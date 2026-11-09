/**
 * A throwaway RSA key pair and a self-signed certificate for it, made in the test, like the pair
 * `npx expo-updates codesigning:generate` makes. Node can read certificates but not make them,
 * so this writes the few DER fields a certificate needs by hand. For tests only.
 */
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

function length(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let rest = n; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const sequence = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const nothing = Buffer.from([0x05, 0x00]);

function integer(bytes) {
  // DER takes the shortest form only, and OpenSSL refuses any other ("illegal padding"): no
  // leading 0 unless the byte after it has its top bit set, where a leading 0 keeps it positive.
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && bytes[start + 1] < 0x80) start += 1;
  const shortest = bytes.subarray(start);
  return tlv(0x02, shortest[0] & 0x80 ? Buffer.concat([Buffer.from([0]), shortest]) : shortest);
}

function oid(dotted) {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const groups = [];
    for (let value = part; ; value = Math.floor(value / 128)) {
      groups.unshift(value % 128);
      if (value < 128) break;
    }
    bytes.push(...groups.map((group, i) => (i < groups.length - 1 ? group | 0x80 : group)));
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date) {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return tlv(0x17, Buffer.from(`${text}Z`));
}

const SHA256_WITH_RSA = sequence(oid('1.2.840.113549.1.1.11'), nothing);

/**
 * The two extensions expo-updates wants on a code signing certificate: Key Usage with Digital
 * Signature, and Extended Key Usage with Code Signing.
 */
const CODE_SIGNING_EXTENSIONS = tlv(
  0xa3,
  sequence(
    sequence(oid('2.5.29.15'), tlv(0x04, tlv(0x03, Buffer.from([7, 0x80])))),
    sequence(oid('2.5.29.37'), tlv(0x04, sequence(oid('1.3.6.1.5.5.7.3.3')))),
  ),
);

/**
 * A key pair and a certificate for its public key, valid from `from` until `to`, for code
 * signing unless `codeSigning` is false. The serial number is random unless given.
 */
export function makeCodeSigningPair({
  from = new Date(Date.now() - 86_400_000),
  to = new Date(Date.now() + 10 * 365 * 86_400_000),
  commonName = 'BannerTV test',
  codeSigning = true,
  serial = randomBytes(8),
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const name = sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName)))));
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    SHA256_WITH_RSA,
    name,
    sequence(utcTime(from), utcTime(to)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    ...(codeSigning ? [CODE_SIGNING_EXTENSIONS] : []),
  );
  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey);
  const der = sequence(
    tbs,
    SHA256_WITH_RSA,
    tlv(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const lines = der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey,
    certificatePem: `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`,
  };
}

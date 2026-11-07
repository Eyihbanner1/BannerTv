/**
 * The cryptography the account needs, which the app provides: Web Crypto on
 * the TV and in the Android WebView, something else on a phone. Keys are
 * passed as raw bytes so the core needs no platform types; an adapter may
 * keep its imported keys by the bytes object, which the core never changes.
 */
export interface SyncCrypto {
  /** `length` bytes from a secure random source. */
  random(length: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  /** HKDF with SHA-256: `length` bytes. */
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  /** AES-256-GCM with a 16-byte tag: the ciphertext with the tag after it. */
  aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    aad: Uint8Array,
    plain: Uint8Array,
  ): Promise<Uint8Array>;
  /** Rejects when the tag does not match: a wrong key, or anything changed. */
  aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    aad: Uint8Array,
    sealed: Uint8Array,
  ): Promise<Uint8Array>;
}

export type CryptoCheck = 'random' | 'SHA-256' | 'HMAC' | 'HKDF' | 'AES-GCM';

function hex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text.split('').map((char) => char.charCodeAt(0)));
}

// Known answers from the standards, checked against Node's Web Crypto.
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
// RFC 4231, test case 2.
const HMAC_JEFE = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
// RFC 5869, A.1.
const HKDF_A1 =
  '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865';
// Test case 16 of the GCM specification.
const GCM_KEY = 'feffe9928665731c6d6a8f9467308308'.repeat(2);
const GCM_IV = 'cafebabefacedbaddecaf888';
const GCM_AAD = 'feedfacedeadbeeffeedfacedeadbeefabaddad2';
const GCM_PLAIN =
  'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
  '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39';
const GCM_SEALED =
  '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
  '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
  '76fc6ece0f4e1768cddf8853bb2d551b';

async function passes(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

/**
 * Checks `crypto` against known answers, so a screen whose engine gets one
 * wrong never seals anything another screen cannot open. Resolves with the
 * names of the checks that failed: none means the account can work here.
 */
export async function checkSyncCrypto(crypto: SyncCrypto): Promise<CryptoCheck[]> {
  const checks: Array<[CryptoCheck, () => Promise<boolean>]> = [
    [
      'random',
      async () => {
        const a = crypto.random(16);
        const b = crypto.random(16);
        return a.length === 16 && b.length === 16 && !same(a, b);
      },
    ],
    ['SHA-256', async () => same(await crypto.sha256(ascii('abc')), hex(SHA_ABC))],
    [
      'HMAC',
      async () =>
        same(
          await crypto.hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?')),
          hex(HMAC_JEFE),
        ),
    ],
    [
      'HKDF',
      async () =>
        same(
          await crypto.hkdf(
            hex('0b'.repeat(22)),
            hex('000102030405060708090a0b0c'),
            hex('f0f1f2f3f4f5f6f7f8f9'),
            42,
          ),
          hex(HKDF_A1),
        ),
    ],
    [
      'AES-GCM',
      async () => {
        const key = hex(GCM_KEY);
        const iv = hex(GCM_IV);
        const aad = hex(GCM_AAD);
        const sealed = await crypto.aesGcmEncrypt(key, iv, aad, hex(GCM_PLAIN));
        if (!same(sealed, hex(GCM_SEALED))) return false;
        if (!same(await crypto.aesGcmDecrypt(key, iv, aad, sealed), hex(GCM_PLAIN))) return false;
        // A changed bit must be refused, not read.
        const damaged = sealed.slice();
        damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
        try {
          await crypto.aesGcmDecrypt(key, iv, aad, damaged);
          return false;
        } catch {
          return true;
        }
      },
    ],
  ];
  const failed: CryptoCheck[] = [];
  for (const [name, check] of checks) {
    if (!(await passes(check))) failed.push(name);
  }
  return failed;
}

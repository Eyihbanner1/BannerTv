/**
 * Makes the LG update key pair, once, on the laptop (services/updates/README.md, "In-app
 * updates on the LG"). Run from the repository's root, with Node alone:
 *
 *   node services/updates/scripts/lg-key.mjs
 *
 * It writes the public key to apps/webos/certs/lg-updates.pem, to be committed (every .ipk built
 * on main from then on carries it, and takes only updates it verifies), and the private key to
 * lg-updates-private.pem in a bannertv-update-keys folder beside the repository, outside it, so
 * it cannot be committed by mistake. The private key's whole text becomes the repository secret
 * LG_UPDATES_PRIVATE_KEY. It refuses to write over either file.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lgKeyId, readLgPublicKey } from './lib/webos.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const publicPath = join(root, 'apps', 'webos', 'certs', 'lg-updates.pem');
const privateDir = resolve(process.argv[2] ?? join(root, '..', 'bannertv-update-keys'));
const privatePath = join(privateDir, 'lg-updates-private.pem');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!relative(root, privateDir).startsWith('..')) {
  fail(
    `${privateDir} is inside the repository: give a folder outside it, so the key is never committed.`,
  );
}
if (existsSync(publicPath)) {
  fail(
    `${publicPath} exists already. A new key pair means every TV needs a new .ipk: delete it first only if that is what you want.`,
  );
}
if (existsSync(privatePath)) fail(`${privatePath} exists already: move it away first.`);

// 3072 bits, as NIST gives for use past 2030; the TV checks it with Web Crypto's RSASSA-PKCS1-v1_5.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
mkdirSync(dirname(publicPath), { recursive: true });
mkdirSync(privateDir, { recursive: true });
writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath, publicKey);

console.log(`Key ${lgKeyId(readLgPublicKey(publicKey))} made.

1. Add the private key as a repository secret: GitHub, the repository, Settings, Secrets and
   variables, Actions, New repository secret. Name LG_UPDATES_PRIVATE_KEY, value the whole of
   ${privatePath}
   from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----.
2. Keep a copy of that file somewhere safe (a password manager), then delete it.
3. Commit ${relative(root, publicPath)} on main, after the secret is there: from then on
   Publish LG update signs every publish, and stops if the secret is missing.`);

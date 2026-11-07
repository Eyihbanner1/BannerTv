import { checkSyncCrypto, type SyncCrypto } from '@bannertv/core';

/**
 * The BannerTV account's cryptography over the page's Web Crypto (ADR 0006).
 * `crypto.subtle` is only promised to a secure context: Chromium counts
 * file:// as one, and the Android WebView's https address is one, but webOS 5
 * has not been tried yet, which is why Diagnostics shows the self-test.
 */

/** What the adapter needs of the page's `crypto`, so a test can hand it Node's. */
export type CryptoSource = Pick<Crypto, 'subtle' | 'getRandomValues'>;

/**
 * The bytes in a buffer of their own. The core hands over plain Uint8Arrays,
 * which TypeScript lets sit on a SharedArrayBuffer; Web Crypto takes neither
 * those nor views that other code could change while it works.
 */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * SyncCrypto over `source`. Imported keys are kept by the bytes they came
 * from, which the core never changes, so a key used for every document (the
 * data key, the name key) is imported once.
 */
export function createWebCrypto(source: CryptoSource): SyncCrypto {
  const subtle = source.subtle;
  const imported = new WeakMap<Uint8Array, Map<string, Promise<CryptoKey>>>();

  function keyOf(
    raw: Uint8Array,
    algorithm: 'HKDF' | 'HMAC' | 'AES-GCM',
    usage: KeyUsage,
  ): Promise<CryptoKey> {
    let keys = imported.get(raw);
    if (!keys) {
      keys = new Map();
      imported.set(raw, keys);
    }
    const name = `${algorithm}:${usage}`;
    let key = keys.get(name);
    if (!key) {
      const params = algorithm === 'HMAC' ? { name: 'HMAC', hash: 'SHA-256' } : algorithm;
      key = Promise.resolve(subtle.importKey('raw', own(raw), params, false, [usage]));
      // A failed import is tried again next time rather than remembered.
      key.catch(() => keys!.delete(name));
      keys.set(name, key);
    }
    return key;
  }

  return {
    random: (length) => source.getRandomValues(new Uint8Array(length)),
    sha256: async (data) => new Uint8Array(await subtle.digest('SHA-256', own(data))),
    async hkdf(ikm, salt, info, length) {
      const key = await keyOf(ikm, 'HKDF', 'deriveBits');
      const bits = await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: own(info) },
        key,
        length * 8,
      );
      return new Uint8Array(bits);
    },
    async hmacSha256(raw, data) {
      const key = await keyOf(raw, 'HMAC', 'sign');
      return new Uint8Array(await subtle.sign('HMAC', key, own(data)));
    },
    async aesGcmEncrypt(raw, iv, aad, plain) {
      const key = await keyOf(raw, 'AES-GCM', 'encrypt');
      const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv: own(iv), additionalData: own(aad), tagLength: 128 },
        key,
        own(plain),
      );
      return new Uint8Array(sealed);
    },
    async aesGcmDecrypt(raw, iv, aad, sealed) {
      const key = await keyOf(raw, 'AES-GCM', 'decrypt');
      const plain = await subtle.decrypt(
        { name: 'AES-GCM', iv: own(iv), additionalData: own(aad), tagLength: 128 },
        key,
        own(sealed),
      );
      return new Uint8Array(plain);
    },
  };
}

/** The page's Web Crypto, or undefined where it has none (outside a secure context, say). */
export function pageCrypto(): SyncCrypto | undefined {
  try {
    const source = typeof window !== 'undefined' ? window.crypto : undefined;
    if (!source || !source.subtle || typeof source.getRandomValues !== 'function') return undefined;
    return createWebCrypto(source);
  } catch {
    return undefined;
  }
}

/**
 * Whether `crypto` gives the known answers for SHA-256, HMAC, HKDF and
 * AES-GCM, both ways, and refuses a changed message. Never rejects: anything
 * that goes wrong is a failed test.
 */
export async function passesSelfTest(crypto: SyncCrypto | undefined): Promise<boolean> {
  if (!crypto) return false;
  try {
    return (await checkSyncCrypto(crypto)).length === 0;
  } catch {
    return false;
  }
}

let tested: Promise<boolean> | undefined;

/** The self-test of this page's Web Crypto, run once per launch and only when asked for. */
export function webCryptoWorks(): Promise<boolean> {
  if (!tested) tested = passesSelfTest(pageCrypto());
  return tested;
}

/**
 * A number in [0, 1) from the secure random source, for profile ids and PIN
 * salts. Math.random only where a page has no `crypto` at all.
 */
export function secureRandom(): number {
  try {
    const word = new Uint32Array(1);
    window.crypto.getRandomValues(word);
    return word[0]! / 4294967296;
  } catch {
    return Math.random();
  }
}

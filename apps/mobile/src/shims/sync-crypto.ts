import { checkSyncCrypto, type SyncCrypto } from '@bannertv/core';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The account's cryptography in plain JavaScript (the audited noble libraries), for Hermes, which
 * has no Web Crypto. Same algorithms as the TV's Web Crypto adapter, so a phone and a TV read each
 * other's documents: SHA-256, HMAC-SHA-256, HKDF-SHA-256 and AES-256-GCM with a 16-byte tag.
 */
export function createNobleCrypto(randomBytes: (length: number) => Uint8Array): SyncCrypto {
  return {
    random: (length) => randomBytes(length),
    sha256: (data) => Promise.resolve(sha256(data)),
    hkdf: (ikm, salt, info, length) => Promise.resolve(hkdf(sha256, ikm, salt, info, length)),
    hmacSha256: (key, data) => Promise.resolve(hmac(sha256, key, data)),
    aesGcmEncrypt: (key, iv, aad, plain) =>
      Promise.resolve().then(() => gcm(key, iv, aad).encrypt(plain)),
    aesGcmDecrypt: (key, iv, aad, sealed) =>
      Promise.resolve().then(() => gcm(key, iv, aad).decrypt(sealed)),
  };
}

/** Whether `crypto` gives the known answers. Never rejects: anything that goes wrong fails it. */
export async function passesSelfTest(crypto: SyncCrypto | undefined): Promise<boolean> {
  if (!crypto) return false;
  try {
    return (await checkSyncCrypto(crypto)).length === 0;
  } catch {
    return false;
  }
}

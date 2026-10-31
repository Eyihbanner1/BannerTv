import type { SyncCrypto } from '@bannertv/core';
import { getRandomValues } from 'expo-crypto';
import { createNobleCrypto, passesSelfTest } from './sync-crypto';

/**
 * The phone's stand-in for the LG app's platform/web-crypto.ts (Metro swaps it in, see
 * metro.config.js). Same exports the shared modules use; the cryptography is noble's, the random
 * bytes the phone's own secure source.
 */

export { passesSelfTest };

function randomBytes(length: number): Uint8Array {
  return getRandomValues(new Uint8Array(length));
}

let crypto: SyncCrypto | undefined;

/** The account's cryptography: always there on a phone. */
export function pageCrypto(): SyncCrypto | undefined {
  if (!crypto) crypto = createNobleCrypto(randomBytes);
  return crypto;
}

let tested: Promise<boolean> | undefined;

/** The self-test, run once per launch and only when asked for. */
export function webCryptoWorks(): Promise<boolean> {
  if (!tested) tested = passesSelfTest(pageCrypto());
  return tested;
}

/** A number in [0, 1) from the secure random source, for profile ids and PIN salts. */
export function secureRandom(): number {
  try {
    const word = getRandomValues(new Uint32Array(1));
    return word[0]! / 4294967296;
  } catch {
    return Math.random();
  }
}

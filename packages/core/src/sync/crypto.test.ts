import { describe, expect, it } from 'vitest';
import { checkSyncCrypto, type SyncCrypto } from './crypto';
import { webCryptoForTests } from './testing';

describe('checkSyncCrypto', () => {
  it('passes Web Crypto', async () => {
    expect(await checkSyncCrypto(webCryptoForTests())).toEqual([]);
  });

  it('names each check a broken engine fails', async () => {
    const good = webCryptoForTests();
    const broken: SyncCrypto = {
      ...good,
      random: (length) => new Uint8Array(length),
      hkdf: () => Promise.reject(new Error('NotSupportedError')),
      // Opens anything, as an engine that ignored the tag would.
      aesGcmDecrypt: async (key, iv, aad, sealed) => sealed.slice(0, sealed.length - 16),
    };
    expect(await checkSyncCrypto(broken)).toEqual(['random', 'HKDF', 'AES-GCM']);
  });
});

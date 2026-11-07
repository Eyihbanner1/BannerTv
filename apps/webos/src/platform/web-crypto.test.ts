import {
  checkSyncCrypto,
  deriveAccountKeys,
  newItems,
  openDocument,
  sealDocument,
  toBase64Url,
  utf8Encode,
  wireName,
} from '@bannertv/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebCrypto,
  type CryptoSource,
  pageCrypto,
  passesSelfTest,
  secureRandom,
} from './web-crypto';

// Node's Web Crypto stands in for the TV's; the known answers are the core's.
const node = globalThis.crypto as unknown as CryptoSource;
const CODE = 'ABCDEFGHJKMNPQRSTUVW';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => (byte < 16 ? '0' : '') + byte.toString(16)).join('');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebCrypto', () => {
  it('gives the known answers for SHA-256, HMAC, HKDF and AES-GCM', async () => {
    expect(await checkSyncCrypto(createWebCrypto(node))).toEqual([]);
  });

  it('derives the core’s pinned keys and document names from a code', async () => {
    const crypto = createWebCrypto(node);
    const keys = await deriveAccountKeys(crypto, CODE);
    expect(keys.accountId).toBe('UkVdMmNwSTzmLeiw_tUFCA');
    expect(keys.auth).toBe('uMZ4fZlO0B2D6m2Ty3RXygJ-T6an3OUzowaLvEkXagA');
    expect(hex(keys.dataKey)).toBe(
      'a316d9b97a0f0afd6497acc770c56e770925c1efb83b3f841c2671d109f9e9e0',
    );
    expect(hex(keys.nameKey)).toBe(
      'c2a0e2ef4f5b122401ab0f1a605c72563c56c62026014da75f37df082240573c',
    );
    expect(toBase64Url(await crypto.sha256(utf8Encode(keys.auth)))).toBe(
      '4nalcLpXaQh1DbOc9uRl1jnM9VfLs27arV4TR0kwxHQ',
    );
    expect(await wireName(crypto, keys, 'profiles')).toBe('8HTbB1aPHHoDBYmorArYGQ');
    expect(await wireName(crypto, keys, 'p/main/watch')).toBe('1NGn-s1QONN9P_NW9CGqLw');
  });

  it('seals a document that opens again, and only as the same document and version', async () => {
    const crypto = createWebCrypto(node);
    const keys = await deriveAccountKeys(crypto, CODE);
    const items = newItems();
    items['main/name'] = { t: 5, v: 'Ada' };
    const body = await sealDocument(crypto, keys, 'profiles', 3, items);
    expect(await openDocument(crypto, keys, 'profiles', 3, body)).toEqual(items);
    await expect(openDocument(crypto, keys, 'addons', 3, body)).rejects.toThrow();
    await expect(openDocument(crypto, keys, 'profiles', 4, body)).rejects.toThrow();
  });

  it('imports each key once, and tries a failed import again', async () => {
    let imports = 0;
    let failNext = true;
    const counting: CryptoSource = {
      getRandomValues: node.getRandomValues.bind(node) as CryptoSource['getRandomValues'],
      subtle: new Proxy(node.subtle, {
        get(target, name) {
          const value = Reflect.get(target, name) as unknown;
          if (name === 'importKey') {
            return (...args: Parameters<SubtleCrypto['importKey']>) => {
              imports += 1;
              if (failNext) {
                failNext = false;
                return Promise.reject(new Error('busy'));
              }
              return target.importKey(...args);
            };
          }
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        },
      }),
    };
    const crypto = createWebCrypto(counting);
    const key = new Uint8Array(32).fill(7);
    const data = utf8Encode('hello');
    await expect(crypto.hmacSha256(key, data)).rejects.toThrow('busy');
    const first = await crypto.hmacSha256(key, data);
    const second = await crypto.hmacSha256(key, data);
    expect(hex(first)).toBe(hex(second));
    expect(imports).toBe(2);
    // The same bytes as an AES key are a key of their own.
    const iv = new Uint8Array(12);
    await crypto.aesGcmEncrypt(key, iv, data, data);
    expect(imports).toBe(3);
  });

  it('reads bytes that sit inside a larger buffer', async () => {
    const crypto = createWebCrypto(node);
    const buffer = new Uint8Array([0, 0, 97, 98, 99, 0]);
    const abc = buffer.subarray(2, 5);
    expect(hex(await crypto.sha256(abc))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('passesSelfTest', () => {
  it('passes Node’s Web Crypto', async () => {
    expect(await passesSelfTest(createWebCrypto(node))).toBe(true);
  });

  it('fails, without rejecting, where there is no Web Crypto or it gets an answer wrong', async () => {
    expect(await passesSelfTest(undefined)).toBe(false);
    const good = createWebCrypto(node);
    expect(
      await passesSelfTest({ ...good, sha256: () => Promise.resolve(new Uint8Array(32)) }),
    ).toBe(false);
    expect(
      await passesSelfTest({
        ...good,
        hkdf: () => {
          throw new Error('NotSupportedError');
        },
      }),
    ).toBe(false);
    // One that opens anything, as an engine that ignored the tag would.
    expect(
      await passesSelfTest({
        ...good,
        aesGcmDecrypt: async (key, iv, aad, sealed) => sealed.slice(0, sealed.length - 16),
      }),
    ).toBe(false);
  });
});

describe('pageCrypto', () => {
  it('is undefined without a page or outside a secure context', () => {
    expect(pageCrypto()).toBeUndefined();
    vi.stubGlobal('window', { crypto: { getRandomValues: node.getRandomValues } });
    expect(pageCrypto()).toBeUndefined();
  });

  it('wraps the page’s Web Crypto', async () => {
    vi.stubGlobal('window', { crypto: node });
    expect(await passesSelfTest(pageCrypto())).toBe(true);
  });
});

describe('secureRandom', () => {
  it('takes its numbers from the page’s secure source', () => {
    vi.stubGlobal('window', {
      crypto: {
        getRandomValues: (array: Uint32Array) => {
          array[0] = 2147483648;
          return array;
        },
      },
    });
    expect(secureRandom()).toBe(0.5);
  });

  it('falls back to Math.random only where the page has no crypto', () => {
    vi.stubGlobal('window', {});
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(secureRandom()).toBe(0.25);
    vi.restoreAllMocks();
  });
});

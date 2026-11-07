import { describe, expect, it } from 'vitest';
import { toBase64Url, utf8Encode } from './bytes';
import { type Items, newItems } from './items';
import { deriveAccountKeys } from './keys';
import { openDocument, padPlaintext, SealError, sealDocument } from './seal';
import { webCryptoForTests } from './testing';

const crypto = webCryptoForTests();
const CODE = 'ABCDEFGHJKMNPQRSTUVW';

function items(entries: Record<string, unknown>): Items {
  const map = newItems();
  for (const key of Object.keys(entries)) map[key] = entries[key] as Items[string];
  return map;
}

async function openError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'opened';
  } catch (error) {
    return error instanceof SealError ? error.kind : 'other';
  }
}

describe('padPlaintext', () => {
  it('pads with spaces to 1 KB, and to 8 KB above 64 KB', () => {
    expect(padPlaintext(new Uint8Array(1)).length).toBe(1024);
    expect(padPlaintext(new Uint8Array(1000)).length).toBe(1024);
    expect(padPlaintext(new Uint8Array(1024)).length).toBe(1024);
    expect(padPlaintext(new Uint8Array(1025)).length).toBe(2048);
    expect(padPlaintext(new Uint8Array(65536)).length).toBe(65536);
    expect(padPlaintext(new Uint8Array(70000)).length).toBe(73728);
    expect(padPlaintext(utf8Encode('{}'))[1023]).toBe(0x20);
  });
});

describe('sealDocument and openDocument', () => {
  it('seals exactly as ADR 0006 says, with the pinned body for a fixed IV', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    const fixed = {
      ...crypto,
      random: (length: number) => Uint8Array.from({ length }, (_, i) => i + 1),
    };
    const body = await sealDocument(fixed, keys, 'profiles', 1, items({ main: { t: 0, v: 1 } }));
    // Worked out with Node's Web Crypto from {"items":{"main":{"t":0,"v":1}},"s":1} padded to 1 KB.
    expect(body.length).toBe(1406);
    expect(body.slice(0, 60)).toBe('1.AQIDBAUGBwgJCgsM.GKp0iZmMUhRW4aiBKFTN5Ig8dbrpGeLC3AsXuKiIr');
    expect(body.slice(-22)).toBe('t-gygAecJyzyFhWCxzZpsk');
  });

  it('opens what it sealed, keys like __proto__ included', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    const sealed = items({
      tt1: { t: 5, v: { type: 'movie', name: 'Amélie' } },
      gone: { t: 6, x: 1 },
    });
    sealed['__proto__'] = { t: 7, v: { type: 'movie', name: 'Odd' } };
    const body = await sealDocument(crypto, keys, 'p/main/list', 3, sealed);
    const opened = await openDocument(crypto, keys, 'p/main/list', 3, body);
    expect(Object.keys(opened).sort()).toEqual(['__proto__', 'gone', 'tt1']);
    expect(opened['__proto__']).toEqual({ t: 7, v: { type: 'movie', name: 'Odd' } });
    expect(Object.getPrototypeOf(opened)).toBeNull();
    expect(opened.tt1).toEqual({ t: 5, v: { type: 'movie', name: 'Amélie' } });
  });

  it('refuses a body moved to another document, version or account, or changed', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    const other = await deriveAccountKeys(crypto, 'BCDEFGHJKMNPQRSTUVWX');
    const body = await sealDocument(crypto, keys, 'addons', 2, items({ order: { t: 1, v: [] } }));
    expect(await openError(openDocument(crypto, keys, 'addons', 2, body))).toBe('opened');
    expect(await openError(openDocument(crypto, keys, 'profiles', 2, body))).toBe('unreadable');
    expect(await openError(openDocument(crypto, keys, 'addons', 3, body))).toBe('unreadable');
    expect(await openError(openDocument(crypto, other, 'addons', 2, body))).toBe('unreadable');
    // A character inside the tag: the last one can hold only padding bits, and change nothing.
    const at = body.length - 4;
    const flipped = body.slice(0, at) + (body[at] === 'A' ? 'B' : 'A') + body.slice(at + 1);
    expect(await openError(openDocument(crypto, keys, 'addons', 2, flipped))).toBe('unreadable');
    expect(await openError(openDocument(crypto, keys, 'addons', 2, 'nonsense'))).toBe('unreadable');
    expect(await openError(openDocument(crypto, keys, 'addons', 2, `2${body.slice(1)}`))).toBe(
      'unreadable',
    );
  });

  it('tells a newer format apart, so it is neither applied nor pushed over', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    const iv = crypto.random(12);
    const plain = utf8Encode('{"items":{},"s":2}');
    const aad = utf8Encode(`bannertv/1|${keys.accountId}|addons|4`);
    const sealed = await crypto.aesGcmEncrypt(keys.dataKey, iv, aad, plain);
    const body = `1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
    expect(await openError(openDocument(crypto, keys, 'addons', 4, body))).toBe('newer');
  });
});

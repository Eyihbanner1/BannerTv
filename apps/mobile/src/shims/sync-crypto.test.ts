import { webcrypto } from 'node:crypto';
import { checkSyncCrypto } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { createWebCrypto } from '../../../webos/src/platform/web-crypto';
import { createNobleCrypto } from './sync-crypto';

const random = (length: number) => webcrypto.getRandomValues(new Uint8Array(length));
const noble = createNobleCrypto(random);
// The TV's own adapter over Node's Web Crypto, which the TV app's tests also use.
const tv = createWebCrypto(webcrypto as unknown as Parameters<typeof createWebCrypto>[0]);

describe("the phone's account cryptography", () => {
  it('passes the core self-test', async () => {
    expect(await checkSyncCrypto(noble)).toEqual([]);
  });

  it('seals what the TV opens, and opens what the TV seals', async () => {
    const key = random(32);
    const iv = random(12);
    const aad = new TextEncoder().encode('document name');
    const plain = new TextEncoder().encode('{"profiles":["Main","Kids"]}');
    const fromPhone = await noble.aesGcmEncrypt(key, iv, aad, plain);
    expect(Array.from(await tv.aesGcmDecrypt(key, iv, aad, fromPhone))).toEqual(Array.from(plain));
    const fromTv = await tv.aesGcmEncrypt(key, iv, aad, plain);
    expect(Array.from(fromTv)).toEqual(Array.from(fromPhone));
    expect(Array.from(await noble.aesGcmDecrypt(key, iv, aad, fromTv))).toEqual(Array.from(plain));
  });

  it('refuses a changed document', async () => {
    const key = random(32);
    const iv = random(12);
    const sealed = await noble.aesGcmEncrypt(key, iv, new Uint8Array(), new Uint8Array([1, 2, 3]));
    sealed[0] = sealed[0]! ^ 1;
    await expect(noble.aesGcmDecrypt(key, iv, new Uint8Array(), sealed)).rejects.toThrow();
  });

  it('derives the same keys and hashes as the TV', async () => {
    const ikm = random(32);
    const salt = random(16);
    const info = new TextEncoder().encode('bannertv data key');
    expect(Array.from(await noble.hkdf(ikm, salt, info, 32))).toEqual(
      Array.from(await tv.hkdf(ikm, salt, info, 32)),
    );
    expect(Array.from(await noble.hmacSha256(ikm, info))).toEqual(
      Array.from(await tv.hmacSha256(ikm, info)),
    );
    expect(Array.from(await noble.sha256(info))).toEqual(Array.from(await tv.sha256(info)));
  });
});

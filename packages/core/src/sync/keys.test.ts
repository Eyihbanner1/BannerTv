import { describe, expect, it } from 'vitest';
import { toBase64Url, utf8Encode } from './bytes';
import { deriveAccountKeys, wireName } from './keys';
import { webCryptoForTests } from './testing';

const crypto = webCryptoForTests();
const CODE = 'ABCDEFGHJKMNPQRSTUVW';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => (byte < 16 ? '0' : '') + byte.toString(16)).join('');
}

// Worked out with Node's Web Crypto, so the Worker and other apps can check against them.
describe('deriveAccountKeys', () => {
  it('gives the pinned id, auth and keys for a code', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    expect(keys.accountId).toBe('UkVdMmNwSTzmLeiw_tUFCA');
    expect(keys.auth).toBe('uMZ4fZlO0B2D6m2Ty3RXygJ-T6an3OUzowaLvEkXagA');
    expect(hex(keys.dataKey)).toBe(
      'a316d9b97a0f0afd6497acc770c56e770925c1efb83b3f841c2671d109f9e9e0',
    );
    expect(hex(keys.nameKey)).toBe(
      'c2a0e2ef4f5b122401ab0f1a605c72563c56c62026014da75f37df082240573c',
    );
    // What the server keeps instead of the auth key.
    expect(toBase64Url(await crypto.sha256(utf8Encode(keys.auth)))).toBe(
      '4nalcLpXaQh1DbOc9uRl1jnM9VfLs27arV4TR0kwxHQ',
    );
  });
});

describe('wireName', () => {
  it('gives the pinned name of each document', async () => {
    const keys = await deriveAccountKeys(crypto, CODE);
    const names: Record<string, string> = {
      profiles: '8HTbB1aPHHoDBYmorArYGQ',
      addons: 'Gy2CknEZL1sWHwPRDgRqMQ',
      'p/main/settings': 'n2lFefGTODC4CMBU6ZCHrA',
      'p/main/list': 'FlO0sfI0qF0F9y0mJj8uhw',
      'p/main/watch': '1NGn-s1QONN9P_NW9CGqLw',
    };
    for (const document of Object.keys(names)) {
      expect(await wireName(crypto, keys, document)).toBe(names[document]);
    }
  });

  it('works a name out once for each set of keys', async () => {
    let macs = 0;
    const counting = {
      ...crypto,
      hmacSha256: (key: Uint8Array, data: Uint8Array) => {
        macs += 1;
        return crypto.hmacSha256(key, data);
      },
    };
    const keys = await deriveAccountKeys(crypto, CODE);
    await wireName(counting, keys, 'profiles');
    await wireName(counting, keys, 'profiles');
    expect(macs).toBe(1);
    const other = await deriveAccountKeys(crypto, 'BCDEFGHJKMNPQRSTUVWX');
    expect(await wireName(counting, other, 'profiles')).not.toBe('8HTbB1aPHHoDBYmorArYGQ');
  });
});

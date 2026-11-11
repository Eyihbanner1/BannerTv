import { describe, expect, it } from 'vitest';
import { historyKey, iconKey, ipkKey, isSha256Hex, readRepoIndex, repoKey } from './webos';

const SHA = 'ef9ec4ad015859d4b48ca7760f42299b09b2e00681cf7bb63399b9965317c38a';
const COMMIT = 'ed387a1228288492187ba32540e721775a2f3292';

function index(manifest: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    packages: [
      {
        id: 'com.bannertv.app',
        title: 'BannerTV',
        manifest: { version: '0.1.4', ipkHash: { sha256: SHA }, ipkSize: 1269838, ...manifest },
        commit: COMMIT,
        publishedAt: '2026-11-09T12:00:00.000Z',
        restoredAt: null,
        ...extra,
      },
    ],
  });
}

describe('the KV keys', () => {
  it('keep the LG repository under webos/, apart from the phone’s', () => {
    expect(repoKey('main')).toBe('webos/repo/main');
    expect(historyKey('main')).toBe('webos/history/main');
    expect(ipkKey(SHA)).toBe(`webos/ipk/${SHA}`);
    expect(iconKey(SHA)).toBe(`webos/icon/${SHA}`);
  });

  it('take SHA-256 in lower-case hex only, as Homebrew Channel compares it', () => {
    expect(isSha256Hex(SHA)).toBe(true);
    expect(isSha256Hex(SHA.toUpperCase())).toBe(false);
    expect(isSha256Hex(SHA.slice(1))).toBe(false);
  });
});

describe('reading a stored index for /status', () => {
  it('gives the build it offers', () => {
    expect(readRepoIndex(index())).toEqual({
      version: '0.1.4',
      sha256: SHA,
      ipkSize: 1269838,
      commit: COMMIT,
      publishedAt: '2026-11-09T12:00:00.000Z',
      restoredAt: null,
    });
    expect(readRepoIndex(index({}, { restoredAt: '2026-11-10T08:00:00.000Z' }))?.restoredAt).toBe(
      '2026-11-10T08:00:00.000Z',
    );
  });

  it('reads nothing published, or another app only, as none', () => {
    expect(readRepoIndex(null)).toBeUndefined();
    expect(readRepoIndex('{"packages":[]}')).toBeUndefined();
    expect(readRepoIndex(index().replace('com.bannertv.app', 'org.other.app'))).toBeUndefined();
  });

  it.each([
    ['not JSON', '{'],
    ['no list', '{"packages":{}}'],
    ['a version out of form', index({ version: '0.1' })],
    ['an upper-case hash', index({ ipkHash: { sha256: SHA.toUpperCase() } })],
    ['no hash', index({ ipkHash: undefined })],
  ])('reads an index with %s as none', (_, text) => {
    expect(readRepoIndex(text)).toBeUndefined();
  });

  it('leaves out what it cannot read beside the version and hash', () => {
    expect(readRepoIndex(index({ ipkSize: -1 }, { commit: 7, publishedAt: undefined }))).toEqual({
      version: '0.1.4',
      sha256: SHA,
      ipkSize: null,
      commit: null,
      publishedAt: null,
      restoredAt: null,
    });
  });
});

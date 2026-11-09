import { HttpError } from '@bannertv/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkHomebrewRepo,
  compareVersions,
  HOMEBREW_CHANNEL_ID,
  HOMEBREW_REPO_URL,
  parseVersion,
  REPO_TIMEOUT_MS,
  repoNews,
  repoVersion,
} from './homebrew';

const APP = 'com.bannertv.app';
const SHA = 'c0ffee'.repeat(10) + 'c0de';

/** The list's one entry as the updates Worker serves it, with our own extra fields. */
function entry(version: unknown, extra: Record<string, unknown> = {}) {
  const icon = new URL(`icon/${SHA}.png`, HOMEBREW_REPO_URL).href;
  return {
    id: APP,
    title: 'BannerTV',
    iconUri: icon,
    shortDescription: 'Films and series from the addons you choose.',
    commit: '0123abc',
    publishedAt: '2026-11-09T18:00:00.000Z',
    manifest: {
      id: APP,
      version,
      type: 'web',
      title: 'BannerTV',
      appDescription: 'Films and series from the addons you choose, in one place.',
      iconUri: icon,
      ipkUrl: new URL(`ipk/${SHA}.ipk`, HOMEBREW_REPO_URL).href,
      ipkHash: { sha256: SHA },
      ipkSize: 2_345_678,
      rootRequired: false,
    },
    ...extra,
  };
}

describe('the repository address', () => {
  it('is the updates Worker over https, so the same list serves Homebrew Channel and Settings', () => {
    expect(HOMEBREW_REPO_URL).toBe('https://updates.bannertv.workers.dev/webos/repo.json');
  });
});

describe('parseVersion', () => {
  it('reads major.minor.patch as numbers', () => {
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0]);
    expect(parseVersion('12.999.999')).toEqual([12, 999, 999]);
  });

  it('takes nothing else, as LG takes nothing else', () => {
    for (const value of [
      '',
      '0.1',
      '0.1.0.0',
      'v0.1.0',
      '0.1.0-beta',
      '0.1.0+5',
      ' 0.1.0',
      '0.1.0\n',
      '01.0.0',
      '0.01.0',
      '1e3.0.0',
      '1.0.0000000001',
      '١.٢.٣',
    ]) {
      expect(parseVersion(value), value).toBeNull();
    }
    for (const value of [1, 0.1, null, undefined, {}, ['0', '1', '0']]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('compares part by part as numbers, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.999.999')).toBeGreaterThan(0);
    expect(compareVersions('0.1.2', '0.1.10')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('is null when either side is out of form', () => {
    expect(compareVersions('0.2', '0.1.0')).toBeNull();
    expect(compareVersions('0.2.0', 'latest')).toBeNull();
  });
});

describe('repoVersion', () => {
  it("reads the version from BannerTV's entry, extra fields and all", () => {
    expect(repoVersion({ packages: [entry('0.2.0')] }, APP)).toBe('0.2.0');
    expect(
      repoVersion({ generatedAt: 'now', paging: { page: 1 }, packages: [entry('0.2.0')] }, APP),
    ).toBe('0.2.0');
  });

  it('passes over other apps and entries out of form, and the first BannerTV entry decides', () => {
    const other = { ...entry('9.9.9'), id: 'org.example.other' };
    expect(repoVersion({ packages: [null, 'x', 7, [], other, entry('0.3.0')] }, APP)).toBe('0.3.0');
    expect(repoVersion({ packages: [entry('0.3.0'), entry('0.4.0')] }, APP)).toBe('0.3.0');
    expect(repoVersion({ packages: [other] }, APP)).toBeNull();
  });

  it('is null when nothing is published yet', () => {
    expect(repoVersion({ packages: [] }, APP)).toBeNull();
  });

  it('is null for an answer that is not a Homebrew Channel list', () => {
    for (const index of [
      null,
      undefined,
      'packages',
      42,
      true,
      [],
      [entry('0.2.0')],
      {},
      { packages: null },
      { packages: {} },
      { packages: { 0: entry('0.2.0'), length: 1 } },
      { apps: [entry('0.2.0')] },
    ]) {
      expect(repoVersion(index, APP)).toBeNull();
    }
  });

  it("is null when BannerTV's entry has no usable manifest version", () => {
    const { manifest, ...bare } = entry('0.2.0');
    expect(repoVersion({ packages: [bare] }, APP)).toBeNull();
    // Only a manifestUrl: Homebrew Channel would fetch it, Settings does not.
    expect(
      repoVersion({ packages: [{ ...bare, manifestUrl: 'https://example.test/m.json' }] }, APP),
    ).toBeNull();
    expect(repoVersion({ packages: [{ ...bare, manifest: 'x' }] }, APP)).toBeNull();
    expect(repoVersion({ packages: [{ ...bare, manifest: [] }] }, APP)).toBeNull();
    const noVersion: Record<string, unknown> = { ...manifest };
    delete noVersion.version;
    expect(repoVersion({ packages: [{ ...bare, manifest: noVersion }] }, APP)).toBeNull();
    for (const version of [2, null, '', '0.2', 'v0.2.0', { major: 0 }]) {
      expect(repoVersion({ packages: [entry(version)] }, APP)).toBeNull();
    }
    // A version only at the top of the entry is not the manifest's.
    expect(repoVersion({ packages: [{ ...bare, version: '0.2.0' }] }, APP)).toBeNull();
  });
});

describe('repoNews', () => {
  it('says a newer build is ready, with its version', () => {
    expect(repoNews({ packages: [entry('0.2.0')] }, APP, '0.1.0')).toEqual({
      kind: 'ready',
      version: '0.2.0',
    });
    expect(repoNews({ packages: [entry('0.10.0')] }, APP, '0.9.3')).toEqual({
      kind: 'ready',
      version: '0.10.0',
    });
  });

  it('says this is the latest build when the list has the same one', () => {
    expect(repoNews({ packages: [entry('0.1.0')] }, APP, '0.1.0')).toEqual({ kind: 'latest' });
  });

  it('says when the list has an older build than this one', () => {
    expect(repoNews({ packages: [entry('0.1.0')] }, APP, '0.1.1')).toEqual({
      kind: 'older',
      version: '0.1.0',
    });
  });

  it('has nothing to say for an empty list, junk, or a version out of form on either side', () => {
    expect(repoNews({ packages: [] }, APP, '0.1.0')).toEqual({ kind: 'none' });
    expect(repoNews('<!doctype html>', APP, '0.1.0')).toEqual({ kind: 'none' });
    expect(repoNews({ packages: [entry('0.2')] }, APP, '0.1.0')).toEqual({ kind: 'none' });
    expect(repoNews({ packages: [entry('0.2.0')] }, APP, 'dev')).toEqual({ kind: 'none' });
  });
});

describe('checkHomebrewRepo', () => {
  it('asks the repository address once, with the short timeout', async () => {
    const fetchJson = vi.fn(() => Promise.resolve({ packages: [entry('0.2.0')] }));
    await expect(checkHomebrewRepo(fetchJson, APP, '0.1.0')).resolves.toEqual({
      kind: 'ready',
      version: '0.2.0',
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(HOMEBREW_REPO_URL, { timeoutMs: REPO_TIMEOUT_MS });
  });

  it('never rejects: no answer, a timeout, an error status or junk all say nothing', async () => {
    for (const error of [
      new HttpError('network', 'The addon could not be reached'),
      new HttpError('timeout', 'No answer after 8 s'),
      new HttpError('status', 'The addon answered 503', 503),
      new HttpError('invalid', 'The addon did not answer with JSON'),
      new Error('anything else'),
    ]) {
      await expect(checkHomebrewRepo(() => Promise.reject(error), APP, '0.1.0')).resolves.toEqual({
        kind: 'none',
      });
    }
    await expect(checkHomebrewRepo(() => Promise.resolve('junk'), APP, '0.1.0')).resolves.toEqual({
      kind: 'none',
    });
  });
});

/** A Luna call as the page sent it. */
interface Sent {
  uri: string;
  params: Record<string, unknown>;
}

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

describe('on the TV', () => {
  let sent: Sent[];
  let local: MemoryStorage;
  let launchAnswer: Record<string, unknown>;

  /** The page as an LG TV runs it, its service bridge answering each call with launchAnswer. */
  function onTv(extra: Record<string, unknown> = {}) {
    vi.stubGlobal('window', {
      PalmSystem: { launchParams: '{}' },
      PalmServiceBridge: class {
        onservicecallback: ((message: string) => void) | null = null;
        call(uri: string, payload: string) {
          sent.push({ uri, params: JSON.parse(payload) as Record<string, unknown> });
          setTimeout(() => this.onservicecallback?.(JSON.stringify(launchAnswer)), 0);
        }
        cancel() {}
      },
      ...extra,
    });
  }

  /** A launch of the app: homebrew.ts reads its flag from localStorage afresh. */
  async function launch() {
    vi.resetModules();
    return import('./homebrew');
  }

  beforeEach(() => {
    sent = [];
    local = new MemoryStorage();
    launchAnswer = { returnValue: true, processId: '1001' };
    vi.stubGlobal('localStorage', local);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../app/features');
  });

  it('shows updates on an LG TV only', async () => {
    onTv();
    expect((await launch()).homebrewUpdatesShown()).toBe(true);
    // The Android app shows the same page; it has no Homebrew Channel.
    onTv({ BannerAndroid: { protocol: () => '1' } });
    expect((await launch()).homebrewUpdatesShown()).toBe(false);
    // A browser: the development build and the journeys.
    vi.stubGlobal('window', {});
    expect((await launch()).homebrewUpdatesShown()).toBe(false);
  });

  it('shows nothing on an LG TV when the build switch is off, as for the LG store', async () => {
    vi.doMock('../app/features', () => ({
      SPORTS_IN_BUILD: true,
      HOMEBREW_UPDATES_IN_BUILD: false,
    }));
    onTv();
    expect((await launch()).homebrewUpdatesShown()).toBe(false);
  });

  it("opens Homebrew Channel on its Add repository dialog with BannerTV's list, and remembers", async () => {
    onTv();
    const homebrew = await launch();
    expect(homebrew.homebrewListSent.get()).toBe(false);
    await homebrew.openHomebrewChannel('add-list');
    expect(sent).toEqual([
      {
        uri: 'luna://com.webos.applicationManager/launch',
        params: {
          id: HOMEBREW_CHANNEL_ID,
          params: { launchMode: 'addRepository', url: HOMEBREW_REPO_URL },
        },
      },
    ]);
    expect(homebrew.homebrewListSent.get()).toBe(true);
    // The next launch of BannerTV still knows.
    expect((await launch()).homebrewListSent.get()).toBe(true);
  });

  it('opens Homebrew Channel as it is, with no launch params', async () => {
    onTv();
    const homebrew = await launch();
    await homebrew.openHomebrewChannel('open');
    expect(sent).toEqual([
      { uri: 'luna://com.webos.applicationManager/launch', params: { id: HOMEBREW_CHANNEL_ID } },
    ]);
    expect(homebrew.homebrewListSent.get()).toBe(false);
  });

  it('rejects when Homebrew Channel is not on the TV, and remembers nothing', async () => {
    onTv();
    launchAnswer = {
      returnValue: false,
      errorCode: -101,
      errorText: '"org.webosbrew.hbchannel" was not found OR Unsupported Application Type',
    };
    const homebrew = await launch();
    await expect(homebrew.openHomebrewChannel('add-list')).rejects.toThrow();
    expect(homebrew.homebrewListSent.get()).toBe(false);
    expect(local.getItem(homebrew.LIST_SENT_KEY)).toBeNull();
  });

  it('still remembers for this run when the TV keeps no localStorage', async () => {
    onTv();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage is off');
      },
      setItem: () => {
        throw new Error('storage is off');
      },
    });
    const homebrew = await launch();
    expect(homebrew.homebrewListSent.get()).toBe(false);
    await homebrew.openHomebrewChannel('add-list');
    expect(homebrew.homebrewListSent.get()).toBe(true);
  });
});

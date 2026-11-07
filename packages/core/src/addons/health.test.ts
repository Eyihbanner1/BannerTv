import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { memoryKeyValueStore } from '../storage';
import type { InstalledAddon } from './collection';
import {
  answerState,
  createAddonHealth,
  installForUrl,
  installIdForUrl,
  observeAnswers,
} from './health';

function addon(transportUrl: string, installId?: string): InstalledAddon {
  const installed: InstalledAddon = {
    transportUrl,
    manifest: parseManifest({
      id: `org.${transportUrl.length}`,
      version: '1.0.0',
      name: 'Example',
      types: ['movie'],
      resources: ['catalog'],
      catalogs: [],
    }),
    official: false,
    fetchedAt: 0,
  };
  if (installId) installed.installId = installId;
  return installed;
}

/** Lets the persisted store finish its read and save. The core has no timers to wait on. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('answerState', () => {
  it('reads an answer by the share of its time it took', () => {
    expect(answerState(undefined, 1200, 10000)).toBe('fine');
    expect(answerState(undefined, 5000, 10000)).toBe('fine');
    expect(answerState(undefined, 5001, 10000)).toBe('slow');
    expect(answerState(undefined, 7000, 15000)).toBe('fine');
  });

  it('counts no answer, a time-out, a server error and garbage as failed, and a 4xx as nothing', () => {
    expect(answerState(new HttpError('network', 'offline'), 10, 10000)).toBe('failed');
    expect(answerState(new HttpError('timeout', 'slow'), 10000, 10000)).toBe('failed');
    expect(answerState(new HttpError('invalid', 'html'), 10, 10000)).toBe('failed');
    expect(answerState(new HttpError('status', '502', 502), 10, 10000)).toBe('failed');
    expect(answerState(new HttpError('status', '404', 404), 10, 10000)).toBeUndefined();
    expect(answerState(new Error('odd'), 10, 10000)).toBe('failed');
  });
});

describe('installForUrl', () => {
  const a = addon('https://host.example/a/manifest.json', 'one');
  const ab = addon('https://host.example/ab/manifest.json', 'two');
  const root = addon('https://host.example/manifest.json', 'three');

  it('finds the install a request goes to by the longest base', () => {
    const addons = [root, a, ab];
    expect(installForUrl(addons, 'https://host.example/a/catalog/movie/top.json')).toBe(a);
    expect(installForUrl(addons, 'https://host.example/ab/stream/movie/tt1.json')).toBe(ab);
    expect(installForUrl(addons, 'https://host.example/meta/movie/tt1.json')).toBe(root);
    expect(installForUrl(addons, 'https://host.example/a/manifest.json')).toBe(a);
    expect(installForUrl(addons, 'https://other.example/manifest.json')).toBeUndefined();
    expect(installIdForUrl(addons, 'https://host.example/abc/x.json')).toBe('three');
    expect(installIdForUrl([a, ab], 'https://host.example/abc/x.json')).toBeUndefined();
  });
});

describe('createAddonHealth', () => {
  it('tells and saves a change of state only, and any answer clears a failure', async () => {
    const storage = memoryKeyValueStore();
    let time = 1000;
    const health = createAddonHealth({ storage, now: () => time });
    await health.load();
    const listener = vi.fn();
    health.subscribe(listener);

    health.note('one', 'fine');
    await settle();
    expect(health.get().get('one')).toEqual({ state: 'fine', since: 1000 });
    expect(listener).toHaveBeenCalledTimes(1);
    const first = health.get();

    time = 2000;
    health.note('one', 'fine');
    await settle();
    expect(health.get()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    time = 3000;
    health.note('one', 'failed');
    time = 4000;
    health.note('one', 'failed');
    await settle();
    // Since the first failure in a row.
    expect(health.get().get('one')).toEqual({ state: 'failed', since: 3000 });
    expect(await storage.get('addon-health')).toEqual([['one', 'failed', 3000]]);

    time = 5000;
    health.note('one', 'slow');
    await settle();
    expect(health.get().get('one')).toEqual({ state: 'slow', since: 5000 });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('keeps a failure across a restart, with its time, and lays early answers over it', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('addon-health', [
      ['one', 'failed', 3000],
      ['two', 'failed', 3500],
      ['bad', 'gone', 1],
      'nonsense',
    ]);
    let time = 9000;
    const health = createAddonHealth({ storage, now: () => time });
    // Answers before the read finishes: the failure goes on, and keeps its first time.
    health.note('one', 'failed');
    health.note('two', 'fine');
    await health.load();
    await settle();
    expect(health.get().get('one')).toEqual({ state: 'failed', since: 3000 });
    expect(health.get().get('two')).toEqual({ state: 'fine', since: 9000 });
    expect(health.get().has('bad')).toBe(false);
    time = 9500;
    health.forget(['one', 'unknown']);
    await settle();
    expect(Array.from(health.get().keys())).toEqual(['two']);
    expect(await storage.get('addon-health')).toEqual([['two', 'fine', 9000]]);
  });

  it('starts empty when the saved value cannot be read', async () => {
    const storage = memoryKeyValueStore();
    storage.get = () => Promise.reject(new Error('disk'));
    const health = createAddonHealth({ storage });
    await health.load();
    expect(health.get().size).toBe(0);
  });
});

describe('observeAnswers', () => {
  it("notes each addon request's answer and leaves the answer and errors as they were", async () => {
    let clock = 0;
    const answers = new Map<string, () => Promise<unknown>>([
      ['https://a.example/catalog/movie/top.json', () => Promise.resolve({ metas: [] })],
      [
        'https://a.example/stream/movie/tt1.json',
        () => {
          clock += 9000;
          return Promise.resolve({ streams: [] });
        },
      ],
      [
        'https://a.example/meta/movie/tt1.json',
        () => Promise.reject(new HttpError('status', '404', 404)),
      ],
      [
        'https://a.example/meta/movie/tt2.json',
        () => Promise.reject(new HttpError('timeout', 't')),
      ],
      ['https://api.example/tmdb.json', () => Promise.reject(new HttpError('network', 'n'))],
    ]);
    const inner = vi.fn((url: string) => answers.get(url)!());
    const note = vi.fn();
    const fetchJson = observeAnswers(inner, {
      installOf: (url) => (url.indexOf('https://a.example/') === 0 ? 'one' : undefined),
      note,
      elapsed: () => clock,
    });

    await expect(
      fetchJson('https://a.example/catalog/movie/top.json', { timeoutMs: 10000 }),
    ).resolves.toEqual({ metas: [] });
    await fetchJson('https://a.example/stream/movie/tt1.json', { timeoutMs: 15000 });
    await expect(
      fetchJson('https://a.example/meta/movie/tt1.json', { timeoutMs: 10000 }),
    ).rejects.toMatchObject({ kind: 'status' });
    await expect(
      fetchJson('https://a.example/meta/movie/tt2.json', { timeoutMs: 10000 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await expect(
      fetchJson('https://api.example/tmdb.json', { timeoutMs: 10000 }),
    ).rejects.toMatchObject({ kind: 'network' });

    expect(note.mock.calls).toEqual([
      ['one', 'fine'],
      ['one', 'slow'],
      ['one', 'failed'],
    ]);
    expect(inner).toHaveBeenCalledWith('https://a.example/stream/movie/tt1.json', {
      timeoutMs: 15000,
    });
  });
});

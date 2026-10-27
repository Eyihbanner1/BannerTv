import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { memoryKeyValueStore } from '../storage';
import { createAddonCollection, InstallError, type StoredAddon } from './collection';
import { CINEMETA_URL, DEFAULT_ADDONS } from './defaults';

const EXTRA_URL = 'https://addon.example.com/conf/manifest.json';
const EXTRA_MANIFEST = {
  id: 'org.example',
  version: '1.0.0',
  name: 'Example',
  types: ['movie'],
  resources: ['stream'],
};

function setup(
  fetchJson = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(EXTRA_MANIFEST)),
) {
  const storage = memoryKeyValueStore();
  let time = 1000;
  const collection = createAddonCollection({
    storage,
    fetchJson,
    defaults: DEFAULT_ADDONS,
    now: () => time,
  });
  return { storage, collection, fetchJson, setTime: (t: number) => (time = t) };
}

const urls = (collection: { get(): { addons: readonly { transportUrl: string }[] } }) =>
  collection.get().addons.map((a) => a.transportUrl);

describe('createAddonCollection', () => {
  it('installs Cinemeta and OpenSubtitles on first launch and saves them', async () => {
    const { collection, storage } = setup();
    expect(collection.get().ready).toBe(false);
    await collection.load();
    expect(collection.get().ready).toBe(true);
    expect(collection.get().addons.map((a) => a.manifest.name)).toEqual([
      'Cinemeta',
      'OpenSubtitles v3',
    ]);
    expect(collection.get().addons[0]!.official).toBe(true);
    expect(((await storage.get('addons')) as StoredAddon[]).length).toBe(2);
  });

  it('keeps an empty collection empty instead of bringing the defaults back', async () => {
    const { collection, storage } = setup();
    await storage.set('addons', []);
    await collection.load();
    expect(collection.get().addons).toEqual([]);
  });

  it('skips saved entries that no longer read as addons', async () => {
    const { collection, storage } = setup();
    await storage.set('addons', [
      { transportUrl: EXTRA_URL, manifest: { id: 'broken' }, official: false, fetchedAt: 1 },
      DEFAULT_ADDONS[0],
      'junk',
    ]);
    await collection.load();
    expect(urls(collection)).toEqual([CINEMETA_URL]);
  });

  it('installs from a typed address, and reinstalling updates in place', async () => {
    const { collection, fetchJson, storage } = setup();
    await collection.load();
    const addon = await collection.install('stremio://addon.example.com/conf/manifest.json');
    expect(fetchJson).toHaveBeenCalledWith(EXTRA_URL, { timeoutMs: 10000 });
    expect(addon).toMatchObject({ transportUrl: EXTRA_URL, official: false, fetchedAt: 1000 });
    expect(urls(collection)).toEqual([...DEFAULT_ADDONS.map((a) => a.transportUrl), EXTRA_URL]);

    await collection.install(EXTRA_URL);
    expect(collection.get().addons).toHaveLength(3);
    const saved = (await storage.get('addons')) as StoredAddon[];
    expect(saved[2]).toEqual({
      transportUrl: EXTRA_URL,
      manifest: EXTRA_MANIFEST,
      official: false,
      fetchedAt: 1000,
    });
  });

  it("puts a reconfigured addon in the old one's place", async () => {
    const { collection, storage } = setup();
    await collection.load();
    await collection.install(EXTRA_URL);
    collection.move(EXTRA_URL, -5);
    const configured = 'https://addon.example.com/new-settings/manifest.json';
    await collection.install(configured, { replaces: EXTRA_URL });
    expect(urls(collection)).toEqual([configured, ...DEFAULT_ADDONS.map((a) => a.transportUrl)]);
    const saved = (await storage.get('addons')) as StoredAddon[];
    expect(saved.map((a) => a.transportUrl)).toEqual(urls(collection));

    // Settings that match an addon already in the list update that one instead.
    await collection.install(CINEMETA_URL, { replaces: configured });
    expect(urls(collection)).toEqual(DEFAULT_ADDONS.map((a) => a.transportUrl));
    // Replacing an addon with itself, or one that is gone, is a plain install.
    await collection.install(EXTRA_URL, { replaces: EXTRA_URL });
    await collection.install(configured, { replaces: 'https://gone.example.com/manifest.json' });
    expect(urls(collection)).toHaveLength(4);
  });

  it('explains why an install failed', async () => {
    const failing = setup(vi.fn(() => Promise.reject(new HttpError('network', 'offline'))));
    await expect(failing.collection.install('not a url')).rejects.toMatchObject({
      kind: 'invalid-url',
    });
    await expect(failing.collection.install(EXTRA_URL)).rejects.toMatchObject({
      kind: 'unreachable',
    });
    const notAddon = setup(vi.fn(() => Promise.resolve({ hello: 'world' })));
    await expect(notAddon.collection.install(EXTRA_URL)).rejects.toBeInstanceOf(InstallError);
    await expect(notAddon.collection.install(EXTRA_URL)).rejects.toMatchObject({
      kind: 'not-an-addon',
    });
  });

  it('removes and reorders addons', async () => {
    const { collection } = setup();
    await collection.load();
    await collection.install(EXTRA_URL);
    collection.move(EXTRA_URL, -5);
    expect(urls(collection)[0]).toBe(EXTRA_URL);
    collection.move(EXTRA_URL, 1);
    expect(urls(collection)[1]).toBe(EXTRA_URL);
    collection.remove(CINEMETA_URL);
    expect(urls(collection)).toEqual([EXTRA_URL, DEFAULT_ADDONS[1]!.transportUrl]);
  });

  it('refreshes old manifests and keeps the old one when an addon is down', async () => {
    const fetchJson = vi.fn((url: string): Promise<unknown> => {
      if (url === CINEMETA_URL) {
        return Promise.resolve({ ...(DEFAULT_ADDONS[0]!.manifest as object), version: '9.9.9' });
      }
      return Promise.reject(new HttpError('timeout', 'slow'));
    });
    const { collection, setTime } = setup(fetchJson);
    await collection.load();
    setTime(5000);
    await collection.refreshManifests(1000);
    const [cinemeta, subtitles] = collection.get().addons;
    expect(cinemeta!.manifest.version).toBe('9.9.9');
    expect(cinemeta!.fetchedAt).toBe(5000);
    expect(subtitles!.fetchedAt).toBe(0);

    fetchJson.mockClear();
    await collection.refreshManifests(1000);
    // Only the one that failed is old enough to try again.
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([DEFAULT_ADDONS[1]!.transportUrl]);
  });
});

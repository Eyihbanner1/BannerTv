import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { memoryKeyValueStore } from '../storage';
import { createAddonCollection, InstallError, installIdOf, type StoredAddon } from './collection';
import { BANNERTV_DEMO_URL, CINEMETA_URL, DEFAULT_ADDONS } from './defaults';

/** Cinemeta and OpenSubtitles v3 as shipped: two official addons, without BannerTV Demo. */
const STREMIO_DEFAULTS = DEFAULT_ADDONS.filter((a) => a.transportUrl !== BANNERTV_DEMO_URL);

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
  defaults: readonly StoredAddon[] = STREMIO_DEFAULTS,
) {
  const storage = memoryKeyValueStore();
  let time = 1000;
  const collection = createAddonCollection({
    storage,
    fetchJson,
    defaults,
    now: () => time,
  });
  return { storage, collection, fetchJson, setTime: (t: number) => (time = t) };
}

const urls = (collection: { get(): { addons: readonly { transportUrl: string }[] } }) =>
  collection.get().addons.map((a) => a.transportUrl);

describe('createAddonCollection', () => {
  it('installs BannerTV Demo, Cinemeta and OpenSubtitles on first launch and saves them', async () => {
    const { collection, storage } = setup(undefined, DEFAULT_ADDONS);
    expect(collection.get().ready).toBe(false);
    await collection.load();
    expect(collection.get().ready).toBe(true);
    expect(collection.get().addons.map((a) => a.manifest.name)).toEqual([
      'BannerTV Demo',
      'Cinemeta',
      'OpenSubtitles v3',
    ]);
    expect(collection.get().addons.every((a) => a.official)).toBe(true);
    expect(((await storage.get('addons')) as StoredAddon[]).length).toBe(3);
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
      STREMIO_DEFAULTS[0],
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
    expect(urls(collection)).toEqual([...STREMIO_DEFAULTS.map((a) => a.transportUrl), EXTRA_URL]);

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
    expect(urls(collection)).toEqual([configured, ...STREMIO_DEFAULTS.map((a) => a.transportUrl)]);
    const saved = (await storage.get('addons')) as StoredAddon[];
    expect(saved.map((a) => a.transportUrl)).toEqual(urls(collection));
    // It is the same install, by a name that does not give its address away.
    const first = installIdOf({ ...collection.get().addons[0]!, transportUrl: EXTRA_URL });
    expect(saved[0]!.installId).toBe(first);
    expect(saved[0]!.installId).not.toContain('example');
    const reloaded = createAddonCollection({
      storage,
      fetchJson: () => Promise.resolve(EXTRA_MANIFEST),
      defaults: STREMIO_DEFAULTS,
    });
    await reloaded.load();
    expect(installIdOf(reloaded.get().addons[0]!)).toBe(first);
    expect(saved.slice(1).every((a) => a.installId === undefined)).toBe(true);
    // Installed again from its first address, the new copy gets a name of its own.
    await reloaded.install(EXTRA_URL);
    const names = reloaded.get().addons.map(installIdOf);
    expect(new Set(names).size).toBe(names.length);
    const again = createAddonCollection({
      storage,
      fetchJson: vi.fn(),
      defaults: STREMIO_DEFAULTS,
    });
    await again.load();
    expect(again.get().addons.map(installIdOf)).toEqual(names);

    // Settings that match an addon already in the list update that one instead.
    await collection.install(CINEMETA_URL, { replaces: configured });
    expect(urls(collection)).toEqual(STREMIO_DEFAULTS.map((a) => a.transportUrl));

    // Replacing an addon with itself updates it where it is.
    await collection.install(EXTRA_URL);
    collection.move(EXTRA_URL, -5);
    await collection.install(EXTRA_URL, { replaces: EXTRA_URL });
    const order = [EXTRA_URL, ...STREMIO_DEFAULTS.map((a) => a.transportUrl)];
    expect(urls(collection)).toEqual(order);
    // Replacing one that is gone is a plain install.
    await collection.install(configured, { replaces: 'https://gone.example.com/manifest.json' });
    expect(urls(collection)).toEqual([...order, configured]);
    const stored = (await storage.get('addons')) as StoredAddon[];
    expect(stored.map((a) => a.transportUrl)).toEqual(urls(collection));
    expect(stored.every((a) => a.manifest !== undefined)).toBe(true);
  });

  it('refuses settings that are for a different addon', async () => {
    const other = { ...EXTRA_MANIFEST, id: 'org.other', name: 'Other' };
    const fetchJson = vi.fn((url: string): Promise<unknown> =>
      Promise.resolve(url.includes('/other/') ? other : EXTRA_MANIFEST),
    );
    const elsewhere = 'https://other.example.com/other/manifest.json';
    const sameServer = 'https://addon.example.com/other/manifest.json';
    const { collection, storage } = setup(fetchJson);
    await collection.load();
    await collection.install(EXTRA_URL);
    const before = urls(collection);
    for (const url of [elsewhere, sameServer]) {
      await expect(collection.install(url, { replaces: EXTRA_URL })).rejects.toMatchObject({
        kind: 'different-addon',
      });
    }
    expect(urls(collection)).toEqual(before);
    const stored = (await storage.get('addons')) as StoredAddon[];
    expect(stored.map((a) => a.transportUrl)).toEqual(before);

    // The same addon on the same server, with a hash of its settings in its id.
    other.name = EXTRA_MANIFEST.name;
    await expect(collection.install(sameServer, { replaces: EXTRA_URL })).resolves.toMatchObject({
      manifest: { id: 'org.other' },
    });
    expect(urls(collection)).toEqual([...before.slice(0, -1), sameServer]);

    // A hash of the settings in the id, and a name taken from the settings.
    const hashed = 'https://addon.example.com/hashed/manifest.json';
    const rehashed = 'https://addon.example.com/rehashed/manifest.json';
    fetchJson.mockImplementation((url: string) =>
      Promise.resolve(
        url === hashed
          ? { ...EXTRA_MANIFEST, id: 'org.example.0123456789ab', name: 'Example (home)' }
          : { ...EXTRA_MANIFEST, id: 'org.example.ba9876543210', name: 'Example (away)' },
      ),
    );
    await collection.install(hashed);
    await expect(collection.install(rehashed, { replaces: hashed })).resolves.toMatchObject({
      manifest: { name: 'Example (away)' },
    });
    expect(urls(collection)).toContain(rehashed);
    expect(urls(collection)).not.toContain(hashed);
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
    expect(urls(collection)).toEqual([EXTRA_URL, STREMIO_DEFAULTS[1]!.transportUrl]);
  });

  it('refreshes old manifests and keeps the old one when an addon is down', async () => {
    const fetchJson = vi.fn((url: string): Promise<unknown> => {
      if (url === CINEMETA_URL) {
        return Promise.resolve({ ...(STREMIO_DEFAULTS[0]!.manifest as object), version: '9.9.9' });
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
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([STREMIO_DEFAULTS[1]!.transportUrl]);
  });
});

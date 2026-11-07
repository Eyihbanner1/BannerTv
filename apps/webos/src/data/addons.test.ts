import { afterEach, describe, expect, it, vi } from 'vitest';

// What the TV keeps, in memory.
const saved = vi.hoisted(() => new Map<string, unknown>());
// The profile in use, which a test makes a kids one.
const profile = vi.hoisted(() => ({ kids: false }));
// What each address answers; any other address is offline.
const answers = vi.hoisted(() => new Map<string, unknown>());

vi.mock('./storage', () => {
  const kv = {
    get: (key: string) => Promise.resolve(saved.get(key)),
    set: (key: string, value: unknown) => {
      saved.set(key, value);
      return Promise.resolve();
    },
  };
  return { storage: { kv } };
});
vi.mock('./profiles', () => ({ isKidsProfile: () => profile.kids }));
vi.mock('../platform/tuning', () => ({ tuning: { playFirst: false } }));
vi.mock('../platform/http', () => ({
  fetchJson: (url: string) =>
    answers.has(url) ? Promise.resolve(answers.get(url)) : Promise.reject(new Error('offline')),
}));

const TORRENTIO = 'https://torrentio.example/manifest.json';
const ADULT = 'https://adult.example/manifest.json';
answers.set(TORRENTIO, {
  id: 'org.example.torrentio',
  version: '1.0.0',
  name: 'Torrentio',
  resources: ['stream'],
  types: ['movie', 'series'],
});
answers.set(ADULT, {
  id: 'org.example.adult',
  version: '1.0.0',
  name: 'Adult streams',
  resources: ['stream'],
  types: ['movie'],
  behaviorHints: { adult: true },
});

/** A fresh copy of the module, its collection and switches read from what the TV keeps. */
async function load() {
  vi.resetModules();
  const addons = await import('./addons');
  await Promise.all([addons.allAddons.load(), addons.addonSwitches.load()]);
  return addons;
}

afterEach(() => {
  saved.clear();
  profile.kids = false;
});

describe('streamAddons', () => {
  it('tells a stream addon switched off from none installed', async () => {
    const addons = await load();
    // The defaults only: the BannerTV Demo addon plays its own clips, so it doesn't count.
    expect(addons.streamAddons()).toEqual({ on: false, off: false });

    const torrentio = await addons.allAddons.install(TORRENTIO);
    expect(addons.streamAddons()).toEqual({ on: true, off: false });

    // Switched off, it is still installed: the problem box says to switch it on, not to add one.
    addons.switchAddon(torrentio, true);
    await vi.waitFor(() => expect(addons.addonCollection.get().addons).not.toContain(torrentio));
    expect(addons.streamAddons()).toEqual({ on: false, off: true });

    addons.switchAddon(torrentio, false);
    await vi.waitFor(() => expect(addons.addonCollection.get().addons).toContain(torrentio));
    expect(addons.streamAddons()).toEqual({ on: true, off: false });
  });

  it('leaves out adult addons on a kids profile, switched off or not', async () => {
    const addons = await load();
    const adult = await addons.allAddons.install(ADULT);
    addons.switchAddon(adult, true);
    await vi.waitFor(() => expect(addons.addonSwitches.isOff(adult)).toBe(true));
    expect(addons.streamAddons()).toEqual({ on: false, off: true });
    profile.kids = true;
    expect(addons.streamAddons()).toEqual({ on: false, off: false });
  });
});

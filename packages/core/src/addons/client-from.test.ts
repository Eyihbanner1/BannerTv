import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { createLane, DroppedError } from '../lane';
import { createLimiter } from '../limiter';
import { createQueryCache } from '../query';
import { memoryKeyValueStore } from '../storage';
import { createAddonClient } from './client';
import { createAddonCollection } from './collection';

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A sports addon that declares meta and streams for every `ev:` id of type sport. */
function sportsManifest(id: string, name: string) {
  return {
    id,
    version: '1.0.0',
    name,
    types: ['sport'],
    idPrefixes: ['ev:'],
    resources: ['catalog', 'meta', 'stream'],
    catalogs: [{ type: 'sport', id: 'live', name: 'Live Now' }],
  };
}

const FIRST_URL = 'https://first.example/manifest.json';
const LISTER_URL = 'https://lister.example/manifest.json';

/** Two addons that claim the same type and id prefix; only the second listed the match. */
async function setup(answers: Record<string, () => Promise<unknown>> = {}) {
  const fetchJson = vi.fn((url: string) => {
    if (url === FIRST_URL) return Promise.resolve(sportsManifest('test.first', 'First'));
    if (url === LISTER_URL) return Promise.resolve(sportsManifest('test.lister', 'Lister'));
    const answer = answers[url];
    if (answer) return answer();
    if (/\/meta\//.test(url)) {
      return Promise.resolve({ meta: { id: 'ev:1', type: 'sport', name: 'Home vs Away' } });
    }
    if (/\/stream\//.test(url)) {
      return Promise.resolve({ streams: [{ url: 'https://cdn.example/live.m3u8' }] });
    }
    return Promise.reject(new HttpError('status', 'Not found', 404));
  });
  const collection = createAddonCollection({
    storage: memoryKeyValueStore(),
    fetchJson,
    defaults: [],
  });
  await collection.load();
  await collection.install(FIRST_URL);
  const lister = await collection.install(LISTER_URL);
  const client = createAddonClient({
    collection,
    queries: createQueryCache(),
    limiter: createLimiter(6),
    fetchJson,
  });
  const asked = () =>
    fetchJson.mock.calls
      .map(([url]) => url)
      .filter((url) => url !== FIRST_URL && url !== LISTER_URL);
  return { client, collection, lister, fetchJson, asked };
}

describe('requests for one source', () => {
  it('asks only the addon that listed a sports item for its meta', async () => {
    const { client, lister, asked } = await setup();
    // The fan-out would ask the first addon, which declares the same type and prefix.
    const fanOut = client.meta('sport', 'ev:1');
    fanOut.load();
    await flush();
    expect(asked()).toEqual(['https://first.example/meta/sport/ev%3A1.json']);

    const query = client.metaFrom({ addon: lister, type: 'sport', id: 'ev:1' });
    query.load();
    await flush();
    expect(query.get().data?.name).toBe('Home vs Away');
    expect(asked().slice(1)).toEqual(['https://lister.example/meta/sport/ev%3A1.json']);
  });

  it('asks only the addons that listed an event for streams, once per distinct source', async () => {
    const { client, lister, asked } = await setup();
    // The fan-out would ask both.
    expect(client.streams('sport', 'ev:1').map((answer) => answer.addon.manifest.id)).toEqual([
      'test.first',
      'test.lister',
    ]);
    const answers = client.streamsFrom([
      // The same match in the addon's Live and Football catalogs, and another of its ids.
      { addon: lister, type: 'sport', id: 'ev:1' },
      { addon: lister, type: 'sport', id: 'ev:1' },
      { addon: lister, type: 'sport', id: 'ev:1b' },
    ]);
    expect(answers.map((answer) => answer.addon)).toEqual([lister, lister]);
    for (const answer of answers) answer.query.load();
    await flush();
    expect(asked()).toEqual([
      'https://lister.example/stream/sport/ev%3A1.json',
      'https://lister.example/stream/sport/ev%3A1b.json',
    ]);
    expect(answers[0]!.query.get().data).toHaveLength(1);
  });

  it('keeps a lookup made through a lane apart, so dropping the lane never fails the event page', async () => {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const metaUrl = 'https://lister.example/meta/sport/ev%3A1.json';
    const { client, lister } = await setup({
      [metaUrl]: () =>
        held.then(() => ({ meta: { id: 'ev:1', type: 'sport', name: 'Home vs Away' } })),
    });
    const lane = createLane(1);
    const source = { addon: lister, type: 'sport', id: 'ev:1' } as const;
    // The lane is busy, so the feed's lookup waits in it.
    void lane.run(() => held);
    const lookup = client.metaFrom(source, { lane });
    lookup.load();
    const page = client.metaFrom(source);
    expect(page).not.toBe(lookup);
    page.load();
    // The viewer opened the event page: the sports lane drops what it holds.
    lane.drop();
    release();
    await flush();
    expect(lookup.get().error).toBeInstanceOf(DroppedError);
    expect(page.get().status).toBe('success');
    expect(page.get().data?.name).toBe('Home vs Away');
  });
});

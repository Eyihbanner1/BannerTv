import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { createLimiter } from '../limiter';
import { createQueryCache } from '../query';
import { memoryKeyValueStore } from '../storage';
import { createAddonClient, NotFoundError, withArtwork } from './client';
import { createAddonCollection } from './collection';
import { CINEMETA_URL, DEFAULT_ADDONS } from './defaults';

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const ANIME_URL = 'https://anime.example/manifest.json';
const ANIME = {
  id: 'org.anime',
  version: '1.0.0',
  name: 'Anime',
  types: ['series', 'movie'],
  idPrefixes: ['kitsu:', 'tt'],
  resources: ['meta'],
};

async function setup(answers: Record<string, () => Promise<unknown>>) {
  const fetchJson = vi.fn((url: string) => {
    if (url === ANIME_URL) return Promise.resolve(ANIME);
    const answer = answers[url];
    return answer ? answer() : Promise.reject(new HttpError('status', 'Not found', 404));
  });
  const collection = createAddonCollection({
    storage: memoryKeyValueStore(),
    fetchJson,
    defaults: DEFAULT_ADDONS,
  });
  await collection.load();
  const client = createAddonClient({
    collection,
    queries: createQueryCache(),
    limiter: createLimiter(6),
    fetchJson,
  });
  return { client, collection, fetchJson };
}

describe('createAddonClient', () => {
  it('loads a catalog page with extras and fills in Metahub artwork', async () => {
    const url = 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action.json';
    const { client, collection, fetchJson } = await setup({
      [url]: () =>
        Promise.resolve({
          metas: [
            { id: 'tt0111161', type: 'movie', name: 'The Shawshank Redemption' },
            { id: 'local:1', type: 'movie', name: 'Not on IMDb' },
          ],
        }),
    });
    const query = client.catalog(collection.get().addons[0]!, 'movie', 'top', [
      ['genre', 'Action'],
    ]);
    query.load();
    await flush();
    expect(fetchJson).toHaveBeenCalledWith(url, { timeoutMs: 10000 });
    expect(query.get().data).toEqual([
      expect.objectContaining({
        id: 'tt0111161',
        background: 'https://images.metahub.space/background/medium/tt0111161/img',
        logo: 'https://images.metahub.space/logo/medium/tt0111161/img',
      }),
      expect.not.objectContaining({ background: expect.anything() }),
    ]);
  });

  it('asks meta addons in priority order and skips ones that fail or do not know the title', async () => {
    const animeMeta = 'https://anime.example/meta/series/tt0944947.json';
    const cinemetaMeta = 'https://v3-cinemeta.strem.io/meta/series/tt0944947.json';
    const { client, collection, fetchJson } = await setup({
      [animeMeta]: () => Promise.resolve({ meta: null }),
      [cinemetaMeta]: () =>
        Promise.resolve({ meta: { id: 'tt0944947', type: 'series', name: 'Game of Thrones' } }),
    });
    await collection.install(ANIME_URL);
    collection.move(ANIME_URL, -10);

    const query = client.meta('series', 'tt0944947');
    query.load();
    await flush();
    expect(fetchJson.mock.calls.map(([url]) => url).slice(-2)).toEqual([animeMeta, cinemetaMeta]);
    expect(query.get().data?.name).toBe('Game of Thrones');
  });

  it('never asks an addon for an ID prefix it does not declare', async () => {
    const { client, fetchJson } = await setup({});
    const query = client.meta('series', 'kitsu:1');
    query.load();
    await flush();
    expect(fetchJson).not.toHaveBeenCalledWith(
      expect.stringContaining('v3-cinemeta'),
      expect.anything(),
    );
    expect(query.get().error).toBeInstanceOf(NotFoundError);
  });

  it('reports the network failure when no addon answered', async () => {
    const { client } = await setup({
      'https://v3-cinemeta.strem.io/meta/movie/tt1.json': () =>
        Promise.reject(new HttpError('timeout', 'slow')),
    });
    const query = client.meta('movie', 'tt1');
    query.load();
    await flush();
    expect(query.get()).toMatchObject({ status: 'error', error: { kind: 'timeout' } });
  });
});

describe('withArtwork', () => {
  it('keeps artwork the addon sent', () => {
    const item = {
      id: 'tt1',
      type: 'movie',
      name: 'X',
      posterShape: 'poster' as const,
      genres: [],
      trailers: [],
      background: 'https://example.com/b.jpg',
    };
    expect(withArtwork(item)).toMatchObject({
      background: 'https://example.com/b.jpg',
      logo: 'https://images.metahub.space/logo/medium/tt1/img',
    });
  });
});

describe('the bundled Cinemeta manifest', () => {
  it('still reads, and is the first default', () => {
    expect(DEFAULT_ADDONS[0]!.transportUrl).toBe(CINEMETA_URL);
    expect(parseManifest(DEFAULT_ADDONS[0]!.manifest).catalogs.length).toBeGreaterThan(0);
  });
});

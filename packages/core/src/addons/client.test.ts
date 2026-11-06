import { boardCatalogs, parseManifest } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../http';
import { createLimiter } from '../limiter';
import { createQueryCache } from '../query';
import { memoryKeyValueStore } from '../storage';
import { createAddonClient, metahubAtSize, NotFoundError, withArtwork } from './client';
import { createAddonCollection } from './collection';
import { BANNERTV_DEMO_URL, CINEMETA_URL, DEFAULT_ADDONS, OPENSUBTITLES_V3_URL } from './defaults';

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

const ADULT_URL = 'https://adult.example/manifest.json';
const ADULT = {
  ...ANIME,
  id: 'org.adult',
  name: 'Adult',
  resources: ['meta', 'stream'],
  behaviorHints: { adult: true },
};

async function setup(
  answers: Record<string, () => Promise<unknown>>,
  kids = false,
  options: Partial<Pick<Parameters<typeof createAddonClient>[0], 'limiter' | 'playPriority'>> = {},
) {
  const fetchJson = vi.fn((url: string) => {
    if (url === ANIME_URL) return Promise.resolve(ANIME);
    if (url === ADULT_URL) return Promise.resolve(ADULT);
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
    limiter: options.limiter ?? createLimiter(6),
    fetchJson,
    kidsOnly: () => kids,
    playPriority: options.playPriority,
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
    const cinemeta = collection.get().addons.find((a) => a.transportUrl === CINEMETA_URL)!;
    const query = client.catalog(cinemeta, 'movie', 'top', [['genre', 'Action']]);
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

  it('leaves addons marked adult out of a kids profile, and caches its details apart', async () => {
    const adultMeta = 'https://adult.example/meta/movie/tt1.json';
    const cinemetaMeta = 'https://v3-cinemeta.strem.io/meta/movie/tt1.json';
    const answers = {
      [adultMeta]: () => Promise.resolve({ meta: { id: 'tt1', type: 'movie', name: 'Adult cut' } }),
      [cinemetaMeta]: () => Promise.resolve({ meta: { id: 'tt1', type: 'movie', name: 'Film' } }),
    };
    for (const kids of [false, true]) {
      const { client, collection, fetchJson } = await setup(answers, kids);
      await collection.install(ADULT_URL);
      collection.move(ADULT_URL, -10);
      const query = client.meta('movie', 'tt1');
      query.load();
      await flush();
      expect(query.get().data?.name).toBe(kids ? 'Film' : 'Adult cut');
      expect(fetchJson.mock.calls.some(([url]) => url === adultMeta)).toBe(!kids);
      expect(client.streams('movie', 'tt1').map(({ addon }) => addon.manifest.id)).toEqual(
        kids ? [] : ['org.adult'],
      );
    }
  });

  it('keeps the details shown when they come back the same, and Home rows keep their items', async () => {
    const metaUrl = 'https://v3-cinemeta.strem.io/meta/series/tt0944947.json';
    const rowUrl = 'https://v3-cinemeta.strem.io/catalog/movie/top.json';
    const otherUrl = 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Drama.json';
    let name = 'Game of Thrones';
    const list = () => ({
      metas: [
        { id: 'tt1', type: 'movie', name: 'One' },
        { id: 'tt2', type: 'movie', name: 'Two' },
      ],
    });
    const { client, collection } = await setup({
      [metaUrl]: () =>
        Promise.resolve({
          meta: {
            id: 'tt0944947',
            type: 'series',
            name,
            videos: [{ id: 'tt0944947:1:1', name: 'Winter Is Coming', season: 1, episode: 1 }],
          },
        }),
      [rowUrl]: () => Promise.resolve(list()),
      [otherUrl]: () => Promise.resolve(list()),
    });

    // Try again on a fresh copy asks again, as a refresh would.
    const meta = client.meta('series', 'tt0944947');
    meta.load();
    await flush();
    const first = meta.get().data!;
    meta.retry();
    await flush();
    expect(meta.get().data).toBe(first);
    name = 'A Game of Thrones';
    meta.retry();
    await flush();
    expect(meta.get().data?.name).toBe('A Game of Thrones');
    expect(meta.get().data?.videos).toBe(first.videos);

    const cinemeta = collection.get().addons.find((a) => a.transportUrl === CINEMETA_URL)!;
    const row = client.catalog(cinemeta, 'movie', 'top', [], { keepEqual: true });
    const other = client.catalog(cinemeta, 'movie', 'top', [['genre', 'Drama']]);
    for (const query of [row, other]) {
      query.load();
      await flush();
      const items = query.get().data!;
      query.retry();
      await flush();
      expect(query.get().data).toEqual(items);
      // Only the row that asked keeps its items; other readers get new ones, as before.
      expect(query.get().data === items).toBe(query === row);
    }
  });

  it('never keeps the items of a catalog the sports readings may read', async () => {
    const sportsUrl = 'https://sport.example/manifest.json';
    const manifest = {
      id: 'org.sport',
      version: '1.0.0',
      name: 'Sport',
      types: ['movie', 'tv'],
      resources: ['catalog'],
      catalogs: [
        { type: 'movie', id: 'football', name: 'Football' },
        { type: 'tv', id: 'top', name: 'Popular' },
      ],
    };
    const list = () => Promise.resolve({ metas: [{ id: 'tt1', type: 'movie', name: 'One' }] });
    const { client, collection } = await setup({
      [sportsUrl]: () => Promise.resolve(manifest),
      'https://sport.example/catalog/movie/football.json': list,
      'https://sport.example/catalog/tv/top.json': list,
    });
    const addon = await collection.install(sportsUrl);
    for (const [type, id] of [
      ['movie', 'football'],
      ['tv', 'top'],
    ] as const) {
      const query = client.catalog(addon, type, id, [], { keepEqual: true });
      query.load();
      await flush();
      const items = query.get().data!;
      expect(items).toHaveLength(1);
      query.retry();
      await flush();
      expect(query.get().data).not.toBe(items);
    }
  it('puts the stream and subtitles requests of the video playPriority names ahead of the rest waiting', async () => {
    const top = 'https://v3-cinemeta.strem.io/catalog/movie/top.json';
    const later = 'https://v3-cinemeta.strem.io/catalog/series/top.json';
    let finishTop = () => undefined as void;
    const asked: string[] = [];
    const answer = (url: string, body: unknown) => () => {
      asked.push(url);
      return Promise.resolve(body);
    };
    const { client, collection } = await setup(
      {
        [top]: () => {
          asked.push(top);
          return new Promise((resolve) => (finishTop = () => resolve({ metas: [] })));
        },
        [later]: answer(later, { metas: [] }),
        'https://adult.example/stream/movie/tt1.json': answer('stream tt1', { streams: [] }),
        'https://adult.example/stream/movie/tt2.json': answer('stream tt2', { streams: [] }),
        'https://opensubtitles-v3.strem.io/subtitles/movie/tt2.json': answer('subtitles tt2', {
          subtitles: [],
        }),
      },
      false,
      { limiter: createLimiter(1), playPriority: (_type, videoId) => (videoId === 'tt2' ? 1 : 0) },
    );
    await collection.install(ADULT_URL);
    const cinemeta = collection.get().addons.find((a) => a.transportUrl === CINEMETA_URL)!;
    // One slot: the first catalog holds it while the rest queue in the order asked.
    client.catalog(cinemeta, 'movie', 'top').load();
    client.catalog(cinemeta, 'series', 'top').load();
    client.streams('movie', 'tt1').forEach(({ query }) => query.load());
    client.streams('movie', 'tt2').forEach(({ query }) => query.load());
    client.subtitles('movie', 'tt2').forEach(({ query }) => query.load());
    await flush();
    expect(asked).toEqual([top]);
    finishTop();
    await flush();
    expect(asked).toEqual([top, 'stream tt2', 'subtitles tt2', later, 'stream tt1']);
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

describe('the bundled manifests', () => {
  it('still read, with BannerTV Demo first and then Cinemeta, each with a Home row', () => {
    expect(DEFAULT_ADDONS.map((a) => a.transportUrl)).toEqual([
      BANNERTV_DEMO_URL,
      CINEMETA_URL,
      OPENSUBTITLES_V3_URL,
    ]);
    for (const addon of DEFAULT_ADDONS.slice(0, 2)) {
      expect(boardCatalogs(parseManifest(addon.manifest)).length).toBeGreaterThan(0);
    }
  });
});

describe('metahubAtSize', () => {
  const at = (path: string, host = 'images') => `https://${host}.metahub.space${path}`;

  it('asks Metahub for the same image at another size', () => {
    expect(metahubAtSize(at('/poster/small/tt1160419/img'), 'medium')).toBe(
      at('/poster/medium/tt1160419/img'),
    );
    expect(metahubAtSize(at('/background/medium/tt1160419/img'), 'large')).toBe(
      at('/background/large/tt1160419/img'),
    );
    expect(metahubAtSize(at('/logo/large/tt1160419/img'), 'medium')).toBe(
      at('/logo/medium/tt1160419/img'),
    );
    expect(metahubAtSize(at('/poster/small/tt0944947/img', 'live'), 'medium')).toBe(
      at('/poster/medium/tt0944947/img', 'live'),
    );
  });

  it('leaves every other address as it was', () => {
    for (const url of [
      'https://image.tmdb.org/t/p/w500/x.jpg',
      'https://episodes.metahub.space/tt0944947/1/1/w780.jpg',
      at('/poster/xl/tt1/img'),
      at('/poster/small/kitsu:1/img'),
      at('/poster/small/tt1/img?size=2'),
      `http://images.metahub.space/poster/small/tt1/img`,
      'https://example.com/images.metahub.space/poster/small/tt1/img',
      'https://images.metahub.space.example/poster/small/tt1/img',
      'https://rpdb.example/KEY/imdb/poster-default/tt1.jpg',
    ]) {
      expect(metahubAtSize(url, 'large')).toBe(url);
    }
  });
});

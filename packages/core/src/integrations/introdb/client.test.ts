import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../http';
import { createQueryCache } from '../../query';
import { createIntroDbClient, episodeOf, INTRODB_TIMEOUT_MS, INTRODB_URL } from './client';

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const EPISODE = `${INTRODB_URL}/segments?imdb_id=tt0903747&season=2&episode=1`;

function setup(answer: (url: string) => Promise<unknown>) {
  const fetchJson = vi.fn((url: string) => answer(url));
  const client = createIntroDbClient({ fetchJson, queries: createQueryCache() });
  return { client, fetchJson };
}

describe('episodeOf', () => {
  it('reads the IMDb id, season and episode of a Stremio series video id', () => {
    expect(episodeOf('tt0903747:2:1')).toEqual({ imdbId: 'tt0903747', season: 2, episode: 1 });
  });

  it('gives none for films, specials, and ids from other catalogues', () => {
    expect(episodeOf('tt0903747')).toBeNull();
    expect(episodeOf('tt0903747:0:3')).toBeNull();
    expect(episodeOf('kitsu:1:2')).toBeNull();
    expect(episodeOf('tt0903747:2:1&x=1')).toBeNull();
  });
});

describe('createIntroDbClient', () => {
  it("asks IntroDB for a series episode's timings and reads its intro, recap and credits", async () => {
    const { client, fetchJson } = setup(() =>
      Promise.resolve({
        intro: { start_sec: 61, end_sec: 92 },
        recap: { start_sec: 0, end_sec: 45 },
        outro: { start_sec: 2600, end_sec: 2680 },
      }),
    );
    const query = client.marks('series', 'tt0903747:2:1');
    query.load();
    await flush();
    expect(fetchJson).toHaveBeenCalledWith(EPISODE, { timeoutMs: INTRODB_TIMEOUT_MS });
    expect(query.get().data).toEqual({
      segments: [
        { kind: 'recap', start: 0, end: 45 },
        { kind: 'intro', start: 61, end: 92 },
      ],
      credits: { start: 2600, end: 2680, sceneAfter: false },
    });
  });

  it('asks once for the same episode', async () => {
    const { client, fetchJson } = setup(() => Promise.resolve({ intro: null }));
    client.marks('series', 'tt0903747:2:1').load();
    client.marks('series', 'tt0903747:2:1').load();
    await flush();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('takes a 404 to mean no timings, not a failure', async () => {
    const { client } = setup(() =>
      Promise.reject(new HttpError('status', 'The addon answered 404', 404)),
    );
    const query = client.marks('series', 'tt0903747:2:1');
    query.load();
    await flush();
    expect(query.get()).toMatchObject({ status: 'success', data: { segments: [] } });
  });

  it('leaves other failures as failures, which show no skip', async () => {
    const { client } = setup(() => Promise.reject(new HttpError('network', 'offline')));
    const query = client.marks('series', 'tt0903747:2:1');
    query.load();
    await flush();
    expect(query.get().status).toBe('error');
    expect(query.get().data).toBeUndefined();
  });

  it('never asks about films or ids it cannot look up', async () => {
    const { client, fetchJson } = setup(() => Promise.resolve({}));
    for (const [type, id] of [
      ['movie', 'tt0468569'],
      ['series', 'kitsu:1:1'],
      ['tv', 'tt0903747:2:1'],
    ] as const) {
      const query = client.marks(type, id);
      query.load();
      expect(query.get()).toMatchObject({ status: 'success', data: { segments: [] } });
    }
    await flush();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('goes to another address when given one, without a double slash', async () => {
    const fetchJson = vi.fn(() => Promise.resolve({}));
    const client = createIntroDbClient({
      baseUrl: 'https://proxy.example/introdb/',
      fetchJson,
      queries: createQueryCache(),
    });
    client.marks('series', 'tt1:1:1').load();
    await flush();
    expect(fetchJson).toHaveBeenCalledWith(
      'https://proxy.example/introdb/segments?imdb_id=tt1&season=1&episode=1',
      { timeoutMs: INTRODB_TIMEOUT_MS },
    );
  });

  describe("through BannerTV's service", () => {
    const PROXIED =
      'https://api.example.workers.dev/introdb/segments?imdb_id=tt0903747&season=2&episode=1';

    function proxied(answer: (url: string) => Promise<unknown>) {
      const fetchJson = vi.fn((url: string) => answer(url));
      const client = createIntroDbClient({
        proxyUrl: 'https://api.example.workers.dev/introdb/',
        fetchJson,
        queries: createQueryCache(),
      });
      const query = client.marks('series', 'tt0903747:2:1');
      query.load();
      return { query, fetchJson };
    }

    it('asks the service, which a browser can read, and not IntroDB', async () => {
      const { query, fetchJson } = proxied(() =>
        Promise.resolve({ intro: { start_sec: 61, end_sec: 92 } }),
      );
      await flush();
      expect(fetchJson.mock.calls).toEqual([[PROXIED, { timeoutMs: INTRODB_TIMEOUT_MS }]]);
      expect(query.get().data).toMatchObject({
        segments: [{ kind: 'intro', start: 61, end: 92 }],
      });
    });

    it('asks IntroDB itself when the service has no answer: too old for the route, or down', async () => {
      for (const failure of [
        new HttpError('status', 'The addon answered 404', 404),
        new HttpError('status', 'The addon answered 502', 502),
        new HttpError('timeout', 'No answer after 8 s'),
      ]) {
        const { query, fetchJson } = proxied((url) =>
          url === PROXIED
            ? Promise.reject(failure)
            : Promise.resolve({ recap: { start_sec: 0, end_sec: 40 } }),
        );
        await flush();
        expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([PROXIED, EPISODE]);
        expect(query.get().data).toMatchObject({
          segments: [{ kind: 'recap', start: 0, end: 40 }],
        });
      }
    });

    it('fails only when IntroDB fails too, as it does in a browser', async () => {
      const { query } = proxied(() => Promise.reject(new HttpError('network', 'offline')));
      await flush();
      expect(query.get().status).toBe('error');
    });
  });
});

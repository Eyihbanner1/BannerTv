import { describe, expect, it } from 'vitest';
import { type ExtraArg, type ResourceName, resourceUrl } from '@bannertv/protocol';
import { FILMS, filmId } from './addon';
import worker from './worker';

const ORIGIN = 'https://demo.bannertv.example.workers.dev';
const MANIFEST = `${ORIGIN}/manifest.json`;

function call(path: string, method = 'GET') {
  return worker.fetch(new Request(ORIGIN + path, { method }));
}

/** A request built the way the TV app builds it, so ids arrive encoded. */
function appCall(resource: ResourceName, type: string, id: string, extra: ExtraArg[] = []) {
  return worker.fetch(new Request(resourceUrl(MANIFEST, resource, type, id, extra)));
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  return (await response.json()) as T;
}

describe('demo addon routes', () => {
  it('answers the manifest from its own origin, open to any page', async () => {
    const response = await call('/manifest.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const manifest = await body(response);
    expect(manifest.id).toBe('com.bannertv.demo');
    expect(manifest.logo).toBe(`${ORIGIN}/art/addon.png`);
  });

  it('lists every film in the catalog', async () => {
    const { metas } = await body<{ metas: { id: string }[] }>(
      await appCall('catalog', 'movie', 'blender'),
    );
    expect(metas.map((meta) => meta.id)).toEqual(FILMS.map(filmId));
  });

  it('searches by title, director, genre and year, ignoring case and accents', async () => {
    const ids = async (search: string) => {
      const response = await appCall('catalog', 'movie', 'blender', [['search', search]]);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=600');
      const { metas } = await body<{ metas: { id: string }[] }>(response);
      return metas.map((meta) => meta.id);
    };
    expect(await ids('big buck')).toEqual(['bannertv:big-buck-bunny']);
    expect(await ids('BÚNNY')).toEqual(['bannertv:big-buck-bunny']);
    expect(await ids('goralczyk')).toEqual(['bannertv:spring']);
    expect(await ids('wing it')).toEqual(['bannertv:wing-it']);
    expect(await ids('2008')).toEqual(['bannertv:big-buck-bunny']);
    expect(await ids('bunny 2019')).toEqual([]);
    expect(await ids('the matrix')).toEqual([]);
  });

  it('reads search text written with + for spaces', async () => {
    const { metas } = await body<{ metas: unknown[] }>(
      await call('/catalog/movie/blender/search=big+buck.json'),
    );
    expect(metas).toHaveLength(1);
  });

  it('answers a blank search with no films rather than all of them', async () => {
    const { metas } = await body<{ metas: unknown[] }>(
      await call('/catalog/movie/blender/search=%20.json'),
    );
    expect(metas).toEqual([]);
  });

  it('skips films when asked', async () => {
    const { metas } = await body<{ metas: unknown[] }>(
      await call('/catalog/movie/blender/skip=1.json'),
    );
    expect(metas).toHaveLength(FILMS.length - 1);
  });

  it('answers 404 for catalogs it does not have', async () => {
    expect((await appCall('catalog', 'series', 'blender')).status).toBe(404);
    expect((await appCall('catalog', 'movie', 'top')).status).toBe(404);
  });

  it('describes each film, with the id the app sends encoded', async () => {
    for (const film of FILMS) {
      const response = await appCall('meta', 'movie', filmId(film));
      expect(response.status).toBe(200);
      const { meta } = await body<{ meta: { id: string; name: string } }>(response);
      expect(meta.id).toBe(filmId(film));
      expect(meta.name).toBe(film.name);
    }
    // The app encodes the colon, but a hand-typed address may not.
    const { meta } = await body<{ meta: { id: string } }>(
      await call('/meta/movie/bannertv:spring.json'),
    );
    expect(meta.id).toBe('bannertv:spring');
  });

  it('answers a null meta for titles it does not know, not an error', async () => {
    for (const [type, id] of [
      ['movie', 'bannertv:sintel'],
      ['movie', 'tt1254207'],
      ['series', 'bannertv:spring'],
    ] as const) {
      const response = await appCall('meta', type, id);
      expect(response.status).toBe(200);
      expect(await body(response)).toEqual({ meta: null });
    }
  });

  it('lists two copies of each film, the second marked as a backup', async () => {
    const response = await appCall('stream', 'movie', 'bannertv:wing-it');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    const { streams } = await body<{ streams: { url: string }[] }>(response);
    expect(streams.map((stream) => stream.url)).toEqual([
      `${ORIGIN}/media/wing-it/v1/master.m3u8`,
      `${ORIGIN}/media/wing-it/v1/master.m3u8?b=1`,
    ]);
  });

  it('answers an empty stream list for titles it does not know', async () => {
    const response = await appCall('stream', 'movie', 'tt1254207');
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ streams: [] });
  });

  it('answers 404 for resources and paths it does not serve', async () => {
    for (const path of [
      '/subtitles/movie/bannertv:spring.json',
      '/addon_catalog/all/x.json',
      '/catalog/movie.json',
      '/a/b/c/d/e.json',
      '/meta/movie/%E0%A4%A.json',
      '/catalog/movie/blender/search.json',
      '/media/spring/v1/missing.ts',
      '/favicon.ico',
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
  });

  it('shows the credits page at the root', async () => {
    const response = await call('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    for (const film of FILMS) expect(html).toContain(film.licence.url);
    expect(html).toContain(MANIFEST);
    expect(html).toContain('keeps no request logs');
  });

  it('answers HEAD with the headers only', async () => {
    const response = await call('/manifest.json', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('');
  });

  it('answers preflight requests and refuses writes', async () => {
    const preflight = await call('/manifest.json', 'OPTIONS');
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS');

    const post = await call('/manifest.json', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
  });
});

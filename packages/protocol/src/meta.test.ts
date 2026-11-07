import { describe, expect, it } from 'vitest';
import { parseCatalogResponse, parseMetaResponse, parseMetaPreview } from './meta';

describe('parseMetaPreview', () => {
  it('reads a Cinemeta catalog item, folding legacy fields', () => {
    const preview = parseMetaPreview({
      id: 'tt0111161',
      imdb_id: 'tt0111161',
      type: 'movie',
      name: 'The Shawshank Redemption',
      poster: 'https://images.metahub.space/poster/small/tt0111161/img',
      background: 'https://images.metahub.space/background/medium/tt0111161/img',
      logo: 'https://images.metahub.space/logo/medium/tt0111161/img',
      description: 'Two imprisoned men bond over a number of years.',
      year: '1994',
      imdbRating: 9.3,
      runtime: '142 min',
      genre: ['Drama'],
      genres: ['Drama'],
      trailers: [
        { source: 'NmzuHjWmXOc', type: 'Trailer' },
        { source: 'clip1', type: 'Clip' },
      ],
      trailerStreams: [{ title: 'Trailer', ytId: 'NmzuHjWmXOc' }],
    });
    expect(preview).toEqual({
      id: 'tt0111161',
      type: 'movie',
      name: 'The Shawshank Redemption',
      poster: 'https://images.metahub.space/poster/small/tt0111161/img',
      posterShape: 'poster',
      background: 'https://images.metahub.space/background/medium/tt0111161/img',
      logo: 'https://images.metahub.space/logo/medium/tt0111161/img',
      description: 'Two imprisoned men bond over a number of years.',
      releaseInfo: '1994',
      imdbRating: '9.3',
      runtime: '142 min',
      genres: ['Drama'],
      trailers: ['NmzuHjWmXOc'],
    });
  });

  it('drops items without an id or a name, and uses the requested type when one is missing', () => {
    expect(parseMetaPreview({ name: 'No id', type: 'movie' })).toBeUndefined();
    expect(parseMetaPreview({ id: 'x', type: 'movie' })).toBeUndefined();
    expect(parseMetaPreview({ id: 'x', name: 'X' })).toBeUndefined();
    expect(parseMetaPreview({ id: 'x', name: 'X' }, 'series')?.type).toBe('series');
  });

  it('refuses unsafe artwork URLs and strips HTML from descriptions', () => {
    const preview = parseMetaPreview({
      id: 'x',
      type: 'movie',
      name: 'X',
      poster: 'javascript:alert(1)',
      background: '/relative.jpg',
      logo: 'data:image/png;base64,AAAA',
      description: '<p>Line one<br>line &quot;two&quot;</p><script>bad()</script>&#233;t&#xE9;',
      posterShape: 'landscape',
    });
    expect(preview?.poster).toBeUndefined();
    expect(preview?.background).toBeUndefined();
    expect(preview?.logo).toBeUndefined();
    expect(preview?.description).toBe('Line one\nline "two"\nbad()été');
    expect(preview?.posterShape).toBe('landscape');
  });

  it("keeps a sports item's team badges with the team they belong to, safe addresses only", () => {
    const preview = parseMetaPreview({
      id: 'match:1',
      type: 'tv',
      name: 'Los Angeles Lakers vs Portland Trail Blazers',
      team1: { name: 'Los Angeles Lakers', logo: 'https://img.example/badge/lakers.png' },
      team2: { name: 'Portland Trail Blazers', logo: 'javascript:alert(1)' },
    });
    expect(preview?.sport).toEqual({
      home: 'Los Angeles Lakers',
      homeLogo: 'https://img.example/badge/lakers.png',
      away: 'Portland Trail Blazers',
    });
    const plain = parseMetaPreview({ id: 'm', type: 'tv', name: 'A vs B', homeTeam: 'A' });
    expect(plain?.sport).toEqual({ home: 'A' });
  });
});

describe('parseMetaResponse', () => {
  it('reads a series with episodes, cast from links and cache hints', () => {
    const { meta, cache } = parseMetaResponse({
      meta: {
        id: 'tt0944947',
        type: 'series',
        name: 'Game of Thrones',
        releaseInfo: '2011–2019',
        cast: ['Emilia Clarke'],
        director: null,
        writer: ['David Benioff', 'D.B. Weiss'],
        links: [
          { name: '9.2', category: 'imdb', url: 'https://imdb.com/title/tt0944947' },
          { name: 'Emilia Clarke', category: 'Cast', url: 'stremio:///search?search=Emilia' },
          { name: 'Peter Dinklage', category: 'Cast' },
          { name: 'Drama', category: 'Genres' },
          { broken: true },
        ],
        videos: [
          {
            id: 'tt0944947:1:1',
            name: 'Winter Is Coming',
            season: 1,
            number: 1,
            firstAired: '2011-04-17T05:00:00.000Z',
            thumbnail: 'https://episodes.metahub.space/tt0944947/1/1/w780.jpg',
            overview: 'Lord Stark is troubled.',
          },
          {
            id: 'tt0944947:1:2',
            title: 'The Kingsroad',
            season: '1',
            episode: '2',
            released: 'soon',
          },
          { name: 'no id' },
          { id: 'tt0944947:1:1', name: 'duplicate' },
        ],
        behaviorHints: { defaultVideoId: null, hasScheduledVideos: true },
      },
      cacheMaxAge: 3600,
      staleError: -1,
    });

    expect(meta?.imdbRating).toBe('9.2');
    expect(meta?.cast).toEqual(['Emilia Clarke', 'Peter Dinklage']);
    expect(meta?.directors).toEqual([]);
    expect(meta?.writers).toEqual(['David Benioff', 'D.B. Weiss']);
    expect(meta?.genres).toEqual(['Drama']);
    expect(meta?.links).toHaveLength(4);
    expect(meta?.videos).toEqual([
      {
        id: 'tt0944947:1:1',
        title: 'Winter Is Coming',
        released: '2011-04-17T05:00:00.000Z',
        season: 1,
        episode: 1,
        thumbnail: 'https://episodes.metahub.space/tt0944947/1/1/w780.jpg',
        overview: 'Lord Stark is troubled.',
      },
      { id: 'tt0944947:1:2', title: 'The Kingsroad', season: 1, episode: 2 },
    ]);
    expect(meta?.behaviorHints).toEqual({ hasScheduledVideos: true });
    expect(cache).toEqual({ cacheMaxAge: 3600 });
  });

  it('keeps the first copy of each episode, in order, for a long-running series', () => {
    const videos: unknown[] = [];
    for (let n = 1; n <= 5000; n++) videos.push({ id: `tt1:1:${n}`, name: `Episode ${n}` });
    // Repeats of every tenth episode, after the originals, and a junk item between them.
    for (let n = 10; n <= 5000; n += 10) videos.push({ id: `tt1:1:${n}`, name: 'repeat' });
    videos.splice(2500, 0, { name: 'no id' });

    const { meta } = parseMetaResponse({
      meta: { id: 'tt1', type: 'series', name: 'A daily', videos },
    });
    expect(meta?.videos).toHaveLength(5000);
    expect(meta?.videos.map((v) => v.id)).toEqual(
      Array.from({ length: 5000 }, (_, i) => `tt1:1:${i + 1}`),
    );
    expect(meta?.videos.every((v) => v.title !== 'repeat')).toBe(true);
  });

  it('treats a null meta as not found', () => {
    expect(parseMetaResponse({ meta: null }).meta).toBeNull();
    expect(() => parseMetaResponse('oops')).toThrow('not a JSON object');
  });
});

describe('parseCatalogResponse', () => {
  it('keeps good items, counts dropped ones and removes duplicates', () => {
    const response = parseCatalogResponse(
      {
        metas: [
          { id: 'a', name: 'A' },
          { id: 'b' },
          'junk',
          { id: 'a', name: 'A again' },
          { id: 'c', name: 'C', type: 'series' },
        ],
        cacheMaxAge: '600',
      },
      'movie',
    );
    expect(response.metas.map((m) => [m.id, m.type])).toEqual([
      ['a', 'movie'],
      ['c', 'series'],
    ]);
    expect(response.dropped).toBe(3);
    expect(response.cache).toEqual({ cacheMaxAge: 600 });
  });

  it('refuses a response without a metas list', () => {
    expect(() => parseCatalogResponse({ items: [] })).toThrow('no metas list');
  });
});

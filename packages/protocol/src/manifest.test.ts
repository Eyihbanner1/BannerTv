import { describe, expect, it } from 'vitest';
import {
  boardCatalogs,
  catalogAccepts,
  parseManifest,
  ProtocolError,
  supportsResource,
} from './manifest';

const BASE = { id: 'org.example', version: '1.0.0', name: 'Example', types: ['movie'] };

describe('parseManifest', () => {
  it('reads current extras, resource objects and behaviour hints', () => {
    const manifest = parseManifest({
      ...BASE,
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      resources: ['catalog', { name: 'stream', types: ['movie'], idPrefixes: ['tt', 'kitsu:'] }],
      catalogs: [
        {
          type: 'movie',
          id: 'top',
          name: 'Popular',
          extra: [{ name: 'genre', options: ['Action', 'Drama'] }, { name: 'skip' }],
        },
        { type: 'movie', id: 'year', extra: [{ name: 'genre', isRequired: true }] },
      ],
      behaviorHints: { configurable: true, adult: 'yes' },
      logo: 'javascript:alert(1)',
      description: '<b>Movies</b> &amp; series',
    });

    expect(manifest.resources).toEqual([
      { name: 'catalog' },
      { name: 'stream', types: ['movie'], idPrefixes: ['tt', 'kitsu:'] },
    ]);
    expect(manifest.catalogs[0]!.extra).toEqual([
      { name: 'genre', isRequired: false, options: ['Action', 'Drama'] },
      { name: 'skip', isRequired: false, options: [] },
    ]);
    // A catalog without a name is named after its id.
    expect(manifest.catalogs[1]!.name).toBe('year');
    expect(manifest.behaviorHints).toEqual({
      adult: false,
      p2p: false,
      configurable: true,
      configurationRequired: false,
    });
    expect(manifest.logo).toBeUndefined();
    expect(manifest.description).toBe('Movies & series');
  });

  it('folds legacy extraSupported, extraRequired and genres into extras', () => {
    const manifest = parseManifest({
      ...BASE,
      resources: ['catalog'],
      catalogs: [
        {
          type: 'movie',
          id: 'legacy',
          genres: ['Comedy'],
          extraSupported: ['genre', 'search'],
          extraRequired: ['search'],
        },
      ],
    });
    expect(manifest.catalogs[0]!.extra).toEqual([
      { name: 'genre', isRequired: false, options: ['Comedy'] },
      { name: 'search', isRequired: true, options: [] },
    ]);
  });

  it('drops broken catalog and resource entries but keeps the manifest', () => {
    const manifest = parseManifest({
      ...BASE,
      resources: ['meta', 42, { types: ['movie'] }, 'meta'],
      catalogs: [{ id: 'no-type' }, null, { type: 'movie', id: 'ok' }, { type: 'movie', id: 'ok' }],
    });
    expect(manifest.resources).toEqual([{ name: 'meta' }]);
    expect(manifest.catalogs.map((c) => c.id)).toEqual(['ok']);
  });

  it('refuses a manifest without the required fields', () => {
    expect(() => parseManifest('nope')).toThrow(ProtocolError);
    expect(() => parseManifest({ ...BASE, id: '' })).toThrow('no id');
    expect(() => parseManifest({ ...BASE, version: undefined })).toThrow('no version');
    expect(() => parseManifest({ ...BASE, resources: [] })).toThrow('no resources');
  });
});

describe('supportsResource', () => {
  const manifest = parseManifest({
    ...BASE,
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    resources: ['meta', { name: 'stream', types: ['series'], idPrefixes: ['kitsu:'] }],
  });

  it('checks the resource, the type and the ID prefix', () => {
    expect(supportsResource(manifest, 'meta', 'movie', 'tt0111161')).toBe(true);
    expect(supportsResource(manifest, 'meta', 'channel', 'tt0111161')).toBe(false);
    expect(supportsResource(manifest, 'meta', 'movie', 'kitsu:1')).toBe(false);
    expect(supportsResource(manifest, 'subtitles', 'movie', 'tt0111161')).toBe(false);
  });

  it('lets a resource object override the manifest types and prefixes', () => {
    expect(supportsResource(manifest, 'stream', 'series', 'kitsu:1:1')).toBe(true);
    expect(supportsResource(manifest, 'stream', 'series', 'tt0944947:1:1')).toBe(false);
    expect(supportsResource(manifest, 'stream', 'movie', 'kitsu:1')).toBe(false);
  });

  it('accepts any ID when no prefixes are declared', () => {
    const open = parseManifest({ ...BASE, resources: ['meta'] });
    expect(supportsResource(open, 'meta', 'movie', 'anything:42')).toBe(true);
  });
});

describe('catalog extras', () => {
  const manifest = parseManifest({
    ...BASE,
    resources: ['catalog'],
    catalogs: [
      { type: 'movie', id: 'top', extra: [{ name: 'genre' }, { name: 'skip' }] },
      { type: 'movie', id: 'search', extra: [{ name: 'search', isRequired: true }] },
    ],
  });
  const [top, search] = manifest.catalogs as [
    (typeof manifest.catalogs)[0],
    (typeof manifest.catalogs)[0],
  ];

  it('accepts declared extras and insists on required ones', () => {
    expect(catalogAccepts(top, [])).toBe(true);
    expect(catalogAccepts(top, ['genre', 'skip'])).toBe(true);
    expect(catalogAccepts(top, ['search'])).toBe(false);
    expect(catalogAccepts(search, [])).toBe(false);
    expect(catalogAccepts(search, ['search'])).toBe(true);
  });

  it('puts only catalogs that need no extra on the board', () => {
    expect(boardCatalogs(manifest).map((c) => c.id)).toEqual(['top']);
  });
});

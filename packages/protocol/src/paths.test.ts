import { describe, expect, it } from 'vitest';
import { addonBaseUrl, normalizeManifestUrl, resourceUrl } from './paths';

describe('normalizeManifestUrl', () => {
  it('turns typed and deep-link addresses into manifest URLs', () => {
    expect(normalizeManifestUrl(' https://v3-cinemeta.strem.io/manifest.json ')).toBe(
      'https://v3-cinemeta.strem.io/manifest.json',
    );
    expect(normalizeManifestUrl('stremio://addon.example.com/abc/manifest.json')).toBe(
      'https://addon.example.com/abc/manifest.json',
    );
    expect(normalizeManifestUrl('addon.example.com/abc/')).toBe(
      'https://addon.example.com/abc/manifest.json',
    );
    expect(normalizeManifestUrl('http://192.168.1.20:7000/manifest.json?x=1')).toBe(
      'http://192.168.1.20:7000/manifest.json',
    );
  });

  it('refuses what cannot be an addon URL', () => {
    expect(normalizeManifestUrl('')).toBeUndefined();
    expect(normalizeManifestUrl('ftp://example.com/manifest.json')).toBeUndefined();
    expect(normalizeManifestUrl('not a url')).toBeUndefined();
  });
});

describe('resourceUrl', () => {
  const cinemeta = 'https://v3-cinemeta.strem.io/manifest.json';

  it('builds catalog, meta and stream paths like stremio-core', () => {
    expect(addonBaseUrl(cinemeta)).toBe('https://v3-cinemeta.strem.io');
    expect(resourceUrl(cinemeta, 'catalog', 'movie', 'top')).toBe(
      'https://v3-cinemeta.strem.io/catalog/movie/top.json',
    );
    expect(resourceUrl(cinemeta, 'meta', 'series', 'tt0944947')).toBe(
      'https://v3-cinemeta.strem.io/meta/series/tt0944947.json',
    );
    expect(resourceUrl(cinemeta, 'stream', 'series', 'tt0944947:1:1')).toBe(
      'https://v3-cinemeta.strem.io/stream/series/tt0944947%3A1%3A1.json',
    );
  });

  it('encodes extras as one query-string segment', () => {
    expect(
      resourceUrl(cinemeta, 'catalog', 'series', 'top', [
        ['search', 'game of thrones'],
        ['skip', '100'],
      ]),
    ).toBe(
      'https://v3-cinemeta.strem.io/catalog/series/top/search=game%20of%20thrones&skip=100.json',
    );
    expect(resourceUrl(cinemeta, 'catalog', 'movie', 'top', [['genre', 'Sci-Fi & Fantasy']])).toBe(
      'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi%20%26%20Fantasy.json',
    );
  });

  it('keeps configuration in the base path', () => {
    expect(
      resourceUrl('https://addon.example.com/eyJrZXkiOjF9/manifest.json', 'catalog', 'movie', 'x'),
    ).toBe('https://addon.example.com/eyJrZXkiOjF9/catalog/movie/x.json');
  });
});

import { type ManifestCatalog, type MetaPreview, parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from '../addons/collection';
import cinemeta from '../addons/cinemeta.manifest.json';
import metegol from './fixtures/metegol/manifest.json';
import nuvio from './fixtures/nuvio-live-sports/manifest.json';
import sportsStreams from './fixtures/sports-streams/manifest.json';
import stremverse from './fixtures/stremverse/manifest.json';
import {
  catalogView,
  isSportsCatalog,
  looksLikeSports,
  needsEvidence,
  sportsCatalogFilter,
  sportsCatalogs,
} from './detect';

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const streams = installed(sportsStreams, 'https://sports.example/manifest.json');
const nuvioAddon = installed(nuvio, 'https://nuvio.example/manifest.json');
const metegolAddon = installed(metegol, 'https://metegol.example/manifest.json');
const stremverseAddon = installed(stremverse, 'https://stremverse.example/manifest.json');
const cinemetaAddon = installed(cinemeta, 'https://v3-cinemeta.strem.io/manifest.json');

function catalog(name: string, id = name, type = 'tv'): ManifestCatalog {
  return { type, id, name, extra: [] };
}

function items(...names: string[]): MetaPreview[] {
  return names.map((name, i) => ({
    id: `x${i}`,
    type: 'tv',
    name,
    posterShape: 'landscape',
    genres: [],
    trailers: [],
  }));
}

describe('what a catalog holds', () => {
  it('reads views and sports from names and ids', () => {
    expect(catalogView(catalog('🔴 Live Now', 'nuvio_sports_live'))).toEqual({ view: 'live' });
    expect(catalogView(catalog('📺 24/7 Live TV', 'nuvio_sports_networks'))).toEqual({
      view: 'channels',
    });
    expect(catalogView(catalog('⚽ Football Replays'))).toEqual({
      view: 'replays',
      sport: 'football',
    });
    expect(catalogView(catalog('Today'))).toEqual({ view: 'today' });
    expect(catalogView(catalog('⏱️ Upcoming'))).toEqual({ view: 'upcoming' });
    expect(catalogView(catalog('Motor Sports', 'sports_motor_sports'))).toEqual({
      view: 'sport',
      sport: 'motorsport',
    });
    expect(catalogView(catalog('StremVerse IPTV'))).toEqual({ view: 'channels' });
  });

  it('gives no sport to a catalog that names two', () => {
    expect(catalogView(catalog('Fight (UFC, Boxing)', 'sports_fight'))).toEqual({ view: 'other' });
  });
});

describe('which catalogs are sports catalogs', () => {
  it('finds every catalog of a sports addon by its type or names', () => {
    const found = sportsCatalogs([streams]);
    expect(found).toHaveLength(17);
    expect(found.map((entry) => entry.view)).toContain('live');
    expect(found.every((entry) => entry.pageable)).toBe(true);
  });

  it('finds sport-named catalogs of a tv-typed addon, and keeps its replays skip=0', () => {
    const found = sportsCatalogs([nuvioAddon]);
    const live = found.find((entry) => entry.catalog.id === 'nuvio_sports_live')!;
    expect(live.view).toBe('live');
    // A live catalog names no sport: it needs a first page that looks like sport...
    expect(isSportsCatalog(nuvioAddon, live.catalog)).toBe(true);
    const replays = found.find((entry) => entry.catalog.id === 'nuvio_sports_replays')!;
    expect(replays.skipRequired).toBe(true);
    expect(found.find((entry) => entry.catalog.id === 'nuvio_sports_football')?.sport).toBe(
      'football',
    );
  });

  it('needs first-page evidence for a catalog that only names a view', () => {
    const live = metegolAddon.manifest.catalogs[0]!;
    expect(isSportsCatalog(metegolAddon, live)).toBe(true); // its id is "deportes"
    const plain = catalog('Live Events', 'live_events');
    const addon = installed(
      { ...stremverse, catalogs: [plain] },
      'https://x.example/manifest.json',
    );
    expect(isSportsCatalog(addon, plain)).toBe(false);
    expect(isSportsCatalog(addon, plain, { evidence: () => true })).toBe(true);
    expect(isSportsCatalog(addon, plain, { evidence: () => false })).toBe(false);
  });

  it('never takes a movie or series catalog on its name alone', () => {
    for (const entry of cinemetaAddon.manifest.catalogs) {
      expect(isSportsCatalog(cinemetaAddon, entry)).toBe(false);
    }
    const boxing = catalog('Boxing Films', 'boxing', 'movie');
    expect(isSportsCatalog(cinemetaAddon, boxing)).toBe(false);
    expect(isSportsCatalog(cinemetaAddon, boxing, { evidence: () => true })).toBe(true);
  });

  it('follows the addon setting', () => {
    expect(sportsCatalogs([streams], { setting: () => 'no' })).toHaveLength(0);
    const plain = catalog('Live Events', 'live_events');
    const addon = installed(
      { ...stremverse, catalogs: [plain] },
      'https://x.example/manifest.json',
    );
    expect(isSportsCatalog(addon, plain, { setting: () => 'yes' })).toBe(true);
  });

  it('leaves out catalogs the feed cannot ask', () => {
    const searchOnly: ManifestCatalog = {
      type: 'sport',
      id: 'search',
      name: 'Search',
      extra: [{ name: 'search', isRequired: true, options: [] }],
    };
    const addon = installed(
      { ...sportsStreams, catalogs: [searchOnly] },
      'https://y.example/manifest.json',
    );
    expect(sportsCatalogs([addon])).toHaveLength(0);
  });

  it('gives unique keys and a filter Home and Search can use', () => {
    const found = sportsCatalogs([streams, nuvioAddon, stremverseAddon], { evidence: () => true });
    expect(new Set(found.map((entry) => entry.key)).size).toBe(found.length);
    for (const entry of found) expect(entry.key).toMatch(/^[a-z0-9-]+$/);
    const leaveOut = sportsCatalogFilter(found);
    expect(leaveOut(streams, streams.manifest.catalogs[0]!)).toBe(true);
    expect(leaveOut(cinemetaAddon, cinemetaAddon.manifest.catalogs[0]!)).toBe(false);
  });
});

describe('first-page evidence', () => {
  it('reads matches and live labels as sport', () => {
    expect(
      looksLikeSports(items('Celtic vs Rangers', 'Arsenal v Spurs', '🔴 LIVE: Lakers vs Knicks')),
    ).toBe(true);
  });

  it('reads films, channels and short pages as not sport', () => {
    expect(looksLikeSports(items('The Matrix', 'Heat', 'Alien', 'Arsenal vs Spurs'))).toBe(false);
    expect(looksLikeSports(items('Celtic vs Rangers', 'Arsenal v Spurs'))).toBe(false);
    expect(looksLikeSports([])).toBe(false);
  });

  it('is noted only for catalogs whose first page can change the answer', () => {
    expect(needsEvidence(catalog('Live Events', 'live_events'))).toBe(true);
    expect(needsEvidence(catalog('Football', 'football', 'movie'))).toBe(true);
    // Typed sport: a sports catalog whatever it holds.
    expect(needsEvidence(catalog('Today', 'today', 'sport'))).toBe(false);
    expect(needsEvidence(catalog('Popular', 'top', 'movie'))).toBe(false);
    expect(needsEvidence(cinemetaAddon.manifest.catalogs[0]!)).toBe(false);
  });
});

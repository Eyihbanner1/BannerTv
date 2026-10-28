import {
  type MetaPreview,
  parseCatalogResponse,
  parseManifest,
  parseMetaPreview,
} from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { InstalledAddon } from '../addons/collection';
import data from './data/sports-data.json';
import { sportsCatalogs, type SportsCatalog } from './detect';
import { createMatcher } from './dictionary';
import { buildEvents } from './events';
import metegolDeportes from './fixtures/metegol/catalog__tv__deportes.json';
import metegolManifest from './fixtures/metegol/manifest.json';
import nuvioFootball from './fixtures/nuvio-live-sports/catalog__tv__nuvio_sports_football.json';
import nuvioLive from './fixtures/nuvio-live-sports/catalog__tv__nuvio_sports_live.json';
import nuvioManifest from './fixtures/nuvio-live-sports/manifest.json';
import basketball from './fixtures/sports-streams/catalog__sport__sports_basketball.json';
import cricket from './fixtures/sports-streams/catalog__sport__sports_cricket.json';
import fight from './fixtures/sports-streams/catalog__sport__sports_fight.json';
import football from './fixtures/sports-streams/catalog__sport__sports_football.json';
import football20 from './fixtures/sports-streams/catalog__sport__sports_football__skip=20.json';
import football40 from './fixtures/sports-streams/catalog__sport__sports_football__skip=40.json';
import hockey from './fixtures/sports-streams/catalog__sport__sports_hockey.json';
import live from './fixtures/sports-streams/catalog__sport__sports_live.json';
import motor from './fixtures/sports-streams/catalog__sport__sports_motor_sports.json';
import other from './fixtures/sports-streams/catalog__sport__sports_other.json';
import rugby from './fixtures/sports-streams/catalog__sport__sports_rugby.json';
import tennis from './fixtures/sports-streams/catalog__sport__sports_tennis.json';
import today from './fixtures/sports-streams/catalog__sport__sports_today.json';
import today20 from './fixtures/sports-streams/catalog__sport__sports_today__skip=20.json';
import streamsManifest from './fixtures/sports-streams/manifest.json';
import stremverseLive from './fixtures/stremverse/catalog__tv__stremverse_live_events.json';
import stremverseFootball from './fixtures/stremverse/catalog__tv__stremverse_live_events__genre=Football.json';
import stremverseXtra from './fixtures/stremverse/catalog__tv__stremverse_xtra_events.json';
import stremverseManifest from './fixtures/stremverse/manifest.json';
import { type Listing, readListing } from './listing';
import type { SportEvent, SportsData } from './types';
import { buildDay, dayStrip, eventState } from './view';

// The public fixtures were fetched on 28 October 2026 between 03:59 and 04:16 UTC.
const NOW = Date.parse('2026-10-28T04:10:00Z');
const matcher = createMatcher(data as unknown as SportsData);

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const addons = [
  installed(streamsManifest, 'https://sports.example/manifest.json'),
  installed(nuvioManifest, 'https://nuvio.example/manifest.json'),
  installed(metegolManifest, 'https://metegol.example/manifest.json'),
  installed(stremverseManifest, 'https://stremverse.example/manifest.json'),
];
const catalogs = sportsCatalogs(addons, { evidence: () => true });

const PAGES: Array<[addon: number, catalogId: string, json: unknown, genre?: string]> = [
  [0, 'sports_live', live],
  [0, 'sports_today', today],
  [0, 'sports_today', today20],
  [0, 'sports_football', football],
  [0, 'sports_football', football20],
  [0, 'sports_football', football40],
  [0, 'sports_basketball', basketball],
  [0, 'sports_hockey', hockey],
  [0, 'sports_cricket', cricket],
  [0, 'sports_fight', fight],
  [0, 'sports_motor_sports', motor],
  [0, 'sports_rugby', rugby],
  [0, 'sports_tennis', tennis],
  [0, 'sports_other', other],
  [1, 'nuvio_sports_live', nuvioLive],
  [1, 'nuvio_sports_football', nuvioFootball],
  [2, 'deportes', metegolDeportes],
  [3, 'stremverse_live_events', stremverseLive],
  [3, 'stremverse_live_events', stremverseFootball, 'Football'],
  [3, 'stremverse_xtra_events', stremverseXtra],
];

function entryFor(addon: number, catalogId: string): SportsCatalog {
  const entry = catalogs.find((c) => c.addonIndex === addon && c.catalog.id === catalogId);
  if (!entry) throw new Error(`no catalog ${catalogId}`);
  return entry;
}

function listingsOf(
  addon: number,
  catalogId: string,
  json: unknown,
  genre?: string,
  suffix = '',
  zone = entryFor(addon, catalogId).zone,
): Listing[] {
  const entry = entryFor(addon, catalogId);
  const metas: MetaPreview[] = parseCatalogResponse(json, entry.catalog.type).metas;
  return metas.map((item) =>
    readListing(
      suffix ? { ...item, id: `${item.id}${suffix}`, name: `${item.name}${suffix}` } : item,
      {
        addonIndex: entry.addonIndex,
        addonId: entry.addon.manifest.id,
        transportUrl: entry.addon.transportUrl,
        catalogId,
        sport: entry.sport,
        replays: entry.view === 'replays',
        channels: entry.view === 'channels',
        genreOption: genre,
        zone,
      },
      NOW,
    ),
  );
}

const listings: Listing[] = [];
for (const [addon, id, json, genre] of PAGES) listings.push(...listingsOf(addon, id, json, genre));
const events = buildEvents(listings, { matcher });

function find(text: string): SportEvent {
  const found = events.find((event) => event.title.indexOf(text) !== -1);
  if (!found) throw new Error(`no event "${text}"`);
  return found;
}

describe('the public sports addons, as captured', () => {
  it('reads every item of every page without throwing', () => {
    expect(listings.length).toBeGreaterThan(700);
    expect(events.length).toBeGreaterThan(150);
  });

  it('names the competitions the addons give', () => {
    expect(find('Freiburg vs Wolfsburg').competition.key).toBe('ger.cup');
    const city = find('Manchester City vs Brighton');
    expect(city.competition.key).toBe('eng.league-cup');
    expect(city.kickOff?.at).toBe(Date.parse('2026-10-28T19:30:00Z'));
    expect(find('Celtic vs Dundee United').competition.name).toBe('Scottish Premiership');
    expect(find('Brabrand vs AC Horsens').competition.country).toBe('DK');
  });

  it('merges one match listed by two addons', () => {
    const lakers = find('Los Angeles Lakers vs Portland Trail Blazers');
    const addonsListing = new Set(lakers.sources.map((s) => s.addonIndex));
    expect(addonsListing.size).toBeGreaterThanOrEqual(2);
    expect(lakers.competition.key).toBe('nba');
  });

  it('trusts the teams over a wrong sport tag', () => {
    // MeteGol tags its NHL games "Fútbol".
    const ducks = events.filter(
      (e) => e.sources.some((s) => s.addonIndex === 2) && /Ducks/.test(e.title),
    );
    expect(ducks.length).toBeGreaterThan(0);
    for (const event of ducks) {
      expect(event.sport).toBe('ice-hockey');
      expect(event.competition.key).toBe('nhl');
    }
  });

  it('puts no channel, TV programme or placeholder among the events', () => {
    for (const event of events) {
      for (const source of event.sources) expect(source.id.indexOf('leaf:')).toBe(-1);
      expect(event.title).not.toMatch(/\bS\d+,\s*E\d+\b/);
    }
  });

  it('never guesses the Champions League for a SofaScore competition it does not know', () => {
    // Bayern v Real Madrid on a Wednesday, under SofaScore tournament 696: not the men's league phase.
    expect(find('FC Bayern Munchen vs Real Madrid').competition.key).not.toBe('uefa.cl');
    expect(find('Liverpool FC vs Chelsea').competition.key).toBe('eng.league-cup');
  });

  it('takes the sport of the genre page an item was asked from', () => {
    // StremVerse sends "Indian Super League" with no genres; its genre=Football page says it.
    const onPage = listingsOf(3, 'stremverse_live_events', stremverseFootball, 'Football');
    const league = onPage.filter((listing) => listing.title === 'Indian Super League');
    expect(league.length).toBeGreaterThan(0);
    for (const listing of league) expect(listing.addonSport).toBe('football');
    const [event] = buildEvents(league, { matcher });
    expect(event!.sport).toBe('football');
    expect(event!.competition.name).toBe('Other football');
  });

  it('gives youth sides their own row', () => {
    expect(find('Manchester United U18 vs Burnley U18').competition.name).toBe('Youth football');
  });

  it('keeps clock-only times unknown when the addon names no zone', () => {
    // MeteGol sends only "23:00", in a zone set in its settings (UTC-3 by default); this
    // install address names none.
    expect(entryFor(2, 'deportes').zone).toBeUndefined();
    const metegol = listingsOf(2, 'deportes', metegolDeportes);
    expect(metegol).toHaveLength(4);
    for (const listing of metegol) expect(listing.kickOff).toBeUndefined();
    // Where its matches merge with another addon's, that copy's time is shown.
    const merged = events.filter((e) => e.sources.some((s) => s.addonIndex === 2));
    expect(merged.length).toBeGreaterThan(0);
    for (const event of merged) expect(event.kickOff?.source).not.toBe('clock');
    // With a zone, the same items do get a time.
    const zoned = listingsOf(2, 'deportes', metegolDeportes, undefined, '', 'UTC-03:00');
    expect(zoned[0]!.kickOff).toEqual({
      at: Date.parse('2026-10-28T02:00:00Z'),
      sure: true,
      source: 'clock',
      zone: 'UTC-03:00',
    });
  });

  it('builds every day of the strip with safe keys and no empty rows', () => {
    for (const day of dayStrip(NOW)) {
      const groups = buildDay(events, day, { now: NOW, matcher });
      for (const group of groups) {
        expect(group.key).toMatch(/^[a-z0-9-]+$/);
        expect(group.events.length).toBeGreaterThan(0);
        for (const event of group.events) {
          if (day === 'live')
            expect(['live', 'soon', 'live-unknown']).toContain(eventState(event, { now: NOW }));
        }
      }
    }
    const live = buildDay(events, 'live', { now: NOW, matcher });
    expect(live.length).toBeGreaterThan(2);
  });

  it('puts UK football first on Today', () => {
    const groups = buildDay(events, '2026-10-28', { now: NOW, matcher });
    expect(groups[0]!.competition.key).toBe('eng.league-cup');
    expect(groups.map((g) => g.competition.key).indexOf('sco.1')).toBe(1);
  });
});

describe('names the captures do not have, with the bundled dictionary', () => {
  let counter = 0;
  function listing(fields: Record<string, unknown>, addonIndex: number): Listing {
    const item = parseMetaPreview({ id: `x${counter++}`, type: 'tv', ...fields });
    if (!item) throw new Error('not an item');
    return readListing(
      item,
      {
        addonIndex,
        addonId: `test.${addonIndex}`,
        transportUrl: `https://addon-${addonIndex}.example/manifest.json`,
        catalogId: 'live',
        replays: false,
        channels: false,
      },
      NOW,
    );
  }

  it('reads a competition ending in a number in front of the teams, and merges the match', () => {
    const released = '2026-10-28T20:00:00.000Z';
    const built = buildEvents(
      [
        listing({ name: 'Ligue 1: Paris Saint-Germain vs Marseille', released }, 0),
        listing({ name: 'Paris Saint-Germain vs Olympique de Marseille', released }, 1),
      ],
      { matcher },
    );
    expect(built).toHaveLength(1);
    expect(built[0]!.home).toBe('Paris Saint-Germain');
    expect(built[0]!.competition).toMatchObject({ key: 'fra.1', source: 'name-prefix' });
    expect(built[0]!.sources).toHaveLength(2);
  });

  it('takes a stage in front of the teams as the round, not a competition', () => {
    const game = listing({ name: 'Game 7: Los Angeles Lakers vs Boston Celtics' }, 0);
    expect(game.round).toBe('Game 7');
    expect(game.competitions).toEqual([]);
    const [event] = buildEvents([game], { matcher });
    expect(event!.home).toBe('Los Angeles Lakers');
    expect(event!.competition).toMatchObject({ key: 'nba', round: 'Game 7' });
  });
});

describe('a huge catalog', () => {
  it('groups over 3,000 items quickly', () => {
    const many: Listing[] = [];
    for (let copy = 0; many.length < 3000; copy++) {
      for (const [addon, id, json, genre] of PAGES) {
        for (const listing of listingsOf(addon, id, json, genre, ` ${copy}`)) many.push(listing);
      }
    }
    const started = Date.now();
    const built = buildEvents(many, { matcher });
    const days = dayStrip(NOW).map((day) => buildDay(built, day, { now: NOW, matcher }));
    const elapsed = Date.now() - started;
    expect(built.length).toBeGreaterThan(500);
    expect(days[1]!.length).toBeGreaterThan(0);
    // Under 100 ms on the TV is the target; a desktop runner should be well inside it.
    expect(elapsed).toBeLessThan(400);
  });
});

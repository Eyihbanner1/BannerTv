import { type MetaPreview, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { profileKeyPrefix } from '../profiles/profiles';
import { profileKeyValueStore } from '../profiles/scoped';
import { type KeyValueStore, memoryKeyValueStore } from '../storage';
import { createAccountClock } from '../sync/clock';
import { createSyncEngine } from '../sync/engine';
import { type LiveItem, newItems } from '../sync/items';
import { tidyItems } from '../sync/merge';
import { fakeSyncService, manualTimers, memoryPart, webCryptoForTests } from '../sync/testing';
import { createMatcher } from './dictionary';
import { buildEvents } from './events';
import mini from './fixtures/mini-data.json';
import {
  createFollows,
  type Follow,
  followableCompetition,
  followableTeams,
  followDocumentKey,
  followsHas,
  followsPart,
  type FollowTarget,
  followTargets,
  isFollowed,
  MAX_FOLLOWS,
} from './follows';
import { type CatalogContext, readListing } from './listing';
import type { SportsData } from './types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const matcher = createMatcher(mini as unknown as SportsData);

function context(addonIndex = 0): CatalogContext {
  return {
    addonIndex,
    addonId: `test.sports.${addonIndex}`,
    transportUrl: `https://sports${addonIndex}.example/manifest.json`,
    catalogId: 'all',
    replays: false,
    channels: false,
  };
}

let counter = 0;
function item(fields: Record<string, unknown>): MetaPreview {
  const parsed = parseMetaPreview({ id: `m${counter++}`, type: 'sport', ...fields });
  if (!parsed) throw new Error('not an item');
  return parsed;
}

/** One event per listing, each from an addon of its own so none are combined. */
function eventsOf(...rows: Array<Record<string, unknown>>) {
  return rows.map(
    (fields, index) =>
      buildEvents([readListing(item(fields), context(index), NOW)], { matcher })[0]!,
  );
}

const arsenal: FollowTarget = {
  kind: 'team',
  id: 'football:arsenal',
  name: 'Arsenal',
  sport: 'football',
};
const premierLeague: FollowTarget = {
  kind: 'comp',
  id: 'eng.1',
  name: 'Premier League',
  sport: 'football',
};

describe('follow keys', () => {
  it('are the same for one club however two addons name it', () => {
    const [a, b, c, d] = eventsOf(
      { name: 'Man Utd vs Spurs', genres: ['Football', 'Premier League'] },
      { name: 'Manchester United v Tottenham Hotspur', genres: ['Soccer'] },
      { name: 'Bath Rugby vs Saracens', genres: ['Rugby'] },
      { name: 'Bath v Saracens RFC', genres: ['Rugby Union'] },
    );
    expect(a!.followKeys).toEqual(['football:manchester united', 'football:tottenham hotspur']);
    expect(b!.followKeys).toEqual(a!.followKeys);
    expect(c!.followKeys).toEqual(['rugby:bath', 'rugby:saracens']);
    expect(d!.followKeys).toEqual(c!.followKeys);
  });

  it('leave off the sport words of a club named in full', () => {
    const [county, short, rugby] = eventsOf(
      { name: 'Yorkshire County Cricket Club vs Lancashire CCC', genres: ['Cricket'] },
      { name: 'Yorkshire vs Lancashire', genres: ['Cricket'] },
      { name: 'Bath Rugby Football Club vs Saracens Rugby Club', genres: ['Rugby'] },
    );
    expect(county!.followKeys).toEqual(['cricket:yorkshire', 'cricket:lancashire']);
    expect(short!.followKeys).toEqual(county!.followKeys);
    expect(rugby!.followKeys).toEqual(['rugby:bath', 'rugby:saracens']);
  });

  it("tell a club's women's and youth sides, and its other sports, from its first team", () => {
    const [women, wsl, youth, basketball, football] = eventsOf(
      { name: 'Arsenal Women vs Chelsea Women', genres: ['Football'] },
      { name: 'Arsenal vs Chelsea', genres: ['Football', "Women's Super League"] },
      { name: 'Arsenal U21 vs Chelsea U21', genres: ['Football'] },
      { name: 'Real Madrid vs Barcelona', genres: ['Basketball', 'EuroLeague'] },
      { name: 'Real Madrid vs Barcelona', genres: ['Football'] },
    );
    expect(women!.followKeys).toEqual(['football:arsenal:women', 'football:chelsea:women']);
    expect(wsl!.followKeys).toEqual(women!.followKeys);
    expect(youth!.followKeys).toEqual(['football:arsenal:youth', 'football:chelsea:youth']);
    expect(basketball!.followKeys![0]).toBe('basketball:real madrid');
    expect(football!.followKeys![0]).toBe('football:real madrid');
  });

  it('are not given to players and fighters', () => {
    const [tennis, mma] = eventsOf(
      { name: 'Sinner vs Alcaraz', genres: ['Tennis', 'ATP Paris'] },
      { name: 'UFC 320: Jones vs Aspinall', genres: ['MMA'] },
    );
    expect(tennis!.followKeys).toBeUndefined();
    expect(mma!.followKeys).toBeUndefined();
    expect(followableTeams(tennis!)).toBeUndefined();
  });
});

describe('what a match offers to follow', () => {
  it('offers both sides and a competition with a key the same on every screen', () => {
    const [pl, euroLeague, unknown, country] = eventsOf(
      { name: 'Arsenal vs Burnley', genres: ['Football', 'Premier League'] },
      { name: 'Real Madrid vs Barcelona', genres: ['Basketball', 'EuroLeague'] },
      { name: 'Brabrand vs AC Horsens', genres: ['Football', 'Denmark DBU Pokalen'] },
      { name: 'Rangers vs Celtic', genres: ['Football'] },
    );
    expect(followableTeams(pl!)).toEqual([
      { kind: 'team', id: 'football:arsenal', name: 'Arsenal', sport: 'football' },
      { kind: 'team', id: 'football:burnley', name: 'Burnley', sport: 'football' },
    ]);
    expect(followableCompetition(pl!)).toEqual(premierLeague);
    // In the basketball Other row, by the competition its note names.
    expect(euroLeague!.competition.key).not.toBe('euroleague');
    expect(followableCompetition(euroLeague!)).toEqual({
      kind: 'comp',
      id: 'euroleague',
      name: 'EuroLeague',
      sport: 'basketball',
    });
    expect(followableCompetition(unknown!)).toMatchObject({
      kind: 'comp',
      id: expect.stringMatching(/^text:football:/),
      name: 'Denmark DBU Pokalen',
    });
    // A country's row is BannerTV's guess, not a competition.
    expect(country!.competition.source).toBe('country');
    expect(followableCompetition(country!)).toBeUndefined();
    expect(followTargets(pl!).map((target) => target.name)).toEqual([
      'Arsenal',
      'Burnley',
      'Premier League',
    ]);
    expect(followTargets(country!).map((target) => target.name)).toEqual(['Rangers', 'Celtic']);
    expect(followsHas({ teams: new Set(['eng.1']), competitions: new Set() }, premierLeague)).toBe(
      false,
    );
  });

  it('tells a followed match by either side or its competition', () => {
    const [pl, euroLeague, country] = eventsOf(
      { name: 'Arsenal vs Burnley', genres: ['Football', 'Premier League'] },
      { name: 'Real Madrid vs Barcelona', genres: ['Basketball', 'EuroLeague'] },
      { name: 'Rangers vs Celtic', genres: ['Football'] },
    );
    const none = { teams: new Set<string>(), competitions: new Set<string>() };
    expect(isFollowed(pl!, none)).toBe(false);
    expect(isFollowed(pl!, { ...none, teams: new Set(['football:burnley']) })).toBe(true);
    expect(isFollowed(pl!, { ...none, competitions: new Set(['eng.1']) })).toBe(true);
    expect(isFollowed(euroLeague!, { ...none, competitions: new Set(['euroleague']) })).toBe(true);
    expect(
      isFollowed(country!, { ...none, competitions: new Set([country!.competition.key]) }),
    ).toBe(false);
    expect(isFollowed(country!, { ...none, teams: new Set(['football:celtic']) })).toBe(true);
  });
});

function store(storage: KeyValueStore = memoryKeyValueStore(), start = NOW) {
  let time = start;
  const follows = createFollows({ storage, now: () => time++ });
  return { follows, storage, tick: (ms: number) => (time += ms) };
}

describe('createFollows', () => {
  it('follows and unfollows, the newest first, and keeps them', async () => {
    const { follows, storage } = store();
    await follows.load();
    expect(await follows.follow(arsenal)).toBe(true);
    expect(await follows.follow(premierLeague)).toBe(true);
    // Following again changes nothing.
    expect(await follows.follow({ ...arsenal, name: 'Arsenal FC' })).toBe(true);
    expect(follows.list().map((f) => f.id)).toEqual(['eng.1', 'football:arsenal']);
    expect(follows.has(arsenal)).toBe(true);
    expect(follows.has({ kind: 'comp', id: 'football:arsenal' })).toBe(false);
    const set = follows.set();
    expect(follows.set()).toBe(set);
    expect([...set.teams]).toEqual(['football:arsenal']);
    expect([...set.competitions]).toEqual(['eng.1']);

    const again = createFollows({ storage });
    await again.load();
    expect(again.list()).toEqual(follows.list());

    await follows.unfollow(arsenal);
    expect(follows.list().map((f) => f.id)).toEqual(['eng.1']);
    expect(follows.set()).not.toBe(set);
    expect(follows.set().teams.size).toBe(0);
  });

  it('cleans names and refuses what it cannot keep', async () => {
    const { follows } = store();
    await follows.load();
    expect(await follows.follow({ ...arsenal, name: '  Arsenal \n Women ' })).toBe(true);
    expect(follows.list()[0]!.name).toBe('Arsenal Women');
    expect(await follows.follow({ ...arsenal, id: '' })).toBe(false);
    expect(await follows.follow({ ...arsenal, id: 'x'.repeat(201) })).toBe(false);
    expect(await follows.follow({ ...arsenal, id: 'a', name: ' ' })).toBe(false);
    expect(
      await follows.follow({ ...arsenal, id: 'b', sport: 'quidditch' } as unknown as FollowTarget),
    ).toBe(false);
    expect(follows.list()).toHaveLength(1);
  });

  it('follows no more than MAX_FOLLOWS', async () => {
    const { follows } = store();
    await follows.load();
    for (let n = 0; n < MAX_FOLLOWS; n++) {
      expect(await follows.follow({ ...arsenal, id: `football:team ${n}` })).toBe(true);
    }
    expect(await follows.follow(premierLeague)).toBe(false);
    expect(follows.has(premierLeague)).toBe(false);
    expect(follows.list()).toHaveLength(MAX_FOLLOWS);
  });

  it('reads what was saved, leaving out what it cannot read and the oldest past the cap', async () => {
    const storage = memoryKeyValueStore();
    const saved: unknown[] = [
      { ...arsenal, at: NOW - 5 },
      { kind: 'side', id: 'x', name: 'X', sport: 'football', at: NOW },
      { ...premierLeague, at: 'yesterday' },
      'nonsense',
      { ...arsenal, name: 'Old Arsenal', at: NOW - 10 },
    ];
    for (let n = 0; n < MAX_FOLLOWS + 5; n++) {
      saved.push({ ...arsenal, id: `football:team ${n}`, at: NOW - 1000 - n });
    }
    await storage.set('sports.follows', saved);
    const follows = createFollows({ storage });
    await follows.load();
    const list = follows.list();
    expect(list).toHaveLength(MAX_FOLLOWS);
    expect(list[0]).toEqual({ ...arsenal, at: NOW - 5 });
    expect(list[MAX_FOLLOWS - 1]!.id).toBe(`football:team ${MAX_FOLLOWS - 2}`);
  });

  it("makes the account's change, trimmed to the cap, before its first await", async () => {
    const { follows } = store();
    await follows.load();
    await follows.follow(arsenal);
    const set: Follow[] = [];
    for (let n = 0; n < MAX_FOLLOWS; n++) {
      set.push({ ...arsenal, id: `football:team ${n}`, at: NOW + 100 + n });
    }
    const adopted = follows.adopt({ set, remove: [] });
    // Arsenal, followed before the others, is the one the cap leaves out, as the account does.
    expect(follows.list()).toHaveLength(MAX_FOLLOWS);
    expect(follows.has(arsenal)).toBe(false);
    expect(follows.list()[0]!.id).toBe(`football:team ${MAX_FOLLOWS - 1}`);
    await adopted;

    const before = follows.list();
    await follows.adopt({ remove: [{ kind: 'team', id: 'football:nobody' }] });
    expect(follows.list()).toBe(before);
    await follows.adopt({ set: [set[0]!] });
    expect(follows.list()).toBe(before);
    await follows.adopt({ remove: [{ kind: 'team', id: 'football:team 0' }] });
    expect(follows.list()).toHaveLength(MAX_FOLLOWS - 1);
  });
});

describe('followsPart', () => {
  it('gives each follow as follow/<kind>/<id> with its name, sport and time', async () => {
    const { follows } = store();
    const part = followsPart('main', follows);
    await part.load();
    expect(part.document).toBe('p/main/settings');
    expect(part.ownData!()).toBe(false);
    await follows.follow(arsenal);
    await follows.follow(premierLeague);
    const snapshot = part.snapshot();
    expect([...snapshot]).toEqual([
      ['follow/comp/eng.1', { v: { n: 'Premier League', s: 'football' }, t: NOW + 1 }],
      ['follow/team/football:arsenal', { v: { n: 'Arsenal', s: 'football' }, t: NOW }],
    ]);
    // The same items while nothing changes, so the engine's comparisons stay cheap.
    expect(part.snapshot().get('follow/comp/eng.1')).toBe(snapshot.get('follow/comp/eng.1'));
    expect(part.ownData!()).toBe(true);
    expect(followDocumentKey({ kind: 'team', id: 'rugby:bath:women' })).toBe(
      'follow/team/rugby:bath:women',
    );
  });

  it("adopts the account's follows and removals, passing over what it cannot read", async () => {
    const { follows } = store();
    const part = followsPart('main', follows);
    await part.load();
    await follows.follow(arsenal);
    const set = new Map<string, LiveItem>([
      ['follow/team/rugby:bath', { v: { n: 'Bath Rugby', s: 'rugby' }, t: NOW + 50 }],
      ['follow/comp/text:rugby:premiership-cup', { v: { n: 'Prem Cup', s: 'rugby' }, t: NOW + 60 }],
      ['follow/side/rugby:bath', { v: { n: 'Bath', s: 'rugby' }, t: NOW + 70 }],
      ['follow/team/', { v: { n: 'Nobody', s: 'rugby' }, t: NOW + 70 }],
      ['follow/team/rugby:saracens', { v: 'Saracens', t: NOW + 70 }],
      ['follow/team/rugby:quins', { v: { n: 'Quins', s: 'quidditch' }, t: NOW + 70 }],
    ]);
    const adopted = part.adopt({ set, remove: ['follow/team/football:arsenal'] });
    expect([...part.snapshot().keys()]).toEqual([
      'follow/comp/text:rugby:premiership-cup',
      'follow/team/rugby:bath',
    ]);
    await adopted;
    expect(follows.list()[1]).toEqual({
      kind: 'team',
      id: 'rugby:bath',
      name: 'Bath Rugby',
      sport: 'rugby',
      at: NOW + 50,
    });
  });

  it("keeps the same follows as the account's own cap", async () => {
    const items = newItems();
    for (let n = 0; n < MAX_FOLLOWS + 20; n++) {
      // Some at the same time, which both cut by key.
      items[`follow/team/football:team ${n}`] = {
        v: { n: `Team ${n}`, s: 'football' },
        t: NOW + (n >> 1),
      };
    }
    items['pref/autoplay'] = { v: true, t: NOW };
    const tidied = tidyItems('p/main/settings', items, NOW);
    const accountKept = Object.keys(tidied)
      .filter((key) => key.indexOf('follow/') === 0)
      .sort();
    expect(accountKept).toHaveLength(MAX_FOLLOWS);
    expect(tidied['pref/autoplay']).toBeDefined();

    const { follows } = store();
    await follows.load();
    const set: Follow[] = [];
    for (const [key, value] of Object.entries(items)) {
      if (key.indexOf('follow/team/') !== 0) continue;
      const v = (value as LiveItem).v as { n: string; s: 'football' };
      set.push({ kind: 'team', id: key.slice(12), name: v.n, sport: v.s, at: value.t });
    }
    void follows.adopt({ set });
    expect(follows.list().map(followDocumentKey).sort()).toEqual(accountKept);
  });
});

describe('follows on two screens', () => {
  const crypto = webCryptoForTests();
  const START = Date.UTC(2026, 9, 1, 12, 0, 0) + 123;

  function world() {
    const time = manualTimers();
    const now = () => START + time.elapsed();
    return { time, now, service: fakeSyncService({ now }) };
  }

  function screen(w: ReturnType<typeof world>) {
    const storage = memoryKeyValueStore();
    const clock = createAccountClock({ now: w.now });
    const profiles = memoryPart('profiles');
    profiles.set('main', 1, 0);
    const followsOf = (id: string) =>
      createFollows({
        storage: profileKeyValueStore(storage, Promise.resolve(profileKeyPrefix(id))),
        now: clock.now,
      });
    const follows = followsOf('main');
    const engine = createSyncEngine({
      crypto,
      transport: w.service.transport,
      storage,
      clock,
      timers: w.time.timers,
      accountParts: [profiles.part],
      profileParts: (id) => [followsPart(id, followsOf(id))],
    });
    return {
      follows,
      engine,
      start: () => engine.start({ id: 'main', parts: [followsPart('main', follows)] }),
    };
  }

  const ids = (s: ReturnType<typeof screen>) => s.follows.list().map((f) => f.id);

  it('show the same follows once both have synced, unfollowing included', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    await a.follows.follow(arsenal);
    await w.time.advance(1000);
    await a.follows.follow(premierLeague);
    const code = await a.engine.create();
    await a.engine.confirmCreate();

    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');
    expect(ids(b)).toEqual(['eng.1', 'football:arsenal']);
    expect(b.follows.list()[1]!.at).toBe(a.follows.list()[1]!.at);

    await w.time.advance(1000);
    await b.follows.unfollow(arsenal);
    await b.follows.follow({ kind: 'team', id: 'rugby:bath', name: 'Bath', sport: 'rugby' });
    await w.time.advance(1000);
    await a.follows.follow({ kind: 'comp', id: 'f1', name: 'Formula 1', sport: 'motorsport' });
    await b.engine.flush();
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(ids(a)).toEqual(['f1', 'rugby:bath', 'eng.1']);
    expect(ids(b)).toEqual(ids(a));

    // Followed again after the unfollow: the newer change wins on both.
    await w.time.advance(1000);
    await a.follows.follow(arsenal);
    await a.engine.flush();
    await b.engine.syncNow();
    expect(ids(b)).toEqual(['football:arsenal', 'f1', 'rugby:bath', 'eng.1']);
  });

  it('keep the same newest follows when both together follow more than the cap', async () => {
    const w = world();
    const a = screen(w);
    await a.start();
    const code = await a.engine.create();
    await a.engine.confirmCreate();
    const b = screen(w);
    await b.start();
    await b.engine.join(code, 'use');

    const half = MAX_FOLLOWS / 2 + 10;
    for (let n = 0; n < half; n++) {
      await a.follows.follow({ ...arsenal, id: `football:a${n}` });
      await b.follows.follow({ ...arsenal, id: `football:b${n}` });
      await w.time.advance(10);
    }
    await a.engine.flush();
    await b.engine.flush();
    await a.engine.syncNow();
    expect(ids(a)).toHaveLength(MAX_FOLLOWS);
    expect(ids(b)).toEqual(ids(a));
    // The first ten each followed are the oldest, and the ones left out.
    expect(ids(a)).not.toContain('football:a9');
    expect(ids(a)).toContain('football:a10');
    // Followed at the same moment on both: by key, as the account cuts them.
    expect(ids(a).slice(0, 2)).toEqual([`football:a${half - 1}`, `football:b${half - 1}`]);
  });
});

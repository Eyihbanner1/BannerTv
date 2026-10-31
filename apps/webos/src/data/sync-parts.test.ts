import {
  createStore,
  type KidsRating,
  type LiveItem,
  type PartChange,
  type Profile,
  type ProfilesState,
} from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, type Preferences } from './preferences';
import { preferencesPart, profilesPart, type SportsChoices, sportsPart } from './sync-parts';

const MAIN = 'Main';

/** A part's snapshot as a plain object, to compare whole. */
function plain(items: Map<string, unknown>): { [key: string]: unknown } {
  const out: { [key: string]: unknown } = {};
  items.forEach((value, key) => (out[key] = value));
  return out;
}
const PIN = { salt: 'c2FsdA', hash: 'a'.repeat(64) };

function change(set: Array<[string, LiveItem]> = [], remove: string[] = []): PartChange {
  return { set: new Map(set), remove };
}

function setup(list: Profile[], active: string | null = 'main', lastId = 'main') {
  const profiles = createStore<ProfilesState>({ profiles: list, lastId, askAtLaunch: true });
  const held = { deleted: [] as string[], kids: [] as Array<[string, KidsRating | null]> };
  const part = profilesPart({
    profiles,
    activeId: () => active,
    mainName: MAIN,
    holdDeletion: (id) => held.deleted.push(id),
    holdKids: (id, kids) => held.kids.push([id, kids]),
  });
  const ids = () => profiles.get().profiles.map((profile) => profile.id);
  return { profiles, held, part, ids };
}

const main: Profile = { id: 'main', name: MAIN, colour: 0 };

describe('profilesPart', () => {
  it('describes each profile with its fields, kids and PIN null when there is none', () => {
    const { part } = setup([
      main,
      { id: 'abc123', name: 'Ada', colour: 2, kids: 'PG', pin: PIN },
      { id: 'def456', name: 'Bo', colour: 1 },
    ]);
    expect(plain(part.snapshot())).toEqual({
      main: { v: 1, t: 0 },
      'main/name': { v: MAIN },
      'main/colour': { v: 0 },
      'main/kids': { v: null },
      'main/pin': { v: null },
      abc123: { v: 1 },
      'abc123/name': { v: 'Ada' },
      'abc123/colour': { v: 2 },
      'abc123/kids': { v: 'PG' },
      'abc123/pin': { v: PIN },
      def456: { v: 1 },
      'def456/name': { v: 'Bo' },
      'def456/colour': { v: 1 },
      'def456/kids': { v: null },
      'def456/pin': { v: null },
    });
    expect(part.document).toBe('profiles');
  });

  it('adds the account’s profiles after this screen’s, oldest first, and keeps which was used last', () => {
    const { part, profiles, ids } = setup([main, { id: 'here01', name: 'Here', colour: 1 }]);
    void part.adopt(
      change([
        ['late01', { t: 300, v: 1 }],
        ['late01/name', { t: 300, v: 'Late' }],
        ['early1', { t: 100, v: 1 }],
        ['early1/name', { t: 100, v: '  Early  ' }],
        ['early1/colour', { t: 100, v: 4 }],
        ['early1/pin', { t: 100, v: PIN }],
        ['main/name', { t: 50, v: 'Family' }],
      ]),
    );
    expect(ids()).toEqual(['main', 'here01', 'early1', 'late01']);
    const state = profiles.get();
    expect(state.profiles[0]!.name).toBe('Family');
    expect(state.profiles[2]).toEqual({ id: 'early1', name: 'Early', colour: 4, pin: PIN });
    expect(state.lastId).toBe('main');
    expect(state.askAtLaunch).toBe(true);
  });

  it('leaves out values it cannot use and profiles that came without a name', () => {
    const { part, profiles, ids } = setup([main, { id: 'abc123', name: 'Ada', colour: 2 }]);
    void part.adopt(
      change([
        ['abc123/colour', { t: 1, v: 9 }],
        ['abc123/name', { t: 1, v: '   ' }],
        ['abc123/kids', { t: 1, v: 'R18' }],
        ['abc123/pin', { t: 1, v: { salt: 'x', hash: 'not a hash' } }],
        ['nameless', { t: 1, v: 1 }],
        ['BAD ID', { t: 1, v: 1 }],
        ['BAD ID/name', { t: 1, v: 'Nope' }],
        ['__proto__/name', { t: 1, v: 'Nope' }],
      ]),
    );
    expect(ids()).toEqual(['main', 'abc123']);
    expect(profiles.get().profiles[1]).toEqual({ id: 'abc123', name: 'Ada', colour: 2 });
  });

  it('takes a PIN or kids setting off, by a null or a removal', () => {
    const { part, profiles } = setup([
      main,
      { id: 'abc123', name: 'Ada', colour: 2, kids: 'U', pin: PIN },
      { id: 'def456', name: 'Bo', colour: 1, kids: '12', pin: PIN },
    ]);
    void part.adopt(
      change(
        [
          ['abc123/pin', { t: 1, v: null }],
          ['abc123/kids', { t: 1, v: null }],
        ],
        ['def456/pin', 'def456/kids'],
      ),
    );
    expect(profiles.get().profiles.slice(1)).toEqual([
      { id: 'abc123', name: 'Ada', colour: 2 },
      { id: 'def456', name: 'Bo', colour: 1 },
    ]);
  });

  it('holds back a kids change to the profile in use until the next launch', () => {
    const { part, profiles, held } = setup(
      [
        main,
        { id: 'abc123', name: 'Ada', colour: 2, kids: 'U' },
        { id: 'def456', name: 'Bo', colour: 1 },
      ],
      'abc123',
    );
    void part.adopt(
      change([
        ['abc123/kids', { t: 1, v: '12' }],
        ['def456/kids', { t: 1, v: 'PG' }],
      ]),
    );
    expect(profiles.get().profiles[1]!.kids).toBe('U');
    expect(profiles.get().profiles[2]!.kids).toBe('PG');
    expect(held.kids).toEqual([['abc123', '12']]);
    void part.adopt(change([], ['abc123/kids']));
    expect(held.kids).toEqual([
      ['abc123', '12'],
      ['abc123', null],
    ]);
  });

  it('never makes Main a kids profile', () => {
    const { part, profiles, held } = setup([main]);
    void part.adopt(change([['main/kids', { t: 1, v: 'U' }]]));
    expect(profiles.get().profiles[0]!.kids).toBeUndefined();
    expect(held.kids).toEqual([]);
  });

  it('takes a deleted profile away now, and the one in use at the next launch', () => {
    const { part, held, ids, profiles } = setup(
      [main, { id: 'abc123', name: 'Ada', colour: 2 }, { id: 'def456', name: 'Bo', colour: 1 }],
      'def456',
      'abc123',
    );
    void part.adopt(change([], ['abc123', 'abc123/name', 'def456', 'main', 'gone99']));
    expect(held.deleted).toEqual(['abc123', 'def456']);
    // Main is never removed; the profile in use stays until the app starts again.
    expect(ids()).toEqual(['main', 'def456']);
    expect(profiles.get().lastId).toBe('main');
  });

  it('shows at most six profiles, keeping Main and the one in use', () => {
    const here: Profile[] = [main];
    for (let i = 1; i <= 5; i++) here.push({ id: `here0${i}`, name: `Here ${i}`, colour: 0 });
    const { part, ids } = setup(here, 'here05');
    void part.adopt(
      change([
        ['new001', { t: 1, v: 1 }],
        ['new001/name', { t: 1, v: 'New' }],
      ]),
    );
    expect(ids()).toEqual(['main', 'here01', 'here02', 'here03', 'here04', 'here05']);
  });

  it('puts Main back first if a list ever lacks it', () => {
    const { part, ids, profiles } = setup(
      [{ id: 'abc123', name: 'Ada', colour: 2 }],
      'abc123',
      'abc123',
    );
    void part.adopt(change([['abc123/colour', { t: 1, v: 3 }]]));
    expect(ids()).toEqual(['main', 'abc123']);
    expect(profiles.get().profiles[0]!.name).toBe(MAIN);
    expect(profiles.get().lastId).toBe('abc123');
  });

  it('counts more profiles, a renamed Main or Main’s PIN as data of this screen’s own', () => {
    expect(setup([main]).part.ownData!()).toBe(false);
    expect(setup([{ ...main, name: 'Family' }]).part.ownData!()).toBe(true);
    expect(setup([{ ...main, pin: PIN }]).part.ownData!()).toBe(true);
    expect(setup([main, { id: 'abc123', name: 'Ada', colour: 2 }]).part.ownData!()).toBe(true);
  });
});

describe('preferencesPart', () => {
  function prefsSetup(start: Partial<Preferences> = {}) {
    const store = createStore<Preferences>({ ...DEFAULT_PREFERENCES, ...start });
    let writes = 0;
    store.subscribe(() => (writes += 1));
    return { store, part: preferencesPart('abc123', store), writes: () => writes };
  }

  it('describes only what differs from the defaults, and never link testing', () => {
    const { part } = prefsSetup({
      probing: 'off',
      audioLanguage: 'fre',
      tmdb: false,
      subtitleStyle: { ...DEFAULT_PREFERENCES.subtitleStyle, colour: 'yellow' },
    });
    expect(part.document).toBe('p/abc123/settings');
    expect(plain(part.snapshot())).toEqual({
      'pref/audioLanguage': { v: 'fre' },
      'pref/tmdb': { v: false },
      'style/colour': { v: 'yellow' },
    });
    expect(plain(prefsSetup().part.snapshot())).toEqual({});
  });

  it('takes the account’s values, a removal as the default, and keeps link testing as it is', () => {
    const { part, store } = prefsSetup({ probing: 'on', streamChoice: 'fast', tmdb: false });
    void part.adopt(
      change(
        [
          ['pref/subtitleLanguage', { t: 1, v: 'spa' }],
          ['style/size', { t: 1, v: 'large' }],
          ['pref/probing', { t: 1, v: 'off' }],
        ],
        ['pref/streamChoice'],
      ),
    );
    expect(store.get()).toEqual({
      ...DEFAULT_PREFERENCES,
      probing: 'on',
      tmdb: false,
      subtitleLanguage: 'spa',
      subtitleStyle: { ...DEFAULT_PREFERENCES.subtitleStyle, size: 'large' },
    });
  });

  it('turns a value this build does not know into the default, and writes nothing when nothing changed', () => {
    const { part, store, writes } = prefsSetup({ allStreamsOrder: 'addon' });
    void part.adopt(change([['pref/allStreamsOrder', { t: 1, v: 'newest' }]]));
    expect(store.get().allStreamsOrder).toBe(DEFAULT_PREFERENCES.allStreamsOrder);
    expect(writes()).toBe(1);
    void part.adopt(change([['style/position', { t: 2, v: 'bottom' }]]));
    expect(writes()).toBe(1);
  });
});

describe('sportsPart', () => {
  function choicesSetup(start: Array<[string, 'yes' | 'no']> = []) {
    let current: ReadonlyMap<string, 'yes' | 'no'> = new Map(start);
    const listeners = new Set<() => void>();
    const adopted: Array<[ReadonlyArray<readonly [string, 'yes' | 'no']>, readonly string[]]> = [];
    const choices: SportsChoices = {
      load: () => Promise.resolve(),
      get: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      adopt(set, remove) {
        adopted.push([set, remove]);
        const next = new Map(current);
        for (const [id, setting] of set) next.set(id, setting);
        for (const id of remove) next.delete(id);
        current = next;
        listeners.forEach((listener) => listener());
      },
    };
    return { part: sportsPart(choices), adopted };
  }

  it('keeps each choice as s/<manifest id> in addons', () => {
    const { part } = choicesSetup([
      ['org.football', 'yes'],
      ['com.films', 'no'],
    ]);
    expect(part.document).toBe('addons');
    expect(part.prefixes).toEqual(['s/']);
    expect(plain(part.snapshot())).toEqual({
      's/org.football': { v: 'yes' },
      's/com.films': { v: 'no' },
    });
  });

  it('passes on the account’s choices and removals, leaving out values it cannot use', () => {
    const { part, adopted } = choicesSetup([['org.football', 'yes']]);
    void part.adopt(
      change(
        [
          ['s/com.films', { t: 1, v: 'no' }],
          ['s/odd', { t: 1, v: 'maybe' }],
        ],
        ['s/org.football'],
      ),
    );
    expect(adopted).toEqual([[[['com.films', 'no']], ['org.football']]]);
    expect(plain(part.snapshot())).toEqual({ 's/com.films': { v: 'no' } });
    void part.adopt(change([['s/odd', { t: 2, v: 'maybe' }]]));
    expect(adopted).toHaveLength(1);
  });
});

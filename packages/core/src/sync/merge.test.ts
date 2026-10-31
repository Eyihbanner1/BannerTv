import { describe, expect, it } from 'vitest';
import { canon, type Item, type Items, newItems } from './items';
import {
  changesItem,
  clampItems,
  documentKind,
  documentProfile,
  mergeItem,
  mergeItems,
  profileDocuments,
  tidyItems,
} from './merge';
import { seededRandom } from './testing';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 31);

function items(entries: Record<string, Item>): Items {
  const map = newItems();
  for (const key of Object.keys(entries)) map[key] = entries[key]!;
  return map;
}

function same(a: Items, b: Items): boolean {
  return canon(a) === canon(b);
}

describe('documents', () => {
  it('knows each document by its name', () => {
    expect(profileDocuments('main')).toEqual(['p/main/settings', 'p/main/list', 'p/main/watch']);
    expect(documentKind('profiles')).toBe('profiles');
    expect(documentKind('p/k2x9qa/watch')).toBe('watch');
    expect(documentKind('p/../list')).toBeUndefined();
    expect(documentProfile('p/k2x9qa/list')).toBe('k2x9qa');
    expect(documentProfile('addons')).toBeUndefined();
  });
});

describe('mergeItem', () => {
  it('takes the newer time', () => {
    expect(mergeItem('addons', 'order', { t: 2, v: ['a'] }, { t: 1, v: ['b'] })).toEqual({
      t: 2,
      v: ['a'],
    });
    expect(mergeItem('addons', 'order', { t: 1, v: ['a'] }, { t: 2, x: 1 })).toEqual({
      t: 2,
      x: 1,
    });
  });

  it('on equal times takes the removal, then the larger canonical JSON', () => {
    expect(mergeItem('p/main/list', 'tt1', { t: 5, v: { type: 'movie' } }, { t: 5, x: 1 })).toEqual(
      { t: 5, x: 1 },
    );
    expect(
      mergeItem('p/main/settings', 'pref/tmdb', { t: 5, v: false }, { t: 5, v: true }),
    ).toEqual({ t: 5, v: true });
  });

  it('keeps a profile removed whatever the times, and never removes Main', () => {
    expect(mergeItem('profiles', 'k2x9qa', { t: 9, v: 1 }, { t: 3, x: 1 })).toEqual({
      t: 3,
      x: 1,
    });
    // A field is an ordinary value.
    expect(mergeItem('profiles', 'k2x9qa/name', { t: 9, v: 'Sam' }, { t: 3, x: 1 })).toEqual({
      t: 9,
      v: 'Sam',
    });
    expect(mergeItem('profiles', 'main', { t: 0, v: 1 }, { t: 3, x: 1 })).toEqual({ t: 0, v: 1 });
  });

  it('in watch, keeps a video watched if either side had it, and takes no removals', () => {
    const watched = { metaId: 'tt1', type: 'movie', position: 5000, duration: 5400, watched: true };
    const later = { ...watched, position: 30, watched: false };
    expect(mergeItem('p/main/watch', 'tt1', { t: 1, v: watched }, { t: 2, v: later })).toEqual({
      t: 2,
      v: { ...later, watched: true },
    });
    expect(mergeItem('p/main/watch', 'tt1', { t: 1, v: watched }, { t: 2, x: 1 })).toEqual({
      t: 1,
      v: watched,
    });
  });
});

describe('changesItem', () => {
  it('is false once the current item carries or beats the one given', () => {
    expect(changesItem('addons', 'order', undefined, { t: 1, v: [] })).toBe(true);
    expect(changesItem('addons', 'order', { t: 1, v: [] }, { t: 1, v: [] })).toBe(false);
    expect(changesItem('addons', 'order', { t: 2, v: [] }, { t: 1, v: ['a'] })).toBe(false);
    expect(changesItem('addons', 'order', { t: 1, v: [] }, { t: 2, v: ['a'] })).toBe(true);
    const seen = { metaId: 'm', type: 'movie', position: 1, duration: 2, watched: true };
    const unseen = { ...seen, watched: false };
    expect(changesItem('p/a/watch', 'm', { t: 1, v: seen }, { t: 1, v: unseen })).toBe(false);
    expect(changesItem('p/a/watch', 'm', { t: 1, v: unseen }, { t: 1, v: seen })).toBe(true);
  });
});

describe('clampItems', () => {
  it('lowers times more than a minute after the document was stored', () => {
    const clamped = clampItems(
      items({ a: { t: 1000 + 60000, v: 1 }, b: { t: 1000 + 60001, v: 2 }, c: { t: 99e9, x: 1 } }),
      1000,
    );
    expect(clamped.a).toEqual({ t: 61000, v: 1 });
    expect(clamped.b).toEqual({ t: 1000, v: 2 });
    expect(clamped.c).toEqual({ t: 1000, x: 1 });
  });
});

describe('tidyItems', () => {
  it('forgets removals after 400 days, except in profiles', () => {
    const old = NOW - 401 * DAY;
    const recent = NOW - 399 * DAY;
    const list = tidyItems(
      'p/main/list',
      items({ a: { t: old, x: 1 }, b: { t: recent, x: 1 }, c: { t: old, v: { type: 'movie' } } }),
      NOW,
    );
    expect(Object.keys(list).sort()).toEqual(['b', 'c']);
    const profiles = tidyItems('profiles', items({ k2x9qa: { t: old, x: 1 } }), NOW);
    expect(Object.keys(profiles)).toEqual(['k2x9qa']);
  });

  it('keeps My List to its newest 1,000 titles and removals', () => {
    const many = newItems();
    for (let i = 0; i < 1100; i++) many[`tt${i}`] = { t: NOW - i, v: { type: 'movie' } };
    for (let i = 0; i < 1100; i++) many[`gone${i}`] = { t: NOW - i, x: 1 };
    const kept = tidyItems('p/main/list', many, NOW);
    expect(Object.keys(kept).length).toBe(2000);
    expect(kept.tt999).toBeDefined();
    expect(kept.tt1000).toBeUndefined();
    expect(kept.gone1000).toBeUndefined();
  });

  it('keeps Continue Watching to 500 videos, with cards on the newest 200', () => {
    const many = newItems();
    for (let i = 0; i < 520; i++) {
      many[`v${i}`] = { t: NOW - i, v: { metaId: `v${i}`, watched: false, card: { name: 'x' } } };
    }
    const kept = tidyItems('p/main/watch', many, NOW);
    expect(Object.keys(kept).length).toBe(500);
    expect((kept.v199 as { v: { card?: unknown } }).v.card).toEqual({ name: 'x' });
    expect((kept.v200 as { v: { card?: unknown } }).v.card).toBeUndefined();
  });

  it('keeps 300 track choices and offsets, and 300 Home rows', () => {
    const settings = newItems();
    for (let i = 0; i < 310; i++) {
      settings[`track/tt${i}`] = { t: NOW - i, v: { a: 'en' } };
      settings[`offset/k${i}`] = { t: NOW - i, v: 1.5 };
    }
    settings['home/order'] = { t: 1, v: Array.from({ length: 310 }, (_, i) => `row${i}`) };
    settings['pref/tmdb'] = { t: 1, v: true };
    const kept = tidyItems('p/main/settings', settings, NOW);
    expect(Object.keys(kept).filter((key) => key.indexOf('track/') === 0).length).toBe(300);
    expect(Object.keys(kept).filter((key) => key.indexOf('offset/') === 0).length).toBe(300);
    expect((kept['home/order'] as { v: string[] }).v.length).toBe(300);
    expect(kept['pref/tmdb']).toEqual({ t: 1, v: true });
  });

  it('drops the fields of a deleted profile, and keeps Main', () => {
    const kept = tidyItems(
      'profiles',
      items({
        main: { t: 0, v: 1 },
        'main/name': { t: 5, v: 'Eyitayo' },
        k2x9qa: { t: 9, x: 1 },
        'k2x9qa/name': { t: 8, v: 'Sam' },
      }),
      NOW,
    );
    expect(Object.keys(kept).sort()).toEqual(['k2x9qa', 'main', 'main/name']);
  });

  it('removes a second addon with the same address, keeping the newer', () => {
    const u = 'https://addon.example/manifest.json';
    const kept = tidyItems(
      'addons',
      items({
        'a/first': { t: NOW - 5, v: { u, o: false } },
        'a/second': { t: NOW - 3, v: { u, o: false } },
        'a/other': { t: 1, v: { u: 'https://other.example/manifest.json', o: true } },
        order: { t: 2, v: ['first', 'other'] },
      }),
      NOW,
    );
    expect(kept['a/second']).toEqual({ t: NOW - 3, v: { u, o: false } });
    expect(kept['a/first']).toEqual({ t: NOW - 5, x: 1 });
    expect(kept['a/other']).toBeDefined();
    expect(kept.order).toBeDefined();
  });

  it('is idempotent', () => {
    const settings = newItems();
    for (let i = 0; i < 320; i++) settings[`track/t${i % 7}${i}`] = { t: i % 13, v: { a: 'en' } };
    const once = tidyItems('p/main/settings', settings, NOW);
    expect(same(tidyItems('p/main/settings', once, NOW), once)).toBe(true);
  });
});

/** Random documents over a few keys, times and values, so collisions happen often. */
function randomItems(next: () => number, document: string): Items {
  const kind = documentKind(document);
  const keys =
    kind === 'profiles'
      ? ['main', 'ab', 'ab/name', 'cd', 'cd/kids']
      : kind === 'addons'
        ? ['a/x', 'a/y', 'order', 's/org.example']
        : ['k1', 'k2', 'k3', '__proto__', 'constructor'];
  const map = newItems();
  for (const key of keys) {
    if (next() < 0.3) continue;
    const t = Math.floor(next() * 4);
    if (next() < 0.25) {
      map[key] = { t, x: 1 };
      continue;
    }
    const pick = Math.floor(next() * 3);
    let v: unknown;
    if (kind === 'watch') {
      v = { metaId: key, type: 'movie', position: pick * 10, duration: 100, watched: next() < 0.5 };
    } else if (kind === 'addons' && key.indexOf('a/') === 0) {
      v = { u: `https://addon.example/${pick}/manifest.json`, o: pick === 0 };
    } else {
      v = [pick, { b: pick % 2, a: 'x' }];
    }
    map[key] = { t, v };
  }
  return map;
}

describe('the merge, over random documents', () => {
  const documents = ['profiles', 'addons', 'p/main/settings', 'p/main/list', 'p/main/watch'];

  it('is commutative, associative and idempotent', () => {
    const next = seededRandom(20261031);
    for (let round = 0; round < 2000; round++) {
      const document = documents[round % documents.length]!;
      const a = randomItems(next, document);
      const b = randomItems(next, document);
      const c = randomItems(next, document);
      const ab = mergeItems(document, a, b);
      expect(same(ab, mergeItems(document, b, a))).toBe(true);
      expect(
        same(mergeItems(document, ab, c), mergeItems(document, a, mergeItems(document, b, c))),
      ).toBe(true);
      expect(same(mergeItems(document, ab, ab), ab)).toBe(true);
      expect(same(mergeItems(document, ab, a), ab)).toBe(true);
    }
  });

  it('tidies the same whatever order the documents came in', () => {
    const next = seededRandom(7);
    for (let round = 0; round < 1000; round++) {
      const document = documents[round % documents.length]!;
      const a = randomItems(next, document);
      const b = randomItems(next, document);
      const tidyAb = tidyItems(document, mergeItems(document, a, b), NOW);
      expect(same(tidyAb, tidyItems(document, mergeItems(document, b, a), NOW))).toBe(true);
      expect(same(tidyItems(document, tidyAb, NOW), tidyAb)).toBe(true);
    }
  });

  it('never touches Object.prototype through an addon-made key', () => {
    const odd = newItems();
    odd['__proto__'] = { t: 1, v: { type: 'movie' } };
    const merged = mergeItems(
      'p/main/watch',
      odd,
      items({ constructor: { t: 2, v: { type: 'series', watched: true } } }),
    );
    expect(Object.keys(merged).sort()).toEqual(['__proto__', 'constructor']);
    expect(merged['__proto__']).toEqual({ t: 1, v: { type: 'movie' } });
    expect(Object.getPrototypeOf(merged)).toBeNull();
    expect(({} as { type?: unknown }).type).toBeUndefined();
    const tidied = tidyItems('p/main/watch', merged, NOW);
    expect(Object.keys(tidied).sort()).toEqual(['__proto__', 'constructor']);
  });
});

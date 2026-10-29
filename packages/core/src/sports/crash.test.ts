import { parseCatalogResponse, parseMetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { createLane, DroppedError } from '../lane';
import { memoryKeyValueStore } from '../storage';
import type { Timers } from '../timers';
import data from './data/sports-data.json';
import { createMatcher } from './dictionary';
import { buildEvents } from './events';
import { createKickoffMemory, KICKOFF_MEMORY_MAX } from './kickoffs';
import { type CatalogContext, readListing } from './listing';
import { cleanTitle, splitTeams, teamKey } from './text';
import { readKickOff, zoneFromAddress } from './time';
import type { SportsData } from './types';
import { buildDay, dayStrip, searchEvents } from './view';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const matcher = createMatcher(data as unknown as SportsData);
const CONTEXT: CatalogContext = {
  addonIndex: 0,
  addonId: 'crash.test',
  transportUrl: 'https://crash.example/manifest.json',
  catalogId: 'all',
  replays: false,
  channels: false,
  zone: 'Europe/London',
};

// Names built to make a careless regular expression backtrack for seconds.
const NASTY_NAMES = [
  '',
  ' ',
  'vs',
  ' vs ',
  'A vs',
  'vs B',
  'A vs B vs C vs D',
  'A @ B @ C',
  'A at B at C at D',
  '-',
  ' - - - - - ',
  '🔴🔴🔴🔴',
  '🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'LIVE LIVE LIVE LIVE: LIVE',
  'ريال مدريد ضد برشلونة',
  '皇家马德里 vs 巴塞罗那',
  '\u0000\u0001 vs \u0002',
  '\ud800 vs \udfff',
  'x'.repeat(10000),
  'v'.repeat(5000),
  'a vs '.repeat(2000),
  'a - '.repeat(2000),
  'a @ '.repeat(2000),
  '1'.repeat(5000),
  '28 Oct 2026 · '.repeat(500),
  '19:45 '.repeat(1000),
  '⏰ 19:45 - 27/10 | '.repeat(300),
  'Game 1 Game 2 Game 3 '.repeat(300),
  'U18 U19 U21 II B Women '.repeat(300),
  `${'(1-2) '.repeat(500)} vs B 2-1`,
  'FC '.repeat(3000),
];

function item(fields: Record<string, unknown>) {
  return parseMetaPreview({ id: 'crash:1', type: 'sport', name: 'A vs B', ...fields });
}

describe('items built to break the parser', () => {
  it('reads every nasty name fast and without throwing', () => {
    const started = Date.now();
    for (const name of NASTY_NAMES) {
      const meta = item({
        name,
        releaseInfo: name,
        description: `${name}\n${name}`,
        genres: [name, name],
      });
      if (!meta) continue;
      expect(() => readListing(meta, CONTEXT, NOW)).not.toThrow();
      expect(() => cleanTitle(name)).not.toThrow();
      expect(() => splitTeams(name)).not.toThrow();
      expect(() => teamKey(name)).not.toThrow();
      expect(() =>
        readKickOff(
          { name, releaseInfo: name, description: name, replay: false },
          { now: NOW, zone: 'Europe/London' },
        ),
      ).not.toThrow();
    }
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('survives wrong types in every field the parser reads', () => {
    const odd = [
      { team1: 5, team2: { name: {} }, eventStart: [], isLive: 'yes' },
      { team1: { name: 'A' }, team2: null, homeTeam: { name: 'B' } },
      { released: 'not a date', releaseInfo: 42, description: { text: 'x' } },
      { released: '9999-99-99T99:99:99Z' },
      { released: '1970-01-01T00:00:00.000Z' },
      { eventStart: '99999999999999999999' },
      { eventStart: '2026-10-28T19:00:00Z', name: 'A vs B 99:99' },
      { genres: Array.from({ length: 2000 }, (_, i) => `Genre ${i}`) },
      { genres: [null, 5, {}, 'Football'] },
      { poster: 'http://[::1', background: `https://x.example/?lg=${'%'.repeat(1000)}` },
      { poster: `https://x.example/m?${'lg=a&'.repeat(5000)}` },
      { background: 'https://api.sofascore.app/api/v1/unique-tournament/NaN/image' },
      { category: 'football'.repeat(1000) },
    ];
    for (const fields of odd) {
      const meta = item(fields);
      if (!meta) continue;
      const listing = readListing(meta, CONTEXT, NOW);
      expect(() => buildEvents([listing], { matcher })).not.toThrow();
    }
  });

  it('takes catalog responses that are not catalogs', () => {
    // No list at all is an error the query shows as "not answering"; a list of junk is no items.
    for (const json of [null, undefined, 7, 'x', [], {}, { metas: null }, { metas: {} }]) {
      expect(() => parseCatalogResponse(json, 'sport')).toThrow(/metas/);
    }
    const { metas } = parseCatalogResponse({ metas: [null, 1, 'x', [], {}, { id: 'a' }] }, 'sport');
    const listings = metas.map((meta) => readListing(meta, CONTEXT, NOW));
    expect(buildEvents(listings, { matcher })).toEqual([]);
  });

  it('never puts an addon address in what it builds', () => {
    const secret = 'https://premium.example/SECRET-KEY-0123456789/manifest.json';
    const meta = item({ name: 'Celtic vs Rangers', genres: ['Football'] })!;
    const [event] = buildEvents([readListing(meta, { ...CONTEXT, transportUrl: secret }, NOW)], {
      matcher,
    });
    const { sources, ...rest } = event!;
    expect(JSON.stringify(rest)).not.toContain('SECRET');
    // The source keeps the address only so the right install is asked for streams.
    expect(sources[0]!.transportUrl).toBe(secret);
    expect(event!.key).not.toContain('SECRET');
  });

  it('reads only a zone from settings, never anything else', () => {
    expect(zoneFromAddress('https://x.example/eyJrZXkiOiJhYmMifQ/manifest.json')).toBeUndefined();
    expect(zoneFromAddress(`https://x.example/${'A'.repeat(20000)}/manifest.json`)).toBeUndefined();
    expect(zoneFromAddress('https://x.example/%ZZ/manifest.json')).toBeUndefined();
  });
});

describe('volume', () => {
  it('merges 5,000 copies of one match into one event', () => {
    const meta = item({
      name: 'Celtic vs Rangers',
      genres: ['Football'],
      releaseInfo: '28 Oct 2026 · 19:45 UTC',
    })!;
    const listings = Array.from({ length: 5000 }, (_, i) =>
      readListing({ ...meta, id: `copy:${i}` }, { ...CONTEXT, addonIndex: i % 7 }, NOW),
    );
    const started = Date.now();
    const events = buildEvents(listings, { matcher });
    expect(events).toHaveLength(1);
    expect(events[0]!.sources).toHaveLength(5000);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('builds the strip and searches 4,000 distinct matches', () => {
    const listings = Array.from({ length: 4000 }, (_, i) => {
      const meta = item({
        id: `m:${i}`,
        name: `Team ${i} vs Club ${i}`,
        genres: ['Football', `League ${i % 40}`],
        releaseInfo: new Date(NOW + (i % 200) * 45 * 60 * 1000).toUTCString(),
      })!;
      return readListing({ ...meta, id: `m:${i}` }, CONTEXT, NOW);
    });
    const started = Date.now();
    const events = buildEvents(listings, { matcher });
    for (const day of dayStrip(NOW)) buildDay(events, day, { now: NOW, matcher });
    searchEvents(events, 'team 12', { now: NOW, matcher });
    expect(events).toHaveLength(4000);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

function instantTimers(): Timers & { flush(): void } {
  const queue: Array<() => void> = [];
  return {
    after(_ms, run) {
      queue.push(run);
      return () => {
        const at = queue.indexOf(run);
        if (at !== -1) queue.splice(at, 1);
      };
    },
    every() {
      return () => undefined;
    },
    flush() {
      while (queue.length > 0) queue.shift()!();
    },
  };
}

describe('kick-off memory', () => {
  it('keeps a kick-off after the addon swaps it for LIVE, across launches', async () => {
    const store = memoryKeyValueStore();
    const timers = instantTimers();
    const memory = createKickoffMemory({ store, timers, now: () => NOW });
    memory.note('a', 'x', { at: NOW - 3600000, sure: true, source: 'dated-text' });
    memory.note('a', 'x', undefined);
    await memory.flush();
    const next = createKickoffMemory({ store, timers, now: () => NOW + 60000 });
    await next.load();
    expect(next.get('a', 'x')).toEqual({ at: NOW - 3600000, sure: true, source: 'remembered' });
    expect(next.firstSeen('a', 'x')).toBe(NOW);
  });

  it('never lets an unsure time replace a sure one, nor its own guesses count', () => {
    const memory = createKickoffMemory({ timers: instantTimers(), now: () => NOW });
    memory.note('a', 'x', { at: NOW, sure: true, source: 'released' });
    memory.note('a', 'x', { at: NOW + 3600000, sure: false, source: 'clock' });
    memory.note('a', 'x', { date: '2026-10-29', sure: false, source: 'estimated' });
    expect(memory.get('a', 'x')?.at).toBe(NOW);
  });

  it('forgets old items, a removed addon, and everything on clear', async () => {
    const store = memoryKeyValueStore();
    const timers = instantTimers();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    memory.note('a', 'old', { at: NOW, sure: true, source: 'released' });
    memory.note('b', 'kept', { at: NOW + 3 * 86400000, sure: true, source: 'released' });
    time = NOW + 3 * 86400000;
    await memory.flush();
    const reread = createKickoffMemory({ store, timers, now: () => time });
    await reread.load();
    expect(reread.get('a', 'old')).toBeUndefined();
    expect(reread.get('b', 'kept')).toBeDefined();
    reread.forget('b');
    expect(reread.get('b', 'kept')).toBeUndefined();
    reread.note('c', 'x', { at: time, sure: true, source: 'released' });
    reread.clear();
    expect(reread.firstSeen('c', 'x')).toBeUndefined();
  });

  it('stays small, and ignores storage it cannot read', async () => {
    const store = memoryKeyValueStore();
    const timers = instantTimers();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    for (let i = 0; i < KICKOFF_MEMORY_MAX + 500; i++) {
      time = NOW + i;
      memory.note('a', `id${i}`, { at: NOW + 86400000, sure: true, source: 'released' });
    }
    await memory.flush();
    const stored = (await store.get('sports.kickoffs')) as unknown[];
    expect(stored.length).toBe(KICKOFF_MEMORY_MAX);
    for (const junk of [null, 'x', [1, 2], [[null]], [['k', 'x', 5, true, 'y']]]) {
      await store.set('sports.kickoffs', junk);
      const fresh = createKickoffMemory({ store, timers, now: () => NOW });
      await expect(fresh.load()).resolves.toBeUndefined();
    }
    const failing = {
      get: () => Promise.reject(new Error('quota')),
      set: () => Promise.reject(new Error('quota')),
    };
    const broken = createKickoffMemory({ store: failing, timers, now: () => NOW });
    await broken.load();
    broken.note('a', 'x', { at: NOW, sure: true, source: 'released' });
    await expect(broken.flush()).resolves.toBeUndefined();
    expect(broken.get('a', 'x')?.at).toBe(NOW);
  });
});

describe('lane', () => {
  it('runs at most its share at once and drops what is queued', async () => {
    const lane = createLane(2);
    let running = 0;
    let most = 0;
    const releases: Array<() => void> = [];
    const task = () =>
      new Promise<string>((resolve) => {
        running++;
        most = Math.max(most, running);
        releases.push(() => {
          running--;
          resolve('done');
        });
      });
    const results = Array.from({ length: 5 }, () =>
      lane.run(task).catch((error: unknown) => error),
    );
    await Promise.resolve();
    expect(most).toBe(2);
    lane.drop();
    releases.splice(0).forEach((release) => release());
    const settled = await Promise.all(results);
    expect(settled.filter((r) => r === 'done')).toHaveLength(2);
    expect(settled.filter((r) => r instanceof DroppedError)).toHaveLength(3);
  });

  it('keeps going after a task throws', async () => {
    const lane = createLane(1);
    const failed = lane.run(() => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    await expect(lane.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import type { Timers } from '../timers';
import { createKickoffMemory, KICKOFF_MEMORY_MS } from './kickoffs';
import type { SportEvent } from './types';
import { eventState } from './view';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Saves run through flush() only.
const timers: Timers = {
  after: () => () => undefined,
  every: () => () => undefined,
};

/** A LIVE item with no time: shown for the UTC day it was first seen. */
function liveEvent(): SportEvent {
  return {
    key: 'e',
    sport: 'football',
    kind: 'event',
    title: 'Home vs Away',
    competition: {
      key: 'other:football',
      name: 'Other football',
      sport: 'football',
      priority: 1000,
      source: 'other',
    },
    liveLabel: true,
    teamKeys: ['home', 'away'],
    sources: [
      {
        addonIndex: 0,
        addonId: 'a',
        transportUrl: 'https://a.example/manifest.json',
        type: 'sport',
        id: 'ev:old',
        name: 'LIVE: Home vs Away',
        catalogId: 'live',
      },
    ],
  };
}

describe('kick-off memory over days', () => {
  it('keeps when an untimed item was first seen while the addon still lists it', async () => {
    const store = memoryKeyValueStore();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    memory.note('a', 'ev:old', undefined);
    const event = liveEvent();
    const state = () =>
      eventState(event, { now: time, firstSeen: () => memory.firstSeen('a', 'ev:old') });
    expect(state()).toBe('live-unknown');
    // Listed again every day, and saved with something else each time.
    for (let day = 1; day <= 4; day++) {
      time = NOW + day * DAY + HOUR;
      memory.note('a', 'ev:old', undefined);
      memory.note('a', `other${day}`, undefined);
      await memory.flush();
      expect(memory.firstSeen('a', 'ev:old')).toBe(NOW);
      expect(state()).toBe('ended');
    }
    const next = createKickoffMemory({ store, timers, now: () => time });
    await next.load();
    expect(next.firstSeen('a', 'ev:old')).toBe(NOW);
  });

  it('keeps a kick-off past two days while the addon still lists the item as LIVE', async () => {
    const store = memoryKeyValueStore();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    memory.note('a', 'x', { at: NOW, sure: true, source: 'released' });
    time = NOW + DAY;
    memory.note('a', 'x', undefined);
    time = NOW + 2 * DAY + HOUR;
    memory.note('a', 'x', undefined);
    await memory.flush();
    expect(memory.get('a', 'x')).toEqual({ at: NOW, sure: true, source: 'remembered' });
  });

  it('forgets an item two days after the addon last listed it', async () => {
    const store = memoryKeyValueStore();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    memory.note('a', 'gone', undefined);
    memory.note('a', 'kept', undefined);
    time = NOW + DAY;
    memory.note('a', 'kept', undefined);
    time = NOW + KICKOFF_MEMORY_MS + HOUR;
    await memory.flush();
    expect(memory.firstSeen('a', 'gone')).toBeUndefined();
    expect(memory.firstSeen('a', 'kept')).toBe(NOW);
  });

  it('keeps an earlier launch’s first-seen and time for an item noted before storage was read', async () => {
    const store = memoryKeyValueStore();
    const first = createKickoffMemory({ store, timers, now: () => NOW });
    first.note('a', 'x', { at: NOW + HOUR, sure: true, source: 'released' });
    await first.flush();
    const later = NOW + 2 * HOUR;
    const second = createKickoffMemory({ store, timers, now: () => later });
    // The addon swapped the time for LIVE, and the feed read it before load() was done.
    second.note('a', 'x', undefined);
    await second.load();
    expect(second.firstSeen('a', 'x')).toBe(NOW);
    expect(second.get('a', 'x')).toEqual({ at: NOW + HOUR, sure: true, source: 'remembered' });
    await second.flush();
    const third = createKickoffMemory({ store, timers, now: () => later });
    await third.load();
    expect(third.firstSeen('a', 'x')).toBe(NOW);
  });

  it('reads rows saved before last-seen was stored', async () => {
    const store = memoryKeyValueStore();
    await store.set('sports.kickoffs', [['a\nx', NOW, '', true, NOW - HOUR]]);
    const memory = createKickoffMemory({ store, timers, now: () => NOW });
    await memory.load();
    expect(memory.firstSeen('a', 'x')).toBe(NOW - HOUR);
    expect(memory.get('a', 'x')?.at).toBe(NOW);
  });
});

describe('an addon set up again under another id', () => {
  const OLD = 'org.example.sports.ab12cd34ef56';
  const NEW = 'org.example.sports.99887766aabb';

  it('keeps its kick-offs and first-seen under the new id', async () => {
    const store = memoryKeyValueStore();
    let time = NOW;
    const memory = createKickoffMemory({ store, timers, now: () => time });
    memory.note(OLD, 'ev:1', { at: NOW + HOUR, sure: true, source: 'released' });
    memory.note(OLD, 'ev:2', undefined);
    memory.note('other.addon', 'ev:1', { at: NOW, sure: true, source: 'released' });
    time = NOW + 2 * HOUR;
    memory.move(OLD, NEW);
    // The new install lists the match as LIVE, with no time.
    memory.note(NEW, 'ev:1', undefined);
    expect(memory.get(NEW, 'ev:1')).toEqual({ at: NOW + HOUR, sure: true, source: 'remembered' });
    expect(memory.firstSeen(NEW, 'ev:2')).toBe(NOW);
    expect(memory.get(OLD, 'ev:1')).toBeUndefined();
    expect(memory.firstSeen(OLD, 'ev:2')).toBeUndefined();
    expect(memory.get('other.addon', 'ev:1')?.at).toBe(NOW);
    await memory.flush();
    const next = createKickoffMemory({ store, timers, now: () => time });
    await next.load();
    expect(next.get(NEW, 'ev:1')?.at).toBe(NOW + HOUR);
    expect(next.firstSeen(OLD, 'ev:2')).toBeUndefined();
  });

  it('lets what the new id holds win, keeping the earlier first-seen', () => {
    let time = NOW;
    const memory = createKickoffMemory({ timers, now: () => time });
    memory.note(OLD, 'ev:1', { at: NOW + HOUR, sure: true, source: 'released' });
    memory.note(OLD, 'ev:2', { at: NOW + HOUR, sure: true, source: 'released' });
    time = NOW + 2 * HOUR;
    memory.note(NEW, 'ev:1', { at: NOW + 3 * HOUR, sure: true, source: 'released' });
    memory.note(NEW, 'ev:2', undefined);
    memory.move(OLD, NEW);
    expect(memory.get(NEW, 'ev:1')?.at).toBe(NOW + 3 * HOUR);
    expect(memory.firstSeen(NEW, 'ev:1')).toBe(NOW);
    // Seen by the new id with no time of its own: the old kick-off stands.
    expect(memory.get(NEW, 'ev:2')?.at).toBe(NOW + HOUR);
  });

  it('moves and forgets what storage still held when that comes in later', async () => {
    const store = memoryKeyValueStore();
    const first = createKickoffMemory({ store, timers, now: () => NOW });
    first.note(OLD, 'ev:1', { at: NOW + HOUR, sure: true, source: 'released' });
    first.note('gone.addon', 'ev:9', { at: NOW, sure: true, source: 'released' });
    await first.flush();
    const second = createKickoffMemory({ store, timers, now: () => NOW });
    second.move(OLD, NEW);
    second.forget('gone.addon');
    await second.load();
    expect(second.get(NEW, 'ev:1')?.at).toBe(NOW + HOUR);
    expect(second.get(OLD, 'ev:1')).toBeUndefined();
    expect(second.get('gone.addon', 'ev:9')).toBeUndefined();
    await second.flush();
    const stored = JSON.stringify(await store.get('sports.kickoffs'));
    expect(stored).not.toContain('gone.addon');
    expect(stored).not.toContain(OLD);
  });
});

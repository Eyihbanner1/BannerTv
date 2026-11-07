import { describe, expect, it } from 'vitest';
import { createPersisted } from '../persisted';
import { memoryKeyValueStore } from '../storage';
import { createTrackMemory, MAX_TRACK_TITLES } from './tracks';
import { createWatchedSet } from './watched';

describe('createTrackMemory', () => {
  it('remembers audio and subtitles per title, off included', async () => {
    const storage = memoryKeyValueStore();
    const memory = createTrackMemory({ storage });
    await memory.rememberAudio('tt1', 'jpn');
    await memory.rememberSubtitle('tt1', 'eng');
    await memory.rememberSubtitle('tt2', null);
    expect(memory.get('tt1')).toEqual({ metaId: 'tt1', audio: 'jpn', subtitle: 'eng' });
    expect(memory.get('tt2')).toEqual({ metaId: 'tt2', subtitle: null });
    expect(memory.get('tt3')).toBeUndefined();

    const again = createTrackMemory({ storage });
    await again.load();
    expect(again.get('tt1')).toEqual({ metaId: 'tt1', audio: 'jpn', subtitle: 'eng' });
    expect(again.get('tt2')).toEqual({ metaId: 'tt2', subtitle: null });
  });

  it('drops the least recently changed titles past the limit, and damaged entries', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('trackChoices', [
      { metaId: 'old', audio: 'eng' },
      { metaId: '', audio: 'eng' },
      { metaId: 'empty' },
      { metaId: 'twice', audio: 'fre' },
      { metaId: 'twice', audio: 'ger' },
    ]);
    const memory = createTrackMemory({ storage });
    await memory.load();
    expect(memory.get('twice')).toEqual({ metaId: 'twice', audio: 'ger' });
    expect(memory.get('empty')).toBeUndefined();
    for (let i = 0; i < MAX_TRACK_TITLES; i++) await memory.rememberAudio(`t${i}`, 'eng');
    expect(memory.get('old')).toBeUndefined();
    expect(memory.get(`t${MAX_TRACK_TITLES - 1}`)).toBeDefined();
  });
});

describe('createWatchedSet', () => {
  it('answers by video id and is replaced whole', async () => {
    const storage = memoryKeyValueStore();
    const watched = createWatchedSet({ storage });
    await watched.replace(['tt1', 'tt2:1:1', 'tt1']);
    expect(watched.has('tt1')).toBe(true);
    expect(watched.has('tt2:1:1')).toBe(true);
    expect(watched.has('tt2:1:2')).toBe(false);
    const version = watched.version();
    await watched.replace(['tt1', 'tt2:1:1']);
    expect(watched.version()).toBe(version);
    await watched.replace(['tt3']);
    expect(watched.has('tt1')).toBe(false);
    const again = createWatchedSet({ storage });
    await again.load();
    expect(again.has('tt3')).toBe(true);
  });
});

describe('createPersisted', () => {
  it('reads once, waits for the read before changing, and saves the newest value', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('n', 5);
    const writes: unknown[] = [];
    const watching = {
      ...storage,
      set: async (key: string, value: unknown) => {
        writes.push(value);
        await storage.set(key, value);
      },
    };
    const value = createPersisted<number>({
      storage: watching,
      key: 'n',
      initial: 0,
      read: (saved) => (typeof saved === 'number' ? saved : 0),
    });
    expect(value.loaded()).toBe(false);
    let told = 0;
    value.subscribe(() => told++);
    await Promise.all([value.update((n) => n + 1), value.update((n) => n + 1)]);
    expect(value.get()).toBe(7);
    expect(value.loaded()).toBe(true);
    expect(told).toBeGreaterThan(0);
    expect(await storage.get('n')).toBe(7);
    // An update that changes nothing writes nothing.
    const before = writes.length;
    await value.update((n) => n);
    expect(writes.length).toBe(before);
  });

  it('starts from the initial value when the saved one is unreadable or storage fails', async () => {
    const broken = {
      get: () => Promise.reject(new Error('disk')),
      set: () => Promise.reject(new Error('disk')),
    };
    const value = createPersisted<string[]>({
      storage: broken,
      key: 'k',
      initial: [],
      read: (saved) => {
        if (!Array.isArray(saved)) throw new Error('bad');
        return saved as string[];
      },
    });
    await value.update((list) => list.concat('a'));
    expect(value.get()).toEqual(['a']);

    const storage = memoryKeyValueStore();
    await storage.set('k', 'not a list');
    const other = createPersisted<string[]>({
      storage,
      key: 'k',
      initial: [],
      read: (saved) => {
        if (!Array.isArray(saved)) throw new Error('bad');
        return saved as string[];
      },
    });
    let told = false;
    other.subscribe(() => (told = true));
    await other.load();
    expect(other.get()).toEqual([]);
    // Nothing usable was saved, so the value is still `initial`, but readers still hear it is loaded.
    expect(told).toBe(true);
  });
});

describe('track choices and the BannerTV account', () => {
  it('lists every choice, tells of changes, and adopts the account’s', async () => {
    const memory = createTrackMemory({ storage: memoryKeyValueStore() });
    await memory.rememberAudio('tt1', 'jpn');
    await memory.rememberSubtitle('tt2', null);
    let notified = 0;
    memory.subscribe(() => (notified += 1));
    await memory.adopt({
      set: [
        { metaId: 'tt3', audio: 'eng' },
        { metaId: 'tt1', subtitle: 'fre' },
      ],
      remove: ['tt2'],
    });
    expect(memory.choices()).toEqual([
      { metaId: 'tt3', audio: 'eng' },
      { metaId: 'tt1', subtitle: 'fre' },
    ]);
    expect(notified).toBe(1);
    await memory.adopt({ remove: ['tt2'] });
    expect(notified).toBe(1);
  });
});

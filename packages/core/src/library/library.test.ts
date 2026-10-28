import type { MetaPreview } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { createLibrary, MAX_LIBRARY_ITEMS } from './library';

function preview(id: string, extra: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id,
    type: 'movie',
    name: `Title ${id}`,
    posterShape: 'poster',
    genres: [],
    trailers: [],
    ...extra,
  };
}

function clock(start = 1000) {
  let time = start;
  return { now: () => time, tick: (ms = 1000) => (time += ms) };
}

describe('createLibrary', () => {
  it('saves titles with what a tile needs, newest first, and reads them back', async () => {
    const storage = memoryKeyValueStore();
    const time = clock();
    const library = createLibrary({ storage, now: time.now });
    await library.add(
      preview('tt1', {
        poster: 'https://img/p.jpg',
        releaseInfo: '2008',
        genres: ['Animation', 'Family'],
        description: 'not kept',
      }),
    );
    time.tick();
    await library.add(preview('tt2', { type: 'series' }));
    expect(library.items().map((i) => i.id)).toEqual(['tt2', 'tt1']);
    expect(library.get('tt1')).toEqual({
      id: 'tt1',
      type: 'movie',
      name: 'Title tt1',
      poster: 'https://img/p.jpg',
      releaseInfo: '2008',
      genres: ['Animation', 'Family'],
      addedAt: 1000,
    });

    const again = createLibrary({ storage });
    expect(again.has('tt1')).toBe(false);
    await again.load();
    expect(again.has('tt1')).toBe(true);
    expect(again.items().map((i) => i.id)).toEqual(['tt2', 'tt1']);
  });

  it('waits for what was saved before adding, so nothing saved is lost', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('library', {
      items: [{ id: 'old', type: 'movie', name: 'Old', addedAt: 1 }],
    });
    const library = createLibrary({ storage, now: () => 5 });
    await library.add(preview('new'));
    expect(library.items().map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('drops unreadable items, not the list', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('library', {
      items: [
        { id: 'ok', type: 'movie', name: 'OK', addedAt: 3, poster: 7 },
        { id: '', type: 'movie', name: 'x', addedAt: 1 },
        { id: 'ok', type: 'movie', name: 'Twice', addedAt: 2 },
        'nonsense',
      ],
      outbox: [
        { op: 'add', id: 'ok', type: 'movie' },
        { op: 'other', id: 'x', type: 'movie' },
      ],
      synced: ['ok', 3],
    });
    const library = createLibrary({ storage });
    await library.load();
    expect(library.items()).toEqual([{ id: 'ok', type: 'movie', name: 'OK', addedAt: 3 }]);
    expect(library.outbox()).toEqual([{ op: 'add', id: 'ok', type: 'movie' }]);
  });

  it('keeps one waiting change per title for Trakt', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('a'));
    await library.add(preview('b'));
    await library.remove('a');
    await library.remove('missing');
    expect(library.items().map((i) => i.id)).toEqual(['b']);
    expect(library.outbox()).toEqual([
      { op: 'add', id: 'b', type: 'movie' },
      { op: 'remove', id: 'a', type: 'movie' },
    ]);
    await library.sent([{ op: 'add', id: 'b', type: 'movie' }]);
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'a', type: 'movie' }]);
  });

  it('fills in a title from Trakt without moving it', async () => {
    const time = clock();
    const library = createLibrary({ storage: memoryKeyValueStore(), now: time.now });
    await library.mergeRemote([{ id: 'tt9', type: 'series', name: 'Show', addedAt: 50 }]);
    const before = library.version();
    await library.refresh(preview('tt9', { type: 'series', name: 'Show', poster: 'https://p' }));
    expect(library.get('tt9')).toEqual({
      id: 'tt9',
      type: 'series',
      name: 'Show',
      poster: 'https://p',
      addedAt: 50,
    });
    expect(library.version()).toBeGreaterThan(before);
    const after = library.version();
    await library.refresh(preview('tt9', { type: 'series', name: 'Show', poster: 'https://p' }));
    expect(library.version()).toBe(after);
    await library.refresh(preview('unknown'));
    expect(library.has('unknown')).toBe(false);
  });

  it('keeps at most the limit', async () => {
    const time = clock();
    const library = createLibrary({ storage: memoryKeyValueStore(), now: time.now });
    for (let i = 0; i <= MAX_LIBRARY_ITEMS; i++) {
      time.tick();
      await library.add(preview(`t${i}`));
    }
    expect(library.items()).toHaveLength(MAX_LIBRARY_ITEMS);
    expect(library.has('t0')).toBe(false);
  });
});

describe('mergeRemote', () => {
  it('on the first sync, keeps both sides and queues what Trakt lacks', async () => {
    const time = clock(10_000);
    const library = createLibrary({ storage: memoryKeyValueStore(), now: time.now });
    await library.add(preview('local'));
    await library.mergeRemote([
      { id: 'remote', type: 'series', name: 'Remote', releaseInfo: '2020', addedAt: 20_000 },
    ]);
    expect(library.items().map((i) => [i.id, i.addedAt])).toEqual([
      ['remote', 20_000],
      ['local', 10_000],
    ]);
    expect(library.get('remote')!.releaseInfo).toBe('2020');
    expect(library.outbox()).toEqual([{ op: 'add', id: 'local', type: 'movie' }]);
  });

  it('queues titles Trakt never had, and treats a sent one now missing as removed there', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('kept'));
    await library.add(preview('gone'));
    await library.sent(library.outbox());
    await library.mergeRemote([{ id: 'kept', type: 'movie', name: 'Kept', addedAt: 1 }]);
    expect(library.items().map((i) => i.id)).toEqual(['kept']);
    expect(library.outbox()).toEqual([]);

    await library.add(preview('fresh'));
    await library.forgetRemote();
    await library.mergeRemote([{ id: 'kept', type: 'movie', name: 'Kept', addedAt: 1 }]);
    expect(library.items().map((i) => i.id)).toEqual(['fresh', 'kept']);
    expect(library.outbox()).toEqual([{ op: 'add', id: 'fresh', type: 'movie' }]);
  });

  it('applies removals made on Trakt, but not over a newer change here', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('a'));
    await library.add(preview('b'));
    await library.add(preview('c'));
    await library.sent(library.outbox());
    await library.mergeRemote([
      { id: 'a', type: 'movie', name: 'A', addedAt: 1 },
      { id: 'b', type: 'movie', name: 'B', addedAt: 1 },
      { id: 'c', type: 'movie', name: 'C', addedAt: 1 },
    ]);
    expect(library.outbox()).toEqual([]);

    // Here: c removed and b added again; on Trakt: a and b removed, d added.
    await library.remove('c');
    await library.remove('b');
    await library.add(preview('b'));
    await library.mergeRemote([
      { id: 'c', type: 'movie', name: 'C', addedAt: 1 },
      { id: 'd', type: 'movie', name: 'D', addedAt: 2 },
    ]);
    expect(
      library
        .items()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['b', 'd']);
    expect(library.outbox()).toEqual([
      { op: 'remove', id: 'c', type: 'movie' },
      { op: 'add', id: 'b', type: 'movie' },
    ]);
  });

  it('forgets the sync state on sign-out and keeps the titles', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('a'));
    await library.mergeRemote([{ id: 'r', type: 'movie', name: 'R', addedAt: 1 }]);
    await library.forgetRemote();
    expect(library.outbox()).toEqual([]);
    expect(
      library
        .items()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'r']);
    // Signed in again: Trakt's empty list removes nothing, since nothing was synced.
    await library.mergeRemote([]);
    expect(
      library
        .items()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'r']);
  });
});

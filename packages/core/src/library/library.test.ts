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
    // a is on Trakt's list, so taking it off here is a change for Trakt.
    await library.sent([{ op: 'add', id: 'a', type: 'movie' }]);
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

  it('queues no removal for a title Trakt never had, and drops its waiting addition', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    // Saved and taken off again before any Trakt account was signed in.
    await library.add(preview('a'));
    await library.remove('a');
    expect(library.outbox()).toEqual([]);

    // On Trakt's list, then taken off here, added again and taken off again.
    await library.add(preview('b'));
    await library.sent(library.outbox());
    await library.remove('b');
    await library.add(preview('b'));
    await library.remove('b');
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'b', type: 'movie' }]);
  });

  it('sends the removal of a title taken off while its addition was on its way', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('x'));
    const sending = library.outbox().slice();
    await library.remove('x');
    expect(library.outbox()).toEqual([]);
    // Trakt took the addition, so the removal has to go there too.
    await library.sent(sending);
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'x', type: 'movie' }]);
    // A pull before the removal goes keeps it off.
    await library.mergeRemote([{ id: 'x', type: 'movie', name: 'X', addedAt: 1 }]);
    expect(library.has('x')).toBe(false);
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'x', type: 'movie' }]);

    // Taken off and saved again on the way: it stays, and nothing more is sent.
    await library.add(preview('y'));
    const again = library.outbox().filter((change) => change.id === 'y');
    await library.remove('y');
    await library.add(preview('y'));
    await library.sent(again);
    expect(library.has('y')).toBe(true);
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'x', type: 'movie' }]);
  });

  it('sends no removal for a title only dropped to keep the limit', async () => {
    const time = clock();
    const library = createLibrary({ storage: memoryKeyValueStore(), now: time.now });
    for (let i = 0; i <= MAX_LIBRARY_ITEMS; i++) {
      time.tick();
      await library.add(preview(`t${i}`));
    }
    expect(library.has('t0')).toBe(false);
    // It never reaches Trakt, so the first sync has nothing to bring back.
    expect(library.outbox().some((change) => change.id === 't0')).toBe(false);
    await library.sent(library.outbox().slice());
    expect(library.outbox()).toEqual([]);
    await library.mergeRemote(
      library.items().map((i) => ({ id: i.id, type: i.type, name: i.name, addedAt: i.addedAt })),
    );
    expect(library.has('t0')).toBe(false);
    expect(library.has('t1')).toBe(true);

    // Dropped while its addition was on its way: Trakt is told to take it off.
    const sending = library.outbox().slice();
    time.tick();
    await library.add(preview('late'));
    const inFlight = [{ op: 'add' as const, id: 't1', type: 'movie' as const }];
    await library.sent(sending.concat(inFlight));
    expect(library.has('t1')).toBe(false);
    expect(library.outbox()).toContainEqual({ op: 'remove', id: 't1', type: 'movie' });
  });

  it('leaves no removal for the next account after signing out', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore() });
    await library.add(preview('a'));
    await library.add(preview('b'));
    await library.sent(library.outbox());
    await library.remove('a');
    await library.forgetRemote();
    expect(library.outbox()).toEqual([]);
    await library.remove('b');
    expect(library.outbox()).toEqual([]);
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

  it("queues nothing for a title that does not fit beside Trakt's list", async () => {
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => 1 });
    await library.add(preview('old'));
    // Signed in to an account whose list is full of newer titles: its waiting addition goes too.
    const remote = Array.from({ length: MAX_LIBRARY_ITEMS }, (_, i) => ({
      id: `tt${i}`,
      type: 'movie' as const,
      name: `T${i}`,
      addedAt: 10 + i,
    }));
    await library.mergeRemote(remote);
    expect(library.has('old')).toBe(false);
    expect(library.outbox()).toEqual([]);
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

  it('keeps a title under the id My List saved it by when Trakt gives another as well', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => 1000 });
    await library.add(preview('tmdb:603', { name: 'The Matrix' }));
    await library.sent(library.outbox());
    // Trakt lists it by both ids, as it does every title it has both for.
    const remote = [
      { id: 'tt0133093', otherIds: ['tmdb:603'], type: 'movie', name: 'The Matrix', addedAt: 5 },
      { id: 'tt0234215', otherIds: ['tmdb:604'], type: 'movie', name: 'Reloaded', addedAt: 4 },
    ];
    await library.mergeRemote(remote);
    expect(library.items().map((i) => i.id)).toEqual(['tmdb:603', 'tt0234215']);
    expect(library.get('tmdb:603')).toEqual({
      id: 'tmdb:603',
      type: 'movie',
      name: 'The Matrix',
      addedAt: 1000,
    });
    expect(library.outbox()).toEqual([]);
    await library.mergeRemote(remote);
    expect(library.items().map((i) => i.id)).toEqual(['tmdb:603', 'tt0234215']);

    // Synced under the TV's id, so taking it off here sends that id, and a pull before it goes keeps it off.
    await library.remove('tmdb:603');
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'tmdb:603', type: 'movie' }]);
    await library.mergeRemote(remote);
    expect(library.items().map((i) => i.id)).toEqual(['tt0234215']);
    expect(library.outbox()).toEqual([{ op: 'remove', id: 'tmdb:603', type: 'movie' }]);
  });

  it('tells a film from a show that shares its TMDB number', async () => {
    const library = createLibrary({ storage: memoryKeyValueStore(), now: () => 1000 });
    await library.add(preview('tmdb:603', { type: 'series', name: 'A show' }));
    const film = {
      id: 'tt0133093',
      otherIds: ['tmdb:603'],
      type: 'movie',
      name: 'The Matrix',
      addedAt: 5,
    };
    const ids = () =>
      library
        .items()
        .map((i) => i.id)
        .sort();
    // The film on Trakt's list is no sign that Trakt has the show.
    await library.mergeRemote([film]);
    expect(ids()).toEqual(['tmdb:603', 'tt0133093']);
    expect(library.get('tt0133093')).toMatchObject({ type: 'movie', name: 'The Matrix' });
    expect(library.outbox()).toEqual([{ op: 'add', id: 'tmdb:603', type: 'series' }]);

    await library.sent(library.outbox());
    const show = {
      id: 'tt9000603',
      otherIds: ['tmdb:603'],
      type: 'series',
      name: 'A show',
      addedAt: 4,
    };
    await library.mergeRemote([film, show]);
    expect(ids()).toEqual(['tmdb:603', 'tt0133093']);
    expect(library.outbox()).toEqual([]);

    // The show taken off Trakt goes from My List, though the film still has its number.
    await library.mergeRemote([film]);
    expect(ids()).toEqual(['tt0133093']);
  });

  it('takes no TMDB id from the last sync for a title of another type', async () => {
    const storage = memoryKeyValueStore();
    // A show on Trakt's list by its TMDB id at the last sync, no longer in My List.
    await storage.set('library', { items: [], outbox: [], synced: ['tmdb:603'] });
    const library = createLibrary({ storage });
    await library.mergeRemote([
      { id: 'tt0133093', otherIds: ['tmdb:603'], type: 'movie', name: 'The Matrix', addedAt: 5 },
    ]);
    expect(library.items().map((i) => i.id)).toEqual(['tt0133093']);
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

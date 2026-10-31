import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { describe, expect, it, vi } from 'vitest';
import { memoryKeyValueStore, type KeyValueStore } from '../storage';
import {
  CONTINUE_LIMIT,
  continueWatching,
  createPlayedVideos,
  playedCard,
  type PlayedVideo,
} from './continue';
import { createProgressStore, type ProgressUpdate } from './progress';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const AIRS = '2026-06-08T00:00:00Z';

type Card = Omit<PlayedVideo, 'updatedAt'>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Deferred = ReturnType<typeof deferred<void>>;

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A key-value store whose reads and writes finish only when the test says so. */
function slowStorage(saved?: unknown) {
  const values = new Map<string, unknown>();
  if (saved !== undefined) values.set('played', saved);
  const reads: Deferred[] = [];
  const writes: { value: unknown; done: Deferred }[] = [];
  let running = 0;
  let mostRunning = 0;
  const storage: KeyValueStore = {
    get(key) {
      const done = deferred<void>();
      reads.push(done);
      return done.promise.then(() => values.get(key));
    },
    set(key, value) {
      running += 1;
      mostRunning = Math.max(mostRunning, running);
      const done = deferred<void>();
      writes.push({ value, done });
      return done.promise.then(
        () => {
          running -= 1;
          values.set(key, value);
        },
        (error: Error) => {
          running -= 1;
          throw error;
        },
      );
    },
  };
  return { storage, values, reads, writes, mostRunning: () => mostRunning };
}

function preview(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: 'tt1',
    type: 'movie',
    name: 'Film',
    posterShape: 'poster',
    genres: [],
    trailers: [],
    ...overrides,
  };
}

function detail(item: MetaPreview, videos: Video[]): MetaDetail {
  return {
    ...item,
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: false },
  };
}

const OLD = Date.parse('2020-01-01T00:00:00Z');

function ep(season: number, episode: number, released = '2020-01-01T00:00:00Z'): Video {
  return {
    id: `tt9:${season}:${episode}`,
    title: `S${season}E${episode}`,
    season,
    episode,
    released,
  };
}

const SHOW_ITEM = preview({ id: 'tt9', type: 'series', name: 'Show' });
// Listed out of order, as some addons do. Season 2 has not aired by NOW.
const SHOW = detail(SHOW_ITEM, [ep(1, 2), ep(2, 1, AIRS), ep(0, 1), ep(1, 1), ep(1, 3), ep(0, 2)]);

/** A card as the player records it once a film plays. */
function filmCard(id = 'tt1', overrides: Partial<MetaPreview> = {}): Card {
  return playedCard(preview({ id, ...overrides }), id, undefined);
}

/** A card as the player records it once the series' episode list has arrived. */
function episodeCard(videoId: string): Card {
  return playedCard(SHOW_ITEM, videoId, SHOW);
}

function card(videoId: string, overrides: Partial<Card> = {}): Card {
  return { videoId, metaId: 'tt1', type: 'movie', name: 'Film', ...overrides };
}

function saved(videoId: string, updatedAt: number, overrides: Partial<PlayedVideo> = {}) {
  return { ...card(videoId), updatedAt, ...overrides };
}

describe('playedCard', () => {
  it('makes a film card from the title alone', () => {
    const expected = { videoId: 'tt1', metaId: 'tt1', type: 'movie', name: 'Film' };
    expect(playedCard(preview(), 'tt1', undefined)).toStrictEqual(expected);
    // Films have no episode list, so the meta adds nothing.
    expect(playedCard(preview(), 'tt1', detail(preview(), []))).toStrictEqual(expected);
  });

  it('keeps the artwork and the hero text, and only the first three genres', () => {
    const item = preview({
      poster: 'https://img.example/poster.jpg',
      posterShape: 'landscape',
      background: 'https://img.example/background.jpg',
      logo: 'https://img.example/logo.png',
      description: 'A heist goes wrong.',
      releaseInfo: '2019',
      imdbRating: '7.4',
      runtime: '2h 4min',
      genres: ['Crime', 'Drama', 'Thriller', 'Mystery'],
      trailers: ['yt123'],
    });
    expect(playedCard(item, 'tt1', undefined)).toStrictEqual({
      videoId: 'tt1',
      metaId: 'tt1',
      type: 'movie',
      name: 'Film',
      poster: 'https://img.example/poster.jpg',
      background: 'https://img.example/background.jpg',
      logo: 'https://img.example/logo.png',
      description: 'A heist goes wrong.',
      releaseInfo: '2019',
      imdbRating: '7.4',
      runtime: '2h 4min',
      genres: ['Crime', 'Drama', 'Thriller'],
    });
  });

  it('leaves out what the title has empty', () => {
    const item = preview({ poster: '', description: '', genres: [] });
    expect(playedCard(item, 'tt1', undefined)).toStrictEqual({
      videoId: 'tt1',
      metaId: 'tt1',
      type: 'movie',
      name: 'Film',
    });
  });

  it('adds the episode and the one after it', () => {
    expect(playedCard(SHOW_ITEM, 'tt9:1:1', SHOW)).toStrictEqual({
      videoId: 'tt9:1:1',
      metaId: 'tt9',
      type: 'series',
      name: 'Show',
      season: 1,
      episode: 1,
      episodeName: 'S1E1',
      next: { videoId: 'tt9:1:2', season: 1, episode: 2, name: 'S1E2', released: OLD },
    });
  });

  it('keeps the next episode before it airs, with its release time, and none after the last', () => {
    // Whether it has aired is decided when the row is drawn, not by the clock at play time.
    const later = '2999-01-01T00:00:00Z';
    const show = detail(SHOW_ITEM, [ep(1, 3), ep(2, 1, later)]);
    expect(playedCard(SHOW_ITEM, 'tt9:1:3', show).next).toEqual({
      videoId: 'tt9:2:1',
      season: 2,
      episode: 1,
      name: 'S2E1',
      released: Date.parse(later),
    });
    const last = playedCard(SHOW_ITEM, 'tt9:2:1', SHOW);
    expect(last).toMatchObject({ season: 2, episode: 1, episodeName: 'S2E1' });
    expect(last).not.toHaveProperty('next');
  });

  it('leaves out a release time the addon did not give or that does not read', () => {
    const undated = detail(SHOW_ITEM, [
      ep(1, 1),
      { ...ep(1, 2), released: undefined },
      { ...ep(1, 3), released: 'soon' },
    ]);
    expect(playedCard(SHOW_ITEM, 'tt9:1:1', undated).next).not.toHaveProperty('released');
    expect(playedCard(SHOW_ITEM, 'tt9:1:2', undated).next).not.toHaveProperty('released');
  });

  it("takes the ids the progress is saved under over the answer's", () => {
    // Asked for a tmdb id, the addon answered with an imdb one, and another type.
    const card = playedCard(SHOW_ITEM, 'tt9:1:1', SHOW, { metaId: 'tmdb:9', type: 'tv' });
    expect(card).toMatchObject({ metaId: 'tmdb:9', type: 'tv', season: 1, episode: 1 });
  });

  it('keeps specials as season 0, leading only to the next special', () => {
    expect(playedCard(SHOW_ITEM, 'tt9:0:1', SHOW)).toMatchObject({
      season: 0,
      episode: 1,
      next: { videoId: 'tt9:0:2', season: 0, episode: 2 },
    });
    const lastSpecial = playedCard(SHOW_ITEM, 'tt9:0:2', SHOW);
    expect(lastSpecial).toMatchObject({ season: 0, episode: 2 });
    expect(lastSpecial).not.toHaveProperty('next');
  });

  it('has no episode before the episode list arrives, nor for a video it does not list', () => {
    const base = { videoId: 'tt9:1:1', metaId: 'tt9', type: 'series', name: 'Show' };
    expect(playedCard(SHOW_ITEM, 'tt9:1:1', undefined)).toStrictEqual(base);
    expect(playedCard(SHOW_ITEM, 'tt9:9:9', SHOW)).toStrictEqual({
      ...base,
      videoId: 'tt9:9:9',
    });
  });

  it('leaves out episode names the addon left empty', () => {
    const untitled = detail(SHOW_ITEM, [
      { ...ep(1, 1), title: '' },
      { ...ep(1, 2), title: '' },
    ]);
    expect(playedCard(SHOW_ITEM, 'tt9:1:1', untitled)).toStrictEqual({
      videoId: 'tt9:1:1',
      metaId: 'tt9',
      type: 'series',
      name: 'Show',
      season: 1,
      episode: 1,
      next: { videoId: 'tt9:1:2', season: 1, episode: 2, released: OLD },
    });
  });
});

describe('createPlayedVideos', () => {
  it('records a card with the time and writes every card', async () => {
    const storage = memoryKeyValueStore();
    let time = 1000;
    const played = createPlayedVideos({ storage, now: () => time });
    await played.load();
    expect(played.get('tt1')).toBeUndefined();

    played.record(card('tt1'));
    expect(played.get('tt1')).toEqual({ ...card('tt1'), updatedAt: 1000 });
    await flush();
    expect(await storage.get('played')).toEqual([played.get('tt1')]);

    time = 2000;
    played.record(card('tt2', { metaId: 'tt2' }));
    await flush();
    expect(await storage.get('played')).toEqual([played.get('tt1'), played.get('tt2')]);
  });

  it('replaces a video card with the one recorded later', async () => {
    const storage = memoryKeyValueStore();
    let time = 1;
    const played = createPlayedVideos({ storage, now: () => time });
    await played.load();
    // First from the title alone, then again once the episode list has arrived.
    played.record(playedCard(SHOW_ITEM, 'tt9:1:1', undefined));
    time = 2;
    played.record(episodeCard('tt9:1:1'));

    expect(played.get('tt9:1:1')).toEqual({ ...episodeCard('tt9:1:1'), updatedAt: 2 });
    await flush();
    expect(await storage.get('played')).toEqual([played.get('tt9:1:1')]);

    time = 3;
    played.record(card('tt9:1:1', { metaId: 'tt9', type: 'series', name: 'Renamed' }));
    expect(played.get('tt9:1:1')).toStrictEqual({
      ...card('tt9:1:1', { metaId: 'tt9', type: 'series', name: 'Renamed' }),
      updatedAt: 3,
    });
  });

  it('keeps the most recently played cards up to the limit', async () => {
    const storage = memoryKeyValueStore();
    let time = 0;
    const played = createPlayedVideos({ storage, now: () => time, maxCards: 2 });
    await played.load();
    time = 1;
    played.record(card('a'));
    time = 2;
    played.record(card('b'));
    time = 3;
    played.record(card('a'));
    time = 4;
    played.record(card('c'));

    expect(played.get('b')).toBeUndefined();
    expect(played.get('a')).toBeDefined();
    expect(played.get('c')).toBeDefined();
    await flush();
    expect(await storage.get('played')).toEqual([played.get('a'), played.get('c')]);
  });

  it('keeps the card just recorded even when the clock has gone back', async () => {
    let time = 5000;
    const played = createPlayedVideos({
      storage: memoryKeyValueStore(),
      now: () => time,
      maxCards: 2,
    });
    await played.load();
    played.record(card('a'));
    played.record(card('b'));
    time = 10;
    played.record(card('c'));

    expect(played.get('a')).toBeUndefined();
    expect(played.get('c')).toBeDefined();
  });

  it('bumps the version and tells listeners on every change until they unsubscribe', async () => {
    const played = createPlayedVideos({ storage: memoryKeyValueStore(), now: () => 0 });
    expect(played.version()).toBe(0);
    await played.load();
    expect(played.version()).toBe(0);

    const listener = vi.fn();
    const unsubscribe = played.subscribe(listener);
    played.record(card('tt1'));
    played.record(card('tt1'));
    expect(played.version()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    played.record(card('tt2'));
    expect(played.version()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  describe('load', () => {
    it('reads storage once, however often it is called', async () => {
      const storage = memoryKeyValueStore();
      const get = vi.spyOn(storage, 'get');
      const played = createPlayedVideos({ storage });
      const first = played.load();
      expect(played.load()).toBe(first);
      await first;
      await played.load();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('brings back saved cards and tells listeners', async () => {
      const storage = memoryKeyValueStore();
      const show = { ...episodeCard('tt9:1:2'), updatedAt: 5 };
      await storage.set('played', [show]);
      const played = createPlayedVideos({ storage });
      const listener = vi.fn();
      played.subscribe(listener);
      await played.load();
      expect(played.get('tt9:1:2')).toStrictEqual(show);
      expect(played.version()).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('drops saved cards it cannot read and keeps the rest', async () => {
      const storage = memoryKeyValueStore();
      const good = saved('good', 1);
      await storage.set('played', [
        good,
        null,
        'tt1',
        42,
        [saved('list', 1)],
        saved('', 1),
        saved('no-meta', 1, { metaId: '' }),
        saved('no-type', 1, { type: undefined }),
        saved('no-name', 1, { name: 7 as unknown as string }),
        saved('no-time', 1, { updatedAt: undefined }),
        saved('bad-time', 1, { updatedAt: -1 }),
        saved('nan-time', 1, { updatedAt: NaN }),
        saved('text-time', 1, { updatedAt: '1' as unknown as number }),
      ]);
      const played = createPlayedVideos({ storage });
      await played.load();
      expect(played.get('good')).toStrictEqual(good);
      const unreadable = ['', 'list', 'no-meta', 'no-type', 'no-name', 'no-time', 'bad-time'];
      for (const videoId of [...unreadable, 'nan-time', 'text-time']) {
        expect(played.get(videoId)).toBeUndefined();
      }
    });

    it('keeps a saved card without the fields it cannot read, and without unknown ones', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('played', [
        {
          ...saved('tt9:1:1', 1, { metaId: 'tt9', type: 'series', name: 'Show' }),
          poster: 5,
          background: '',
          logo: 'https://img.example/logo.png',
          description: null,
          genres: ['Crime', 3, '', 'Drama', 'Thriller', 'Mystery'],
          season: -1,
          episode: '1',
          episodeName: 'Pilot',
          next: { videoId: 'tt9:1:2', season: 'one', episode: 2, name: 7 },
          stream: 'https://cdn.example/video.mp4',
        },
        { ...saved('tt9:1:2', 2), genres: 'Crime', next: { season: 1, episode: 3 } },
        { ...saved('tt9:1:3', 3), genres: [1, 2], next: 'tt9:1:4' },
      ]);
      const played = createPlayedVideos({ storage });
      await played.load();
      expect(played.get('tt9:1:1')).toStrictEqual({
        videoId: 'tt9:1:1',
        metaId: 'tt9',
        type: 'series',
        name: 'Show',
        updatedAt: 1,
        logo: 'https://img.example/logo.png',
        genres: ['Crime', 'Drama', 'Thriller'],
        episodeName: 'Pilot',
        next: { videoId: 'tt9:1:2', episode: 2 },
      });
      expect(played.get('tt9:1:2')).toStrictEqual(saved('tt9:1:2', 2));
      expect(played.get('tt9:1:3')).toStrictEqual(saved('tt9:1:3', 3));
    });

    it('starts empty when the saved value is not a list', async () => {
      for (const value of [undefined, null, 'played', { 0: saved('tt1', 1) }]) {
        const storage = memoryKeyValueStore();
        await storage.set('played', value);
        const played = createPlayedVideos({ storage });
        await played.load();
        expect(played.get('tt1')).toBeUndefined();
        expect(played.version()).toBe(0);
      }
    });

    it('trims a saved list longer than the limit, least recently played first', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('played', [saved('b', 2), saved('c', 3), saved('a', 1)]);
      const played = createPlayedVideos({ storage, now: () => 4, maxCards: 2 });
      await played.load();
      expect(played.get('a')).toBeUndefined();
      expect(played.get('b')).toBeDefined();
      expect(played.get('c')).toBeDefined();

      played.record(card('d'));
      expect(played.get('b')).toBeUndefined();
      await flush();
      expect(await storage.get('played')).toEqual([saved('c', 3), played.get('d')]);
    });

    it('treats the later of two saved cards with the same time as the more recent', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('played', [saved('x', 5), saved('y', 5), saved('x', 4, { name: 'Old' })]);
      const played = createPlayedVideos({ storage, maxCards: 1 });
      await played.load();
      expect(played.get('x')).toBeUndefined();
      expect(played.get('y')).toStrictEqual(saved('y', 5));
    });

    it('lets cards recorded while reading win over the saved ones, and saves both', async () => {
      const storage = slowStorage([
        saved('tt9:1:1', 5, { metaId: 'tt9', name: 'Old' }),
        saved('tt2', 6, { metaId: 'tt2' }),
      ]);
      const played = createPlayedVideos({ storage: storage.storage, now: () => 50 });
      const loading = played.load();
      played.record(card('tt9:1:1', { metaId: 'tt9', name: 'New' }));
      await flush();
      expect(storage.writes).toHaveLength(0);

      storage.reads[0]?.resolve();
      await loading;
      expect(played.get('tt9:1:1')?.name).toBe('New');
      expect(played.get('tt2')).toBeDefined();

      await flush();
      expect(storage.writes).toHaveLength(1);
      storage.writes[0]?.done.resolve();
      await flush();
      expect(storage.values.get('played')).toEqual([
        saved('tt2', 6, { metaId: 'tt2' }),
        played.get('tt9:1:1'),
      ]);
    });

    it('reads the saved list itself before the first write when load was never called', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('played', [saved('old', 1)]);
      const played = createPlayedVideos({ storage, now: () => 50 });
      played.record(card('tt1'));
      await flush();
      expect(played.get('old')).toBeDefined();
      expect(await storage.get('played')).toEqual([saved('old', 1), played.get('tt1')]);
    });

    it('carries on in memory when the saved list cannot be read', async () => {
      const storage = slowStorage();
      const played = createPlayedVideos({ storage: storage.storage, now: () => 50 });
      const loading = played.load();
      storage.reads[0]?.reject(new Error('QuotaExceededError'));
      await expect(loading).resolves.toBeUndefined();

      played.record(card('tt1'));
      expect(played.get('tt1')?.updatedAt).toBe(50);
      await flush();
      expect(storage.writes).toHaveLength(1);
    });
  });

  describe('writing', () => {
    it('runs one write at a time and writes only the newest list next', async () => {
      const storage = slowStorage();
      let time = 0;
      const played = createPlayedVideos({ storage: storage.storage, now: () => time });
      const loading = played.load();
      storage.reads[0]?.resolve();
      await loading;

      time = 1;
      played.record(card('tt1'));
      await flush();
      expect(storage.writes).toHaveLength(1);

      time = 2;
      played.record(card('tt1', { name: 'Second' }));
      time = 3;
      played.record(card('tt1', { name: 'Third' }));
      time = 4;
      played.record(card('tt2'));
      await flush();
      expect(storage.writes).toHaveLength(1);

      storage.writes[0]?.done.resolve();
      await flush();
      expect(storage.writes).toHaveLength(2);
      expect(storage.writes[1]?.value).toEqual([
        saved('tt1', 3, { name: 'Third' }),
        saved('tt2', 4),
      ]);

      storage.writes[1]?.done.resolve();
      await flush();
      expect(storage.writes).toHaveLength(2);
      expect(storage.mostRunning()).toBe(1);
      expect(storage.values.get('played')).toEqual(storage.writes[1]?.value);
    });

    it('survives a failed write and writes again on the next record', async () => {
      const storage = slowStorage();
      const played = createPlayedVideos({ storage: storage.storage, now: () => 0 });
      const loading = played.load();
      storage.reads[0]?.resolve();
      await loading;

      played.record(card('tt1'));
      await flush();
      storage.writes[0]?.done.reject(new Error('QuotaExceededError'));
      await flush();
      expect(played.get('tt1')).toBeDefined();

      played.record(card('tt2'));
      await flush();
      expect(storage.writes).toHaveLength(2);
      storage.writes[1]?.done.resolve();
      await flush();
      expect(storage.values.get('played')).toEqual([played.get('tt1'), played.get('tt2')]);
    });

    it('does not throw when storage throws instead of rejecting', async () => {
      const storage: KeyValueStore = {
        get() {
          throw new Error('broken');
        },
        set() {
          throw new Error('broken');
        },
      };
      const played = createPlayedVideos({ storage, now: () => 0 });
      await played.load();
      expect(() => played.record(card('tt1'))).not.toThrow();
      await flush();
      expect(played.get('tt1')).toBeDefined();
    });
  });
});

function movie(videoId: string, position: number, duration = 6000): ProgressUpdate {
  return { metaId: videoId, type: 'movie', videoId, position, duration };
}

function episode(videoId: string, position: number, duration = 2400): ProgressUpdate {
  return { metaId: 'tt9', type: 'series', videoId, position, duration };
}

/** Progress and cards on a fake clock, as the player saves them. */
async function watching() {
  let time = 0;
  const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time });
  const played = createPlayedVideos({ storage: memoryKeyValueStore(), now: () => time });
  await Promise.all([progress.load(), played.load()]);
  return {
    played,
    /** Stops `update`'s video at its position at `at`, recording its card when given one. */
    play(update: ProgressUpdate, at: number, withCard?: Card) {
      time = at;
      progress.record(update);
      if (withCard) played.record(withCard);
    },
    progress,
    items: (limit?: number, now = NOW) => continueWatching(progress, played.get, now, limit),
  };
}

describe('continueWatching', () => {
  it('lists the titles most recently watched first', async () => {
    const tv = await watching();
    // Cards in another order, to show the row follows the progress.
    tv.played.record(filmCard('tt2'));
    tv.played.record(episodeCard('tt9:1:1'));
    tv.played.record(filmCard('tt1'));
    tv.play(movie('tt1', 600), 1);
    tv.play(episode('tt9:1:1', 600), 2);
    tv.play(movie('tt2', 600), 3);

    expect(tv.items().map((item) => item.preview.id)).toEqual(['tt2', 'tt9', 'tt1']);
  });

  it('shows each title once, from the video played last', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:1', 600), 1, episodeCard('tt9:1:1'));
    tv.play(movie('tt1', 600), 2, filmCard());
    tv.play(episode('tt9:1:2', 900), 3, episodeCard('tt9:1:2'));
    // An older episode played again is the latest.
    tv.play(episode('tt9:1:1', 1200), 4);

    expect(tv.items().map((item) => [item.preview.id, item.videoId, item.startAt])).toEqual([
      ['tt9', 'tt9:1:1', 1200],
      ['tt1', 'tt1', 600],
    ]);
  });

  it('resumes a film left part way, with how far through it is', async () => {
    const tv = await watching();
    const hero = {
      poster: 'https://img.example/poster.jpg',
      background: 'https://img.example/background.jpg',
      logo: 'https://img.example/logo.png',
      description: 'A heist goes wrong.',
      releaseInfo: '2019',
      imdbRating: '7.4',
      runtime: '2h 4min',
      genres: ['Crime', 'Drama'],
    };
    tv.play(movie('tt1', 1500), 1, filmCard('tt1', hero));

    expect(tv.items()).toStrictEqual([
      {
        preview: {
          id: 'tt1',
          type: 'movie',
          name: 'Film',
          posterShape: 'poster',
          trailers: [],
          ...hero,
        },
        videoId: 'tt1',
        startAt: 1500,
        progress: 0.25,
        upNext: false,
      },
    ]);
  });

  it('resumes an episode left part way, with its season and episode', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:2', 1200), 1, episodeCard('tt9:1:2'));

    expect(tv.items()).toStrictEqual([
      {
        preview: preview({ id: 'tt9', type: 'series', name: 'Show' }),
        videoId: 'tt9:1:2',
        startAt: 1200,
        progress: 0.5,
        season: 1,
        episode: 2,
        upNext: false,
      },
    ]);
  });

  it('leaves out a video whose length never became known, such as a live broadcast', async () => {
    const tv = await watching();
    // Saved by a build that recorded live streams.
    tv.play(movie('tt1', 3000, 0), 1, filmCard());
    tv.play(episode('tt9:1:2', 10, 0), 2, episodeCard('tt9:1:2'));
    expect(tv.items()).toEqual([]);
  });

  it('offers the episode after a finished one, from the beginning', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:1', 2300), 1, episodeCard('tt9:1:1'));

    expect(tv.items()).toStrictEqual([
      {
        preview: preview({ id: 'tt9', type: 'series', name: 'Show' }),
        videoId: 'tt9:1:2',
        startAt: 0,
        season: 1,
        episode: 2,
        upNext: true,
      },
    ]);
  });

  it('offers the episode after a finished one from where that one was left', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:2', 500), 1, episodeCard('tt9:1:2'));
    // Back to the first episode, watched to the end.
    tv.play(episode('tt9:1:1', 2300), 2, episodeCard('tt9:1:1'));

    const [item] = tv.items();
    // With how far through the next one already is (500 of 2400 s).
    expect(item).toMatchObject({ videoId: 'tt9:1:2', startAt: 500, upNext: true });
    expect(item!.progress).toBeCloseTo(500 / 2400);
  });

  it('offers the next special after a finished one, as season 0', async () => {
    const tv = await watching();
    tv.play(episode('tt9:0:1', 2300), 1, episodeCard('tt9:0:1'));

    expect(tv.items()).toMatchObject([
      { videoId: 'tt9:0:2', startAt: 0, season: 0, episode: 2, upNext: true },
    ]);
  });

  it('leaves out a finished film, until it is watched again', async () => {
    const tv = await watching();
    tv.play(movie('tt1', 5900), 1, filmCard());
    expect(tv.items()).toEqual([]);

    tv.play(movie('tt1', 1200), 2);
    expect(tv.items()).toMatchObject([{ videoId: 'tt1', startAt: 1200, progress: 0.2 }]);
  });

  it('leaves out a series whose last episode was finished', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:2', 2300), 1, episodeCard('tt9:1:2'));
    // Season 2 has not aired, so the card has no next episode.
    tv.play(episode('tt9:1:3', 2300), 2, episodeCard('tt9:1:3'));

    expect(tv.items()).toEqual([]);
  });

  it('starts an episode stopped in its first seconds from the beginning', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:2', 10), 1, episodeCard('tt9:1:2'));

    expect(tv.items()).toStrictEqual([
      {
        preview: preview({ id: 'tt9', type: 'series', name: 'Show' }),
        videoId: 'tt9:1:2',
        startAt: 0,
        season: 1,
        episode: 2,
        upNext: false,
      },
    ]);
  });

  it('offers the next episode after a short one stopped in its closing minute', async () => {
    const tv = await watching();
    // 250 of 300 s: past the last point worth resuming, short of 90%.
    tv.play(episode('tt9:1:1', 250, 300), 1, episodeCard('tt9:1:1'));
    expect(tv.items()).toMatchObject([{ videoId: 'tt9:1:2', startAt: 0, upNext: true }]);

    // With nothing after it, the series is left out, as a finished one is.
    tv.play(episode('tt9:1:3', 250, 300), 2, episodeCard('tt9:1:3'));
    tv.play(episode('tt9:2:1', 250, 300), 3, episodeCard('tt9:2:1'));
    expect(tv.items()).toEqual([]);
  });

  it('starts a video shorter than a minute from the beginning when stopped in its first seconds', async () => {
    const tv = await watching();
    // A 40 s clip: every point is within a minute of the end.
    tv.play(episode('tt9:1:2', 1, 40), 1, episodeCard('tt9:1:2'));
    expect(tv.items()).toMatchObject([{ videoId: 'tt9:1:2', startAt: 0, upNext: false }]);
  });

  it('leaves out a short film stopped in its closing minute', async () => {
    const tv = await watching();
    tv.play(movie('tt1', 250, 300), 1, filmCard());
    expect(tv.items()).toEqual([]);
  });

  it('brings a series back once the episode after the finished one airs', async () => {
    const tv = await watching();
    // S1E3 finished before S2E1 airs.
    tv.play(episode('tt9:1:3', 2300), 1, episodeCard('tt9:1:3'));
    expect(tv.items(undefined, Date.parse(AIRS) - 1)).toEqual([]);
    expect(tv.items(undefined, Date.parse(AIRS))).toMatchObject([
      { videoId: 'tt9:2:1', season: 2, episode: 1, upNext: true },
    ]);
  });

  it('counts an episode with no release time as aired', async () => {
    const tv = await watching();
    const undated = detail(SHOW_ITEM, [
      ep(1, 1),
      { id: 'tt9:1:2', title: 'S1E2', season: 1, episode: 2 },
    ]);
    tv.play(episode('tt9:1:1', 2300), 1, playedCard(SHOW_ITEM, 'tt9:1:1', undated));
    expect(tv.items(undefined, 0)).toMatchObject([{ videoId: 'tt9:1:2', upNext: true }]);
  });

  it('leaves out a film stopped in its first seconds', async () => {
    const tv = await watching();
    tv.play(movie('tt1', 10), 1, filmCard());

    expect(tv.items()).toEqual([]);
  });

  it('leaves out a video kept only to resume, such as a sports replay, card or not', async () => {
    const tv = await watching();
    tv.play(movie('tt1', 600), 1, filmCard());
    tv.play({ ...movie('tt2', 600), continueRow: false }, 2, filmCard('tt2'));
    tv.play({ ...episode('tt9:1:2', 1200), continueRow: false }, 3, episodeCard('tt9:1:2'));
    tv.play({ ...movie('tt3', 600), continueRow: false }, 4);

    expect(tv.items().map((item) => item.preview.id)).toEqual(['tt1']);
  });

  it('leaves out a title whose last video has no card', async () => {
    const tv = await watching();
    tv.play(episode('tt9:1:1', 600), 1, episodeCard('tt9:1:1'));
    tv.play(movie('tt1', 600), 2, filmCard());
    // Saved before Continue Watching existed, or the card is still on its way.
    tv.play(episode('tt9:1:2', 600), 3);
    tv.play(movie('tt3', 600), 4);

    expect(tv.items().map((item) => item.preview.id)).toEqual(['tt1']);
  });

  it('stops at the limit, counting only the titles it shows', async () => {
    const tv = await watching();
    for (let i = 1; i <= CONTINUE_LIMIT + 5; i++) {
      tv.play(movie(`tt${i}`, 600), i, filmCard(`tt${i}`));
    }
    const all = tv.items();
    expect(all).toHaveLength(CONTINUE_LIMIT);
    expect(all[0]?.preview.id).toBe(`tt${CONTINUE_LIMIT + 5}`);

    tv.play(movie('tt404', 600), 100);
    expect(tv.items(2).map((item) => item.preview.id)).toEqual(['tt25', 'tt24']);
  });
});

describe('filled cards and the BannerTV account', () => {
  const card: Card = { videoId: 'tt1', metaId: 'tt1', type: 'movie', name: 'One' };

  it('marks a card the screen filled in, keeps the mark when read back, and drops it when played', async () => {
    const storage = memoryKeyValueStore();
    const played = createPlayedVideos({ storage, now: () => 10 });
    await played.load();
    played.record(card, { filled: true });
    expect(played.get('tt1')?.filled).toBe(true);
    await flush();
    const again = createPlayedVideos({ storage, now: () => 20 });
    await again.load();
    expect(again.get('tt1')?.filled).toBe(true);
    again.record({ ...card, name: 'One, played' });
    expect(again.get('tt1')).toEqual({ ...card, name: 'One, played', updatedAt: 20 });
  });

  it('adopts cards with their own times, least recently played first, and forgets others', async () => {
    const storage = memoryKeyValueStore();
    const played = createPlayedVideos({ storage, now: () => 50, maxCards: 3 });
    await played.load();
    played.record(card);
    played.record({ ...card, videoId: 'tt2', metaId: 'tt2' });
    const listener = vi.fn();
    played.subscribe(listener);
    await played.adopt({
      set: [
        { ...card, videoId: 'tt3', metaId: 'tt3', updatedAt: 90 },
        { ...card, videoId: 'tt4', metaId: 'tt4', updatedAt: 10 },
        { ...card, videoId: 'tt5', metaId: 'tt5', updatedAt: 70 },
      ],
      remove: ['tt2'],
    });
    // The limit of three drops the least recently played, an adopted one here.
    expect(played.get('tt4')).toBeUndefined();
    expect(played.get('tt2')).toBeUndefined();
    expect(played.get('tt3')?.updatedAt).toBe(90);
    expect(played.get('tt1')?.updatedAt).toBe(50);
    expect(listener).toHaveBeenCalledTimes(1);
    await flush();
    expect(((await storage.get('played')) as PlayedVideo[]).map((c) => c.videoId)).toEqual([
      'tt1',
      'tt5',
      'tt3',
    ]);
  });
});

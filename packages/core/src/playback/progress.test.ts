import { describe, expect, it, vi } from 'vitest';
import { memoryKeyValueStore, type KeyValueStore } from '../storage';
import {
  AWAY_MS,
  createProgressStore,
  MIN_RESUME_SECONDS,
  type ProgressEntry,
  type ProgressUpdate,
  RESUME_LEAD_IN_AWAY_S,
  RESUME_LEAD_IN_S,
  resumeLeadIn,
  WATCHED_FRACTION,
} from './progress';

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
  if (saved !== undefined) values.set('progress', saved);
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

function movie(position: number, duration = 6000): ProgressUpdate {
  return { metaId: 'tt1', type: 'movie', videoId: 'tt1', position, duration };
}

function episode(videoId: string, position: number, duration = 2400): ProgressUpdate {
  return { metaId: 'tt9', type: 'series', videoId, position, duration };
}

function saved(overrides: Partial<ProgressEntry> = {}): ProgressEntry {
  return {
    metaId: 'tt1',
    type: 'movie',
    videoId: 'tt1',
    position: 600,
    duration: 6000,
    updatedAt: 1,
    watched: false,
    ...overrides,
  };
}

describe('createProgressStore', () => {
  it('records the position with the time and writes the whole list', async () => {
    const storage = memoryKeyValueStore();
    let time = 1000;
    const progress = createProgressStore({ storage, now: () => time });
    await progress.load();

    const entry = progress.record(movie(120));
    expect(entry).toEqual({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 120,
      duration: 6000,
      updatedAt: 1000,
      watched: false,
    });
    expect(progress.get('tt1')).toBe(entry);
    await flush();
    expect(await storage.get('progress')).toEqual([entry]);

    time = 2000;
    progress.record(episode('tt9:1:1', 50));
    await flush();
    expect(await storage.get('progress')).toEqual([entry, progress.get('tt9:1:1')]);
  });

  it('marks a video watched past the watched share and keeps it watched through a rewatch', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    await progress.load();
    expect(progress.record(movie(WATCHED_FRACTION * 6000 - 1)).watched).toBe(false);
    expect(progress.record(movie(WATCHED_FRACTION * 6000)).watched).toBe(true);

    const rewatch = progress.record(movie(40));
    expect(rewatch.watched).toBe(true);
    expect(rewatch.position).toBe(40);
  });

  it('counts an episode watched from its credits, kept at its end so it never resumes in them', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    await progress.load();
    const episode = (position: number, creditsAt?: number): ProgressUpdate => ({
      metaId: 'tt2',
      type: 'series',
      videoId: 'tt2:1:1',
      position,
      duration: 2600,
      ...(creditsAt !== undefined ? { creditsAt } : {}),
    });
    // Long credits start well before the watched share.
    expect(progress.record(episode(2199, 2200))).toMatchObject({ position: 2199, watched: false });
    expect(progress.record(episode(2200, 2200))).toMatchObject({ position: 2600, watched: true });
    expect(progress.resumeAt('tt2:1:1')).toBeUndefined();
    // Back before the credits, it stays watched and resumes there, as any rewatch does.
    expect(progress.record(episode(1500, 2200))).toMatchObject({ position: 1500, watched: true });
    expect(progress.resumeAt('tt2:1:1')).toBe(1500);
    // A mark that makes no sense for the file changes nothing.
    for (const creditsAt of [0, -5, 2600, 3000, NaN]) {
      expect(
        progress.record({ ...episode(2300, creditsAt), videoId: `x${creditsAt}` }),
      ).toMatchObject({ position: 2300, watched: false });
    }
    // Nor is the mark saved.
    expect(progress.get('tt2:1:1')).not.toHaveProperty('creditsAt');
  });

  it('keeps a video off Continue Watching while it is recorded so, across launches too', async () => {
    const storage = memoryKeyValueStore();
    const progress = createProgressStore({ storage, now: () => 1000 });
    await progress.load();
    progress.record({ ...movie(600), continueRow: false });
    // Its place is kept to resume all the same.
    expect(progress.get('tt1')).toMatchObject({ position: 600, continueRow: false });
    expect(progress.resumeAt('tt1')).toBe(600);
    await flush();

    const relaunched = createProgressStore({ storage });
    await relaunched.load();
    expect(relaunched.get('tt1')).toEqual({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 600,
      duration: 6000,
      updatedAt: 1000,
      watched: false,
      continueRow: false,
    });
    // Played from elsewhere since, it can go on the row.
    relaunched.record(movie(700));
    expect(relaunched.get('tt1')).not.toHaveProperty('continueRow');
  });

  it('never marks a video watched while its duration is unknown', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    await progress.load();
    expect(progress.record(movie(5000, 0)).watched).toBe(false);
  });

  it('turns NaN, Infinity and negative readings into 0', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    await progress.load();
    expect(progress.record(movie(NaN, Infinity))).toMatchObject({ position: 0, duration: 0 });
    expect(progress.record(movie(-5, -1))).toMatchObject({ position: 0, duration: 0 });
    expect(progress.record(movie(Infinity, NaN))).toMatchObject({ position: 0, duration: 0 });
  });

  it('starts a resume a few seconds early, further after a day away, and says the exact place', async () => {
    let time = 1_000_000;
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time });
    await progress.load();
    expect(progress.resumeFrom('tt1')).toBeUndefined();
    progress.record(movie(2530));
    // Details still says where it stopped.
    expect(progress.resumeAt('tt1')).toBe(2530);
    expect(progress.resumeFrom('tt1')).toBe(2530 - RESUME_LEAD_IN_S);
    time += AWAY_MS - 1;
    expect(progress.resumeFrom('tt1')).toBe(2530 - RESUME_LEAD_IN_S);
    time += 1;
    expect(progress.resumeFrom('tt1')).toBe(2530 - RESUME_LEAD_IN_AWAY_S);
    // A time given wins over the store's clock.
    expect(progress.resumeFrom('tt1', 1_000_000)).toBe(2530 - RESUME_LEAD_IN_S);
    // Nothing to resume, nothing to start early.
    progress.record(movie(MIN_RESUME_SECONDS - 1));
    expect(progress.resumeFrom('tt1')).toBeUndefined();
  });

  it('never leads a resume in below where resumes begin, so leaving at once keeps it resumable', async () => {
    let time = 1_000_000;
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time });
    await progress.load();
    progress.record(movie(MIN_RESUME_SECONDS + 2));
    time += AWAY_MS;
    expect(progress.resumeFrom('tt1')).toBe(MIN_RESUME_SECONDS);
    // The player saves its first reading there, and it still resumes.
    progress.record(movie(MIN_RESUME_SECONDS));
    expect(progress.resumeAt('tt1')).toBe(MIN_RESUME_SECONDS);
    expect(progress.resumeFrom('tt1')).toBe(MIN_RESUME_SECONDS);
  });

  it('never starts a resume before 0, and a clock set back is no time away', () => {
    expect(resumeLeadIn(3, 0, 0)).toBe(0);
    expect(resumeLeadIn(600, 5000, 1000)).toBe(600 - RESUME_LEAD_IN_S);
    expect(resumeLeadIn(600, 0, AWAY_MS)).toBe(600 - RESUME_LEAD_IN_AWAY_S);
  });

  it('resumes only from the middle of a video', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    await progress.load();
    expect(progress.resumeAt('tt1')).toBeUndefined();

    progress.record(movie(MIN_RESUME_SECONDS - 1));
    expect(progress.resumeAt('tt1')).toBeUndefined();
    progress.record(movie(MIN_RESUME_SECONDS));
    expect(progress.resumeAt('tt1')).toBe(MIN_RESUME_SECONDS);

    progress.record(movie(3000, 0));
    expect(progress.resumeAt('tt1')).toBe(undefined);
    progress.record(movie(3000));
    expect(progress.resumeAt('tt1')).toBe(3000);

    // A short video, so the last minute starts before the watched share.
    const short = (position: number) => ({ ...movie(position, 500), videoId: 'short' });
    progress.record(short(441));
    expect(progress.get('short')?.watched).toBe(false);
    expect(progress.resumeAt('short')).toBeUndefined();
    progress.record(short(440));
    expect(progress.resumeAt('short')).toBe(440);

    progress.record(movie(5900));
    expect(progress.resumeAt('tt1')).toBeUndefined();
    // A rewatch stopped part way resumes, and the film stays watched.
    progress.record(movie(1200));
    expect(progress.get('tt1')?.watched).toBe(true);
    expect(progress.resumeAt('tt1')).toBe(1200);
    progress.record(movie(5500));
    expect(progress.resumeAt('tt1')).toBeUndefined();
  });

  it('lists the entries of one title, most recently updated first', async () => {
    let time = 0;
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time });
    await progress.load();
    time = 10;
    progress.record(episode('tt9:1:1', 100));
    time = 30;
    progress.record(episode('tt9:1:3', 100));
    time = 20;
    progress.record(episode('tt9:1:2', 100));
    progress.record(movie(100));

    expect(progress.forMeta('tt9').map((entry) => entry.videoId)).toEqual([
      'tt9:1:3',
      'tt9:1:2',
      'tt9:1:1',
    ]);
    expect(progress.forMeta('tt404')).toEqual([]);
  });

  it('lists every entry, most recently updated first', async () => {
    let time = 0;
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time });
    await progress.load();
    expect(progress.recent()).toEqual([]);

    time = 10;
    progress.record(episode('tt9:1:1', 100));
    time = 30;
    progress.record(movie(100));
    time = 20;
    progress.record(episode('tt9:1:2', 100));
    // Recorded at the same time: the later record is the more recent.
    progress.record(episode('tt9:1:3', 100));
    time = 40;
    progress.record(episode('tt9:1:1', 200));

    expect(progress.recent().map((entry) => entry.videoId)).toEqual([
      'tt9:1:1',
      'tt1',
      'tt9:1:3',
      'tt9:1:2',
    ]);
    expect(progress.recent()[0]).toBe(progress.get('tt9:1:1'));
  });

  it('lists saved entries with the ones recorded since, most recent first', async () => {
    const storage = memoryKeyValueStore();
    // Saved least recent first, so of two with the same time the later one is the more recent.
    await storage.set('progress', [
      saved({ videoId: 'b', updatedAt: 5 }),
      saved({ videoId: 'c', updatedAt: 5 }),
      saved({ videoId: 'a', updatedAt: 1 }),
    ]);
    const progress = createProgressStore({ storage, now: () => 3 });
    await progress.load();
    progress.record(episode('tt9:1:1', 100));

    expect(progress.recent().map((entry) => entry.videoId)).toEqual(['c', 'b', 'tt9:1:1', 'a']);
  });

  it('starts over by forgetting the entry, in storage too', async () => {
    const storage = memoryKeyValueStore();
    const progress = createProgressStore({ storage, now: () => 0 });
    await progress.load();
    progress.record(movie(5900));
    progress.record(episode('tt9:1:1', 100));
    const listener = vi.fn();
    progress.subscribe(listener);
    const before = progress.version();

    progress.clear('tt1');
    expect(progress.get('tt1')).toBeUndefined();
    expect(progress.version()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalledTimes(1);
    await flush();
    expect(await storage.get('progress')).toEqual([progress.get('tt9:1:1')]);

    expect(progress.record(movie(10)).watched).toBe(false);
  });

  it('does nothing when clearing a video it has no entry for', async () => {
    const storage = slowStorage();
    const progress = createProgressStore({ storage: storage.storage });
    const loading = progress.load();
    storage.reads[0]?.resolve();
    await loading;
    const listener = vi.fn();
    progress.subscribe(listener);

    progress.clear('tt404');
    await flush();
    expect(storage.writes).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(progress.version()).toBe(0);
  });

  it('bumps the version and tells listeners on every change until they unsubscribe', async () => {
    const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => 0 });
    expect(progress.version()).toBe(0);
    await progress.load();
    expect(progress.version()).toBe(0);

    const listener = vi.fn();
    const unsubscribe = progress.subscribe(listener);
    progress.record(movie(100));
    progress.record(movie(100));
    expect(progress.version()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    progress.record(movie(200));
    expect(progress.version()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the most recently updated entries up to the limit', async () => {
    const storage = memoryKeyValueStore();
    let time = 0;
    const progress = createProgressStore({ storage, now: () => time, maxEntries: 2 });
    await progress.load();
    time = 1;
    progress.record(episode('tt9:1:1', 100));
    time = 2;
    progress.record(episode('tt9:1:2', 100));
    time = 3;
    progress.record(episode('tt9:1:1', 200));
    time = 4;
    progress.record(episode('tt9:1:3', 100));

    expect(progress.get('tt9:1:2')).toBeUndefined();
    expect(progress.forMeta('tt9').map((entry) => entry.videoId)).toEqual(['tt9:1:3', 'tt9:1:1']);
    await flush();
    expect(await storage.get('progress')).toHaveLength(2);
  });

  it('keeps the entry just recorded even when the clock has gone back', async () => {
    let time = 5000;
    const progress = createProgressStore({
      storage: memoryKeyValueStore(),
      now: () => time,
      maxEntries: 2,
    });
    await progress.load();
    progress.record(episode('tt9:1:1', 100));
    progress.record(episode('tt9:1:2', 100));
    time = 10;
    progress.record(episode('tt9:1:3', 100));

    expect(progress.get('tt9:1:1')).toBeUndefined();
    expect(progress.get('tt9:1:3')).toBeDefined();
  });

  describe('load', () => {
    it('reads storage once, however often it is called', async () => {
      const storage = memoryKeyValueStore();
      const get = vi.spyOn(storage, 'get');
      const progress = createProgressStore({ storage });
      const first = progress.load();
      expect(progress.load()).toBe(first);
      await first;
      await progress.load();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('brings back saved entries and tells listeners', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('progress', [saved({ position: 900 })]);
      const progress = createProgressStore({ storage });
      const listener = vi.fn();
      progress.subscribe(listener);
      await progress.load();
      expect(progress.resumeAt('tt1')).toBe(900);
      expect(progress.version()).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('drops saved entries it cannot read and keeps the rest', async () => {
      const storage = memoryKeyValueStore();
      const good = saved({ videoId: 'good' });
      await storage.set('progress', [
        good,
        null,
        'tt1',
        42,
        saved({ videoId: '' }),
        saved({ metaId: undefined as unknown as string }),
        saved({ type: 7 as unknown as string }),
        saved({ position: -1 }),
        saved({ position: NaN }),
        saved({ duration: Infinity }),
        saved({ duration: '6000' as unknown as number }),
        saved({ updatedAt: undefined as unknown as number }),
        saved({ watched: 'yes' as unknown as boolean }),
      ]);
      const progress = createProgressStore({ storage });
      await progress.load();
      expect(progress.forMeta('tt1')).toEqual([good]);
    });

    it('reads only false as keeping a video off Continue Watching', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('progress', [
        saved({ videoId: 'a', continueRow: true as unknown as false }),
        saved({ videoId: 'b', continueRow: 'no' as unknown as false }),
        saved({ videoId: 'c', continueRow: false }),
      ]);
      const progress = createProgressStore({ storage });
      await progress.load();
      expect(progress.get('a')).toEqual(saved({ videoId: 'a' }));
      expect(progress.get('b')).toEqual(saved({ videoId: 'b' }));
      expect(progress.get('c')).toEqual(saved({ videoId: 'c', continueRow: false }));
    });

    it('keeps the latest of two saved entries for the same video', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('progress', [
        saved({ position: 900, updatedAt: 20 }),
        saved({ position: 300, updatedAt: 10 }),
      ]);
      const progress = createProgressStore({ storage });
      await progress.load();
      expect(progress.get('tt1')?.position).toBe(900);
    });

    it('starts empty when the saved value is not a list', async () => {
      for (const value of [undefined, null, 'progress', { 0: saved() }]) {
        const storage = memoryKeyValueStore();
        await storage.set('progress', value);
        const progress = createProgressStore({ storage });
        await progress.load();
        expect(progress.forMeta('tt1')).toEqual([]);
        expect(progress.version()).toBe(0);
      }
    });

    it('trims a saved list longer than the limit, oldest first', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('progress', [
        saved({ videoId: 'b', updatedAt: 2 }),
        saved({ videoId: 'c', updatedAt: 3 }),
        saved({ videoId: 'a', updatedAt: 1 }),
      ]);
      const progress = createProgressStore({ storage, maxEntries: 2 });
      await progress.load();
      expect(progress.forMeta('tt1').map((entry) => entry.videoId)).toEqual(['c', 'b']);
    });

    it('lets records made while reading win over the saved ones, and saves both', async () => {
      const storage = slowStorage([
        saved({ videoId: 'tt9:1:1', metaId: 'tt9', position: 700 }),
        saved({ videoId: 'tt9:1:2', metaId: 'tt9', position: 800 }),
      ]);
      const progress = createProgressStore({ storage: storage.storage, now: () => 50 });
      const loading = progress.load();
      progress.record(episode('tt9:1:1', 1300));
      await flush();
      expect(storage.writes).toHaveLength(0);

      storage.reads[0]?.resolve();
      await loading;
      expect(progress.get('tt9:1:1')?.position).toBe(1300);
      expect(progress.get('tt9:1:2')?.position).toBe(800);

      await flush();
      expect(storage.writes).toHaveLength(1);
      storage.writes[0]?.done.resolve();
      await flush();
      expect(storage.values.get('progress')).toEqual([
        progress.get('tt9:1:2'),
        progress.get('tt9:1:1'),
      ]);
    });

    it('keeps a saved watched mark through a rewatch recorded while reading', async () => {
      const storage = slowStorage([saved({ position: 5900, watched: true })]);
      const progress = createProgressStore({ storage: storage.storage, now: () => 50 });
      const loading = progress.load();
      progress.record(movie(45));
      storage.reads[0]?.resolve();
      await loading;
      expect(progress.get('tt1')).toMatchObject({ position: 45, watched: true });
    });

    it('does not bring back an entry that was started over while reading', async () => {
      const storage = slowStorage([
        saved({ position: 5900, watched: true }),
        saved({ videoId: 'x' }),
      ]);
      const progress = createProgressStore({ storage: storage.storage, now: () => 50 });
      const loading = progress.load();
      progress.clear('tt1');
      storage.reads[0]?.resolve();
      await loading;
      expect(progress.get('tt1')).toBeUndefined();
      expect(progress.get('x')).toBeDefined();

      await flush();
      storage.writes[0]?.done.resolve();
      await flush();
      expect(storage.values.get('progress')).toEqual([saved({ videoId: 'x' })]);

      expect(progress.record(movie(45)).watched).toBe(false);
    });

    it('reads the saved list itself before the first write when load was never called', async () => {
      const storage = memoryKeyValueStore();
      await storage.set('progress', [saved({ videoId: 'old' })]);
      const progress = createProgressStore({ storage, now: () => 50 });
      progress.record(movie(100));
      await flush();
      expect(progress.get('old')).toBeDefined();
      expect(await storage.get('progress')).toEqual([
        saved({ videoId: 'old' }),
        progress.get('tt1'),
      ]);
    });

    it('carries on in memory when the saved list cannot be read', async () => {
      const storage = slowStorage();
      const progress = createProgressStore({ storage: storage.storage, now: () => 50 });
      const loading = progress.load();
      storage.reads[0]?.reject(new Error('QuotaExceededError'));
      await expect(loading).resolves.toBeUndefined();

      progress.record(movie(100));
      expect(progress.get('tt1')?.position).toBe(100);
      await flush();
      expect(storage.writes).toHaveLength(1);
    });
  });

  describe('writing', () => {
    it('runs one write at a time and writes only the newest list next', async () => {
      const storage = slowStorage();
      let time = 0;
      const progress = createProgressStore({ storage: storage.storage, now: () => time });
      const loading = progress.load();
      storage.reads[0]?.resolve();
      await loading;

      time = 1;
      progress.record(movie(100));
      await flush();
      expect(storage.writes).toHaveLength(1);

      time = 2;
      progress.record(movie(110));
      time = 3;
      progress.record(movie(120));
      time = 4;
      progress.record(episode('tt9:1:1', 10));
      await flush();
      expect(storage.writes).toHaveLength(1);

      storage.writes[0]?.done.resolve();
      await flush();
      expect(storage.writes).toHaveLength(2);
      expect(storage.writes[1]?.value).toEqual([
        { ...movie(120), updatedAt: 3, watched: false },
        { ...episode('tt9:1:1', 10), updatedAt: 4, watched: false },
      ]);

      storage.writes[1]?.done.resolve();
      await flush();
      expect(storage.writes).toHaveLength(2);
      expect(storage.mostRunning()).toBe(1);
      expect(storage.values.get('progress')).toEqual(storage.writes[1]?.value);
    });

    it('survives a failed write and writes again on the next record', async () => {
      const storage = slowStorage();
      const progress = createProgressStore({ storage: storage.storage, now: () => 0 });
      const loading = progress.load();
      storage.reads[0]?.resolve();
      await loading;

      progress.record(movie(100));
      await flush();
      storage.writes[0]?.done.reject(new Error('QuotaExceededError'));
      await flush();
      expect(progress.get('tt1')?.position).toBe(100);

      progress.record(movie(200));
      await flush();
      expect(storage.writes).toHaveLength(2);
      storage.writes[1]?.done.resolve();
      await flush();
      expect(storage.values.get('progress')).toEqual([progress.get('tt1')]);
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
      const progress = createProgressStore({ storage, now: () => 0 });
      await progress.load();
      expect(() => progress.record(movie(100))).not.toThrow();
      expect(() => progress.clear('tt1')).not.toThrow();
      await flush();
    });
  });
});

describe('the Trakt mark and the BannerTV account', () => {
  const traktEntry: ProgressEntry = {
    metaId: 'tt1',
    type: 'movie',
    videoId: 'tt1',
    position: 600,
    duration: 3000,
    updatedAt: 2000,
    watched: false,
    from: 'trakt',
  };

  it('keeps the mark of progress from Trakt through a save, and drops it when played here', async () => {
    const storage = memoryKeyValueStore();
    let time = 5000;
    const progress = createProgressStore({ storage, now: () => time });
    await progress.load();
    expect(await progress.merge([traktEntry])).toBe(1);
    expect(progress.get('tt1')?.from).toBe('trakt');
    await vi.waitFor(async () => expect(await storage.get('progress')).toHaveLength(1));

    const again = createProgressStore({ storage, now: () => time });
    await again.load();
    expect(again.get('tt1')?.from).toBe('trakt');
    time = 6000;
    again.record({ metaId: 'tt1', type: 'movie', videoId: 'tt1', position: 700, duration: 3000 });
    expect(again.get('tt1')?.from).toBeUndefined();
  });

  it('adopts entries as given, without rescaling, and forgets others', async () => {
    const storage = memoryKeyValueStore();
    const progress = createProgressStore({ storage, now: () => 5000 });
    await progress.load();
    progress.record({ metaId: 'tt2', type: 'movie', videoId: 'tt2', position: 60, duration: 100 });
    progress.record({ metaId: 'tt3', type: 'movie', videoId: 'tt3', position: 60, duration: 100 });
    const listener = vi.fn();
    progress.subscribe(listener);
    await progress.adopt({
      set: [
        { ...traktEntry, from: undefined, position: 1500, updatedAt: 9000 },
        { ...traktEntry, videoId: 'tt2', metaId: 'tt2', position: 10, updatedAt: 1000 },
      ],
      remove: ['tt3'],
    });
    expect(progress.get('tt1')).toEqual({
      metaId: 'tt1',
      type: 'movie',
      videoId: 'tt1',
      position: 1500,
      duration: 3000,
      updatedAt: 9000,
      watched: false,
    });
    // Older than the TV's own, but the account's merge already chose it.
    expect(progress.get('tt2')).toMatchObject({ position: 10, updatedAt: 1000, from: 'trakt' });
    expect(progress.get('tt3')).toBeUndefined();
    expect(progress.recent().map((e) => e.videoId)).toEqual(['tt1', 'tt2']);
    expect(listener).toHaveBeenCalledTimes(1);
    await progress.adopt({ remove: ['tt3'] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

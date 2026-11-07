import { describe, expect, it, vi } from 'vitest';
import {
  type CachePolicy,
  createQueryCache,
  keepEqual,
  policyFromHints,
  type QueryResult,
} from './query';
import { memoryCacheStore } from './storage';

const POLICY: CachePolicy = { freshFor: 1000, revalidateFor: 1000, errorFor: 1000 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets queued promise callbacks run. The core has no timers to wait on.
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('policyFromHints', () => {
  it('prefers the addon hints, in seconds, over the defaults', () => {
    expect(policyFromHints({ cacheMaxAge: 60, staleError: 0 }, POLICY)).toEqual({
      freshFor: 60000,
      revalidateFor: 1000,
      errorFor: 0,
    });
  });
});

describe('createQueryCache', () => {
  it('loads once, shares the query per key and skips fetching while fresh', async () => {
    let time = 0;
    const cache = createQueryCache({ now: () => time });
    const fetch = vi.fn(() => Promise.resolve({ value: 'a', hints: {} }));
    const query = cache.query('k', { fetch, policy: POLICY, persist: false });
    expect(cache.query('k', { fetch, policy: POLICY, persist: false })).toBe(query);

    query.load();
    expect(query.get().status).toBe('loading');
    query.load();
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: 'a', stale: false });

    time = 500;
    query.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    time = 1500;
    query.load();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serves a stored copy at once and refreshes it behind the scenes', async () => {
    const store = memoryCacheStore();
    await store.write('k', { value: 'old', storedAt: 0, ...POLICY });
    const cache = createQueryCache({ store, now: () => 1500 });
    const next = deferred<QueryResult<string>>();
    const query = cache.query('k', { fetch: () => next.promise, policy: POLICY, persist: true });

    query.load();
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: 'old', stale: true });
    next.resolve({ value: 'new', hints: { cacheMaxAge: 5 } });
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: 'new', stale: false });
    expect(await store.read('k')).toEqual({
      value: 'new',
      storedAt: 1500,
      freshFor: 5000,
      revalidateFor: 1000,
      errorFor: 1000,
    });
  });

  it('uses a stored fresh copy without fetching', async () => {
    const store = memoryCacheStore();
    await store.write('k', { value: 'kept', storedAt: 0, ...POLICY });
    const fetch = vi.fn(() => Promise.resolve({ value: 'new', hints: {} }));
    const query = createQueryCache({ store, now: () => 10 }).query('k', {
      fetch,
      policy: POLICY,
      persist: true,
    });
    query.load();
    await flush();
    expect(query.get().data).toBe('kept');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to an old copy only when the addon fails', async () => {
    const store = memoryCacheStore();
    await store.write('k', { value: 'old', storedAt: 0, ...POLICY });
    // Past fresh and revalidate, inside staleError.
    const cache = createQueryCache({ store, now: () => 2500 });
    const next = deferred<QueryResult<string>>();
    const query = cache.query('k', { fetch: () => next.promise, policy: POLICY, persist: true });

    query.load();
    await flush();
    expect(query.get().status).toBe('loading');
    next.reject(new Error('offline'));
    await flush();
    expect(query.get()).toMatchObject({ status: 'success', data: 'old', stale: true });
    expect(query.get().error?.message).toBe('offline');
  });

  it('reports an error when there is nothing to fall back on, and retry fetches again', async () => {
    const fetch = vi
      .fn<() => Promise<QueryResult<string>>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ value: 'ok', hints: {} });
    const query = createQueryCache().query('k', { fetch, policy: POLICY, persist: false });
    query.load();
    await flush();
    expect(query.get()).toMatchObject({ status: 'error', stale: false });
    expect(query.get().error?.message).toBe('timeout');
    query.retry();
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: 'ok', stale: false });
  });

  it('notifies subscribers and forgets unwatched queries beyond the limit', async () => {
    const cache = createQueryCache({ maxEntries: 1 });
    const fetch = () => Promise.resolve({ value: 1, hints: {} });
    const first = cache.query('a', { fetch, policy: POLICY, persist: false });
    const listener = vi.fn();
    first.subscribe(listener);
    first.load();
    await flush();
    expect(listener).toHaveBeenCalled();

    const second = cache.query('b', { fetch, policy: POLICY, persist: false });
    // 'a' is watched, so it stays; 'b' is not.
    expect(cache.query('a', { fetch, policy: POLICY, persist: false })).toBe(first);
    expect(cache.query('b', { fetch, policy: POLICY, persist: false })).not.toBe(second);
  });

  it('carries on in memory when the store fails', async () => {
    const store = {
      read: () => Promise.reject(new Error('quota')),
      write: () => Promise.reject(new Error('quota')),
    };
    const query = createQueryCache({ store }).query('k', {
      fetch: () => Promise.resolve({ value: 'x', hints: {} }),
      policy: POLICY,
      persist: true,
    });
    query.load();
    await flush();
    expect(query.get().data).toBe('x');
  });
});

/** As from the network or storage: equal JSON, never the same objects. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const ROW = [
  { id: 'tt1', name: 'One', genres: ['Drama'], behaviorHints: { defaultVideoId: 'tt1' } },
  { id: 'tt2', name: 'Two', genres: ['Comedy'], behaviorHints: {} },
  { id: 'tt3', name: 'Three', genres: [], behaviorHints: {} },
];

describe('keepEqual', () => {
  it('gives back the old value itself when the new one is equal, changing neither', () => {
    const prev = deepFreeze(copy(ROW));
    const next = deepFreeze(copy(ROW));
    expect(keepEqual(prev, next)).toBe(prev);
    expect(next).toEqual(ROW);
    const detail = { id: 'tt1', videos: copy(ROW), cast: ['A'], rating: 0, empty: null };
    const same = copy(detail);
    expect(keepEqual(detail, same)).toBe(detail);
    expect(keepEqual('a', 'a')).toBe('a');
    expect(keepEqual(Number.NaN, Number.NaN)).toBeNaN();
  });

  it('keeps the parts that did not change, and takes the rest from the new value', () => {
    const prev = copy(ROW);
    const next = copy(ROW);
    next[1] = { ...next[1]!, name: 'Two, renamed' };
    deepFreeze(next);
    const kept = keepEqual(prev, next);
    expect(kept).toEqual(next);
    expect(kept).not.toBe(prev);
    expect(kept[0]).toBe(prev[0]);
    expect(kept[1]).not.toBe(prev[1]);
    expect(kept[1]!.genres).toBe(prev[1]!.genres);
    expect(kept[1]!.behaviorHints).toBe(prev[1]!.behaviorHints);
    expect(kept[2]).toBe(prev[2]);
    // The new value itself is left as it came.
    expect(next[0]).not.toBe(prev[0]);
  });

  it('finds moved items by id, so a list with a new title first keeps the others', () => {
    const prev = copy(ROW);
    const added = { id: 'tt0', name: 'Zero', genres: [], behaviorHints: {} };
    const next = [added, ...copy(ROW).reverse()];
    const kept = keepEqual(prev, next);
    expect(kept).toEqual(next);
    expect(kept[0]).toBe(added);
    expect(kept.slice(1)).toEqual([prev[2], prev[1], prev[0]]);
    kept.slice(1).forEach((item, index) => expect(item).toBe(prev[2 - index]));
    // Shorter, with no id to go by.
    const tags = ['a', 'b', 'c'];
    expect(keepEqual(tags, ['a', 'b'])).toEqual(['a', 'b']);
    expect(keepEqual([{ n: 1 }, { n: 2 }], [{ n: 1 }])[0]).toEqual({ n: 1 });
  });

  it('is exact: only values that would read the same count as equal', () => {
    const record = { a: 1, b: 2 };
    expect(keepEqual(record, { b: 2, a: 1 })).not.toBe(record);
    expect(keepEqual({ a: undefined }, {})).toEqual({});
    expect(keepEqual({}, { a: undefined })).toHaveProperty('a');
    expect(Object.is(keepEqual({ n: 0 }, { n: -0 }).n, -0)).toBe(true);
    expect(keepEqual([1, 2], { 0: 1, 1: 2 })).toEqual({ 0: 1, 1: 2 });
    expect(keepEqual({ 0: 1 }, [1])).toEqual([1]);
    expect(keepEqual(null, {})).toEqual({});
    expect(keepEqual(['1'], [1])).toEqual([1]);
    // Anything but plain objects and arrays is equal only to itself.
    const date = new Date(0);
    const later = new Date(0);
    expect(keepEqual({ at: date }, { at: later }).at).toBe(later);
    const bare = Object.assign(Object.create(null) as Record<string, number>, { a: 1 });
    const bareToo = Object.assign(Object.create(null) as Record<string, number>, { a: 1 });
    expect(keepEqual(bare, bareToo)).toBe(bareToo);
    class Box {
      constructor(readonly n: number) {}
    }
    const box = new Box(1);
    expect(keepEqual(new Box(1), box)).toBe(box);
  });

  it('never gives a copy another prototype through a __proto__ key', () => {
    const prev = JSON.parse('{"__proto__": {"x": 1}, "a": {"b": 1}}') as Record<string, unknown>;
    const next = JSON.parse('{"__proto__": {"x": 1}, "a": {"b": 1}}') as Record<string, unknown>;
    const kept = keepEqual(prev, next);
    expect(kept).toBe(next);
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
  });
});

describe('a query that keeps equal answers', () => {
  it('keeps the stored copy on screen when the refreshed answer equals it', async () => {
    const store = memoryCacheStore();
    await store.write('k', { value: copy(ROW), storedAt: 0, ...POLICY });
    let time = 1500;
    const cache = createQueryCache({ store, now: () => time });
    const fetch = vi.fn(() => Promise.resolve({ value: copy(ROW), hints: {} }));
    const query = cache.query('k', { fetch, policy: POLICY, persist: true, keepEqual: true });
    const listener = vi.fn();
    query.subscribe(listener);

    query.load();
    await flush();
    const shown = query.get();
    expect(shown).toMatchObject({ status: 'success', stale: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    const data = shown.data!;
    expect(data).toEqual(ROW);
    // Still saved, with the time of this answer.
    expect((await store.read('k'))?.storedAt).toBe(1500);

    // Past fresh again in the same session: nothing is told and nothing changes.
    time = 3000;
    query.load();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(query.get()).toBe(shown);
    expect((await store.read('k'))?.storedAt).toBe(3000);
  });

  it('gives a changed answer, keeping the items that did not change', async () => {
    let time = 0;
    const cache = createQueryCache({ now: () => time });
    let answer = copy(ROW);
    const query = cache.query('k', {
      fetch: () => Promise.resolve({ value: answer, hints: {} }),
      policy: POLICY,
      persist: false,
      keepEqual: true,
    });
    query.load();
    await flush();
    const first = query.get().data!;

    answer = copy(ROW);
    answer[2]!.name = 'Three, renamed';
    time = 1500;
    query.load();
    await flush();
    const second = query.get();
    expect(second).toMatchObject({ status: 'success', stale: false });
    expect(second.data).toEqual(answer);
    expect(second.data).not.toBe(first);
    expect(second.data![0]).toBe(first[0]);
    expect(second.data![2]).not.toBe(first[2]);
  });

  it('is off unless asked for: every answer is new data, as before', async () => {
    let time = 0;
    const cache = createQueryCache({ now: () => time });
    const query = cache.query('k', {
      fetch: () => Promise.resolve({ value: copy(ROW), hints: {} }),
      policy: POLICY,
      persist: false,
    });
    const listener = vi.fn();
    query.subscribe(listener);
    query.load();
    await flush();
    const first = query.get().data;
    time = 1500;
    query.load();
    await flush();
    expect(query.get().data).toEqual(first);
    expect(query.get().data).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('tells subscribers when Try again brings the same answer after an error', async () => {
    const store = memoryCacheStore();
    await store.write('k', { value: copy(ROW), storedAt: 0, ...POLICY });
    const cache = createQueryCache({ store, now: () => 1500 });
    const fetch = vi
      .fn<() => Promise<QueryResult<typeof ROW>>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ value: copy(ROW), hints: {} });
    const query = cache.query('k', { fetch, policy: POLICY, persist: true, keepEqual: true });
    query.load();
    await flush();
    const failed = query.get();
    expect(failed).toMatchObject({ status: 'success', stale: true, error: { message: 'down' } });
    query.retry();
    await flush();
    expect(query.get()).toEqual({ status: 'success', data: failed.data, stale: false });
    expect(query.get().data).toBe(failed.data);
  });
});

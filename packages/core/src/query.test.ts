import { describe, expect, it, vi } from 'vitest';
import { type CachePolicy, createQueryCache, policyFromHints, type QueryResult } from './query';
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

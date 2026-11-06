import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const switches = vi.hoisted(() => ({ idbPrune: 'open' as 'open' | 'later' }));
const launched = vi.hoisted(() => [] as Array<() => void>);
vi.mock('./tuning', () => ({ tuning: switches }));
vi.mock('./marks', () => ({ bootMark: () => undefined }));
vi.mock('./launch', () => ({ afterLaunch: (run: () => void) => launched.push(run) }));

/** Each transaction asked of the database, with exactly the arguments it was asked with. */
let transactions: unknown[][];
/** How many records the fake cache store counts. */
let cached: number;

/** A request that succeeds a moment later, as IndexedDB's do. */
function request<T>(result: T) {
  const pending: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
  setTimeout(() => {
    pending.result = result;
    pending.onsuccess?.();
  }, 0);
  return pending;
}

const store = {
  get: () => request(undefined),
  put: () => request(undefined),
  delete: () => request(undefined),
  count: () => request(cached),
  index: () => ({ openKeyCursor: () => request(null) }),
};

const database = {
  objectStoreNames: { contains: () => true },
  transaction: (...args: unknown[]) => {
    transactions.push(args);
    return { objectStore: () => store };
  },
};

/** Lets the fake database's requests, and what waits on them, run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function open() {
  vi.resetModules();
  const { createStorage } = await import('./idb');
  return createStorage();
}

const record = { value: [], storedAt: 1, freshFor: 1, revalidateFor: 1, errorFor: 1 };

beforeEach(() => {
  transactions = [];
  cached = 0;
  launched.length = 0;
  vi.stubGlobal('indexedDB', { open: () => request(database) });
});

afterEach(() => {
  switches.idbPrune = 'open';
  vi.unstubAllGlobals();
});

describe('the cache trim at launch', () => {
  it('counts the cache as the database opens, ahead of the first reads, by default', async () => {
    const storage = await open();
    void storage.kv.get('addons');
    void storage.cache.read('catalog');
    await settle();
    expect(transactions).toEqual([
      ['cache', 'readwrite'],
      ['kv', 'readonly'],
      ['cache', 'readonly'],
    ]);
    expect(launched).toEqual([]);
  });

  it('with idbPrune later, waits for the launch to settle and lets the reads go first', async () => {
    switches.idbPrune = 'later';
    const storage = await open();
    void storage.kv.get('addons');
    void storage.cache.read('catalog');
    await settle();
    expect(transactions).toEqual([
      ['kv', 'readonly'],
      ['cache', 'readonly'],
    ]);
    expect(launched).toHaveLength(1);
    launched[0]!();
    await settle();
    expect(transactions[2]).toEqual(['cache', 'readwrite']);
  });

  it('trims every 50 writes either way', async () => {
    switches.idbPrune = 'later';
    const storage = await open();
    await settle();
    for (let i = 0; i < 50; i++) await storage.cache.write(`catalog-${i}`, record);
    const writing = transactions.filter(([name, mode]) => name === 'cache' && mode === 'readwrite');
    // 50 puts, and the trim after the 50th.
    expect(writing).toHaveLength(51);
  });
});

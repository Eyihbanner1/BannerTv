import { describe, expect, it } from 'vitest';
import { HttpError } from '../../http';
import { createQueryCache } from '../../query';
import {
  memoryCacheStore,
  memoryKeyValueStore,
  type CacheRecord,
  type CacheStore,
} from '../../storage';
import {
  createSubdlClient,
  SUBDL_ANSWER_MS,
  SUBDL_FAILURE_MEMORY_MS,
  SUBDL_SEARCH_MS,
  type SubdlHttp,
  type SubdlSearchState,
} from './client';
import { FAKE_SUBDL_KEY, filmAnswer } from './fixtures';
import type { SubdlKeyRecord } from './key';
import { createSubdlUsage, type SubdlUsage } from './usage';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

interface Answer {
  status: number;
  body: unknown;
}

function setup(
  options: {
    record?: SubdlKeyRecord | null;
    kids?: boolean;
    answer?: (url: string) => Answer | Promise<Answer>;
    store?: CacheStore;
    kv?: ReturnType<typeof memoryKeyValueStore>;
    usage?: SubdlUsage;
    now?: () => number;
  } = {},
) {
  const requests: Array<{ url: string; headers: Record<string, string>; timeoutMs: number }> = [];
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  // As the app's requestJson: no answer within timeoutMs of the request is a timeout.
  const http: SubdlHttp = (url, init) => {
    requests.push({ url, ...init });
    const answer = Promise.resolve(
      options.answer ? options.answer(url) : { status: 200, body: filmAnswer() },
    );
    const late = new Promise<never>((_, reject) => {
      timers.push({
        at: clock + init.timeoutMs,
        fn: () => reject(new HttpError('timeout', 'No answer')),
        done: false,
      });
    });
    return Promise.race([answer, late]);
  };
  let record: SubdlKeyRecord | null =
    options.record === undefined ? { key: FAKE_SUBDL_KEY, state: 'works' } : options.record;
  const states: string[] = [];
  const marks: Array<[string, string]> = [];
  const store = options.store ?? memoryCacheStore();
  const kv = options.kv ?? memoryKeyValueStore();
  const now = options.now ?? Date.now;
  const usage = options.usage ?? createSubdlUsage({ storage: kv, now });
  const runs: Array<[string, string]> = [];
  const client = createSubdlClient({
    http,
    queries: createQueryCache({ store, now }),
    usage,
    key: () => record,
    setKeyState: (refusedKey, state) => {
      states.push(state);
      marks.push([refusedKey, state]);
      // As the apps do: only the key SubDL said it of.
      if (record && record.key === refusedKey) record = { ...record, state };
    },
    kidsOnly: () => options.kids === true,
    run: (type, videoId, task) => {
      runs.push([type, videoId]);
      return task();
    },
    elapsed: () => clock,
    setTimer: (fn, ms) => {
      const timer = { at: clock + ms, fn, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { done: boolean }).done = true;
    },
  });
  return {
    client,
    requests,
    states,
    store,
    kv,
    usage,
    runs,
    marks,
    record: () => record,
    setRecord(next: SubdlKeyRecord | null) {
      record = next;
    },
    pass(ms: number) {
      clock += ms;
      for (const timer of timers) {
        if (!timer.done && timer.at <= clock) {
          timer.done = true;
          timer.fn();
        }
      }
    },
  };
}

async function settle(search: {
  get(): SubdlSearchState;
  load(): void;
}): Promise<SubdlSearchState> {
  search.load();
  await flush();
  return search.get();
}

const filmFiles = (state: SubdlSearchState) =>
  'files' in state && state.files ? state.files.map((file) => file.id) : undefined;

describe('createSubdlClient', () => {
  it('is off, with no request, for kids, no key, a refused key and what it cannot ask', async () => {
    const cases: Array<[Parameters<typeof setup>[0], string, string, string[], string]> = [
      [{ kids: true, record: null }, 'movie', 'tt9900001', ['en'], 'kids'],
      [{ record: null }, 'movie', 'tt9900001', ['en'], 'no key'],
      [
        { record: { key: FAKE_SUBDL_KEY, state: 'refused' } },
        'movie',
        'kitsu:1',
        ['en'],
        'key refused',
      ],
      [{}, 'movie', 'kitsu:1', ['en'], 'not imdb'],
      [{}, 'series', 'tt9900002:0:1', ['en'], 'special'],
      [{}, 'movie', 'tt9900001', [], 'subtitles off'],
    ];
    for (const [options, type, id, wanted, why] of cases) {
      const { client, requests } = setup(options);
      const search = client.search(type, id, wanted);
      expect(await settle(search)).toEqual({ status: 'off', why });
      expect(requests).toHaveLength(0);
    }
  });

  it('asks once per ask, and a second search uses the answer kept', async () => {
    const { client, requests, runs, pass } = setup();
    const first = client.search('movie', 'tt9900001', ['en']);
    expect(first.languages).toEqual(['EN']);
    expect(first.get()).toEqual({ status: 'asking' });
    first.load();
    pass(600);
    await flush();
    expect(first.get()).toMatchObject({ status: 'answered', saved: false, ms: 600 });
    expect(filmFiles(first.get())).toEqual(['9000001-9100001']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers).toEqual({ 'X-API-Key': FAKE_SUBDL_KEY });
    expect(requests[0]!.timeoutMs).toBe(SUBDL_ANSWER_MS);
    expect(runs).toEqual([['movie', 'tt9900001']]);
    const second = client.search('movie', 'tt9900001', ['eng']);
    expect(await settle(second)).toMatchObject({ status: 'answered', saved: true });
    expect(requests).toHaveLength(1);
  });

  it('serves a fresh saved answer after a launch with no request', async () => {
    const store = memoryCacheStore();
    const kv = memoryKeyValueStore();
    const one = setup({ store, kv });
    await settle(one.client.search('movie', 'tt9900001', ['en']));
    const two = setup({ store, kv });
    const state = await settle(two.client.search('movie', 'tt9900001', ['en']));
    expect(state).toMatchObject({ status: 'answered', saved: true });
    expect(two.requests).toHaveLength(0);
  });

  it('keeps the key out of everything it stores', async () => {
    const records = new Map<string, CacheRecord>();
    const store: CacheStore = {
      read: (key) => Promise.resolve(records.get(key)),
      write: (key, record) => {
        records.set(key, record);
        return Promise.resolve();
      },
    };
    const kv = memoryKeyValueStore();
    const { client, usage } = setup({ store, kv });
    await settle(client.search('movie', 'tt9900001', ['en']));
    usage.rest('busy');
    await flush();
    expect(records.size).toBe(1);
    const saved =
      JSON.stringify([...records]) +
      JSON.stringify([await kv.get('subdl/usage'), await kv.get('subdl/rest')]);
    expect(saved).toContain('9000001-9100001');
    expect(saved).not.toContain(FAKE_SUBDL_KEY);
  });

  it('gives up after 8 s, and an answer after that fills the cache but leaves the play as it was', async () => {
    let answer: ((value: Answer) => void) | undefined;
    const { client, pass, requests } = setup({
      answer: () =>
        new Promise<Answer>((resolve) => {
          answer = resolve;
        }),
    });
    const search = client.search('movie', 'tt9900001', ['en']);
    let told = 0;
    search.subscribe(() => told++);
    search.load();
    await flush();
    pass(SUBDL_SEARCH_MS - 1);
    expect(search.get()).toEqual({ status: 'asking' });
    pass(1);
    expect(search.get()).toEqual({ status: 'failed', why: 'timeout', ms: SUBDL_SEARCH_MS });
    const toldThen = told;
    answer!({ status: 200, body: filmAnswer() });
    await flush();
    expect(search.get()).toEqual({ status: 'failed', why: 'timeout', ms: SUBDL_SEARCH_MS });
    expect(told).toBe(toldThen);
    const later = client.search('movie', 'tt9900001', ['en']);
    expect(await settle(later)).toMatchObject({ status: 'answered', saved: true });
    expect(requests).toHaveLength(1);
  });

  it('saves an answer that comes after the play gave up, and counts no failure for it', async () => {
    const answers: Array<(value: Answer) => void> = [];
    const { client, pass, requests, usage } = setup({
      answer: () =>
        new Promise<Answer>((resolve) => {
          answers.push(resolve);
        }),
    });
    // Three plays in a row on a link where SubDL takes 9 s to answer.
    for (const id of ['tt9900001', 'tt9900002', 'tt9900003']) {
      const search = client.search('movie', id, ['en']);
      search.load();
      await flush();
      pass(SUBDL_SEARCH_MS);
      expect(search.get()).toMatchObject({ status: 'failed', why: 'timeout' });
      pass(1000);
      answers[answers.length - 1]!({ status: 200, body: filmAnswer() });
      await flush();
    }
    expect(usage.resting()).toBeNull();
    for (const id of ['tt9900001', 'tt9900002', 'tt9900003']) {
      expect(await settle(client.search('movie', id, ['en']))).toMatchObject({
        status: 'answered',
        saved: true,
      });
    }
    expect(requests).toHaveLength(3);
  });

  it('gives the request up once it has had no answer for 30 s, as a timeout', async () => {
    const { client, pass, requests } = setup({
      answer: () => new Promise<Answer>(() => undefined),
    });
    const search = client.search('movie', 'tt9900001', ['en']);
    search.load();
    await flush();
    pass(SUBDL_ANSWER_MS);
    await flush();
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'timeout',
    });
    expect(requests).toHaveLength(1);
  });

  it('marks a refused key, which then asks nothing', async () => {
    const { client, states, requests } = setup({
      answer: () => ({ status: 403, body: { status: false, error: 'not_authorized' } }),
    });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'refused',
    });
    expect(states).toEqual(['refused']);
    expect(await settle(client.search('movie', 'tt9900002', ['en']))).toEqual({
      status: 'off',
      why: 'key refused',
    });
    expect(requests).toHaveLength(1);
  });

  it('checks a refused key again once a launch, and searches with it once SubDL takes it', async () => {
    let works = false;
    const { client, requests, marks, record, pass } = setup({
      record: { key: FAKE_SUBDL_KEY, state: 'refused' },
      answer: (url) =>
        url.endsWith('/api/v2/me')
          ? works
            ? { status: 200, body: { ok: true } }
            : { status: 401, body: undefined }
          : { status: 200, body: filmAnswer() },
    });
    // Still refused: the play goes on without SubDL, and one check that counts no search is sent.
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toEqual({
      status: 'off',
      why: 'key refused',
    });
    expect(requests.map((request) => request.url)).toEqual(['https://api.subdl.com/api/v2/me']);
    expect(requests[0]!.headers).toEqual({ 'X-API-Key': FAKE_SUBDL_KEY });
    expect(record()?.state).toBe('refused');
    // Not again in the same launch, until a day has passed.
    await settle(client.search('movie', 'tt9900002', ['en']));
    expect(requests).toHaveLength(1);
    works = true;
    pass(24 * 60 * 60 * 1000);
    expect(await settle(client.search('movie', 'tt9900002', ['en']))).toEqual({
      status: 'off',
      why: 'key refused',
    });
    expect(requests).toHaveLength(2);
    expect(marks).toEqual([[FAKE_SUBDL_KEY, 'works']]);
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'answered',
      saved: false,
    });
    expect(requests).toHaveLength(3);
  });

  it('asks again, with the key saved since, a title the old key was refused for', async () => {
    let status = 401;
    const { client, requests, setRecord } = setup({
      record: { key: FAKE_SUBDL_KEY, state: 'unchecked' },
      answer: () => ({ status, body: status === 200 ? filmAnswer() : undefined }),
    });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'refused',
    });
    setRecord({ key: 'FAKE-SUBDL-KEY-0002', state: 'works' });
    status = 200;
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'answered',
      saved: false,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers).toMatchObject({ 'X-API-Key': 'FAKE-SUBDL-KEY-0002' });
  });

  it('marks refused only the key it was asked with, not one saved meanwhile', async () => {
    let answer: (value: Answer) => void = () => undefined;
    const { client, setRecord, record, marks } = setup({
      record: { key: FAKE_SUBDL_KEY, state: 'unchecked' },
      answer: () =>
        new Promise<Answer>((resolve) => {
          answer = resolve;
        }),
    });
    const search = client.search('movie', 'tt9900001', ['en']);
    search.load();
    await flush();
    setRecord({ key: 'FAKE-SUBDL-KEY-0002', state: 'unchecked' });
    answer({ status: 401, body: undefined });
    await flush();
    expect(search.get()).toMatchObject({ status: 'failed', why: 'refused' });
    expect(marks).toEqual([[FAKE_SUBDL_KEY, 'refused']]);
    expect(record()).toEqual({ key: 'FAKE-SUBDL-KEY-0002', state: 'unchecked' });
  });

  it('rests on a slow-down and on a daily limit', async () => {
    const busy = setup({
      answer: () => ({ status: 429, body: { error: { code: 'rate_limit' } } }),
    });
    expect(await settle(busy.client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'busy',
    });
    expect(busy.usage.resting()?.why).toBe('busy');
    expect(await settle(busy.client.search('movie', 'tt9900003', ['en']))).toEqual({
      status: 'off',
      why: 'resting',
    });
    expect(busy.requests).toHaveLength(1);
    const limit = setup({ answer: () => ({ status: 429, body: { error: 'daily_limit' } }) });
    await settle(limit.client.search('movie', 'tt9900001', ['en']));
    expect(limit.usage.resting(FAKE_SUBDL_KEY)?.why).toBe('limit');
    expect(await settle(limit.client.search('movie', 'tt9900003', ['en']))).toEqual({
      status: 'off',
      why: 'daily limit',
    });
  });

  it('rests only the key that reached its daily limit, not another saved since', async () => {
    const { client, requests, setRecord, usage, kv } = setup({
      answer: () =>
        requests[requests.length - 1]!.headers['X-API-Key'] === FAKE_SUBDL_KEY
          ? { status: 402, body: { error: 'daily_limit' } }
          : { status: 200, body: filmAnswer() },
    });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'limit',
    });
    expect(await settle(client.search('movie', 'tt9900003', ['en']))).toEqual({
      status: 'off',
      why: 'daily limit',
    });
    expect(requests).toHaveLength(1);
    // Another profile's key, or a new key saved: its own searches are left.
    setRecord({ key: 'FAKE-SUBDL-KEY-0002', state: 'works' });
    expect(await settle(client.search('movie', 'tt9900003', ['en']))).toMatchObject({
      status: 'answered',
      saved: false,
    });
    expect(requests).toHaveLength(2);
    expect(usage.resting()).toBeNull();
    expect(usage.resting(FAKE_SUBDL_KEY)?.why).toBe('limit');
    expect(JSON.stringify(await kv.get('subdl/limit'))).not.toContain(FAKE_SUBDL_KEY);
  });

  it('serves an older copy while resting, with no request', async () => {
    const store = memoryCacheStore();
    const kv = memoryKeyValueStore();
    let now = Date.UTC(2026, 10, 16, 12);
    const one = setup({ store, kv, now: () => now });
    await settle(one.client.search('movie', 'tt9900001', ['en']));
    now += 25 * 60 * 60 * 1000;
    const two = setup({ store, kv, now: () => now });
    two.usage.rest('busy');
    const state = await settle(two.client.search('movie', 'tt9900001', ['en']));
    expect(state).toMatchObject({ status: 'off', why: 'resting' });
    expect(filmFiles(state)).toEqual(['9000001-9100001']);
    expect(two.requests).toHaveLength(0);
  });

  it('does not ask again for 10 minutes an ask that failed this session', async () => {
    let status = 500;
    const { client, requests, pass } = setup({
      answer: () => ({ status, body: status === 200 ? filmAnswer() : {} }),
    });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'server',
    });
    status = 200;
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'server',
    });
    expect(requests).toHaveLength(1);
    pass(SUBDL_FAILURE_MEMORY_MS);
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'answered',
      saved: false,
    });
    expect(requests).toHaveLength(2);
  });

  it('tells a timeout and a network failure apart, and rests after three in a row', async () => {
    let kind: 'timeout' | 'network' = 'timeout';
    const { client, usage } = setup({
      answer: () => Promise.reject(new HttpError(kind, 'No answer')),
    });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toMatchObject({
      status: 'failed',
      why: 'timeout',
    });
    kind = 'network';
    expect(await settle(client.search('movie', 'tt9900002', ['en']))).toMatchObject({
      status: 'failed',
      why: 'network',
    });
    expect(usage.resting()).toBeNull();
    await settle(client.search('movie', 'tt9900003', ['en']));
    expect(usage.resting()?.why).toBe('failing');
  });

  it('says the daily limit is reached once the searches are used up', async () => {
    const kv = memoryKeyValueStore();
    const base = createSubdlUsage({ storage: kv });
    const usage: SubdlUsage = { ...base, takeSearch: () => false };
    const { client, requests } = setup({ usage });
    expect(await settle(client.search('movie', 'tt9900001', ['en']))).toEqual({
      status: 'off',
      why: 'daily limit',
    });
    expect(requests).toHaveLength(0);
  });

  it('stops following the query once stopped', async () => {
    const { client } = setup();
    const search = client.search('movie', 'tt9900001', ['en']);
    let told = 0;
    search.subscribe(() => told++);
    search.load();
    search.stop();
    await flush();
    expect(search.get()).toEqual({ status: 'asking' });
    expect(told).toBe(0);
  });

  it('checks a key with one request that counts no search', async () => {
    const outcome = async (answer: () => Answer | Promise<Answer>) => {
      const kv = memoryKeyValueStore();
      const { client, requests } = setup({ answer, kv });
      const result = await client.checkKey(FAKE_SUBDL_KEY);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe('https://api.subdl.com/api/v2/me');
      expect(await kv.get('subdl/usage')).toBeUndefined();
      return result;
    };
    expect(await outcome(() => ({ status: 200, body: { ok: true } }))).toBe('works');
    expect(await outcome(() => ({ status: 401, body: undefined }))).toBe('refused');
    expect(await outcome(() => ({ status: 403, body: { error: 'not_authorized' } }))).toBe(
      'refused',
    );
    expect(await outcome(() => ({ status: 403, body: undefined }))).toBe('unreachable');
    expect(await outcome(() => ({ status: 500, body: {} }))).toBe('unreachable');
    expect(await outcome(() => Promise.reject(new HttpError('network', 'x')))).toBe('unreachable');
  });
});

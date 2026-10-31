import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  base64Url,
  MAX_ACCOUNT_CHARS,
  MAX_BODY_CHARS,
  MAX_DOCS,
  MAX_PUTS,
  MAX_WANT,
  MAX_WRITES_PER_DAY,
  utcDay,
} from './rules';
import { type TestD1, testD1 } from './test/d1';
import worker, { type Env } from './worker';

const ORIGIN = 'https://sync.example.workers.dev';
const START = Date.parse('2026-10-31T12:00:00Z');
const TODAY = utcDay(START);
const LOGS = ['log', 'info', 'warn', 'error', 'debug'] as const;
/** What every error answer is: the problem and the time, and nothing that was sent. */
const ERROR = /^\{"error":"[a-z-]+","now":\d+(,"retryAfter":\d+)?\}$/;

const random = (bytes: number) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
/** An account id, a document name or an epoch, as the screens make them. */
const newId = () => random(16);

/**
 * A body in the form the screens seal: "1.", a 12-byte IV and the ciphertext,
 * `size` characters in all. The server cannot tell it from a real one.
 */
function sealed(size = 100): string {
  // A random start keeps bodies apart; the rest only has to make up the length.
  const start = `1.${random(12)}.${random(24)}`;
  return start + 'A'.repeat(size - start.length);
}

async function sha256(text: string): Promise<string> {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  );
}

interface Doc {
  ver: number;
  at: number;
  body: string;
}

interface PullAnswer {
  now: number;
  epoch: string;
  vers: Record<string, number>;
  docs: Record<string, Doc>;
  more: boolean;
}

interface PushAnswer {
  now: number;
  epoch: string;
  done: Array<{ name: string; ver: number; at: number }>;
  conflicts: string[];
  full: string[];
}

interface Put {
  name: string;
  base: number;
  body: string;
}

/** A screen's hold on an account: what it derived from the code, and the epoch it was given. */
interface Screen {
  account: string;
  auth: string;
  epoch: string;
}

let d1: TestD1;
let env: Env;

/**
 * One request to the Worker, with the checks every answer must pass: open to
 * any origin, never sniffed or cached, JSON with the server's time, an error
 * that repeats nothing that was sent, and never the auth key or the setup key.
 */
async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  sent?: unknown,
  using: Env = env,
) {
  const text = sent === undefined || typeof sent === 'string' ? sent : JSON.stringify(sent);
  const request = new Request(ORIGIN + path, {
    method,
    body: text,
    headers: text === undefined ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
  const response = await worker.fetch(request, using);
  const answer = await response.text();
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  if (response.status !== 204) {
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect((JSON.parse(answer) as { now: unknown }).now).toBe(Date.now());
  }
  if (response.status >= 400) expect(answer).toMatch(ERROR);
  for (const secret of [using.CREATE_KEY, (sent as { auth?: unknown } | undefined)?.auth]) {
    if (typeof secret === 'string' && secret.trim() !== '') expect(answer).not.toContain(secret);
  }
  return {
    status: response.status,
    headers: response.headers,
    text: answer,
    body: (answer === '' ? undefined : JSON.parse(answer)) as T,
  };
}

async function create(screen: { account: string; auth: string; key?: unknown }, using: Env = env) {
  return call<{ now: number; epoch: string }>('POST', '/v1/account/create', screen, using);
}

/** A new account, made as a screen makes one. */
async function newAccount(using: Env = env): Promise<Screen> {
  const keys = { account: newId(), auth: random(32) };
  const answer = await create(keys, using);
  expect(answer.status).toBe(201);
  return { ...keys, epoch: answer.body.epoch };
}

const pull = (screen: Screen, want: string[], have: Record<string, number> = {}) =>
  call<PullAnswer>('POST', '/v1/pull', { ...screen, have, want });

const push = (screen: Screen, put: Put[], using: Env = env) =>
  call<PushAnswer>('POST', '/v1/push', { ...screen, put }, using);

const remove = (screen: { account: string; auth: string }) =>
  call('POST', '/v1/account/delete', { account: screen.account, auth: screen.auth });

/** New documents, `size` characters each. */
const fresh = (count: number, size = 100): Put[] =>
  Array.from({ length: count }, () => ({ name: newId(), base: 0, body: sealed(size) }));

function rows<T>(sql: string, ...values: Array<string | number>): T[] {
  return d1.sqlite.prepare(sql).all(...values) as unknown as T[];
}

/** The calls to D1 that wrote anything, each with all its statements. */
const writes = () => d1.calls.filter((call) => call.some((sql) => !/^\s*SELECT\b/i.test(sql)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: START });
  for (const name of LOGS) vi.spyOn(console, name);
  d1 = testD1();
  env = { DB: d1, MAX_ACCOUNTS: '1', PULL_MINUTES: '30' };
});

afterEach(() => {
  // Requests carry auth keys and sealed bodies, so the Worker writes nothing to the log.
  for (const name of LOGS) expect(console[name]).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('status', () => {
  it('names the protocol and the time, and says whether an account can be made', async () => {
    const open = await call('GET', '/v1/status');
    expect(open.status).toBe(200);
    expect(open.body).toEqual({
      ok: true,
      v: 1,
      now: START,
      create: true,
      key: false,
      pullMinutes: 30,
    });

    await newAccount();
    expect((await call('GET', '/v1/status')).body).toMatchObject({ create: false });
  });

  it('is closed when MAX_ACCOUNTS is 0 or missing, without asking D1', async () => {
    for (const closed of [{ DB: d1, MAX_ACCOUNTS: '0' }, { DB: d1 }]) {
      expect((await call('GET', '/v1/status', undefined, closed)).body).toMatchObject({
        create: false,
      });
    }
    expect(d1.calls).toEqual([]);
  });

  it('says how often screens should pull', async () => {
    for (const [value, minutes] of [
      ['30', 30],
      ['90', 90],
      [undefined, 30],
      ['soon', 30],
      ['1', 15],
      ['100000', 24 * 60],
      [60, 60],
    ] as const) {
      const answer = await call('GET', '/v1/status', undefined, { ...env, PULL_MINUTES: value });
      expect(answer.body.pullMinutes, String(value)).toBe(minutes);
    }
  });

  it('reads settings written without quotes, which TOML gives as numbers', async () => {
    const unquoted = { DB: d1, MAX_ACCOUNTS: 2, PULL_MINUTES: 60 };
    expect((await call('GET', '/v1/status', undefined, unquoted)).body).toMatchObject({
      create: true,
      pullMinutes: 60,
    });
    expect((await create({ account: newId(), auth: random(32) }, unquoted)).status).toBe(201);
    expect((await create({ account: newId(), auth: random(32) }, unquoted)).status).toBe(201);
    expect((await create({ account: newId(), auth: random(32) }, unquoted)).status).toBe(403);
  });
});

describe('create', () => {
  it('makes an account with a new epoch, and keeps only a hash of the auth key', async () => {
    const screen = await newAccount();
    expect(screen.epoch).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(rows('SELECT * FROM accounts')).toEqual([
      {
        id: screen.account,
        auth: await sha256(screen.auth),
        epoch: screen.epoch,
        created: TODAY,
        seen: TODAY,
        day: TODAY,
        writes: 0,
      },
    ]);
  });

  it('answers a create that resumed with the same epoch, and anyone else with exists', async () => {
    const screen = await newAccount();
    const resumed = await create(screen);
    expect(resumed.status).toBe(200);
    expect(resumed.body).toEqual({ now: START, epoch: screen.epoch });

    const other = await create({ account: screen.account, auth: random(32) });
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: 'exists', now: START });
  });

  it('is closed once MAX_ACCOUNTS accounts exist, and open again after a delete', async () => {
    const first = await newAccount();
    const second = { account: newId(), auth: random(32) };
    const closed = await create(second);
    expect(closed.status).toBe(403);
    expect(closed.body).toEqual({ error: 'closed', now: START });
    // The account that holds the place can still resume its create.
    expect((await create(first)).status).toBe(200);

    expect((await remove(first)).status).toBe(200);
    expect((await create(second)).status).toBe(201);

    const two = { ...env, MAX_ACCOUNTS: '2' };
    expect((await create(first, two)).status).toBe(201);
    expect((await create({ account: newId(), auth: random(32) }, two)).status).toBe(403);
    expect((await create({ account: newId(), auth: random(32) }, { DB: d1 })).status).toBe(403);
  });

  it('gives an account deleted and made again a new epoch, which old screens see', async () => {
    const before = await newAccount();
    await push(before, fresh(1));
    await remove(before);
    const again = await create(before);
    expect(again.status).toBe(201);
    expect(again.body.epoch).not.toBe(before.epoch);

    const stale = await pull(before, []);
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: 'epoch', now: START });
    expect((await push(before, fresh(1))).status).toBe(409);
    const current = await pull({ ...before, epoch: again.body.epoch }, []);
    expect(current.body.vers).toEqual({});
  });
});

describe('setup key', () => {
  const KEY = 'k3yOnTheTV42';
  let keyed: Env;
  beforeEach(() => {
    keyed = { ...env, CREATE_KEY: KEY };
  });
  const keys = () => ({ account: newId(), auth: random(32) });

  it('says in the status whether a create needs it', async () => {
    expect((await call('GET', '/v1/status', undefined, keyed)).body).toMatchObject({
      create: true,
      key: true,
    });
    expect((await call('GET', '/v1/status', undefined, env)).body).toMatchObject({ key: false });
    // Set to something that is no key, it is needed all the same, and nobody has it.
    for (const unusable of ['', '  ', true, {}, 7.5]) {
      const answer = await call('GET', '/v1/status', undefined, { ...env, CREATE_KEY: unusable });
      expect(answer.body, String(unusable)).toMatchObject({ key: true });
    }
  });

  it('refuses a create without it, or with another, before asking D1', async () => {
    for (const key of [undefined, '', 'k3yOnTheTV4', `${KEY}2`, 'K3YONTHETV42', 42, [KEY]]) {
      const answer = await create({ ...keys(), key }, keyed);
      expect(answer.status, JSON.stringify(key)).toBe(403);
      expect(answer.body).toEqual({ error: 'key', now: START });
    }
    expect(d1.calls).toEqual([]);
    expect((await call('GET', '/v1/status', undefined, keyed)).body).toMatchObject({
      create: true,
    });
  });

  it('lets whoever holds it take the place, and resume a lost create', async () => {
    const owner = keys();
    const made = await create({ ...owner, key: KEY }, keyed);
    expect(made.status).toBe(201);
    // Spaces at either end, as a keyboard can add, do not matter.
    const resumed = await create({ ...owner, key: ` ${KEY} ` }, keyed);
    expect(resumed.status).toBe(200);
    expect(resumed.body).toEqual({ now: START, epoch: made.body.epoch });

    // The key comes first: without it nobody learns whether the place is taken.
    expect((await create(owner, keyed)).body).toEqual({ error: 'key', now: START });
    expect((await create(keys(), keyed)).body).toEqual({ error: 'key', now: START });
    expect((await create({ ...keys(), key: KEY }, keyed)).body).toEqual({
      error: 'closed',
      now: START,
    });
    expect(rows('SELECT id FROM accounts')).toEqual([{ id: owner.account }]);
  });

  it('is not asked for when CREATE_KEY is not set', async () => {
    expect((await create({ ...keys(), key: 'anything' })).status).toBe(201);
  });

  it('refuses every create while CREATE_KEY is set to something that is no key', async () => {
    for (const unusable of ['', '  ', true, false, null, {}, { key: KEY }, [KEY], 7.5]) {
      const using = { ...env, CREATE_KEY: unusable };
      for (const key of [undefined, '', '  ', 'true', '[object Object]', KEY, '7.5', 0]) {
        const answer = await create({ ...keys(), key }, using);
        expect(answer.status, `${JSON.stringify(unusable)} ${JSON.stringify(key)}`).toBe(403);
        expect(answer.body).toEqual({ error: 'key', now: START });
      }
    }
    expect(d1.calls).toEqual([]);
  });

  it('takes a whole number, as TOML gives one without quotes, as its text', async () => {
    const using = { ...env, CREATE_KEY: 123456789012 };
    expect((await call('GET', '/v1/status', undefined, using)).body).toMatchObject({ key: true });
    expect((await create(keys(), using)).body).toEqual({ error: 'key', now: START });
    expect((await create({ ...keys(), key: 123456789012 }, using)).status).toBe(403);
    expect((await create({ ...keys(), key: '123456789012' }, using)).status).toBe(201);
  });
});

describe('sign-in', () => {
  it('gives an unknown account and a wrong auth key the same answer', async () => {
    const screen = await newAccount();
    const wrong = { ...screen, auth: random(32) };
    const unknown = { ...screen, account: newId() };
    for (const [path, extra] of [
      ['/v1/pull', { want: [] }],
      ['/v1/push', { put: fresh(1) }],
      ['/v1/account/delete', {}],
    ] as const) {
      const a = await call('POST', path, { ...wrong, ...extra });
      const b = await call('POST', path, { ...unknown, ...extra });
      expect(a.status, path).toBe(401);
      expect(b.text, path).toBe(a.text);
      expect(a.body).toEqual({ error: 'denied', now: START });
    }
    expect(rows('SELECT name FROM docs')).toEqual([]);
    expect(rows('SELECT id FROM accounts')).toHaveLength(1);
  });
});

describe('pull', () => {
  it('gives the wanted documents that changed, and the version of every document', async () => {
    const screen = await newAccount();
    const [a, b, c] = fresh(3) as [Put, Put, Put];
    await push(screen, [a, b, c]);

    const first = await pull(screen, [a.name, b.name]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      now: START,
      epoch: screen.epoch,
      vers: { [a.name]: 1, [b.name]: 1, [c.name]: 1 },
      docs: {
        [a.name]: { ver: 1, at: START, body: a.body },
        [b.name]: { ver: 1, at: START, body: b.body },
      },
      more: false,
    });

    expect(Object.keys((await pull(screen, [a.name, b.name], { [a.name]: 1 })).body.docs)).toEqual([
      b.name,
    ]);
    const unchanged = await pull(screen, [a.name, b.name, c.name], {
      [a.name]: 1,
      [b.name]: 1,
      [c.name]: 1,
    });
    expect(unchanged.body.docs).toEqual({});
    expect(unchanged.body.more).toBe(false);
    // A name the account does not hold is simply missing from the answer.
    const missing = newId();
    const none = await pull(screen, [missing]);
    expect(none.body.docs).toEqual({});
    expect(none.body.vers).not.toHaveProperty(missing);
  });

  it('works without an epoch, for a screen that has not learned it yet', async () => {
    const screen = await newAccount();
    const answer = await call<PullAnswer>('POST', '/v1/pull', {
      account: screen.account,
      auth: screen.auth,
      want: [],
    });
    expect(answer.status).toBe(200);
    expect(answer.body.epoch).toBe(screen.epoch);
  });

  it('leaves bodies past 1 MB for the next pull', async () => {
    const screen = await newAccount();
    const big = fresh(3, 450 * 1000) as [Put, Put, Put];
    expect((await push(screen, big.slice(0, 2))).status).toBe(200);
    expect((await push(screen, big.slice(2))).status).toBe(200);
    const names = big.map((put) => put.name);

    const first = await pull(screen, names);
    expect(Object.keys(first.body.docs)).toEqual(names.slice(0, 2));
    expect(first.body.more).toBe(true);
    const second = await pull(screen, names, { [names[0]!]: 1, [names[1]!]: 1 });
    expect(Object.keys(second.body.docs)).toEqual(names.slice(2));
    expect(second.body.docs[names[2]!]!.body).toBe(big[2].body);
    expect(second.body.more).toBe(false);
  });

  it('notes the day an account was last used, writing once a day at most', async () => {
    const screen = await newAccount();
    vi.setSystemTime(START + 2 * 24 * 60 * 60 * 1000);
    d1.calls.length = 0;
    await pull(screen, []);
    await pull(screen, []);
    expect(writes()).toHaveLength(1);
    expect(rows('SELECT created, seen FROM accounts')).toEqual([
      { created: TODAY, seen: TODAY + 2 },
    ]);
  });
});

describe('push', () => {
  it('adds new documents, then changes them from the version they started at', async () => {
    const screen = await newAccount();
    const [doc] = fresh(1) as [Put];
    const added = await push(screen, [doc]);
    expect(added.status).toBe(200);
    expect(added.body).toEqual({
      now: START,
      epoch: screen.epoch,
      done: [{ name: doc.name, ver: 1, at: START }],
      conflicts: [],
      full: [],
    });

    vi.setSystemTime(START + 5000);
    const body = sealed(300);
    const changed = await push(screen, [{ name: doc.name, base: 1, body }]);
    expect(changed.body.done).toEqual([{ name: doc.name, ver: 2, at: START + 5000 }]);
    expect((await pull(screen, [doc.name])).body.docs[doc.name]).toEqual({
      ver: 2,
      at: START + 5000,
      body,
    });
    // Stored exactly as sent, and nothing else of the request.
    expect(rows('SELECT * FROM docs')).toEqual([
      { account: screen.account, name: doc.name, ver: 2, at: START + 5000, body },
    ]);
  });

  it('commits or refuses each document on its own', async () => {
    const lg = await newAccount();
    const phone = { ...lg };
    const [a, b] = fresh(2) as [Put, Put];
    await push(lg, [a, b]);

    const lgBody = sealed();
    expect((await push(lg, [{ name: a.name, base: 1, body: lgBody }])).body.done).toHaveLength(1);

    // The phone still started from version 1 of `a`, and has a change to a
    // document the account does not hold.
    const [c] = fresh(1) as [Put];
    const unknown = newId();
    const answer = await push(phone, [
      { name: a.name, base: 1, body: sealed() },
      { name: b.name, base: 1, body: sealed() },
      c,
      { name: unknown, base: 3, body: sealed() },
    ]);
    expect(answer.status).toBe(200);
    expect(answer.body.done).toEqual([
      { name: b.name, ver: 2, at: START },
      { name: c.name, ver: 1, at: START },
    ]);
    expect(answer.body.conflicts).toEqual([a.name, unknown]);
    expect(answer.body.full).toEqual([]);
    expect(rows('SELECT body FROM docs WHERE name = ?', a.name)).toEqual([{ body: lgBody }]);
    expect(rows('SELECT name FROM docs')).toHaveLength(3);

    // Two screens adding the same new document: the second learns it exists.
    const twice = await push(phone, [{ name: c.name, base: 0, body: sealed() }]);
    expect(twice.body).toMatchObject({ done: [], conflicts: [c.name] });
  });

  it('writes the documents, the day’s count and the day seen in one batch', async () => {
    const screen = await newAccount();
    vi.setSystemTime(START + 24 * 60 * 60 * 1000);
    d1.calls.length = 0;
    const puts = fresh(3);
    await push(screen, puts);

    const batches = writes();
    expect(batches).toHaveLength(1);
    // The three documents, the day's count, then the versions they were left at.
    expect(batches[0]).toHaveLength(5);
    expect(batches[0]!.filter((sql) => /INSERT INTO docs/.test(sql))).toHaveLength(3);
    expect(batches[0]!.filter((sql) => /UPDATE accounts/.test(sql))).toHaveLength(1);
    expect(batches[0]![4]).toMatch(/^SELECT name, ver FROM docs/);
    // Nothing else is asked of D1: the limits are checked in the batch, not by a listing first.
    expect(d1.calls).toEqual([[expect.stringMatching(/^SELECT auth/)], batches[0]]);
    expect(rows('SELECT seen, day, writes FROM accounts')).toEqual([
      { seen: TODAY + 1, day: TODAY + 1, writes: 3 },
    ]);
    expect(rows('SELECT name FROM docs')).toHaveLength(3);
  });

  it('writes nothing for a push that crosses a delete and a new create, and says so', async () => {
    const screen = await newAccount();
    const [a, b] = fresh(2) as [Put, Put];
    await push(screen, [a]);
    const batch = d1.batch.bind(d1);
    // Between the push's sign-in and its batch, the account is made again under a new epoch.
    d1.batch = async (statements) => {
      d1.sqlite.prepare('UPDATE accounts SET epoch = ?').run(newId());
      return batch(statements);
    };
    const answer = await push(screen, [{ name: a.name, base: 1, body: sealed() }, b]);
    expect(answer.status).toBe(409);
    expect(answer.body).toEqual({ error: 'epoch', now: START });
    expect(rows('SELECT name, ver, body FROM docs')).toEqual([
      { name: a.name, ver: 1, body: a.body },
    ]);
    expect(rows('SELECT writes FROM accounts')).toEqual([{ writes: 1 }]);

    // And one that crosses a delete is told the account is gone.
    const { epoch } = rows<{ epoch: string }>('SELECT epoch FROM accounts')[0]!;
    d1.batch = async (statements) => {
      d1.sqlite.exec('DELETE FROM accounts');
      return batch(statements);
    };
    const gone = await push({ ...screen, epoch }, [b]);
    expect(gone.status).toBe(401);
    expect(gone.body).toEqual({ error: 'denied', now: START });
    expect(rows('SELECT name FROM docs')).toEqual([{ name: a.name }]);
  });

  it('refuses a push for another epoch, writing nothing', async () => {
    const screen = await newAccount();
    const answer = await push({ ...screen, epoch: newId() }, fresh(1));
    expect(answer.status).toBe(409);
    expect(answer.body).toEqual({ error: 'epoch', now: START });
    expect(rows('SELECT name FROM docs')).toEqual([]);
  });

  it('answers an empty push without writing', async () => {
    const screen = await newAccount();
    d1.calls.length = 0;
    expect((await push(screen, [])).body).toEqual({
      now: START,
      epoch: screen.epoch,
      done: [],
      conflicts: [],
      full: [],
    });
    expect(writes()).toEqual([]);
  });
});

describe('limits', () => {
  it('refuses a push of more than 12 documents, a body past 1,000,000 characters or 1.1 MB', async () => {
    const screen = await newAccount();
    const tooMany = await push(screen, fresh(MAX_PUTS + 1));
    expect(tooMany.status).toBe(413);
    expect(tooMany.body).toEqual({ error: 'too-big', now: START });
    expect((await push(screen, fresh(1, MAX_BODY_CHARS + 1))).status).toBe(413);
    expect((await push(screen, fresh(2, 600 * 1000))).status).toBe(413);
    expect(rows('SELECT name FROM docs')).toEqual([]);

    expect((await push(screen, fresh(MAX_PUTS))).status).toBe(200);
    expect((await push(screen, fresh(1, MAX_BODY_CHARS))).status).toBe(200);
  });

  it('refuses a pull of more than 64 names', async () => {
    const screen = await newAccount();
    const names = Array.from({ length: MAX_WANT + 1 }, newId);
    expect((await pull(screen, names)).status).toBe(413);
    expect((await pull(screen, names.slice(1))).status).toBe(200);
  });

  it('keeps an account within 120 documents, refusing only the new ones', async () => {
    const screen = await newAccount();
    const all: Put[] = [];
    while (all.length < MAX_DOCS) {
      const puts = fresh(MAX_PUTS);
      expect((await push(screen, puts)).body.done).toHaveLength(MAX_PUTS);
      all.push(...puts);
    }
    // A Continue Watching change and a new profile's first document, in one push: the
    // change commits, and the new document is listed as not fitting.
    const [extra] = fresh(1) as [Put];
    const watch = { name: all[5]!.name, base: 1, body: sealed(300) };
    const answer = await push(screen, [watch, extra]);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      now: START,
      epoch: screen.epoch,
      done: [{ name: watch.name, ver: 2, at: START }],
      conflicts: [],
      full: [extra.name],
    });
    expect(rows('SELECT ver FROM docs WHERE name = ?', watch.name)).toEqual([{ ver: 2 }]);
    expect(rows('SELECT name FROM docs WHERE name = ?', extra.name)).toEqual([]);

    // A conflict is still a conflict when the account is full, and not one that did not fit.
    const stale = await push(screen, [{ ...watch, body: sealed() }, extra]);
    expect(stale.body).toMatchObject({ done: [], conflicts: [watch.name], full: [extra.name] });
    // A new document that exists already is a conflict too.
    const twice = await push(screen, [{ ...all[0]!, base: 0 }]);
    expect(twice.body).toMatchObject({ conflicts: [all[0]!.name], full: [] });
  });

  it('keeps an account within 10,000,000 characters, counting only growth', async () => {
    const screen = await newAccount();
    // Ten documents 100 characters short of a tenth each.
    const size = MAX_ACCOUNT_CHARS / 10 - 10;
    const first = fresh(1, size)[0]!;
    await push(screen, [first]);
    for (let n = 1; n < 10; n++) expect((await push(screen, fresh(1, size))).status).toBe(200);
    let ver = 1;
    const change = async (body: string) => {
      const answer = await push(screen, [{ name: first.name, base: ver, body }]);
      if (answer.body.done.length === 1) ver += 1;
      return answer.body;
    };

    const over = fresh(1, 101);
    expect((await push(screen, over)).body).toMatchObject({ done: [], full: [over[0]!.name] });
    expect((await push(screen, fresh(1, 100))).body.done).toHaveLength(1);
    // The account is exactly full: a change that grows does not fit, one the same size does.
    expect(await change(sealed(size + 1))).toMatchObject({ done: [], full: [first.name] });
    expect((await change(sealed(size))).done).toHaveLength(1);
    // Making a document smaller makes room.
    expect((await change(sealed(size - 100))).done).toHaveLength(1);
    expect((await push(screen, fresh(1, 100))).body.done).toHaveLength(1);
    expect(rows('SELECT SUM(LENGTH(body)) AS chars FROM docs')).toEqual([
      { chars: MAX_ACCOUNT_CHARS },
    ]);
    // Growing one document while making another smaller: in the order sent, the growth
    // comes first and does not fit, and the push still commits what does.
    const [other] = rows<{ name: string }>('SELECT name FROM docs WHERE LENGTH(body) = ?', size);
    const mixed = await push(screen, [
      { name: first.name, base: ver, body: sealed(size) },
      { name: other!.name, base: 1, body: sealed(100) },
    ]);
    expect(mixed.body).toMatchObject({ full: [first.name], conflicts: [] });
    expect(mixed.body.done.map((doc) => doc.name)).toEqual([other!.name]);
  });

  it('lets an account already over its limits come back under them', async () => {
    const screen = await newAccount();
    // As pushes sent at once could leave an account before the limits were checked in the batch.
    const add = d1.sqlite.prepare(
      'INSERT INTO docs (account, name, ver, at, body) VALUES (?, ?, 1, ?, ?)',
    );
    const held = Array.from({ length: MAX_DOCS + 5 }, () => newId());
    for (const name of held) add.run(screen.account, name, START, sealed(100 * 1000));
    const heavy = newId();
    add.run(screen.account, heavy, START, sealed(MAX_BODY_CHARS));
    expect(rows('SELECT COUNT(*) AS n, SUM(LENGTH(body)) AS chars FROM docs')).toEqual([
      { n: MAX_DOCS + 6, chars: (MAX_DOCS + 5) * 100 * 1000 + MAX_BODY_CHARS },
    ]);
    expect((MAX_DOCS + 5) * 100 * 1000 + MAX_BODY_CHARS).toBeGreaterThan(MAX_ACCOUNT_CHARS);

    const [extra] = fresh(1, 100) as [Put];
    const answer = await push(screen, [
      { name: held[0]!, base: 1, body: sealed(100 * 1000) },
      { name: held[1]!, base: 1, body: sealed(1000) },
      { name: held[2]!, base: 1, body: sealed(100 * 1000 + 1) },
      extra,
      { name: heavy, base: 1, body: sealed(100) },
    ]);
    expect(answer.status).toBe(200);
    // The same size and smaller go through; growing and adding do not.
    expect(answer.body.done.map((doc) => doc.name)).toEqual([held[0], held[1], heavy]);
    expect(answer.body.full).toEqual([held[2], extra.name]);
    expect(answer.body.conflicts).toEqual([]);
  });

  it('stops an account at 2,000 writes a UTC day, until the next one', async () => {
    const screen = await newAccount();
    // Rather than 167 pushes, start the day's count just short of the limit.
    d1.sqlite.prepare('UPDATE accounts SET writes = ?').run(MAX_WRITES_PER_DAY - 5);

    const over = await push(screen, fresh(6));
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'limit', now: START, retryAfter: 12 * 60 * 60 });
    expect(rows('SELECT name FROM docs')).toEqual([]);

    // A conflict is a write too: it costs D1 a statement all the same.
    const [doc] = fresh(1) as [Put];
    await push(screen, [doc]);
    await push(screen, [{ ...doc, base: 0 }]);
    expect((await push(screen, fresh(3))).status).toBe(200);
    expect(rows('SELECT writes FROM accounts')).toEqual([{ writes: MAX_WRITES_PER_DAY }]);
    expect((await push(screen, fresh(1))).status).toBe(429);
    expect((await pull(screen, [doc.name])).status).toBe(200);

    vi.setSystemTime(Date.parse('2026-11-01T00:00:01Z'));
    expect((await push(screen, fresh(1))).status).toBe(200);
    expect(rows('SELECT day, writes FROM accounts')).toEqual([{ day: TODAY + 1, writes: 1 }]);
  });
});

describe('pushes sent at once', () => {
  // D1 is a network call away, so pushes sent together all sign in before any of them
  // writes. Each waits as long here, and none of them can pass a limit by it.
  let slow: Env;
  beforeEach(() => {
    d1 = testD1({ latency: 3 });
    slow = { ...env, DB: d1 };
  });

  const together = (screen: Screen, pushes: Put[][]) =>
    Promise.all(pushes.map((puts) => push(screen, puts, slow)));
  const stored = () =>
    rows<{ n: number; chars: number }>(
      'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(body)), 0) AS chars FROM docs',
    )[0]!;

  it('cannot pass 120 documents together', async () => {
    const screen = await newAccount(slow);
    const answers = await together(
      screen,
      Array.from({ length: 30 }, () => fresh(MAX_PUTS, 1000)),
    );
    expect(answers.every((answer) => answer.status === 200)).toBe(true);
    const done = answers.reduce((n, answer) => n + answer.body.done.length, 0);
    const full = answers.reduce((n, answer) => n + answer.body.full.length, 0);
    expect(done).toBe(MAX_DOCS);
    expect(full).toBe(30 * MAX_PUTS - MAX_DOCS);
    expect(stored().n).toBe(MAX_DOCS);
    // Every document pushed is counted, whether it went in or not.
    expect(rows('SELECT writes FROM accounts')).toEqual([{ writes: 30 * MAX_PUTS }]);
  });

  it('cannot pass 10,000,000 characters together', async () => {
    const screen = await newAccount(slow);
    const size = 990 * 1000;
    const answers = await together(
      screen,
      Array.from({ length: 25 }, () => fresh(1, size)),
    );
    expect(answers.filter((answer) => answer.body.done.length === 1)).toHaveLength(10);
    expect(answers.filter((answer) => answer.body.full.length === 1)).toHaveLength(15);
    expect(stored()).toEqual({ n: 10, chars: 10 * size });
  });

  it('cannot pass 2,000 writes a day together', async () => {
    const screen = await newAccount(slow);
    // Room for two pushes of 12 and not a third. Each finds room when it signs in.
    d1.sqlite.prepare('UPDATE accounts SET writes = ?').run(MAX_WRITES_PER_DAY - 30);
    const answers = await together(
      screen,
      Array.from({ length: 10 }, () => fresh(MAX_PUTS)),
    );
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(2);
    const refused = answers.filter((answer) => answer.status === 429);
    expect(refused).toHaveLength(8);
    for (const answer of refused) {
      expect(answer.body).toEqual({ error: 'limit', now: START, retryAfter: 12 * 60 * 60 });
    }
    expect(stored().n).toBe(2 * MAX_PUTS);
    expect(rows('SELECT writes FROM accounts')).toEqual([{ writes: MAX_WRITES_PER_DAY - 6 }]);
  });
});

describe('delete', () => {
  it('removes the account and its documents in one batch', async () => {
    const screen = await newAccount();
    await push(screen, fresh(2));
    d1.calls.length = 0;
    const answer = await remove(screen);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ now: START });
    expect(writes()).toHaveLength(1);
    expect(rows('SELECT id FROM accounts')).toEqual([]);
    expect(rows('SELECT name FROM docs')).toEqual([]);
    expect((await pull(screen, [])).status).toBe(401);
    expect((await remove(screen)).status).toBe(401);
  });

  it('needs the account’s own auth key', async () => {
    const screen = await newAccount();
    await push(screen, fresh(1));
    expect((await remove({ ...screen, auth: random(32) })).status).toBe(401);
    expect(rows('SELECT name FROM docs')).toHaveLength(1);
  });
});

describe('requests', () => {
  it('refuses anything out of its form, and repeats none of it', async () => {
    const screen = await newAccount();
    const signed = { account: screen.account, auth: screen.auth };
    for (const [path, sent] of [
      ['/v1/account/create', '{"account":'],
      ['/v1/account/create', '[]'],
      ['/v1/account/create', 'null'],
      ['/v1/account/create', ''],
      ['/v1/account/create', { account: `${screen.account}=`, auth: screen.auth }],
      ['/v1/account/create', { account: screen.account, auth: `${screen.auth}=` }],
      ['/v1/account/delete', { account: screen.account.slice(1), auth: screen.auth }],
      ['/v1/pull', { ...signed, want: 'everything' }],
      ['/v1/pull', { ...signed, want: [], have: { 'secret title': 1 } }],
      ['/v1/pull', { ...signed, want: [], epoch: 'not an epoch' }],
      ['/v1/push', { ...signed, put: [] }],
      ['/v1/push', { ...signed, epoch: screen.epoch, put: [{ name: newId(), base: 0 }] }],
      [
        '/v1/push',
        { ...signed, epoch: screen.epoch, put: [{ name: newId(), base: 0, body: '{"t":1}' }] },
      ],
    ] as const) {
      const answer = await call('POST', path, sent);
      expect(answer.status, JSON.stringify(sent)).toBe(400);
      expect(answer.body).toEqual({ error: 'bad-request', now: START });
    }
    expect(rows('SELECT id FROM accounts')).toHaveLength(1);
  });

  it('refuses a request past 1.1 MB before reading it all', async () => {
    const screen = await newAccount();
    const answer = await call('POST', '/v1/pull', {
      ...screen,
      want: [],
      padding: 'x'.repeat(1100 * 1000),
    });
    expect(answer.status).toBe(413);
  });

  it('answers only its own routes', async () => {
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/v1/pull'],
      ['POST', '/v1/status'],
      ['POST', '/v1/accounts'],
      ['PUT', '/v1/push'],
      ['DELETE', '/v1/account/delete'],
      ['POST', '/v1/push/'],
    ] as const) {
      const answer = await call(method, path, method === 'GET' ? undefined : '{}');
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(answer.body).toEqual({ error: 'not-found', now: START });
    }
  });

  it('answers a preflight, though screens never send one', async () => {
    for (const path of ['/v1/push', '/v1/status', '/']) {
      const answer = await call('OPTIONS', path);
      expect(answer.status).toBe(204);
      expect(answer.text).toBe('');
      expect(answer.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(answer.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    }
    expect(d1.calls).toEqual([]);
  });
});

describe('module', () => {
  it('exports only its handler, as Cloudflare takes any other export for an entry point', async () => {
    expect(Object.keys(await import('./worker'))).toEqual(['default']);
  });
});

describe('D1', () => {
  it('makes the tables when they are missing, once', async () => {
    expect(rows("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);
    const screen = await newAccount();
    await pull(screen, []);
    await call('GET', '/v1/status');
    expect(rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).toEqual([
      { name: 'accounts' },
      { name: 'docs' },
    ]);
    const creates = d1.calls.filter((call) => call.some((sql) => /CREATE TABLE/.test(sql)));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toHaveLength(2);
  });

  it('answers 503 while D1 fails, without saying why, and makes the tables when it is back', async () => {
    const screen = { account: newId(), auth: random(32), epoch: newId() };
    d1.down = true;
    for (const answer of [
      await call('GET', '/v1/status'),
      await create(screen),
      await pull(screen, []),
      await push(screen, fresh(1)),
      await remove(screen),
    ]) {
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual({ error: 'unavailable', now: START });
    }
    d1.down = false;
    expect((await create(screen)).status).toBe(201);
  });
});

/**
 * The BannerTV account's sync service (ADR 0006): a Cloudflare Worker with
 * one D1 database that holds each account's documents as the screens sealed
 * them. The keys come from the account code, which never leaves the screens,
 * so the server keeps a random account id, a hash of the auth key and
 * ciphertext it cannot read.
 *
 * Screens pull and push whole documents. A push names the version it started
 * from, and each document commits only while that is still the stored one
 * (compare and swap), so no screen overwrites a change it has not seen.
 * Requests carry the auth key and the sealed bodies, so nothing here logs,
 * and no error repeats what was sent.
 *
 * A Worker module may export only its handler and Durable Object classes (and
 * types), so the rules the tests check live in rules.ts.
 */
import {
  base64Url,
  choosePull,
  type Listed,
  MAX_REQUEST_BYTES,
  MAX_WRITES_PER_DAY,
  PROTOCOL,
  pushFits,
  readMaxAccounts,
  readPull,
  readPullMinutes,
  readPush,
  readSigned,
  type Refusal,
  sameText,
  secondsToMidnight,
  type Signed,
  utcDay,
  writesToday,
} from './rules';

// The few D1 types this file uses, so it needs no type package.
export type D1Value = string | number | null;

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in order as one transaction: all of them take effect, or none does. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** How many accounts may exist. Missing, it closes account creation. */
  MAX_ACCOUNTS?: string;
  /** How often screens pull, in minutes. */
  PULL_MINUTES?: string;
}

/** An account's row, without its id. */
interface Account {
  auth: string;
  epoch: string;
  seen: number;
  day: number;
  writes: number;
}

interface StoredDoc {
  name: string;
  ver: number;
  at: number;
  body: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
  id      TEXT PRIMARY KEY,   -- account id
  auth    TEXT NOT NULL,      -- base64url SHA-256 of the auth key
  epoch   TEXT NOT NULL,
  created INTEGER NOT NULL,   -- UTC day number, coarse on purpose
  seen    INTEGER NOT NULL,   -- UTC day of the last pull or push
  day     INTEGER NOT NULL,   -- the UTC day writes counts
  writes  INTEGER NOT NULL
) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS docs (
  account TEXT NOT NULL,
  name    TEXT NOT NULL,
  ver     INTEGER NOT NULL,
  at      INTEGER NOT NULL,   -- server ms when this version was written
  body    TEXT NOT NULL,
  PRIMARY KEY (account, name)
) WITHOUT ROWID`,
];

const GET_ACCOUNT = 'SELECT auth, epoch, seen, day, writes FROM accounts WHERE id = ?';
// Counting stops at the cap, so a status check reads no more than MAX_ACCOUNTS rows.
const COUNT_ACCOUNTS = 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM accounts LIMIT ?)';
// The cap is checked by the insert itself, so two creates at once cannot both pass it.
const ADD_ACCOUNT = `INSERT INTO accounts (id, auth, epoch, created, seen, day, writes)
SELECT ?1, ?2, ?3, ?4, ?4, ?4, 0
WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM accounts LIMIT ?5)) < ?5
ON CONFLICT DO NOTHING`;
const MARK_SEEN = 'UPDATE accounts SET seen = ?1 WHERE id = ?2 AND seen < ?1';
const LIST_DOCS = 'SELECT name, ver, at, LENGTH(body) AS size FROM docs WHERE account = ?';
// Each write also checks that the account still has the epoch the push was signed in
// with, so a push that crosses a delete writes nothing a new account could inherit.
const ADD_DOC = `INSERT INTO docs (account, name, ver, at, body)
SELECT ?1, ?2, 1, ?3, ?4
WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?1 AND epoch = ?5)
ON CONFLICT DO NOTHING`;
const CHANGE_DOC = `UPDATE docs SET ver = ver + 1, at = ?1, body = ?2
WHERE account = ?3 AND name = ?4 AND ver = ?5
AND EXISTS (SELECT 1 FROM accounts WHERE id = ?3 AND epoch = ?6)`;
const COUNT_WRITES = `UPDATE accounts
SET seen = ?1, writes = CASE WHEN day = ?1 THEN writes + ?2 ELSE ?2 END, day = ?1
WHERE id = ?3 AND epoch = ?4`;
const DELETE_DOCS = 'DELETE FROM docs WHERE account = ?';
const DELETE_ACCOUNT = 'DELETE FROM accounts WHERE id = ?';

// The LG app runs from file:// and the Android app from its own origin, so
// every call is cross-origin. Screens send simple requests (GET, or POST with
// a text body and no credentials), so browsers send no preflight.
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** Every error the Worker answers with, and its status. */
const PROBLEMS = {
  'bad-request': 400,
  denied: 401,
  closed: 403,
  'not-found': 404,
  exists: 409,
  epoch: 409,
  'too-big': 413,
  limit: 429,
  unavailable: 503,
};

type Problem = keyof typeof PROBLEMS;

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** An error answer: the problem and the time, never anything that was sent. */
function fail(problem: Problem, now: number, retryAfter?: number): Response {
  const body =
    retryAfter === undefined ? { error: problem, now } : { error: problem, now, retryAfter };
  return json(body, PROBLEMS[problem]);
}

/** The request's body as text, or undefined when it is longer than `limit` bytes. */
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get('Content-Length')) > limit) return undefined;
  if (!request.body) return '';
  // Read in chunks, so a body sent without a length is not read whole before it is refused.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The request's JSON, or why it was refused unread. */
async function readJson(request: Request): Promise<{ value: unknown } | Refusal> {
  let text: string | undefined;
  try {
    text = await readBody(request, MAX_REQUEST_BYTES);
  } catch {
    return 'bad-request';
  }
  if (text === undefined) return 'too-big';
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return 'bad-request';
  }
}

/**
 * Each database's tables, made the first time it is used. A Worker gets the
 * same binding for every request its isolate serves, so this runs once per
 * isolate; a failure is tried again by the next request.
 */
const schemas = new WeakMap<D1Database, Promise<unknown>>();

async function database(env: Env): Promise<D1Database> {
  const db = env.DB;
  let ready = schemas.get(db);
  if (!ready) {
    ready = db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    schemas.set(db, ready);
    ready.catch(() => schemas.delete(db));
  }
  await ready;
  return db;
}

/** All the server keeps of an auth key: base64url SHA-256 of its characters. */
async function hashAuth(auth: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
  return base64Url(new Uint8Array(digest));
}

// What a request for an unknown account is compared with, so it takes as long
// to refuse as a wrong key and the two get the same answer.
const NO_ACCOUNT = 'A'.repeat(43);

/** The account, when it exists and the auth key is its own. */
async function signIn(db: D1Database, signed: Signed): Promise<Account | undefined> {
  const [account, hash] = await Promise.all([
    db.prepare(GET_ACCOUNT).bind(signed.account).first<Account>(),
    hashAuth(signed.auth),
  ]);
  const match = sameText(hash, account ? account.auth : NO_ACCOUNT);
  return account && match ? account : undefined;
}

async function listDocs(db: D1Database, account: string): Promise<Listed[]> {
  return (await db.prepare(LIST_DOCS).bind(account).all<Listed>()).results;
}

async function status(env: Env, now: number): Promise<Response> {
  const max = readMaxAccounts(env.MAX_ACCOUNTS);
  let count = 0;
  if (max > 0) {
    const db = await database(env);
    count = (await db.prepare(COUNT_ACCOUNTS).bind(max).first<{ n: number }>())?.n ?? max;
  }
  return json({
    ok: true,
    v: PROTOCOL,
    now,
    create: count < max,
    pullMinutes: readPullMinutes(env.PULL_MINUTES),
  });
}

/**
 * The answer to a create for an account that exists already: its epoch for
 * the screen that holds its code, whose earlier create lost its answer, and
 * `exists` for any other. Undefined when there is no such account.
 */
async function existing(
  db: D1Database,
  id: string,
  hash: string,
  now: number,
): Promise<Response | undefined> {
  const account = await db.prepare(GET_ACCOUNT).bind(id).first<Account>();
  if (!account) return undefined;
  return sameText(hash, account.auth) ? json({ now, epoch: account.epoch }) : fail('exists', now);
}

async function create(body: unknown, env: Env, now: number): Promise<Response> {
  const signed = readSigned(body);
  if (!signed) return fail('bad-request', now);
  const db = await database(env);
  const hash = await hashAuth(signed.auth);
  const resumed = await existing(db, signed.account, hash, now);
  if (resumed) return resumed;

  // A new epoch at every create tells screens of an account deleted and made again.
  const epoch = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const max = readMaxAccounts(env.MAX_ACCOUNTS);
  const added = await db
    .prepare(ADD_ACCOUNT)
    .bind(signed.account, hash, epoch, utcDay(now), max)
    .run();
  if (added.meta.changes === 1) return json({ now, epoch }, 201);
  // Either the cap is reached, or another request has just made this account.
  return (await existing(db, signed.account, hash, now)) ?? fail('closed', now);
}

async function pull(body: unknown, env: Env, now: number): Promise<Response> {
  const request = readPull(body);
  if (typeof request === 'string') return fail(request, now);
  const db = await database(env);
  const account = await signIn(db, request);
  if (!account) return fail('denied', now);
  if (request.epoch !== undefined && request.epoch !== account.epoch) return fail('epoch', now);

  const today = utcDay(now);
  const [listing] = await Promise.all([
    listDocs(db, request.account),
    // `seen` moves once a day at most, so most pulls write nothing.
    account.seen < today ? db.prepare(MARK_SEEN).bind(today, request.account).run() : undefined,
  ]);
  const { names, more } = choosePull(listing, request.have, request.want);

  // Keyed by names the Worker checked, but kept without a prototype all the same.
  const vers: Record<string, number> = Object.create(null);
  for (const doc of listing) vers[doc.name] = doc.ver;
  const docs: Record<string, { ver: number; at: number; body: string }> = Object.create(null);
  if (names.length > 0) {
    const marks = names.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT name, ver, at, body FROM docs WHERE account = ? AND name IN (${marks})`)
      .bind(request.account, ...names)
      .all<StoredDoc>();
    const found = new Map<string, StoredDoc>();
    for (const doc of results) found.set(doc.name, doc);
    // In the order wanted, as the screen asked for them.
    for (const name of names) {
      const doc = found.get(name);
      if (!doc) continue;
      docs[name] = { ver: doc.ver, at: doc.at, body: doc.body };
      // A push may have landed since the listing, and the body is the one to go by.
      vers[name] = doc.ver;
    }
  }
  return json({ now, epoch: account.epoch, vers, docs, more });
}

async function push(body: unknown, env: Env, now: number): Promise<Response> {
  const request = readPush(body);
  if (typeof request === 'string') return fail(request, now);
  const db = await database(env);
  const account = await signIn(db, request);
  if (!account) return fail('denied', now);
  const { epoch } = account;
  if (request.epoch !== epoch) return fail('epoch', now);
  if (request.put.length === 0) return json({ now, epoch, done: [], conflicts: [] });

  const today = utcDay(now);
  if (writesToday(account, today) + request.put.length > MAX_WRITES_PER_DAY) {
    return fail('limit', now, secondsToMidnight(now));
  }
  if (!pushFits(await listDocs(db, request.account), request.put)) return fail('too-big', now);

  // One batch, so the documents, the day's write count and `seen` change together or not at all.
  const statements = request.put.map((put) =>
    put.base === 0
      ? db.prepare(ADD_DOC).bind(request.account, put.name, now, put.body, epoch)
      : db.prepare(CHANGE_DOC).bind(now, put.body, request.account, put.name, put.base, epoch),
  );
  statements.push(db.prepare(COUNT_WRITES).bind(today, request.put.length, request.account, epoch));
  const results = await db.batch(statements);

  const done: Array<{ name: string; ver: number; at: number }> = [];
  const conflicts: string[] = [];
  request.put.forEach((put, index) => {
    // No row changed: the document has moved on from `base`, or a new one exists already.
    if (results[index]?.meta.changes === 1)
      done.push({ name: put.name, ver: put.base + 1, at: now });
    else conflicts.push(put.name);
  });
  return json({ now, epoch, done, conflicts });
}

async function remove(body: unknown, env: Env, now: number): Promise<Response> {
  const signed = readSigned(body);
  if (!signed) return fail('bad-request', now);
  const db = await database(env);
  if (!(await signIn(db, signed))) return fail('denied', now);
  await db.batch([
    db.prepare(DELETE_DOCS).bind(signed.account),
    db.prepare(DELETE_ACCOUNT).bind(signed.account),
  ]);
  return json({ now });
}

type Route = (body: unknown, env: Env, now: number) => Promise<Response>;

const POST_ROUTES = new Map<string, Route>([
  ['/v1/account/create', create],
  ['/v1/pull', pull],
  ['/v1/push', push],
  ['/v1/account/delete', remove],
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One time for the whole request: the `now` it answers with is the `at` it writes.
    const now = Date.now();
    const { pathname } = new URL(request.url);

    // Screens never send a preflight, but answer one in case another client does.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...HEADERS,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    try {
      if (request.method === 'GET' && pathname === '/v1/status') return await status(env, now);
      const route = request.method === 'POST' ? POST_ROUTES.get(pathname) : undefined;
      if (!route) return fail('not-found', now);
      const body = await readJson(request);
      if (typeof body === 'string') return fail(body, now);
      return await route(body.value, env, now);
    } catch {
      // D1 failed. Its errors can quote a statement's values, so they go nowhere.
      return fail('unavailable', now);
    }
  },
};

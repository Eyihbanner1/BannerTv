/**
 * Helpers for the sync tests only; nothing in the app imports this file.
 * Node's Web Crypto stands in for the TV's. The core is typed without the
 * DOM or Node, so the little of it used here is typed by hand.
 */
import type { Timers } from '../timers';
import type { SyncCrypto } from './crypto';
import type { PartItem, SyncPart } from './part';
import type { SyncTransport } from './wire';

type Fields = { [field: string]: unknown };

interface SubtleForTests {
  importKey(
    format: 'raw',
    data: Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  deriveBits(algorithm: unknown, key: unknown, length: number): Promise<ArrayBuffer>;
  encrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

declare const crypto: {
  subtle: SubtleForTests;
  getRandomValues(array: Uint8Array): Uint8Array;
};

/** SyncCrypto over Node's Web Crypto, as the app's adapter does it over the browser's. */
export function webCryptoForTests(): SyncCrypto {
  const subtle = crypto.subtle;
  return {
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
    sha256: async (data) => new Uint8Array(await subtle.digest('SHA-256', data)),
    async hkdf(ikm, salt, info, length) {
      const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        key,
        length * 8,
      );
      return new Uint8Array(bits);
    },
    async hmacSha256(raw, data) {
      const key = await subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]);
      return new Uint8Array(await subtle.sign('HMAC', key, data));
    },
    async aesGcmEncrypt(raw, iv, aad, plain) {
      const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const sealed = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        key,
        plain,
      );
      return new Uint8Array(sealed);
    },
    async aesGcmDecrypt(raw, iv, aad, sealed) {
      const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
      const plain = await subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        key,
        sealed,
      );
      return new Uint8Array(plain);
    },
  };
}

/** A repeatable source of numbers in [0, 1), for property tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/** Timers that run only when told to, letting promises settle between them. */
export function manualTimers() {
  let pending: Array<{ due: number; run: () => void; every?: number }> = [];
  let clock = 0;
  const timers: Timers = {
    after(ms, run) {
      const entry = { due: clock + ms, run };
      pending.push(entry);
      return () => {
        pending = pending.filter((p) => p !== entry);
      };
    },
    every(ms, run) {
      const entry = { due: clock + ms, run, every: ms };
      pending.push(entry);
      return () => {
        pending = pending.filter((p) => p !== entry);
      };
    },
  };
  return {
    timers,
    elapsed: () => clock,
    /** How many timers wait. */
    waiting: () => pending.length,
    /** When the next timer is due, in ms from the start. */
    nextDue: () => pending.reduce((min, p) => Math.min(min, p.due), Infinity),
    async settle() {
      for (let i = 0; i < 200; i++) await Promise.resolve();
    },
    /** Runs everything due within `ms`, letting promises settle in between. */
    async advance(ms = 100) {
      const until = clock + ms;
      for (let round = 0; round < 500; round++) {
        for (let i = 0; i < 200; i++) await Promise.resolve();
        const due = pending.filter((p) => p.due <= until).sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        clock = Math.max(clock, due.due);
        if (due.every) due.due += due.every;
        else pending = pending.filter((p) => p !== due);
        due.run();
      }
      for (let i = 0; i < 200; i++) await Promise.resolve();
      clock = until;
    },
  };
}

/** A failure the fake service gives instead of its next answer to `path` (any path when left out). */
export interface FakeFailure {
  path?: string;
  /** No answer at all, as with no network. */
  network?: boolean;
  status?: number;
  body?: unknown;
}

interface FakeDocument {
  ver: number;
  at: number;
  body: string;
}

/**
 * The sync service in memory, answering as `services/sync` does (ADR 0006,
 * "HTTP"), for the engine's tests. Every body goes through JSON both ways,
 * as on the wire. With `createKey`, making an account needs that setup key.
 */
export function fakeSyncService(options: {
  now: () => number;
  maxAccounts?: number;
  createKey?: string;
}) {
  const { now, maxAccounts = 1, createKey } = options;
  const accounts = new Map<string, { auth: string; epoch: string }>();
  const stored = new Map<string, Map<string, FakeDocument>>();
  const failures: FakeFailure[] = [];
  const requests: Array<{ path: string; body: unknown }> = [];
  let epochs = 0;
  let pageChars = Infinity;
  let conflictAlways = false;
  let maxDocuments = Infinity;

  const answer = (status: number, body: Fields) => ({
    status,
    body: JSON.parse(JSON.stringify({ ...body, now: now() })) as unknown,
  });
  const refuse = (status: number, error: string, extra: Fields = {}) =>
    answer(status, { error, ...extra });

  function signedIn(body: Fields) {
    const account = accounts.get(body.account as string);
    return account && account.auth === body.auth ? account : undefined;
  }

  function newEpoch(): string {
    epochs += 1;
    return `epoch${String(epochs).padStart(17, '0')}`;
  }

  function handle(path: string, body: Fields) {
    if (path === '/v1/status') {
      return answer(200, {
        ok: true,
        v: 1,
        create: accounts.size < maxAccounts,
        key: createKey !== undefined,
        pullMinutes: 30,
      });
    }
    if (path === '/v1/account/create') {
      if (createKey !== undefined && body.key !== createKey) return refuse(403, 'key');
      const existing = accounts.get(body.account as string);
      if (existing) {
        return existing.auth === body.auth
          ? answer(200, { epoch: existing.epoch })
          : refuse(409, 'exists');
      }
      if (accounts.size >= maxAccounts) return refuse(403, 'closed');
      const epoch = newEpoch();
      accounts.set(body.account as string, { auth: body.auth as string, epoch });
      stored.set(body.account as string, new Map());
      return answer(201, { epoch });
    }
    const account = signedIn(body);
    if (!account) return refuse(401, 'denied');
    const docs = stored.get(body.account as string)!;
    if (path === '/v1/account/delete') {
      accounts.delete(body.account as string);
      stored.delete(body.account as string);
      return answer(200, {});
    }
    if (body.epoch !== undefined && body.epoch !== null && body.epoch !== account.epoch) {
      return refuse(409, 'epoch');
    }
    if (path === '/v1/pull') {
      const have = (body.have ?? {}) as { [name: string]: number };
      const vers: { [name: string]: number } = {};
      docs.forEach((doc, name) => (vers[name] = doc.ver));
      const sent: { [name: string]: FakeDocument } = {};
      let chars = 0;
      let more = false;
      for (const name of body.want as string[]) {
        const doc = docs.get(name);
        if (!doc || doc.ver === (have[name] ?? 0)) continue;
        if (chars > 0 && chars + doc.body.length > pageChars) {
          more = true;
          break;
        }
        chars += doc.body.length;
        sent[name] = doc;
      }
      return answer(200, { epoch: account.epoch, vers, docs: sent, more });
    }
    if (path === '/v1/push') {
      const put = body.put as Array<{ name: string; base: number; body: string }>;
      if (put.length > 12) return refuse(413, 'too-big');
      const done: Array<{ name: string; ver: number; at: number }> = [];
      const conflicts: string[] = [];
      const full: string[] = [];
      for (const item of put) {
        const current = docs.get(item.name)?.ver ?? 0;
        if (conflictAlways || current !== item.base) {
          conflicts.push(item.name);
          continue;
        }
        if (!docs.has(item.name) && docs.size >= maxDocuments) {
          full.push(item.name);
          continue;
        }
        docs.set(item.name, { ver: item.base + 1, at: now(), body: item.body });
        done.push({ name: item.name, ver: item.base + 1, at: now() });
      }
      return answer(200, { epoch: account.epoch, done, conflicts, full });
    }
    return refuse(404, 'not-found');
  }

  function respond(path: string, body: unknown) {
    requests.push({ path, body });
    const index = failures.findIndex((failure) => !failure.path || failure.path === path);
    if (index !== -1) {
      const failure = failures.splice(index, 1)[0]!;
      if (failure.network) return Promise.reject(new Error('Network'));
      return Promise.resolve({
        status: failure.status ?? 503,
        body: failure.body === undefined ? { error: 'unavailable', now: now() } : failure.body,
      });
    }
    return Promise.resolve(handle(path, (body ?? {}) as Fields));
  }

  const transport: SyncTransport = {
    get: (path) => respond(path, undefined),
    post: (path, body) => respond(path, JSON.parse(JSON.stringify(body)) as unknown),
  };

  return {
    transport,
    /** Every request, in order. */
    requests,
    /** Requests to `path` so far. */
    count: (path: string) => requests.filter((request) => request.path === path).length,
    failNext(...next: FakeFailure[]) {
      failures.push(...next);
    },
    /** Drops the failures from failNext() not given yet: the outage is over. */
    heal() {
      failures.length = 0;
    },
    /** The documents an account holds, by name on the service. */
    documents: (account: string) => stored.get(account) ?? new Map<string, FakeDocument>(),
    /** Replaces a stored document, as another screen (or a broken one) would. */
    put(account: string, name: string, doc: FakeDocument) {
      stored.get(account)!.set(name, doc);
    },
    /** Deletes the account and makes it again with the same keys, under a new epoch. */
    remake(account: string) {
      const old = accounts.get(account)!;
      accounts.set(account, { auth: old.auth, epoch: newEpoch() });
      stored.set(account, new Map());
    },
    /** Pull answers carry at most this many characters of bodies, leaving the rest for `more`. */
    limitPages(chars: number) {
      pageChars = chars;
    },
    conflictEveryPush(on: boolean) {
      conflictAlways = on;
    },
    /** An account holds at most this many documents: a push of another is refused as `full`. */
    limitDocuments(count: number) {
      maxDocuments = count;
    },
  };
}

/** A store in memory as one part, for the engine's tests. */
export function memoryPart(
  document: string,
  prefixes: string[] = [''],
  extra: { ownData?: () => boolean; timed?: boolean } = {},
) {
  let items = new Map<string, PartItem>();
  const listeners = new Set<() => void>();
  let failAdopt = false;
  const changed = () => listeners.forEach((listener) => listener());
  const part: SyncPart = {
    document,
    prefixes,
    load: () => Promise.resolve(),
    snapshot: () => new Map(items),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    adopt(change) {
      if (failAdopt) return Promise.reject(new Error('Full'));
      const next = new Map(items);
      change.set.forEach((item, key) => {
        const kept: PartItem = { v: item.v };
        if (items.get(key)?.t !== undefined || timed.has(key)) kept.t = item.t;
        next.set(key, kept);
      });
      change.remove.forEach((key) => next.delete(key));
      items = next;
      changed();
      return Promise.resolve();
    },
    ownData: extra.ownData,
  };
  // Only parts whose items have times of their own can hold Trakt's.
  if (extra.timed) {
    part.markTrakt = (keys) => {
      const next = new Map(items);
      keys.forEach((key) => {
        const item = next.get(key);
        if (item) next.set(key, { ...item, trakt: true });
      });
      items = next;
      changed();
      return Promise.resolve();
    };
  }
  const timed = new Set<string>();
  return {
    part,
    /** Sets a value as the person would; with `t`, the value has a time of its own. */
    set(key: string, v: unknown, t?: number, trakt?: boolean) {
      const item: PartItem = { v };
      if (t !== undefined) {
        item.t = t;
        timed.add(key);
      }
      if (trakt) item.trakt = true;
      items = new Map(items).set(key, item);
      changed();
    },
    delete(key: string) {
      items = new Map(items);
      items.delete(key);
      changed();
    },
    get: (key: string) => items.get(key),
    keys: () => Array.from(items.keys()).sort(),
    failAdopts(on: boolean) {
      failAdopt = on;
    },
  };
}

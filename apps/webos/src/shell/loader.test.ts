import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_TYPE,
  type FileEntry,
  PLATFORM,
  type ShellApi,
  type ShellConfig,
  UPDATE_TYPE,
} from './contract';
import {
  CHECK_EVERY_MS,
  createShell,
  FIRST_CHECK_MS,
  HIDDEN_RESTART_MS,
  RECHECK_MS,
  SAVE_WAIT_MS,
  type ShellEnv,
  WATCHDOG_MS,
} from './loader';
import { MAX_TRIES } from './state';
import { memoryStore } from './store';

const subtle = globalThis.crypto.subtle;
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const URL_BASE = 'https://updates.example/webos/';
const RUNTIME = 'webos-1-0123456789abcdef';
const BUILT_AT = '2026-11-11T09:00:00.000Z';

const encode = (text: string) => new TextEncoder().encode(text);
const bytesOf = (text: string): ArrayBuffer => encode(text).buffer as ArrayBuffer;
const base64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function hex(text: string): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let keys: CryptoKeyPair;
let spki: string;
let otherKeys: CryptoKeyPair;

beforeAll(async () => {
  const params = { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  keys = (await subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherKeys = (await subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  spki = base64(await subtle.exportKey('spki', keys.publicKey));
});

async function sign(text: string, key = keys.privateKey): Promise<string> {
  return base64(await subtle.sign(RSA, key, encode(text)));
}

/** The .ipk's own files, as scripts the fake page can tell apart by their text. */
const BUILT_IN: Record<string, string> = {
  'assets/index-old.js': 'app:built-in',
  'vendor/hls.min.js': 'hls:built-in',
  'data/sports-data.js': 'sports:built-in',
};

async function entries(files: Record<string, string>): Promise<Record<string, FileEntry>> {
  const out: Record<string, FileEntry> = {};
  for (const [path, text] of Object.entries(files)) {
    out[path] = { sha256: await hex(text), size: encode(text).length };
  }
  return out;
}

async function configWith(changes: Partial<ShellConfig> = {}): Promise<ShellConfig> {
  return {
    contract: 1,
    runtime: RUNTIME,
    build: { id: 'build-1', version: '0.1.5', commit: 'abcdef1', builtAt: BUILT_AT },
    launch: 'assets/index-old.js',
    files: await entries(BUILT_IN),
    updates: { channel: 'main', url: URL_BASE, key: spki, keyId: 'lg-test' },
    ...changes,
  };
}

let nextId = 1;
const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;

interface Published {
  id: string;
  files: Record<string, string>;
  body: string;
}

/** A manifest as the publish workflow signs it, with the files it names. */
async function publish(options: {
  files?: Record<string, string>;
  launch?: string;
  createdAt?: string;
  runtime?: string;
  channel?: string;
  version?: string;
  key?: CryptoKey;
  keyId?: string;
}): Promise<Published> {
  const files = options.files ?? {
    'assets/index-new.js': 'app:new',
    'vendor/hls.min.js': BUILT_IN['vendor/hls.min.js']!,
    'data/sports-data.js': 'sports:new',
  };
  const id = uuid();
  const text = JSON.stringify({
    type: UPDATE_TYPE,
    id,
    createdAt: options.createdAt ?? '2026-11-11T10:00:00.000Z',
    channel: options.channel ?? 'main',
    platform: PLATFORM,
    runtime: options.runtime ?? RUNTIME,
    version: options.version ?? '0.1.6',
    commit: '1234567',
    launch: options.launch ?? Object.keys(files).find((path) => path.startsWith('assets/')),
    files: await entries(files),
  });
  const body = JSON.stringify({
    manifest: text,
    sig: await sign(text, options.key),
    keyid: options.keyId ?? 'lg-test',
  });
  return { id, files, body };
}

async function directive(createdAt: string): Promise<string> {
  const text = JSON.stringify({
    type: BUILT_IN_TYPE,
    createdAt,
    channel: 'main',
    platform: PLATFORM,
    runtime: RUNTIME,
  });
  return JSON.stringify({ directive: text, sig: await sign(text), keyid: 'lg-test' });
}

/** The updates Worker: what /update answers, and the files by their hash. */
class FakeWorker {
  answer: { status: number; body?: string } = { status: 204 };
  files = new Map<string, string>();
  requests: string[] = [];

  async serve(published: Published): Promise<void> {
    this.answer = { status: 200, body: published.body };
    for (const text of Object.values(published.files)) this.files.set(await hex(text), text);
  }

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.requests.push(url);
    // No header of the TV's own: a GET with no preflight from file://.
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe('omit');
    if (url.startsWith(`${URL_BASE}update?`)) {
      expect(url).toBe(`${URL_BASE}update?channel=main&runtime=${RUNTIME}`);
      return new Response(this.answer.body ?? null, { status: this.answer.status });
    }
    const hash = url.slice(`${URL_BASE}file/`.length);
    const text = this.files.get(hash);
    return text === undefined ? new Response('', { status: 404 }) : new Response(text);
  };
}

/** What runs where the TV would run it: every script by its text. */
class FakePage {
  ran: string[] = [];
  reloads = 0;
  isHidden = false;
  visibility: Array<() => void> = [];
  /** What the app's script does as it runs; by default it starts. */
  behave: (source: string) => void = () => undefined;
  failBytes = false;
  api: ShellApi | undefined;

  private run(source: string) {
    this.ran.push(source);
    if (source.startsWith('app:')) {
      if (source.endsWith(':throws')) return;
      this.api!.started();
    }
    this.behave(source);
  }

  runFile = async (path: string) => {
    const text = BUILT_IN[path];
    if (text === undefined) throw new Error('load');
    this.run(text);
  };

  runBytes = async (bytes: ArrayBuffer) => {
    if (this.failBytes) throw new Error('load');
    this.run(new TextDecoder().decode(bytes));
  };

  reload = () => {
    this.reloads++;
  };

  hidden = () => this.isHidden;

  onVisibilityChange = (listener: () => void) => {
    this.visibility.push(listener);
  };

  setHidden(hidden: boolean) {
    this.isHidden = hidden;
    for (const listener of this.visibility) listener();
  }
}

/** One TV: storage that outlives a start, and a start of the app. */
class Tv {
  saved: string | null = null;
  store = memoryStore();
  worker = new FakeWorker();
  page = new FakePage();
  clock = 0;
  warnings: string[] = [];

  /** Starts the app again; `page` stands in for this start's page. */
  async start(
    config?: ShellConfig,
    changes: Partial<ShellEnv> = {},
    page = new FakePage(),
  ): Promise<ShellApi> {
    this.page = page;
    const env: ShellEnv = {
      config: config ?? (await configWith()),
      updatesHere: true,
      subtle,
      store: this.store,
      fetch: this.worker.fetch,
      storage: { get: () => this.saved, set: (text) => (this.saved = text) },
      page: this.page,
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      // The fake timers' clock, plus what a test moves on by hand.
      now: () => Date.now() + this.clock,
      warn: (message) => this.warnings.push(message),
      ...changes,
    };
    const { api, launch } = createShell(env);
    page.api = api;
    await launch();
    await settle();
    return api;
  }
}

/** Lets every promise the loader chains run, with the clock held still. */
async function settle(): Promise<void> {
  for (let round = 0; round < 50; round++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a TV with nothing stored', () => {
  it('starts the .ipk’s own code and checks a minute later', async () => {
    const tv = new Tv();
    const api = await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
    expect(api.updates).toBe(true);
    expect(api.status()).toEqual({
      running: null,
      next: null,
      failed: null,
      check: { kind: 'idle' },
    });
    expect(tv.worker.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(tv.worker.requests).toHaveLength(1);
    expect(api.status().check).toEqual({ kind: 'latest' });
    // Then every few hours.
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(tv.worker.requests).toHaveLength(2);
  });

  it('runs the .ipk’s players and data', async () => {
    const tv = new Tv();
    const api = await tv.start();
    await api.loadScript('vendor/hls.min.js');
    expect(tv.page.ran).toEqual(['app:built-in', 'hls:built-in']);
  });
});

describe('an update', () => {
  it('downloads what differs from the .ipk, checks it, and starts it next time', async () => {
    const tv = new Tv();
    const published = await publish({});
    await tv.worker.serve(published);
    const api = await tv.start();
    const changes: string[] = [];
    api.subscribe(() => changes.push(api.status().check.kind));
    expect(await api.check()).toEqual({ kind: 'ready' });
    expect(changes).toEqual(['checking', 'downloading', 'ready']);
    // The player is the .ipk's own, so only the app and the sports data came down.
    expect(tv.worker.requests.filter((url) => url.includes('/file/'))).toHaveLength(2);
    expect(api.status().next).toMatchObject({ id: published.id, version: '0.1.6' });
    // Nothing changes under the running app.
    expect(tv.page.ran).toEqual(['app:built-in']);

    const next = await tv.start();
    expect(tv.page.ran).toEqual(['app:new']);
    expect(next.status()).toMatchObject({ running: { id: published.id }, next: null });
    await next.loadScript('data/sports-data.js');
    await next.loadScript('vendor/hls.min.js');
    expect(tv.page.ran).toEqual(['app:new', 'sports:new', 'hls:built-in']);
  });

  it('keeps running start after start once it has gone well', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    for (let start = 0; start < MAX_TRIES + 2; start++) {
      const api = await tv.start();
      expect(tv.page.ran).toEqual(['app:new']);
      api.markGood();
    }
  });

  it('is taken only once, and not again once running', async () => {
    const tv = new Tv();
    const published = await publish({});
    await tv.worker.serve(published);
    await (await tv.start()).check();
    const api = await tv.start();
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'latest' });
    expect(api.status().next).toBeNull();
  });

  it('starts from the .ipk’s file when its app script is the .ipk’s own', async () => {
    const tv = new Tv();
    await tv.worker.serve(
      await publish({
        files: {
          'assets/index-old.js': BUILT_IN['assets/index-old.js']!,
          'data/sports-data.js': 'sports:new',
        },
      }),
    );
    await (await tv.start()).check();
    const api = await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
    await api.loadScript('data/sports-data.js');
    expect(tv.page.ran).toEqual(['app:built-in', 'sports:new']);
  });

  it('runs the .ipk’s code in the same start when the page cannot run the update’s script', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    // main.ts tries a blob: script and then an inline one; a page where neither runs gets the
    // .ipk's code without starting again.
    const failing = new FakePage();
    failing.failBytes = true;
    const api = await tv.start(undefined, {}, failing);
    expect(failing.ran).toEqual(['app:built-in']);
    expect(failing.reloads).toBe(0);
    expect(api.status().running).toBeNull();
    expect(api.status().failed).toMatchObject({ version: '0.1.6' });
  });
});

describe('what the TV refuses', () => {
  async function refused(published: Promise<Published> | Published, reason: string) {
    const tv = new Tv();
    await tv.worker.serve(await published);
    const api = await tv.start();
    expect(await api.check()).toEqual({ kind: 'failed', reason });
    expect(api.status().next).toBeNull();
    expect(tv.store.updates.size).toBe(0);
    return tv;
  }

  it('a manifest signed by another key, or naming another key', async () => {
    await refused(publish({ key: otherKeys.privateKey }), 'signature');
    await refused(publish({ keyId: 'lg-other' }), 'signature');
  });

  it('a manifest changed after it was signed', async () => {
    const published = await publish({});
    const body = JSON.parse(published.body) as { manifest: string };
    body.manifest = body.manifest.replace('0.1.6', '0.1.9');
    await refused({ ...published, body: JSON.stringify(body) }, 'signature');
  });

  it('a manifest for another runtime or channel', async () => {
    await refused(publish({ runtime: 'webos-1-ffffffffffffffff' }), 'runtime');
    await refused(publish({ channel: 'beta' }), 'scope');
  });

  it('a file that is not the one the manifest names', async () => {
    const tv = new Tv();
    const published = await publish({});
    await tv.worker.serve(published);
    tv.worker.files.set(await hex('app:new'), 'app:tampered');
    const api = await tv.start();
    expect(await api.check()).toEqual({ kind: 'failed', reason: 'file' });
    expect(api.status().next).toBeNull();
  });

  it('an answer out of form, an error status, or no answer', async () => {
    const tv = new Tv();
    const api = await tv.start();
    tv.worker.answer = { status: 200, body: 'not json' };
    expect(await api.check()).toEqual({ kind: 'failed', reason: 'answer' });
    tv.worker.answer = { status: 503, body: '{"error":"storage"}' };
    expect(await api.check()).toEqual({ kind: 'failed', reason: 'status 503' });
    const offline = new Tv();
    const quiet = await offline.start(undefined, {
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await quiet.check()).toEqual({ kind: 'failed', reason: 'network' });
  });

  it('anything published before the .ipk was built, or before what it took', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({ createdAt: '2026-11-10T09:00:00.000Z' }));
    const api = await tv.start();
    expect(await api.check()).toEqual({ kind: 'latest' });
    expect(tv.store.updates.size).toBe(0);

    await tv.worker.serve(await publish({ createdAt: '2026-11-11T12:00:00.000Z' }));
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'ready' });
    await tv.worker.serve(
      await publish({ createdAt: '2026-11-11T11:00:00.000Z', version: '0.1.4' }),
    );
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'latest' });
    expect(api.status().next).toMatchObject({ createdAt: '2026-11-11T12:00:00.000Z' });
  });
});

describe('an update that goes wrong', () => {
  async function stored(files?: Record<string, string>) {
    const tv = new Tv();
    const published = await publish(files ? { files } : {});
    await tv.worker.serve(published);
    await (await tv.start()).check();
    return { tv, published };
  }

  it('one whose script throws: put aside, and the page starts again from the .ipk', async () => {
    const { tv } = await stored({ 'assets/index-new.js': 'app:new:throws' });
    const api = await tv.start();
    expect(tv.page.ran).toEqual(['app:new:throws']);
    expect(tv.page.reloads).toBe(1);
    expect(api.status().failed).toMatchObject({ version: '0.1.6' });
    await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
    expect(tv.warnings.join('\n')).toContain('threw at start');
  });

  it('one that never settles: put aside after the watchdog, on screen', async () => {
    const { tv } = await stored();
    const api = await tv.start();
    tv.page.isHidden = true;
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    // Off screen it waits to be judged on screen.
    expect(tv.page.reloads).toBe(0);
    tv.page.isHidden = false;
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(tv.page.reloads).toBe(1);
    expect(api.status().failed).not.toBeNull();
    await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
  });

  it('one that settles is never judged by the watchdog', async () => {
    const { tv } = await stored();
    const api = await tv.start();
    api.markGood();
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(tv.page.reloads).toBe(0);
  });

  it('one that starts MAX_TRIES times without settling: the next start runs the .ipk', async () => {
    const { tv } = await stored();
    for (let start = 0; start < MAX_TRIES; start++) {
      await tv.start();
      expect(tv.page.ran).toEqual(['app:new']);
    }
    await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
  });

  it('one changed in storage: the .ipk’s code runs in the same start', async () => {
    const { tv } = await stored();
    tv.store.files.set(await hex('app:new'), bytesOf('app:changed'));
    const api = await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
    expect(tv.page.reloads).toBe(0);
    expect(api.status().failed).not.toBeNull();
  });

  it('one whose manifest is gone from storage: the .ipk’s code runs', async () => {
    const { tv } = await stored();
    tv.store.updates.clear();
    await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
  });

  it('is never downloaded again once put aside', async () => {
    const { tv } = await stored({ 'assets/index-new.js': 'app:new:throws' });
    await tv.start();
    const api = await tv.start();
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'latest' });
  });
});

describe('a newly installed .ipk', () => {
  it('starts its own code, not what an earlier .ipk stored', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    const newer = await configWith({
      build: { id: 'build-2', version: '0.1.7', commit: 'abcdef2', builtAt: BUILT_AT },
    });
    const api = await tv.start(newer);
    expect(tv.page.ran).toEqual(['app:built-in']);
    expect(api.status().next).toBeNull();
    // What the earlier .ipk stored goes once this start has gone well.
    api.markGood();
    await settle();
    expect(tv.store.updates.size).toBe(0);
    expect(tv.store.files.size).toBe(0);
  });
});

describe('going back', () => {
  it('to the .ipk’s code, when the Worker says so', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    const api = await tv.start();
    tv.worker.answer = { status: 200, body: await directive('2026-11-11T12:00:00.000Z') };
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'ready' });
    expect(api.status().next).toBe('built-in');
    await tv.start();
    expect(tv.page.ran).toEqual(['app:built-in']);
  });

  it('to an update with exactly the .ipk’s files counts as going back to the .ipk', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    const api = await tv.start();
    await tv.worker.serve(
      await publish({ files: BUILT_IN, createdAt: '2026-11-11T12:00:00.000Z' }),
    );
    tv.clock += RECHECK_MS;
    expect(await api.check()).toEqual({ kind: 'ready' });
    expect(api.status().next).toBe('built-in');
  });

  it('an update with the .ipk’s files changes nothing on a TV running the .ipk', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({ files: BUILT_IN }));
    const api = await tv.start();
    expect(await api.check()).toEqual({ kind: 'latest' });
    expect(tv.worker.requests).toHaveLength(1);
  });
});

describe('when an update starts', () => {
  it('once the app has been off screen a while, never on screen', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    const api = await tv.start();
    await api.check();
    await vi.advanceTimersByTimeAsync(HIDDEN_RESTART_MS * 2);
    expect(tv.page.reloads).toBe(0);
    tv.page.setHidden(true);
    await vi.advanceTimersByTimeAsync(HIDDEN_RESTART_MS / 2);
    tv.page.setHidden(false);
    await vi.advanceTimersByTimeAsync(HIDDEN_RESTART_MS);
    expect(tv.page.reloads).toBe(0);
    tv.page.setHidden(true);
    await vi.advanceTimersByTimeAsync(HIDDEN_RESTART_MS);
    expect(tv.page.reloads).toBe(1);
  });

  it('or when the app asks', async () => {
    const tv = new Tv();
    const api = await tv.start();
    api.restart();
    await settle();
    expect(tv.page.reloads).toBe(1);
  });
});

describe('the state', () => {
  it('is kept in IndexedDB too, for a start that finds localStorage empty', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    expect(tv.store.state).toBe(tv.saved);
    tv.saved = null;
    const api = await tv.start();
    expect(tv.page.ran).toEqual(['app:new']);
    expect(api.status().running).toMatchObject({ version: '0.1.6' });
    expect(tv.saved).toBe(tv.store.state);
  });

  it('in localStorage wins over the copy when both are there', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    tv.store.state = JSON.stringify({ v: 1, build: 'build-1', next: null, current: null, bad: [] });
    await tv.start();
    expect(tv.page.ran).toEqual(['app:new']);
  });

  it('is written before the page starts again, or a moment later at the most', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({ files: { 'assets/index-new.js': 'app:new:throws' } }));
    await (await tv.start()).check();
    // A store whose writes wait until the test lets them through.
    let release = () => {};
    const putState = tv.store.putState;
    tv.store.putState = (text) =>
      new Promise<void>((resolve) => {
        release = () => void putState(text).then(resolve);
      });
    await tv.start();
    expect(tv.page.ran).toEqual(['app:new:throws']);
    expect(tv.page.reloads).toBe(0);
    release();
    await settle();
    expect(tv.page.reloads).toBe(1);

    // A write that never ends holds it SAVE_WAIT_MS.
    tv.store.putState = () => new Promise<void>(() => undefined);
    const api = await tv.start();
    api.restart();
    await settle();
    expect(tv.page.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(tv.page.reloads).toBe(1);
  });

  it('starts the .ipk’s code when neither can be read', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    tv.store.getState = () => Promise.reject(new Error('IndexedDB'));
    const api = await tv.start(undefined, {
      storage: {
        get: () => {
          throw new Error('SecurityError');
        },
        set: () => undefined,
      },
    });
    expect(tv.page.ran).toEqual(['app:built-in']);
    expect(api.status().next).toBeNull();
  });
});

describe('checks', () => {
  it('are asked at most once a minute, and once at a time', async () => {
    const tv = new Tv();
    const api = await tv.start();
    await Promise.all([api.check(), api.check()]);
    await api.check();
    expect(tv.worker.requests).toHaveLength(1);
    tv.clock += RECHECK_MS;
    await api.check();
    expect(tv.worker.requests).toHaveLength(2);
  });

  it('after a failure are asked again at once', async () => {
    const tv = new Tv();
    const api = await tv.start();
    tv.worker.answer = { status: 500 };
    await api.check();
    await api.check();
    expect(tv.worker.requests).toHaveLength(2);
  });
});

describe('storage', () => {
  it('keeps only what runs and what waits, once a start has gone well', async () => {
    const tv = new Tv();
    await tv.worker.serve(await publish({}));
    await (await tv.start()).check();
    const api = await tv.start();
    const second = await publish({
      files: { 'assets/index-two.js': 'app:two', 'data/sports-data.js': 'sports:new' },
      createdAt: '2026-11-11T12:00:00.000Z',
    });
    await tv.worker.serve(second);
    tv.clock += RECHECK_MS;
    await api.check();
    await tv.start();
    expect(tv.page.ran).toEqual(['app:two']);
    tv.page.api!.markGood();
    await settle();
    expect([...tv.store.updates.keys()]).toEqual([second.id]);
    expect(tv.store.files.size).toBe(2);
    // The sports data both updates share was downloaded once.
    expect(tv.worker.requests.filter((url) => url.includes('/file/'))).toHaveLength(3);
  });
});

describe('a build or TV that takes no updates', () => {
  it.each([
    ['a build without updates', { updates: null }, {}],
    ['the Android app, or a TV without Web Crypto', {}, { updatesHere: false }],
    ['a page without Web Crypto', {}, { subtle: undefined }],
  ])('%s: starts the .ipk’s code and never asks', async (_name, config, env) => {
    const tv = new Tv();
    tv.saved = JSON.stringify({ v: 1, build: 'build-1', next: null, current: null, bad: [] });
    const api = await tv.start(await configWith(config as Partial<ShellConfig>), env);
    expect(api.updates).toBe(false);
    expect(await api.check()).toEqual({ kind: 'off' });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(tv.worker.requests).toEqual([]);
    expect(tv.page.ran).toEqual(['app:built-in']);
    await api.loadScript('vendor/hls.min.js');
    expect(tv.page.ran).toEqual(['app:built-in', 'hls:built-in']);
  });
});

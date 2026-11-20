import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeManifestUrl } from '@bannertv/protocol';
// The core package is not a dependency here; its key rules are one file with no imports.
import { SUBDL_KEY_PATTERN as CORE_SUBDL_KEY_PATTERN } from '../../../packages/core/src/integrations/subdl/key';
import {
  MAX_URL_LENGTH,
  readAddonUrl,
  readCode,
  readSealed,
  readSessionKind,
  readSubmission,
  REDELIVER_MS,
  SEALED_MAX_LENGTH,
  SEALED_MIN_LENGTH,
  SESSION_TTL_MS,
  SUBDL_KEY_AAD_PREFIX,
  SUBDL_KEY_PATTERN,
} from './rules';
import worker, {
  type Env,
  PairSession,
  type SessionNamespace,
  type SessionStorage,
} from './worker';

/**
 * Durable Objects in memory: one PairSession per name, each with its own
 * storage and alarm. Every value written to storage is kept in `written`.
 */
function fakeEnv() {
  const objects = new Map<
    string,
    { session: PairSession; alarm: () => number | undefined; values: Map<string, unknown> }
  >();
  const written: unknown[] = [];
  const namespace: SessionNamespace = {
    idFromName: (name) => name,
    get(id) {
      const name = id as string;
      let entry = objects.get(name);
      if (!entry) {
        const values = new Map<string, unknown>();
        let alarm: number | undefined;
        const storage: SessionStorage = {
          get: async <T>(key: string) => values.get(key) as T | undefined,
          put: async (key, value) => {
            written.push(value);
            values.set(key, value);
          },
          deleteAll: async () => values.clear(),
          setAlarm: async (time) => void (alarm = time),
          deleteAlarm: async () => void (alarm = undefined),
        };
        entry = { session: new PairSession({ storage }), alarm: () => alarm, values };
        objects.set(name, entry);
      }
      const { session } = entry;
      return { fetch: (url, init) => session.fetch(new Request(url, init)) };
    },
  };
  return { env: { SESSIONS: namespace } satisfies Env, objects, written };
}

const ORIGIN = 'https://bannertv-pair.example.workers.dev';

function call(env: Env, method: string, path: string, body?: string, type?: string) {
  const headers: Record<string, string> = type ? { 'Content-Type': type } : {};
  return worker.fetch(new Request(ORIGIN + path, { method, body, headers }), env);
}

async function open(env: Env, query = '') {
  const response = await call(env, 'POST', '/api/sessions' + query);
  expect(response.status).toBe(201);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  return (await response.json()) as {
    code: string;
    secret: string;
    expiresIn: number;
    pageUrl: string;
    kind: string;
  };
}

const send = (env: Env, code: string, url: unknown) =>
  call(env, 'POST', `/api/sessions/${code}`, JSON.stringify({ url }), 'application/json');

const sendSealed = (env: Env, code: string, sealed: unknown) =>
  call(env, 'POST', `/api/sessions/${code}`, JSON.stringify({ sealed }), 'application/json');

const collect = (env: Env, code: string, secret: string) =>
  call(env, 'POST', `/api/sessions/${code}/collect`, secret, 'text/plain');

/** The policy both phone pages are served with. */
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Obviously not a real key, as ADR 0003 asks of every fixture. */
const FAKE_KEY = 'fake-subdl-key-for-tests-only';

/** Storage only ever gets a session's secret hash, its expiry and its kind. */
function expectOnlySessionFields(written: unknown[]) {
  expect(written.length).toBeGreaterThan(0);
  for (const value of written) {
    expect(Object.keys(value as object).sort()).toEqual(['expiresAt', 'kind', 'secretHash']);
  }
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashSecret(secret: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret))));
}

/** A sealing key as the TV makes one: 32 random bytes, kept here only. */
const sealingKey = () => crypto.getRandomValues(new Uint8Array(32));

/**
 * Seals a key exactly as the phone page does: AES-256-GCM, a 12-byte IV, a
 * 128-bit tag, the prefix and code as additional data, and base64url with no
 * padding of the IV followed by the ciphertext.
 */
async function seal(
  k: Uint8Array<ArrayBuffer>,
  code: string,
  key: string,
  iv = crypto.getRandomValues(new Uint8Array(12)),
): Promise<string> {
  const aesKey = await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(SUBDL_KEY_AAD_PREFIX + code),
      tagLength: 128,
    },
    aesKey,
    encoder.encode(key),
  );
  const sealed = new Uint8Array(12 + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(new Uint8Array(ciphertext), 12);
  return toBase64Url(sealed);
}

/** Opens a sealed key as the TV does, with its sealing key and the session's code. */
async function unseal(k: Uint8Array<ArrayBuffer>, code: string, sealed: string): Promise<string> {
  const bytes = fromBase64Url(sealed);
  const aesKey = await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes.subarray(0, 12),
      additionalData: encoder.encode(SUBDL_KEY_AAD_PREFIX + code),
      tagLength: 128,
    },
    aesKey,
    bytes.subarray(12),
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}

/** Fails the test if anything was written to the console: nothing here logs. */
function watchConsole() {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    vi.spyOn(console, name),
  );
  return () => {
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  };
}

interface FakeElement {
  hidden?: boolean;
  value: string;
  textContent: string;
  className: string;
  disabled: boolean;
  href?: string;
  focus(): void;
  listeners: Record<string, (event: { preventDefault(): void }) => void>;
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
}

/**
 * Runs a phone page's own script against stand-in elements, as a phone that
 * opened `page` + `hash` would. Its fetch goes to the Worker, or to `reach`
 * for a phone that cannot; what it sends and where it leaves the address bar
 * are recorded.
 */
async function runPage(
  env: Env,
  page: '/' | '/subdl',
  hash: string,
  /** null for a browser with no Web Crypto. */
  webCrypto: Pick<Crypto, 'subtle' | 'getRandomValues'> | null = crypto,
  reach: (request: Request) => Promise<Response> = (request) => worker.fetch(request, env),
) {
  const script = await (await call(env, 'GET', page === '/' ? '/app.js' : '/subdl.js')).text();
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    let found = elements.get(id);
    if (!found) {
      const listeners: FakeElement['listeners'] = {};
      found = {
        value: '',
        textContent: '',
        className: '',
        disabled: false,
        focus: () => {},
        listeners,
        addEventListener: (type, listener) => void (listeners[type] = listener),
      };
      elements.set(id, found);
    }
    return found;
  };
  const location = { hash, pathname: page };
  const addresses: string[] = [];
  const history = {
    replaceState(_state: unknown, _title: string, url: string) {
      addresses.push(url);
      location.hash = '';
    },
  };
  const bodies: string[] = [];
  const fetch = (path: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return reach(new Request(ORIGIN + path, init));
  };
  const window = { crypto: webCrypto ?? undefined, TextEncoder };
  const run = new Function('window', 'document', 'location', 'history', 'fetch', script) as (
    ...args: unknown[]
  ) => void;
  run(window, { getElementById: element }, location, history, fetch);
  return {
    element,
    location,
    addresses,
    bodies,
    async submit() {
      element('send').listeners.submit?.({ preventDefault: () => {} });
      await vi.waitFor(() => {
        expect(element('status').textContent).not.toBe('Sending…');
        expect(element('submit').disabled).toBe(false);
      });
      return element('status');
    },
  };
}

describe('pairing relay', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('passes one address from the phone to the TV, then forgets it', async () => {
    const { env, objects, written } = fakeEnv();
    const session = await open(env);
    expect(readCode(session.code)).toBe(session.code);
    expect(session.secret.length).toBeGreaterThanOrEqual(43);
    expect(session.expiresIn).toBe(600);
    expect(session.pageUrl).toBe(`${ORIGIN}/#code=${session.code}`);
    expect(session.kind).toBe('addon');

    const waiting = await collect(env, session.code, session.secret);
    expect(await waiting.json()).toEqual({ status: 'waiting', expiresIn: 600 });

    const sent = await send(
      env,
      session.code.toLowerCase(),
      'stremio://addon.example.com/k/manifest.json',
    );
    expect(sent.status).toBe(200);
    expect((await send(env, session.code, 'https://other.example.com')).status).toBe(409);

    const received = await collect(env, session.code, session.secret);
    expect(await received.json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/k/manifest.json',
    });
    // The phone can send nothing more, and the address never reached storage.
    expect((await send(env, session.code, 'https://addon.example.com')).status).toBe(404);
    expect(JSON.stringify(written)).not.toContain('addon.example.com');
    expectOnlySessionFields(written);

    // A TV whose answer was lost asks again and gets the address once more, for a short while.
    vi.setSystemTime(Date.now() + REDELIVER_MS - 1000);
    expect((await collect(env, session.code, 'not-the-secret')).status).toBe(403);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/k/manifest.json',
    });
    expect(objects.get(session.code)!.alarm()).toBe(Date.now() + 1000);
    vi.setSystemTime(Date.now() + 1000);
    expect((await collect(env, session.code, session.secret)).status).toBe(404);
  });

  it('forgets a collected address when the alarm fires', async () => {
    const { env, objects } = fakeEnv();
    const session = await open(env);
    await send(env, session.code, 'https://addon.example.com/manifest.json');
    expect((await collect(env, session.code, session.secret)).status).toBe(200);
    const entry = objects.get(session.code)!;
    expect(entry.alarm()).toBe(Date.now() + REDELIVER_MS);
    await entry.session.alarm();
    expect(entry.alarm()).toBeUndefined();
    expect((await collect(env, session.code, session.secret)).status).toBe(404);
  });

  it('gives the address only to the holder of the secret', async () => {
    const { env } = fakeEnv();
    const session = await open(env);
    await send(env, session.code, 'https://addon.example.com/manifest.json');
    expect((await collect(env, session.code, 'not-the-secret')).status).toBe(403);
    expect((await collect(env, session.code, '')).status).toBe(403);
    expect((await collect(env, session.code, session.secret)).status).toBe(200);
  });

  it('ends a session after ten minutes, with or without the alarm', async () => {
    const { env, objects } = fakeEnv();
    const session = await open(env);
    const entry = objects.get(session.code)!;
    expect(entry.alarm()).toBe(Date.now() + SESSION_TTL_MS);

    vi.setSystemTime(Date.now() + SESSION_TTL_MS);
    expect((await send(env, session.code, 'https://addon.example.com')).status).toBe(404);
    expect((await collect(env, session.code, session.secret)).status).toBe(404);

    await entry.session.alarm();
    expect(entry.alarm()).toBeUndefined();
  });

  it('gives the TV time to collect an address sent just before the end', async () => {
    const { env, objects } = fakeEnv();
    const session = await open(env);
    vi.setSystemTime(Date.now() + SESSION_TTL_MS - 1000);
    expect((await send(env, session.code, 'https://addon.example.com/manifest.json')).status).toBe(
      200,
    );
    expect(objects.get(session.code)!.alarm()).toBe(Date.now() + REDELIVER_MS);
    vi.setSystemTime(Date.now() + 10000);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/manifest.json',
    });
  });

  it('refuses addresses that are not web addresses, and unknown codes', async () => {
    const { env } = fakeEnv();
    const session = await open(env);
    for (const url of [
      '',
      'javascript:alert(1)',
      'ftp://x.example.com',
      'https://a.example.com/x y/manifest.json',
      42,
    ]) {
      const response = await send(env, session.code, url);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-url' });
    }
    const long = await send(
      env,
      session.code,
      'https://a.example.com/' + 'a'.repeat(MAX_URL_LENGTH),
    );
    expect(await long.json()).toEqual({ error: 'too-long' });
    const configured = `https://a.example.com/${'c'.repeat(4000)}/manifest.json`;
    expect((await send(env, session.code, configured)).status).toBe(200);
    const notJson = await call(
      env,
      'POST',
      `/api/sessions/${session.code}`,
      'https://a',
      'text/plain',
    );
    expect(await notJson.json()).toEqual({ error: 'invalid-url' });
    expect((await send(env, 'ABC12', 'https://addon.example.com')).status).toBe(404);
    expect((await send(env, 'ABCDE0', 'https://addon.example.com')).status).toBe(404);
    expect((await send(env, 'ABCDEF', 'https://addon.example.com')).status).toBe(404);
  });

  it('says what is wrong with what was sent before asking the session, as before there were kinds', async () => {
    const { env } = fakeEnv();
    const ended = await open(env);
    vi.setSystemTime(Date.now() + SESSION_TTL_MS);
    // A code never opened, and one that has run out: the field alone settles each answer.
    for (const code of ['HJK234', ended.code]) {
      const cases: [string, unknown][] = [
        [JSON.stringify({ url: 'javascript:alert(1)' }), { error: 'invalid-url' }],
        [JSON.stringify({ url: 42 }), { error: 'invalid-url' }],
        [JSON.stringify({ url: null }), { error: 'invalid-url' }],
        [
          JSON.stringify({ url: 'https://a.example.com/' + 'a'.repeat(MAX_URL_LENGTH) }),
          { error: 'too-long' },
        ],
        ['https://a', { error: 'invalid-url' }],
        [JSON.stringify({ sealed: 'A'.repeat(SEALED_MIN_LENGTH - 1) }), { error: 'invalid-key' }],
        [JSON.stringify({ sealed: 'A'.repeat(SEALED_MIN_LENGTH) + '=' }), { error: 'invalid-key' }],
      ];
      for (const [body, error] of cases) {
        const response = await call(env, 'POST', `/api/sessions/${code}`, body, 'text/plain');
        expect(response.status, body.slice(0, 40)).toBe(400);
        expect(await response.json(), body.slice(0, 40)).toEqual(error);
      }
      // Well formed, each needs the session, which has run out or never was.
      expect((await send(env, code, 'https://addon.example.com')).status).toBe(404);
      expect((await sendSealed(env, code, 'A'.repeat(SEALED_MIN_LENGTH))).status).toBe(404);
    }
    // Those answers never asked a session.
    const fresh = fakeEnv();
    await call(fresh.env, 'POST', '/api/sessions/HJK234', JSON.stringify({ url: 'ftp://x' }));
    await call(fresh.env, 'POST', '/api/sessions/HJK234', JSON.stringify({ sealed: '' }));
    await call(fresh.env, 'POST', '/api/sessions/HJK234', 'not json');
    expect(fresh.objects.size).toBe(0);
  });

  it('serves the phone page with a strict content security policy', async () => {
    const { env } = fakeEnv();
    const page = await call(env, 'GET', '/');
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Content-Security-Policy')).toBe(PAGE_CSP);
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
    const html = await page.text();
    expect(html).toContain('Send an addon to your TV');
    expect(html).toContain('<script src="/app.js" defer></script>');
    expect(html).not.toContain('subdl');
    expect((await call(env, 'GET', '/app.js')).headers.get('Content-Type')).toContain('javascript');
    expect((await call(env, 'GET', '/manifest.json')).status).toBe(404);
    expect((await call(env, 'PUT', '/api/sessions')).status).toBe(404);
  });
});

describe('SubDL key sessions', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes one sealed key from the phone to the TV, which alone can open it', async () => {
    const silent = watchConsole();
    const { env, objects, written } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    expect(session.kind).toBe('subdl-key');
    expect(session.pageUrl).toBe(`${ORIGIN}/subdl#code=${session.code}`);
    expect(session.expiresIn).toBe(600);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'waiting',
      expiresIn: 600,
    });

    const k = sealingKey();
    const sealed = await seal(k, session.code, FAKE_KEY);
    expect((await sendSealed(env, session.code.toLowerCase(), sealed)).status).toBe(200);
    const again = await sendSealed(env, session.code, await seal(k, session.code, FAKE_KEY));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already-sent' });

    const received = await collect(env, session.code, session.secret);
    expect(received.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const answer = (await received.json()) as { status: string; sealed: string };
    expect(answer).toEqual({ status: 'sent', sealed });
    expect(await unseal(k, session.code, answer.sealed)).toBe(FAKE_KEY);
    // Sealed for this code only, and with this sealing key only.
    await expect(unseal(k, 'ABCDEF', answer.sealed)).rejects.toThrow();
    await expect(unseal(sealingKey(), session.code, answer.sealed)).rejects.toThrow();

    // One delivery: the phone can send nothing more.
    expect((await sendSealed(env, session.code, sealed)).status).toBe(404);
    // A TV whose answer was lost asks again and gets the same answer, for a short while.
    vi.setSystemTime(Date.now() + REDELIVER_MS - 1000);
    expect((await collect(env, session.code, 'not-the-secret')).status).toBe(403);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'sent',
      sealed,
    });
    expect(objects.get(session.code)!.alarm()).toBe(Date.now() + 1000);
    vi.setSystemTime(Date.now() + 1000);
    expect((await collect(env, session.code, session.secret)).status).toBe(404);

    // Storage got the hash, the expiry and the kind, and never the sealed key.
    expectOnlySessionFields(written);
    expect(written).toEqual([
      {
        secretHash: await hashSecret(session.secret),
        expiresAt: expect.any(Number),
        kind: 'subdl-key',
      },
    ]);
    expect(JSON.stringify(written)).not.toContain(sealed);
    silent();
  });

  it('gives the TV time to collect a key sent just before the end', async () => {
    const { env, objects, written } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    vi.setSystemTime(Date.now() + SESSION_TTL_MS - 1000);
    const sealed = await seal(sealingKey(), session.code, FAKE_KEY);
    expect((await sendSealed(env, session.code, sealed)).status).toBe(200);
    expect(objects.get(session.code)!.alarm()).toBe(Date.now() + REDELIVER_MS);
    vi.setSystemTime(Date.now() + 10000);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'sent',
      sealed,
    });
    // The extension keeps the session's kind.
    expectOnlySessionFields(written);
    expect(written.map((value) => (value as { kind: string }).kind)).toEqual([
      'subdl-key',
      'subdl-key',
    ]);
    expect(JSON.stringify(written)).not.toContain(sealed);
  });

  it("refuses the other kind's payload, both ways", async () => {
    const { env } = fakeEnv();
    const keySession = await open(env, '?for=subdl-key');
    const addonSession = await open(env);

    const address = await send(env, keySession.code, 'https://addon.example.com/manifest.json');
    expect(address.status).toBe(400);
    expect(await address.json()).toEqual({ error: 'wrong-kind' });
    const sealed = await seal(sealingKey(), addonSession.code, FAKE_KEY);
    const key = await sendSealed(env, addonSession.code, sealed);
    expect(key.status).toBe(400);
    expect(await key.json()).toEqual({ error: 'wrong-kind' });

    // Neither session took anything, so each still takes its own kind.
    expect(
      (await sendSealed(env, keySession.code, await seal(sealingKey(), keySession.code, FAKE_KEY)))
        .status,
    ).toBe(200);
    expect((await send(env, addonSession.code, 'https://addon.example.com/m.json')).status).toBe(
      200,
    );
    expect(await (await collect(env, addonSession.code, addonSession.secret)).json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/m.json',
    });
  });

  it('refuses sealed keys that are not the right shape', async () => {
    const { env } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    const good = await seal(sealingKey(), session.code, FAKE_KEY);
    for (const sealed of [
      good.slice(0, -1) + '+',
      good.slice(0, -1) + '/',
      good + '=',
      good.slice(0, 20) + ' ' + good.slice(21),
      'A'.repeat(SEALED_MIN_LENGTH - 1),
      'A'.repeat(SEALED_MAX_LENGTH + 1),
      '',
      42,
      null,
    ]) {
      const response = await sendSealed(env, session.code, sealed);
      expect(response.status, String(sealed)).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-key' });
    }
    for (const body of ['{}', '[]']) {
      const response = await call(env, 'POST', `/api/sessions/${session.code}`, body, 'text/plain');
      expect(await response.json(), body).toEqual({ error: 'invalid-key' });
    }
    // What is not JSON at all is answered as it was before there were kinds.
    const notJson = await call(env, 'POST', `/api/sessions/${session.code}`, 'not json');
    expect(await notJson.json()).toEqual({ error: 'invalid-url' });
    // None of those used the session up.
    expect((await sendSealed(env, session.code, good)).status).toBe(200);
  });

  it('refuses a kind it does not know, with the headers the TV can read', async () => {
    const { env, objects } = fakeEnv();
    for (const query of ['?for=subtitles', '?for=', '?for=SUBDL-KEY']) {
      const response = await call(env, 'POST', '/api/sessions' + query);
      expect(response.status, query).toBe(400);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'unknown-kind' });
    }
    expect(objects.size).toBe(0);
    const addon = await open(env, '?for=addon');
    expect(addon.kind).toBe('addon');
    expect(addon.pageUrl).toBe(`${ORIGIN}/#code=${addon.code}`);
  });

  it('treats a session stored before there were kinds as an addon session', async () => {
    const { env, objects, written } = fakeEnv();
    const code = 'HJK234';
    const secret = 'an-old-sessions-secret';
    env.SESSIONS.get(env.SESSIONS.idFromName(code));
    objects.get(code)!.values.set('session', {
      secretHash: await hashSecret(secret),
      expiresAt: Date.now() + 1000,
    });

    const key = await sendSealed(env, code, await seal(sealingKey(), code, FAKE_KEY));
    expect(await key.json()).toEqual({ error: 'wrong-kind' });
    expect((await send(env, code, 'https://addon.example.com/manifest.json')).status).toBe(200);
    // Sent in its last second, so it was kept open, now with its kind written down.
    expect(written).toEqual([
      { secretHash: await hashSecret(secret), expiresAt: Date.now() + REDELIVER_MS, kind: 'addon' },
    ]);
    expect(await (await collect(env, code, secret)).json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/manifest.json',
    });
  });

  it('serves the SubDL key page with the same policy as the addon page', async () => {
    const { env } = fakeEnv();
    const page = await call(env, 'GET', '/subdl');
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('Content-Security-Policy')).toBe(PAGE_CSP);
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const html = await page.text();
    expect(html).toContain('<title>Send your SubDL key to BannerTV</title>');
    expect(html).toContain('Paste your SubDL key here and your TV saves it.');
    expect(html).toContain(
      '<a class="button secondary" href="https://subdl.com/panel/api" target="_blank" rel="noopener noreferrer">Open SubDL</a>',
    );
    expect(html).toContain(
      '<input id="key" type="text" autocomplete="off" autocapitalize="off" spellcheck="false">',
    );
    expect(html).toContain('<script src="/subdl.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<div id="ready" hidden>');
    const script = await call(env, 'GET', '/subdl.js');
    expect(script.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).not.toContain('console');
    expect((await call(env, 'HEAD', '/subdl')).status).toBe(200);
  });
});

describe('the phone pages', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('the SubDL page seals the key as the TV opens it, and sends nothing else', async () => {
    const silent = watchConsole();
    const { env } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    const k = sealingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // The page's own IV, made known so its sealed text can be compared exactly.
    const knownIv = {
      subtle: crypto.subtle,
      getRandomValues: (array: Uint8Array) => (array.set(iv), array),
    } as unknown as Crypto;
    const page = await runPage(
      env,
      '/subdl',
      `#code=${session.code.toLowerCase()}&k=${toBase64Url(k)}`,
      knownIv,
    );
    // The fragment, sealing key and all, is gone from the address bar.
    expect(page.addresses).toEqual(['/subdl']);
    expect(page.location.hash).toBe('');
    expect(page.element('scan').hidden).toBe(true);
    expect(page.element('ready').hidden).toBe(false);

    page.element('key').value = `  ${FAKE_KEY} `;
    const status = await page.submit();
    expect(status.textContent).toBe("Sent. Check your TV: it's checking the key with SubDL now.");
    expect(status.className).toBe('status done');
    expect(page.element('key').value).toBe('');
    expect(page.bodies).toEqual([
      JSON.stringify({ sealed: await seal(k, session.code, FAKE_KEY, iv) }),
    ]);
    expect(page.bodies[0]).not.toContain(FAKE_KEY);

    const answer = (await (await collect(env, session.code, session.secret)).json()) as {
      sealed: string;
    };
    expect(await unseal(k, session.code, answer.sealed)).toBe(FAKE_KEY);
    silent();
  });

  it('the SubDL page seals with a fresh IV each time', async () => {
    const { env } = fakeEnv();
    const k = sealingKey();
    const sealedTexts: string[] = [];
    for (let i = 0; i < 2; i++) {
      const session = await open(env, '?for=subdl-key');
      const page = await runPage(env, '/subdl', `#code=${session.code}&k=${toBase64Url(k)}=`);
      page.element('key').value = FAKE_KEY;
      expect((await page.submit()).className).toBe('status done');
      const { sealed } = JSON.parse(page.bodies[0]!) as { sealed: string };
      expect(await unseal(k, session.code, sealed)).toBe(FAKE_KEY);
      sealedTexts.push(sealed.slice(0, 16));
    }
    expect(sealedTexts[0]).not.toBe(sealedTexts[1]);
  });

  it('the SubDL page shows only the scan message without a code and a sealing key', async () => {
    const { env } = fakeEnv();
    const k = toBase64Url(sealingKey());
    for (const hash of [
      '',
      '#code=HJK234',
      `#k=${k}`,
      `#code=HJK23&k=${k}`,
      `#code=HJK234&k=${k.slice(1)}`,
      `#code=HJK234&k=${k}A`,
      `#code=HJK234&k=${k.slice(0, -1)}+`,
    ]) {
      const page = await runPage(env, '/subdl', hash);
      // The page starts with the scan message showing and the form hidden; the script leaves them.
      expect(page.element('ready').hidden, hash).toBeUndefined();
      expect(page.element('scan').hidden, hash).toBeUndefined();
      expect(page.element('send').listeners.submit, hash).toBeUndefined();
      expect(page.addresses).toEqual(hash ? ['/subdl'] : []);
    }
  });

  it('the SubDL page checks the key and says what went wrong', async () => {
    const { env } = fakeEnv();
    const k = toBase64Url(sealingKey());

    const session = await open(env, '?for=subdl-key');
    const page = await runPage(env, '/subdl', `#code=${session.code}&k=${k}`);
    for (const typed of ['', 'short', 'has spaces in it', 'x'.repeat(129)]) {
      page.element('key').value = typed;
      const status = await page.submit();
      expect(status.textContent).toBe(
        "That doesn't look like a SubDL key. Copy it again from SubDL.",
      );
      expect(status.className).toBe('status error');
    }
    expect(page.bodies).toEqual([]);
    page.element('key').value = FAKE_KEY;
    await page.submit();
    page.element('key').value = FAKE_KEY;
    expect((await page.submit()).textContent).toBe(
      'Your TV already has a key from this code. Scan the new code on your TV to send another.',
    );
    // The field keeps what was typed when the send did not go through.
    expect(page.element('key').value).toBe(FAKE_KEY);

    const addon = await open(env);
    const wrong = await runPage(env, '/subdl', `#code=${addon.code}&k=${k}`);
    wrong.element('key').value = FAKE_KEY;
    expect((await wrong.submit()).textContent).toBe(
      "That code is for adding an addon. Scan the code on your TV's SubDL screen.",
    );

    const gone = await runPage(env, '/subdl', `#code=HJK234&k=${k}`);
    gone.element('key').value = FAKE_KEY;
    expect((await gone.submit()).textContent).toBe(
      'That code has run out. Open SubDL subtitles on your TV for a new one.',
    );
  });

  it('the SubDL page says when it cannot reach BannerTV, and lets the viewer try again', async () => {
    const { env } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    const hash = `#code=${session.code}&k=${toBase64Url(sealingKey())}`;
    const answers: [() => Promise<Response>, string][] = [
      [
        () => Promise.reject(new TypeError('Failed to fetch')),
        "Couldn't reach BannerTV. Check your connection and try again.",
      ],
      [
        () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })),
        'Something went wrong. Try again.',
      ],
    ];
    for (const [answer, message] of answers) {
      const page = await runPage(env, '/subdl', hash, crypto, answer);
      page.element('key').value = FAKE_KEY;
      // submit() waits for the button to be pressable again.
      const status = await page.submit();
      expect(status.textContent).toBe(message);
      expect(status.className).toBe('status error');
      expect(page.element('submit').disabled).toBe(false);
      // The field keeps the key, so it can be sent again as it is.
      expect(page.element('key').value).toBe(FAKE_KEY);
      expect(page.bodies).toHaveLength(1);
      expect(page.bodies[0]).not.toContain(FAKE_KEY);
    }
    // Nothing reached the session, which still takes a key.
    const page = await runPage(env, '/subdl', hash);
    page.element('key').value = FAKE_KEY;
    expect((await page.submit()).className).toBe('status done');
  });

  it('the SubDL page says so when the browser cannot seal', async () => {
    const { env } = fakeEnv();
    const session = await open(env, '?for=subdl-key');
    const page = await runPage(
      env,
      '/subdl',
      `#code=${session.code}&k=${toBase64Url(sealingKey())}`,
      null,
    );
    const message = "This browser can't lock the key before sending it. Try another browser.";
    expect(page.element('status').textContent).toBe(message);
    page.element('key').value = FAKE_KEY;
    expect((await page.submit()).textContent).toBe(message);
    expect(page.bodies).toEqual([]);
  });

  it('the addon page still sends an address, as before', async () => {
    const { env } = fakeEnv();
    const session = await open(env);
    const page = await runPage(env, '/', `#code=${session.code}`);
    expect(page.addresses).toEqual(['/']);
    expect(page.element('code-value').textContent).toBe(session.code);
    page.element('url').value = 'stremio://addon.example.com/k/manifest.json';
    const status = await page.submit();
    expect(status.textContent).toBe(
      'Sent. Check your TV: the address is waiting there for you to add.',
    );
    expect(page.bodies).toEqual([
      JSON.stringify({ url: 'stremio://addon.example.com/k/manifest.json' }),
    ]);
    expect(await (await collect(env, session.code, session.secret)).json()).toEqual({
      status: 'sent',
      url: 'https://addon.example.com/k/manifest.json',
    });
  });
});

describe('readAddonUrl', () => {
  it('accepts web and stremio addresses, adding https:// when it is missing', () => {
    expect(readAddonUrl(' https://a.example.com/manifest.json ')).toBe(
      'https://a.example.com/manifest.json',
    );
    expect(readAddonUrl('STREMIO://a.example.com/x/manifest.json')).toBe(
      'https://a.example.com/x/manifest.json',
    );
    expect(readAddonUrl('a.example.com/manifest.json')).toBe('https://a.example.com/manifest.json');
    expect(readAddonUrl('http://192.168.1.20:7000/manifest.json')).toBe(
      'http://192.168.1.20:7000/manifest.json',
    );
    expect(readAddonUrl('nas.local:7000/manifest.json')).toBe(
      'https://nas.local:7000/manifest.json',
    );
    expect(readAddonUrl('data:text/plain,hi')).toBeUndefined();
  });

  it('accepts the addresses the TV accepts, and refuses the ones it refuses', () => {
    for (const input of [
      'https://a.example.com/manifest.json',
      ' stremio://a.example.com/k=1/manifest.json ',
      'a.example.com/conf',
      'nas.local:7000/manifest.json',
      'mediaserver:7000/manifest.json',
      'addon.example.com:8443/k/manifest.json',
      'http://192.168.1.20:7000/manifest.json?x=1',
      'HTTPS://A.EXAMPLE.COM/manifest.json',
      'https://a.example.com/x y/manifest.json',
      'ftp://a.example.com/manifest.json',
      'not a url',
      'https:///manifest.json',
      '',
    ]) {
      const relayed = readAddonUrl(input);
      expect(relayed === undefined, input).toBe(normalizeManifestUrl(input) === undefined);
      if (relayed !== undefined) {
        expect(normalizeManifestUrl(relayed), input).toBe(normalizeManifestUrl(input));
      }
    }
    // The one deliberate difference: the relay caps the length.
    const long = 'https://a.example.com/' + 'a'.repeat(MAX_URL_LENGTH);
    expect(normalizeManifestUrl(long)).toBeDefined();
    expect(readAddonUrl(long)).toBeUndefined();
  });
});

describe('session kinds and sealed keys', () => {
  it('reads the kind a TV asks for', () => {
    expect(readSessionKind(null)).toBe('addon');
    expect(readSessionKind('addon')).toBe('addon');
    expect(readSessionKind('subdl-key')).toBe('subdl-key');
    expect(readSessionKind('')).toBeUndefined();
    expect(readSessionKind('Subdl-Key')).toBeUndefined();
  });

  it('checks keys exactly as the TV does', () => {
    expect(SUBDL_KEY_PATTERN.source).toBe(CORE_SUBDL_KEY_PATTERN.source);
    expect(SUBDL_KEY_PATTERN.flags).toBe(CORE_SUBDL_KEY_PATTERN.flags);
  });

  it('allows every sealed key the phone can make, and only base64url', async () => {
    const k = sealingKey();
    const shortest = await seal(k, 'HJK234', 'k'.repeat(8));
    const longest = await seal(k, 'HJK234', 'k'.repeat(128));
    expect(shortest.length).toBe(SEALED_MIN_LENGTH);
    expect(longest.length).toBe(208);
    expect(readSealed(shortest)).toBe(shortest);
    expect(readSealed(longest)).toBe(longest);
    expect(readSealed('A'.repeat(SEALED_MAX_LENGTH))).toBeDefined();
    expect(readSealed('A'.repeat(SEALED_MAX_LENGTH + 1))).toBeUndefined();
    expect(readSealed('A'.repeat(SEALED_MIN_LENGTH - 1))).toBeUndefined();
    expect(readSealed(` ${shortest}`)).toBeUndefined();
    expect(readSealed(shortest.slice(1) + '.')).toBeUndefined();
    expect(readSealed(undefined)).toBeUndefined();
  });

  it("reads what the phone sent by the session's kind", () => {
    const sealed = 'A'.repeat(SEALED_MIN_LENGTH);
    expect(readSubmission('subdl-key', { sealed })).toEqual({ sealed });
    expect(readSubmission('subdl-key', { sealed, url: 'https://a.example.com' })).toEqual({
      sealed,
    });
    expect(readSubmission('subdl-key', { url: 'https://a.example.com' })).toEqual({
      error: 'wrong-kind',
    });
    expect(readSubmission('subdl-key', undefined)).toEqual({ error: 'invalid-key' });
    expect(readSubmission('addon', { url: 'a.example.com', sealed })).toEqual({
      url: 'https://a.example.com',
    });
    expect(readSubmission('addon', { sealed })).toEqual({ error: 'wrong-kind' });
    expect(readSubmission('addon', [])).toEqual({ error: 'invalid-url' });
    expect(readSubmission('addon', { url: 'https://a.example.com/' + 'a'.repeat(9000) })).toEqual({
      error: 'too-long',
    });
  });
});

describe('readCode', () => {
  it('reads codes as people type them', () => {
    expect(readCode('abc 234')).toBe('ABC234');
    expect(readCode('ABC-234')).toBe('ABC234');
    expect(readCode('ABC23O')).toBeUndefined();
    expect(readCode('ABC2345')).toBeUndefined();
  });
});

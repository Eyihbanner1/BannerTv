import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeManifestUrl } from '@bannertv/protocol';
import { readAddonUrl, readCode, REDELIVER_MS, SESSION_TTL_MS } from './rules';
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
  const objects = new Map<string, { session: PairSession; alarm: () => number | undefined }>();
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
        entry = { session: new PairSession({ storage }), alarm: () => alarm };
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

async function open(env: Env) {
  const response = await call(env, 'POST', '/api/sessions');
  expect(response.status).toBe(201);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  return (await response.json()) as {
    code: string;
    secret: string;
    expiresIn: number;
    pageUrl: string;
  };
}

const send = (env: Env, code: string, url: unknown) =>
  call(env, 'POST', `/api/sessions/${code}`, JSON.stringify({ url }), 'application/json');

const collect = (env: Env, code: string, secret: string) =>
  call(env, 'POST', `/api/sessions/${code}/collect`, secret, 'text/plain');

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

  it('refuses addresses that are not web addresses, and unknown codes', async () => {
    const { env } = fakeEnv();
    const session = await open(env);
    for (const url of [
      '',
      'javascript:alert(1)',
      'ftp://x.example.com',
      'https://a.example.com/x y/manifest.json',
      42,
      'https://' + 'a'.repeat(2048),
    ]) {
      const response = await send(env, session.code, url);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid-url' });
    }
    expect((await send(env, 'ABC12', 'https://addon.example.com')).status).toBe(404);
    expect((await send(env, 'ABCDE0', 'https://addon.example.com')).status).toBe(404);
    expect((await send(env, 'ABCDEF', 'https://addon.example.com')).status).toBe(404);
  });

  it('serves the phone page with a strict content security policy', async () => {
    const { env } = fakeEnv();
    const page = await call(env, 'GET', '/');
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(page.headers.get('Content-Security-Policy')).toContain("form-action 'none'");
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await page.text()).toContain('Send an addon to your TV');
    expect((await call(env, 'GET', '/app.js')).headers.get('Content-Type')).toContain('javascript');
    expect((await call(env, 'GET', '/manifest.json')).status).toBe(404);
    expect((await call(env, 'PUT', '/api/sessions')).status).toBe(404);
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

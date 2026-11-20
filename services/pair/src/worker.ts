/**
 * The phone pairing relay: a Cloudflare Worker with one Durable Object per code.
 *
 * The TV opens a session and shows its code in a QR code. The phone opens the
 * page in that QR code and sends what the session is for: an addon address, or
 * a SubDL key sealed on the phone with a key only the TV holds (it rides in the
 * QR code's fragment and never reaches this Worker). The TV collects it with
 * the session's secret, which ends the session. A session lasts ten minutes
 * and takes one thing. Addon addresses can carry account keys, so nothing here
 * logs, and what the phone sent is held in memory only, never in storage.
 *
 * A Worker module may export only its handler and Durable Object classes (and
 * types), so the rules the tests check live in rules.ts.
 */
import { PAGE_FILES } from './page';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  type Payload,
  readCode,
  readSessionKind,
  readSubmission,
  REDELIVER_MS,
  SESSION_TTL_MS,
  type SessionKind,
  SUBDL_PAGE_PATH,
} from './rules';

// The few Workers runtime types this file uses, so it needs no type package.
export interface SessionStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface SessionState {
  storage: SessionStorage;
}

export interface SessionNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

export interface Env {
  SESSIONS: SessionNamespace;
}

interface Session {
  secretHash: string;
  expiresAt: number;
  /** Missing from sessions opened before there were kinds, which are addon sessions. */
  kind?: SessionKind;
}

interface Delivery {
  secretHash: string;
  payload: Payload;
  until: number;
}

function kindOf(stored: Session): SessionKind {
  return stored.kind === 'subdl-key' ? 'subdl-key' : 'addon';
}

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// The TV app runs from file://, so the TV's calls are cross-origin. They are
// simple requests (POST with a text body), so browsers send no preflight.
const TV_HEADERS = { ...API_HEADERS, 'Access-Control-Allow-Origin': '*' };

function json(body: unknown, status = 200, headers: Record<string, string> = API_HEADERS) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function randomCode(): string {
  const size = CODE_ALPHABET.length;
  // Bytes from here up would make the first few characters likelier than the rest.
  const limit = 256 - (256 % size);
  let code = '';
  const bytes = new Uint8Array(16);
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % size];
    }
  }
  return code;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return base64Url(new Uint8Array(digest));
}

function session(env: Env, code: string) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code));
}

async function openSession(request: Request, env: Env): Promise<Response> {
  const address = new URL(request.url);
  const kind = readSessionKind(address.searchParams.get('for'));
  if (!kind) return json({ error: 'unknown-kind' }, 400, TV_HEADERS);
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const secretHash = await hashSecret(secret);
  // A clash with a live session is unlikely (31^6 codes), but try again if it happens.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    const response = await session(env, code).fetch('https://session/open', {
      method: 'POST',
      body: JSON.stringify({ secretHash, kind }),
    });
    if (response.status === 409) continue;
    if (!response.ok) break;
    const page = kind === 'subdl-key' ? SUBDL_PAGE_PATH : '/';
    return json(
      {
        code,
        secret,
        expiresIn: Math.round(SESSION_TTL_MS / 1000),
        pageUrl: `${address.origin}${page}#code=${code}`,
        kind,
      },
      201,
      TV_HEADERS,
    );
  }
  return json({ error: 'unavailable' }, 503, TV_HEADERS);
}

async function submit(request: Request, env: Env, code: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-url' }, 400);
  }
  const { url, sealed } = (typeof body === 'object' && body !== null ? body : {}) as {
    url?: unknown;
    sealed?: unknown;
  };
  // Where the one field sent settles it, a malformed one is answered before the session is
  // asked, as before there were kinds, so a phone hears about it even for a code that has run
  // out. Anything else needs the session's kind (wrong-kind among it), so the session reads it.
  if (url !== undefined && sealed === undefined) {
    const sent = readSubmission('addon', { url });
    if ('error' in sent) return json({ error: sent.error }, 400);
  } else if (sealed !== undefined && url === undefined) {
    const sent = readSubmission('subdl-key', { sealed });
    if ('error' in sent) return json({ error: sent.error }, 400);
  }
  return session(env, code).fetch('https://session/submit', {
    method: 'POST',
    body: JSON.stringify({ url, sealed }),
  });
}

async function collect(request: Request, env: Env, code: string): Promise<Response> {
  const secret = (await request.text()).trim();
  if (!secret) return json({ error: 'forbidden' }, 403, TV_HEADERS);
  const response = await session(env, code).fetch('https://session/collect', {
    method: 'POST',
    body: JSON.stringify({ secretHash: await hashSecret(secret) }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: { ...TV_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = PAGE_FILES[pathname];
      if (!file) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : file.body, { headers: file.headers });
    }

    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          ...TV_HEADERS,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
    if (pathname === '/api/sessions') return openSession(request, env);
    const match = /^\/api\/sessions\/([^/]+)(\/collect)?$/.exec(pathname);
    const code = match && readCode(match[1] ?? '');
    if (!match || !code)
      return json({ error: 'not-found' }, 404, match?.[2] ? TV_HEADERS : API_HEADERS);
    return match[2] ? collect(request, env, code) : submit(request, env, code);
  },
};

/**
 * One pairing session, stored under the name of its code. Storage holds only
 * the secret's hash, the expiry time and the session's kind. What the phone
 * sent (an address or a sealed key) stays in this object's memory:
 * SQLite-backed storage can be restored to any point in the last 30 days, so
 * anything written there outlives deleteAll(). The TV asks every three
 * seconds, which keeps the object in memory between the phone's send and the
 * TV's collect. If the object is evicted anyway, it is lost and the phone can
 * send it again.
 */
export class PairSession {
  /** What the phone sent, until the TV collects it. */
  private payload: Payload | undefined;
  /** What was just collected, kept briefly in case the answer never reached the TV. */
  private delivered: Delivery | undefined;

  constructor(private readonly state: SessionState) {}

  private async live(): Promise<Session | undefined> {
    const stored = await this.state.storage.get<Session>('session');
    return stored && stored.expiresAt > Date.now() ? stored : undefined;
  }

  private async end(): Promise<void> {
    this.payload = undefined;
    this.delivered = undefined;
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const body = (await request.json()) as {
      secretHash?: string;
      kind?: string;
      url?: unknown;
      sealed?: unknown;
    };

    if (this.delivered && this.delivered.until <= Date.now()) this.delivered = undefined;
    if (pathname === '/collect' && this.delivered) {
      // The TV asks again only when it did not get the first answer.
      if (body.secretHash !== this.delivered.secretHash) return json({ error: 'forbidden' }, 403);
      return json({ status: 'sent', ...this.delivered.payload });
    }

    const current = await this.live();

    if (pathname === '/open') {
      if (current || this.delivered) return json({ error: 'in-use' }, 409);
      this.payload = undefined;
      const expiresAt = Date.now() + SESSION_TTL_MS;
      await this.state.storage.put<Session>('session', {
        secretHash: body.secretHash ?? '',
        expiresAt,
        kind: body.kind === 'subdl-key' ? 'subdl-key' : 'addon',
      });
      await this.state.storage.setAlarm(expiresAt);
      return json({ ok: true }, 201);
    }

    if (!current) return json({ error: 'expired' }, 404);

    if (pathname === '/submit') {
      const sent = readSubmission(kindOf(current), body);
      if ('error' in sent) return json({ error: sent.error }, 400);
      if (this.payload !== undefined) return json({ error: 'already-sent' }, 409);
      this.payload = sent;
      // Something sent just before the end still gives the TV time to collect it.
      const until = Date.now() + REDELIVER_MS;
      if (current.expiresAt < until) {
        await this.state.storage.put<Session>('session', {
          secretHash: current.secretHash,
          expiresAt: until,
          kind: kindOf(current),
        });
        await this.state.storage.setAlarm(until);
      }
      return json({ ok: true });
    }

    if (pathname === '/collect') {
      if (!body.secretHash || body.secretHash !== current.secretHash) {
        return json({ error: 'forbidden' }, 403);
      }
      const payload = this.payload;
      if (payload === undefined) {
        return json({
          status: 'waiting',
          expiresIn: Math.round((current.expiresAt - Date.now()) / 1000),
        });
      }
      // The session ends now: the phone can send nothing more, and only a
      // repeat collect inside the short window gets the same answer again.
      this.payload = undefined;
      this.delivered = {
        secretHash: current.secretHash,
        payload,
        until: Date.now() + REDELIVER_MS,
      };
      await this.state.storage.deleteAll();
      await this.state.storage.setAlarm(this.delivered.until);
      return json({ status: 'sent', ...payload });
    }

    return json({ error: 'not-found' }, 404);
  }

  async alarm(): Promise<void> {
    await this.end();
  }
}

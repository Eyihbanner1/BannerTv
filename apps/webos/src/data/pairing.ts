/**
 * "Send it from your phone": the TV side of the pairing relay (services/pair).
 *
 * The TV opens a session, shows its code and QR code, and asks the relay
 * every few seconds whether the phone has sent an address. Both calls are
 * simple cross-origin requests (POST with no body or a plain-text body), so
 * the TV never sends a preflight. The secret goes in the body, never the URL.
 *
 * A session is for an addon's address (the default) or for a SubDL key, which
 * the phone seals with a key only the TV holds (phone-key.ts), so the relay
 * passes on what it cannot read.
 */

/** The deployed relay (services/pair). Empty hides "Send it from your phone" and addon settings. */
export const PAIR_SERVICE = 'https://pair.bannertv.workers.dev';

export const POLL_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;
/**
 * How long after a session's end the TV keeps asking when it gets no answer.
 * The relay's "expired" answer normally ends it first. But an address sent
 * near the end keeps the session open 30 s more, and a collected address can
 * be collected again for another 30 s (REDELIVER_MS in services/pair).
 */
const GRACE_MS = 2 * 30000;

/** What the phone sends: an addon's address, or a sealed SubDL key. */
export type PairKind = 'addon' | 'subdl-key';

export interface PairSession {
  code: string;
  secret: string;
  /**
   * The phone page, with the code in its fragment: what the QR code holds (with
   * the TV's sealing key after the code, for a SubDL key).
   */
  pageUrl: string;
  /** When the relay forgets the session, by the TV's clock. */
  expiresAt: number;
}

export type PairingState =
  | { status: 'opening' }
  | { status: 'waiting'; session: PairSession }
  | { status: 'expired' }
  /**
   * `older`: the relay answered, but with no session of the kind asked for. An
   * older relay ignores the kind and opens an addon session, so trying again
   * would not help.
   */
  | { status: 'unavailable'; older?: true };

export interface Pairing {
  get(): PairingState;
  subscribe(listener: () => void): () => void;
  /** Sets who gets each address the phone sends; a new code follows at once. */
  onAddress(handler: (url: string) => void): () => void;
  /** As onAddress, for a SubDL key session: what the phone sealed, and the session it came by. */
  onSealed(handler: (sealed: string, session: PairSession) => void): () => void;
  /** Opens a new session (a new code) and waits for the phone. */
  start(): void;
  stop(): void;
}

export interface PairingOptions {
  service: string;
  /** 'addon' unless said otherwise. */
  kind?: PairKind;
  fetch?: typeof fetch;
  pollMs?: number;
  now?: () => number;
}

function readSession(value: unknown, now: number): PairSession | undefined {
  const body = value as Partial<Record<keyof PairSession | 'expiresIn', unknown>> | null;
  if (!body || typeof body !== 'object') return undefined;
  const { code, secret, pageUrl, expiresIn } = body;
  if (typeof code !== 'string' || typeof secret !== 'string' || typeof pageUrl !== 'string') {
    return undefined;
  }
  if (!/^https?:\/\//.test(pageUrl) || typeof expiresIn !== 'number') return undefined;
  return { code, secret, pageUrl, expiresAt: now + expiresIn * 1000 };
}

function originOf(service: string): string | undefined {
  try {
    return new URL(service).origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether the relay opened a SubDL key session whose page is its own key page.
 * The phone gets the TV's sealing key in that page's address, so the TV shows
 * no other page, and never an addon session's.
 */
function isKeySession(value: unknown, session: PairSession, origin: string | undefined): boolean {
  const { kind } = value as { kind?: unknown };
  return (
    kind === 'subdl-key' &&
    origin !== undefined &&
    /^[A-Za-z0-9]+$/.test(session.code) &&
    session.pageUrl === `${origin}/subdl#code=${session.code}`
  );
}

export function createPairing(options: PairingOptions): Pairing {
  const { service, kind = 'addon', pollMs = POLL_MS, now = Date.now } = options;
  const request = options.fetch ?? ((input, init) => fetch(input, init));
  const listeners = new Set<() => void>();
  let state: PairingState = { status: 'opening' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handler: ((url: string) => void) | undefined;
  let sealedHandler: ((sealed: string, session: PairSession) => void) | undefined;
  // Each start or stop moves on a generation, so late answers from the last one are ignored.
  let generation = 0;
  const keyOrigin = kind === 'subdl-key' ? originOf(service) : undefined;

  const set = (next: PairingState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const post = (path: string, body?: string): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return request(service + path, {
      method: 'POST',
      body,
      credentials: 'omit',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  };

  const poll = (session: PairSession, current: number) => {
    timer = setTimeout(() => {
      if (current !== generation) return;
      if (now() >= session.expiresAt + GRACE_MS) {
        set({ status: 'expired' });
        return;
      }
      post(`/api/sessions/${session.code}/collect`, session.secret)
        .then((response) => {
          if (response.status === 404) return { status: 'expired' };
          return response.ok ? response.json() : { status: 'retry' };
        })
        .catch(() => ({ status: 'retry' }))
        .then((answer: { status?: unknown; url?: unknown; sealed?: unknown }) => {
          if (current !== generation) return;
          if (kind === 'addon' && answer.status === 'sent' && typeof answer.url === 'string') {
            handler?.(answer.url);
            start();
          } else if (
            kind === 'subdl-key' &&
            answer.status === 'sent' &&
            typeof answer.sealed === 'string'
          ) {
            sealedHandler?.(answer.sealed, session);
            start();
          } else if (answer.status === 'expired') {
            set({ status: 'expired' });
          } else {
            // Waiting, or a dropped request: ask again until the session runs out.
            poll(session, current);
          }
        });
    }, pollMs);
  };

  function start() {
    clearTimeout(timer);
    const current = ++generation;
    set({ status: 'opening' });
    post(kind === 'addon' ? '/api/sessions' : `/api/sessions?for=${kind}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined)
      .then((body: unknown) => {
        if (current !== generation) return;
        const session = readSession(body, now());
        if (!session) {
          set({ status: 'unavailable' });
          return;
        }
        if (kind === 'subdl-key' && !isKeySession(body, session, keyOrigin)) {
          set({ status: 'unavailable', older: true });
          return;
        }
        set({ status: 'waiting', session });
        poll(session, current);
      });
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAddress(next) {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
    onSealed(next) {
      sealedHandler = next;
      return () => {
        if (sealedHandler === next) sealedHandler = undefined;
      };
    },
    start,
    stop() {
      generation++;
      clearTimeout(timer);
    },
  };
}

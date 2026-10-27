/**
 * "Send it from your phone": the TV side of the pairing relay (services/pair).
 *
 * The TV opens a session, shows its code and QR code, and asks the relay
 * every few seconds whether the phone has sent an address. Both calls are
 * simple cross-origin requests (POST with no body or a plain-text body), so
 * the TV never sends a preflight. The secret goes in the body, never the URL.
 */

/** The deployed relay (services/pair). Empty hides "Send it from your phone" and addon settings. */
export const PAIR_SERVICE = 'https://bannertv-pair.bannertv-pair.workers.dev';

export const POLL_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;

export interface PairSession {
  code: string;
  secret: string;
  /** The phone page, with the code in its fragment: what the QR code holds. */
  pageUrl: string;
  /** When the relay forgets the session, by the TV's clock. */
  expiresAt: number;
}

export type PairingState =
  | { status: 'opening' }
  | { status: 'waiting'; session: PairSession }
  | { status: 'expired' }
  | { status: 'unavailable' };

export interface Pairing {
  get(): PairingState;
  subscribe(listener: () => void): () => void;
  /** Sets who gets each address the phone sends; a new code follows at once. */
  onAddress(handler: (url: string) => void): () => void;
  /** Opens a new session (a new code) and waits for the phone. */
  start(): void;
  stop(): void;
}

export interface PairingOptions {
  service: string;
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

export function createPairing(options: PairingOptions): Pairing {
  const { service, pollMs = POLL_MS, now = Date.now } = options;
  const request = options.fetch ?? ((input, init) => fetch(input, init));
  const listeners = new Set<() => void>();
  let state: PairingState = { status: 'opening' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handler: ((url: string) => void) | undefined;
  // Each start or stop moves on a generation, so late answers from the last one are ignored.
  let generation = 0;

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
      if (now() >= session.expiresAt) {
        set({ status: 'expired' });
        return;
      }
      post(`/api/sessions/${session.code}/collect`, session.secret)
        .then((response) => {
          if (response.status === 404) return { status: 'expired' };
          return response.ok ? response.json() : { status: 'retry' };
        })
        .catch(() => ({ status: 'retry' }))
        .then((answer: { status?: unknown; url?: unknown }) => {
          if (current !== generation) return;
          if (answer.status === 'sent' && typeof answer.url === 'string') {
            handler?.(answer.url);
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
    post('/api/sessions')
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined)
      .then((body: unknown) => {
        if (current !== generation) return;
        const session = readSession(body, now());
        if (!session) {
          set({ status: 'unavailable' });
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
    start,
    stop() {
      generation++;
      clearTimeout(timer);
    },
  };
}

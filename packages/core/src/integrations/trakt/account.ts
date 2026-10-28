import { createPersisted } from '../../persisted';
import type { KeyValueStore } from '../../storage';
import { createStore, type Listener } from '../../store';
import { positive, record, text } from './read';
import {
  isOk,
  isSignedOutError,
  TraktError,
  type TraktMethod,
  type TraktRequest,
  type TraktResponse,
  type TraktSend,
} from './transport';

const KEY = 'trakt';
/**
 * Access tokens last a day (Trakt shortened them in March 2025), so a call
 * refreshes the token first once it has less than this left.
 */
export const TRAKT_REFRESH_BEFORE_MS = 60 * 60 * 1000;

export type TraktAccountState =
  | { status: 'loading' }
  /** `expired` when Trakt refused to refresh the sign-in, so Settings can say why. */
  | { status: 'signedOut'; expired?: boolean }
  | { status: 'signedIn'; username?: string };

export interface TraktAccount {
  /** Reads the saved sign-in. Safe to call more than once. */
  load(): Promise<void>;
  get(): TraktAccountState;
  subscribe(listener: Listener): () => void;
  /**
   * Keeps the tokens from Trakt's token answer (access_token, refresh_token,
   * expires_in), then asks Trakt for the username. Rejects an answer
   * without them.
   */
  signIn(answer: unknown): Promise<void>;
  /** Forgets the sign-in, and asks Trakt to revoke the token without waiting for it. */
  signOut(): Promise<void>;
  /**
   * A request with the profile's token, resolving with Trakt's answer
   * whatever its status. Refreshes the token first when it is about to run
   * out, and once after a 401. Rejects with a TraktError: `signedOut` when
   * the profile is not signed in or Trakt refused to refresh, otherwise as
   * the transport does.
   */
  call(method: TraktMethod, path: string, body?: unknown): Promise<TraktResponse>;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since 1970, by the TV's clock. */
  expiresAt: number;
}

interface Saved {
  tokens?: Tokens;
  username?: string;
  expired?: boolean;
}

const LOADING: TraktAccountState = { status: 'loading' };

function readSaved(saved: unknown): Saved {
  const raw = record(saved) ?? {};
  const value: Saved = {};
  const tokens = record(raw.tokens);
  const accessToken = text(tokens?.accessToken);
  const refreshToken = text(tokens?.refreshToken);
  const expiresAt = tokens?.expiresAt;
  if (accessToken && refreshToken && typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    value.tokens = { accessToken, refreshToken, expiresAt };
    const username = text(raw.username);
    if (username) value.username = username;
  } else if (raw.expired === true) {
    value.expired = true;
  }
  return value;
}

/**
 * The tokens in Trakt's token answer. Their life is counted from the TV's
 * clock rather than Trakt's created_at, because that is the clock it is
 * checked against: a TV a day fast would otherwise refresh on every call.
 */
function readTokens(answer: unknown, now: number): Tokens | undefined {
  const raw = record(answer);
  const accessToken = text(raw?.access_token);
  const refreshToken = text(raw?.refresh_token);
  const expiresIn = positive(raw?.expires_in);
  if (!accessToken || !refreshToken || expiresIn === undefined) return undefined;
  return { accessToken, refreshToken, expiresAt: now + expiresIn * 1000 };
}

function stateOf(loaded: boolean, saved: Saved): TraktAccountState {
  if (!loaded) return LOADING;
  if (saved.tokens) {
    return saved.username
      ? { status: 'signedIn', username: saved.username }
      : { status: 'signedIn' };
  }
  return saved.expired ? { status: 'signedOut', expired: true } : { status: 'signedOut' };
}

function sameState(a: TraktAccountState, b: TraktAccountState): boolean {
  if (a.status !== b.status) return false;
  if (a.status === 'signedIn' && b.status === 'signedIn') return a.username === b.username;
  if (a.status === 'signedOut' && b.status === 'signedOut') return !a.expired === !b.expired;
  return true;
}

const signedOut = () => new TraktError('signedOut', 'Not signed in to Trakt');

/** One profile's Trakt sign-in, kept in its key-value store. Tokens are never logged. */
export function createTraktAccount(options: {
  storage: KeyValueStore;
  send: TraktSend;
  now?: () => number;
}): TraktAccount {
  const { storage, send, now = Date.now } = options;
  const saved = createPersisted<Saved>({ storage, key: KEY, initial: {}, read: readSaved });
  const state = createStore<TraktAccountState>(LOADING);
  // Bumps at every sign-in and sign-out, so a username for an earlier one is not kept.
  let session = 0;
  let refreshing: { from: Tokens; promise: Promise<Tokens> } | undefined;

  function publish() {
    const next = stateOf(saved.loaded(), saved.get());
    if (!sameState(next, state.get())) state.set(next);
  }
  saved.subscribe(publish);

  async function load() {
    await saved.load();
    // Nothing saved leaves the value as it was, which tells no listener.
    publish();
  }

  const tokens = () => saved.get().tokens;

  function revoke(token: string) {
    try {
      send({ method: 'POST', path: '/oauth/revoke', body: { token } }).catch(() => undefined);
    } catch {
      // Best effort: the token runs out within a day anyway.
    }
  }

  async function refreshFrom(from: Tokens): Promise<Tokens> {
    const response = await send({
      method: 'POST',
      path: '/oauth/token',
      body: { refresh_token: from.refreshToken },
    });
    const fresh = isOk(response.status) ? readTokens(response.data, now()) : undefined;
    const refused = response.status === 400 || response.status === 401;
    if (!fresh && !refused) {
      throw new TraktError('other', `Trakt could not refresh the sign-in (${response.status})`);
    }
    await saved.update((value) => {
      // The answer is only for the tokens it was asked with.
      if (value.tokens !== from) return value;
      return fresh ? { ...value, tokens: fresh } : { expired: true };
    });
    const current = tokens();
    // Signed out, or in again, while Trakt answered: these tokens are nobody's.
    if (fresh && current !== fresh) revoke(fresh.accessToken);
    if (current) return current;
    throw refused ? new TraktError('signedOut', 'The Trakt sign-in has run out') : signedOut();
  }

  /** Fresh tokens in place of `used`, with one refresh shared by every call that needs it. */
  function refresh(used: Tokens): Promise<Tokens> {
    const current = tokens();
    if (!current) return Promise.reject(signedOut());
    // Another call refreshed after this one read the tokens.
    if (current.accessToken !== used.accessToken) return Promise.resolve(current);
    if (!refreshing || refreshing.from !== current) {
      const run = {
        from: current,
        promise: refreshFrom(current).finally(() => {
          if (refreshing === run) refreshing = undefined;
        }),
      };
      refreshing = run;
    }
    return refreshing.promise;
  }

  function request(method: TraktMethod, path: string, token: string, body: unknown): TraktRequest {
    const value: TraktRequest = { method, path, token };
    if (body !== undefined) value.body = body;
    return value;
  }

  async function call(method: TraktMethod, path: string, body?: unknown): Promise<TraktResponse> {
    await load();
    let current = tokens();
    if (!current) throw signedOut();
    if (current.expiresAt - now() < TRAKT_REFRESH_BEFORE_MS) {
      try {
        current = await refresh(current);
      } catch (error) {
        // A token with time left still works when Trakt could not be asked for a new one.
        if (isSignedOutError(error) || current.expiresAt <= now()) throw error;
      }
    }
    const response = await send(request(method, path, current.accessToken, body));
    if (response.status !== 401) return response;
    const fresh = await refresh(current);
    return send(request(method, path, fresh.accessToken, body));
  }

  return {
    load,
    get: state.get,
    subscribe: state.subscribe,
    async signIn(answer) {
      const fresh = readTokens(answer, now());
      if (!fresh) throw new TraktError('other', 'Trakt sent a sign-in BannerTV cannot read');
      session += 1;
      const mine = session;
      await saved.update(() => ({ tokens: fresh }));
      let username: string | undefined;
      try {
        const response = await call('GET', '/users/settings');
        if (isOk(response.status)) username = text(record(record(response.data)?.user)?.username);
      } catch {
        // The name only labels the account in Settings.
      }
      if (username === undefined || session !== mine) return;
      await saved.update((value) => (value.tokens ? { ...value, username } : value));
    },
    async signOut() {
      await load();
      const current = tokens();
      session += 1;
      if (current) revoke(current.accessToken);
      await saved.update((value) => (value.tokens || value.expired ? {} : value));
    },
    call,
  };
}

import { createStore, type Listener } from '../../store';
import type { TraktAccount } from './account';
import { positive, record, text } from './read';
import {
  isOk,
  realTimers,
  TraktError,
  type TraktErrorKind,
  type TraktResponse,
  type TraktSend,
  type TraktTimers,
} from './transport';

export type DeviceSignInState =
  | { status: 'idle' }
  | { status: 'starting' }
  /** Showing the code; `expiresAt` is in milliseconds since 1970. */
  | { status: 'waiting'; userCode: string; verificationUrl: string; expiresAt: number }
  | { status: 'done' }
  /** The code ran out before the viewer approved it. */
  | { status: 'expired' }
  /** The viewer turned the code down on trakt.tv. */
  | { status: 'denied' }
  | { status: 'failed'; kind: TraktErrorKind };

export interface DeviceSignIn {
  get(): DeviceSignInState;
  subscribe(listener: Listener): () => void;
  /**
   * Asks Trakt for a code, then asks at Trakt's interval whether the viewer
   * has approved it. Starts again when already running. Resolves once the
   * code is on show or could not be had; never rejects.
   */
  start(): Promise<void>;
  /** Stops asking, for leaving the screen. */
  stop(): void;
}

export interface DeviceSignInOptions {
  send: TraktSend;
  account: Pick<TraktAccount, 'signIn'>;
  now?: () => number;
  timers?: TraktTimers;
}

interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

/** One code being waited on. */
interface Poll {
  code: DeviceCode;
  /** Milliseconds since 1970. */
  expiresAt: number;
  run: number;
  /** Seconds between polls, longer each time Trakt asks the TV to slow down. */
  interval: number;
}

const IDLE: DeviceSignInState = { status: 'idle' };
const STARTING: DeviceSignInState = { status: 'starting' };
const DONE: DeviceSignInState = { status: 'done' };
const EXPIRED: DeviceSignInState = { status: 'expired' };
const DENIED: DeviceSignInState = { status: 'denied' };

function readCode(data: unknown): DeviceCode | undefined {
  const raw = record(data);
  const deviceCode = text(raw?.device_code);
  const userCode = text(raw?.user_code);
  if (!deviceCode || !userCode) return undefined;
  return {
    deviceCode,
    userCode,
    verificationUrl: text(raw?.verification_url) ?? 'https://trakt.tv/activate',
    expiresIn: positive(raw?.expires_in) ?? 600,
    // Never faster than once a second, whatever the answer says.
    interval: Math.max(1, positive(raw?.interval) ?? 5),
  };
}

const kindOf = (error: unknown): TraktErrorKind =>
  error instanceof TraktError ? error.kind : 'other';

/** Trakt's device sign-in (docs/adr/0004, item 10), as the TV shows it. */
export function createDeviceSignIn(options: DeviceSignInOptions): DeviceSignIn {
  const { send, account, now = Date.now, timers = realTimers } = options;
  const state = createStore<DeviceSignInState>(IDLE);
  // Bumps at every start and stop, so answers for an earlier run are dropped.
  let run = 0;
  let timer: { handle: unknown } | undefined;

  function cancel() {
    run += 1;
    if (timer) timers.clearTimeout(timer.handle);
    timer = undefined;
  }

  /** Asks again after `seconds`, or when the code runs out, so the screen says so on time. */
  function schedule(poll: Poll, seconds: number) {
    const ms = Math.max(0, Math.min(seconds * 1000, poll.expiresAt - now()));
    const scheduled = {
      handle: timers.setTimeout(() => {
        if (timer === scheduled) timer = undefined;
        if (poll.run === run) void ask(poll);
      }, ms),
    };
    timer = scheduled;
  }

  async function ask(poll: Poll) {
    if (now() >= poll.expiresAt) {
      state.set(EXPIRED);
      return;
    }
    let response: TraktResponse | undefined;
    try {
      response = await send({
        method: 'POST',
        path: '/oauth/device/token',
        body: { code: poll.code.deviceCode },
      });
    } catch {
      // No answer this time: ask again until the code runs out.
    }
    if (poll.run !== run) return;
    let wait = poll.interval;
    if (response) {
      const { status, retryAfter } = response;
      if (isOk(status)) {
        try {
          await account.signIn(response.data);
          if (poll.run === run) state.set(DONE);
        } catch (error) {
          if (poll.run === run) state.set({ status: 'failed', kind: kindOf(error) });
        }
        return;
      }
      if (status === 404 || status === 409) {
        // An unknown code, or one already used.
        state.set({ status: 'failed', kind: 'other' });
        return;
      }
      if (status === 410) {
        state.set(EXPIRED);
        return;
      }
      if (status === 418) {
        state.set(DENIED);
        return;
      }
      // 400 is "not approved yet". 429 asks the TV to slow down, from now on.
      if (status === 429 || retryAfter !== undefined) {
        poll.interval += 1;
        wait = Math.max(poll.interval, retryAfter ?? 0);
      }
    }
    schedule(poll, wait);
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    async start() {
      cancel();
      const mine = run;
      state.set(STARTING);
      let code: DeviceCode | undefined;
      try {
        const response = await send({ method: 'POST', path: '/oauth/device/code', body: {} });
        code = isOk(response.status) ? readCode(response.data) : undefined;
      } catch (error) {
        if (mine === run) state.set({ status: 'failed', kind: kindOf(error) });
        return;
      }
      if (mine !== run) return;
      if (!code) {
        state.set({ status: 'failed', kind: 'other' });
        return;
      }
      const poll: Poll = {
        code,
        expiresAt: now() + code.expiresIn * 1000,
        run: mine,
        interval: code.interval,
      };
      state.set({
        status: 'waiting',
        userCode: code.userCode,
        verificationUrl: code.verificationUrl,
        expiresAt: poll.expiresAt,
      });
      schedule(poll, poll.interval);
    },
    stop() {
      cancel();
      state.set(IDLE);
    },
  };
}

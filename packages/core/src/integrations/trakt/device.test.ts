import { describe, expect, it } from 'vitest';
import { createDeviceSignIn, type DeviceSignInState } from './device';
import {
  TraktError,
  type TraktRequest,
  type TraktResponse,
  type TraktSend,
  type TraktTimers,
} from './transport';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');

/** Trakt's answer to /oauth/device/code. */
const DEVICE_CODE = {
  device_code: 'd9c126a7706328d808914cfd1e40274b6e009f684b1aca271b9b3f90b3630d64',
  user_code: '5055CC52',
  verification_url: 'https://trakt.tv/activate',
  expires_in: 600,
  interval: 5,
};

const TOKENS = {
  access_token: 'dbaf9757982a9e738f05d249b7b5b4a266b3a139049317c4909f2f263572c781',
  token_type: 'bearer',
  expires_in: 86400,
  refresh_token: '76ba4c5c75c96f6087f58a4de10be6c00b29ea1ddc3b2022ee2016d1363e3a7c',
  scope: 'public',
  created_at: Math.floor(NOW / 1000),
};

const ok = (data: unknown, status = 200): TraktResponse => ({ status, data });

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A clock and timers that move only when the test says so. */
function fakeTime() {
  let now = NOW;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: TraktTimers = {
    setTimeout(callback, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      let due: number | undefined;
      for (const [id, timer] of pending) {
        if (timer.at <= end && (due === undefined || timer.at < pending.get(due)!.at)) due = id;
      }
      if (due === undefined) break;
      const timer = pending.get(due)!;
      pending.delete(due);
      now = timer.at;
      timer.callback();
      await flush();
    }
    now = end;
    await flush();
  }
  return { timers, now: () => now, advance, pending: () => pending.size };
}

/**
 * A fake Trakt for the device flow. `poll` answers each /oauth/device/token
 * in turn; the last answer repeats.
 */
function setup(options: {
  code?: () => TraktResponse | Promise<TraktResponse>;
  poll?: Array<() => TraktResponse | Promise<TraktResponse>>;
  signIn?: (answer: unknown) => Promise<void>;
}) {
  const time = fakeTime();
  const requests: { at: number; request: TraktRequest }[] = [];
  const answers = options.poll ?? [() => ok(null, 400)];
  let polls = 0;
  const send: TraktSend = (request) => {
    requests.push({ at: time.now() - NOW, request });
    if (request.path === '/oauth/device/code') {
      return Promise.resolve().then(options.code ?? (() => ok(DEVICE_CODE)));
    }
    const answer = answers[Math.min(polls++, answers.length - 1)]!;
    return Promise.resolve().then(answer);
  };
  const signedIn: unknown[] = [];
  const account = {
    signIn:
      options.signIn ??
      ((answer: unknown) => {
        signedIn.push(answer);
        return Promise.resolve();
      }),
  };
  const flow = createDeviceSignIn({ send, account, now: time.now, timers: time.timers });
  const states: DeviceSignInState[] = [];
  flow.subscribe(() => states.push(flow.get()));
  const polled = () =>
    requests.filter(({ request }) => request.path === '/oauth/device/token').map(({ at }) => at);
  return { flow, time, requests, polled, signedIn, states };
}

describe('createDeviceSignIn', () => {
  it("shows the code, then asks at Trakt's interval", async () => {
    const { flow, time, requests, polled } = setup({});
    expect(flow.get()).toEqual({ status: 'idle' });

    await flow.start();

    expect(flow.get()).toEqual({
      status: 'waiting',
      userCode: '5055CC52',
      verificationUrl: 'https://trakt.tv/activate',
      expiresAt: NOW + 600 * 1000,
    });
    expect(requests[0]!.request).toEqual({ method: 'POST', path: '/oauth/device/code', body: {} });
    await time.advance(4999);
    expect(polled()).toEqual([]);
    await time.advance(1);
    expect(requests[1]!.request).toEqual({
      method: 'POST',
      path: '/oauth/device/token',
      body: { code: DEVICE_CODE.device_code },
    });
    await time.advance(10000);
    expect(polled()).toEqual([5000, 10000, 15000]);
    expect(flow.get().status).toBe('waiting');
  });

  it('signs in with the token answer once the viewer approves', async () => {
    const { flow, time, polled, signedIn, states } = setup({
      poll: [() => ok({ error: 'authorization_pending' }, 400), () => ok(TOKENS)],
    });
    await flow.start();
    await time.advance(60000);

    expect(signedIn).toEqual([TOKENS]);
    expect(flow.get()).toEqual({ status: 'done' });
    expect(states.map((state) => state.status)).toEqual(['starting', 'waiting', 'done']);
    expect(polled()).toEqual([5000, 10000]);
    expect(time.pending()).toBe(0);
  });

  it('asks a second longer each time Trakt says to slow down', async () => {
    const slowDown = () => ok({ error: 'slow_down' }, 429);
    const { flow, time, polled } = setup({
      poll: [slowDown, slowDown, () => ok(null, 400)],
    });
    await flow.start();
    await time.advance(40000);
    expect(polled()).toEqual([5000, 11000, 18000, 25000, 32000, 39000]);
  });

  it('waits as long as Retry-After asks, once', async () => {
    const { flow, time, polled } = setup({
      poll: [() => ({ status: 429, data: null, retryAfter: 20 }), () => ok(null, 400)],
    });
    await flow.start();
    await time.advance(40000);
    expect(polled()).toEqual([5000, 25000, 31000, 37000]);
  });

  it.each([
    [404, { status: 'failed', kind: 'other' }],
    [409, { status: 'failed', kind: 'other' }],
    [410, { status: 'expired' }],
    [418, { status: 'denied' }],
  ])('stops when Trakt answers %i', async (status, state) => {
    const { flow, time, polled } = setup({ poll: [() => ok(null, 400), () => ok(null, status)] });
    await flow.start();
    await time.advance(60000);
    expect(flow.get()).toEqual(state);
    expect(polled()).toEqual([5000, 10000]);
    expect(time.pending()).toBe(0);
  });

  it('keeps asking through lost answers until the code runs out', async () => {
    const { flow, time, polled } = setup({
      code: () => ok({ ...DEVICE_CODE, expires_in: 28 }),
      poll: [
        () => Promise.reject(new TraktError('network', 'offline')),
        () => Promise.reject(new TraktError('unavailable', 'refused')),
        () => ok({ error: 'server_error' }, 503),
      ],
    });
    await flow.start();
    await time.advance(27999);
    expect(flow.get().status).toBe('waiting');
    expect(polled()).toEqual([5000, 10000, 15000, 20000, 25000]);
    await time.advance(1);
    expect(flow.get()).toEqual({ status: 'expired' });
    expect(polled()).toHaveLength(5);
    expect(time.pending()).toBe(0);
  });

  it('stops asking when stopped, and is idle again', async () => {
    const { flow, time, polled } = setup({});
    await flow.start();
    await time.advance(5000);
    flow.stop();
    expect(flow.get()).toEqual({ status: 'idle' });
    expect(time.pending()).toBe(0);
    await time.advance(60000);
    expect(polled()).toEqual([5000]);
  });

  it('drops answers that arrive after a stop', async () => {
    let answerPoll!: (response: TraktResponse) => void;
    const { flow, time, signedIn } = setup({
      poll: [() => new Promise<TraktResponse>((resolve) => (answerPoll = resolve))],
    });
    await flow.start();
    await time.advance(5000);
    flow.stop();
    answerPoll(ok(TOKENS));
    await flush();
    expect(signedIn).toEqual([]);
    expect(flow.get()).toEqual({ status: 'idle' });
    expect(time.pending()).toBe(0);

    let answerCode!: (response: TraktResponse) => void;
    const late = setup({
      code: () => new Promise<TraktResponse>((resolve) => (answerCode = resolve)),
    });
    const starting = late.flow.start();
    await flush();
    late.flow.stop();
    answerCode(ok(DEVICE_CODE));
    await starting;
    expect(late.flow.get()).toEqual({ status: 'idle' });
    expect(late.time.pending()).toBe(0);
  });

  it('starts over when started again', async () => {
    let codes = 0;
    const { flow, time, requests } = setup({
      code: () => ok({ ...DEVICE_CODE, device_code: `code-${++codes}`, user_code: `USER${codes}` }),
    });
    await flow.start();
    await time.advance(3000);
    await flow.start();
    expect(flow.get()).toMatchObject({ status: 'waiting', userCode: 'USER2' });
    await time.advance(5000);
    const polledCodes = requests
      .filter(({ request }) => request.path === '/oauth/device/token')
      .map(({ request }) => (request.body as { code: string }).code);
    expect(polledCodes).toEqual(['code-2']);
    expect(time.pending()).toBe(1);
  });

  it.each([
    ['network', () => Promise.reject(new TraktError('network', 'offline'))],
    ['unavailable', () => Promise.reject(new TraktError('unavailable', 'unconfigured'))],
    ['other', () => Promise.reject(new Error('odd'))],
    ['other', () => ok({ error: 'invalid_client' }, 401)],
    ['other', () => ok({ user_code: '5055CC52' })],
  ])('fails with %s when no code can be had', async (kind, code) => {
    const { flow, time } = setup({ code: code as () => Promise<TraktResponse> });
    await flow.start();
    expect(flow.get()).toEqual({ status: 'failed', kind });
    expect(time.pending()).toBe(0);
  });

  it('fails when the sign-in that follows approval fails', async () => {
    const { flow, time } = setup({
      poll: [() => ok(TOKENS)],
      signIn: () => Promise.reject(new TraktError('other', 'unreadable')),
    });
    await flow.start();
    await time.advance(5000);
    expect(flow.get()).toEqual({ status: 'failed', kind: 'other' });
  });

  it('fills in what the code answer leaves out, and never asks more than once a second', async () => {
    const plain = setup({ code: () => ok({ device_code: 'abc', user_code: 'XYZ' }) });
    await plain.flow.start();
    expect(plain.flow.get()).toEqual({
      status: 'waiting',
      userCode: 'XYZ',
      verificationUrl: 'https://trakt.tv/activate',
      expiresAt: NOW + 600 * 1000,
    });
    await plain.time.advance(10000);
    expect(plain.polled()).toEqual([5000, 10000]);

    const hasty = setup({ code: () => ok({ ...DEVICE_CODE, interval: 0.1 }) });
    await hasty.flow.start();
    await hasty.time.advance(3000);
    expect(hasty.polled()).toEqual([1000, 2000, 3000]);
  });
});

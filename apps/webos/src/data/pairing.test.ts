import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPairing, type PairingState } from './pairing';

const SERVICE = 'https://pair.example.com';

/**
 * A relay in memory that answers like services/pair, on the fake clock:
 * sessions last ten minutes, an address sent in the last 30 s keeps the
 * session open 30 s more, and a collected address can be collected again for
 * 30 s. It records what the TV sent.
 */
function fakeRelay() {
  const calls: { path: string; body: unknown }[] = [];
  let sessions = 0;
  let expiresAt = 0;
  let sent: string | undefined;
  let delivered: { url: string; until: number } | undefined;
  let gone = false;
  let down = false;
  let loseNext = false;
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  const answer = (path: string): Promise<Response> => {
    const now = Date.now();
    if (path === '/api/sessions') {
      sessions++;
      expiresAt = now + 600000;
      sent = undefined;
      delivered = undefined;
      gone = false;
      const code = `CODE0${sessions}`.slice(-6);
      return reply(201, {
        code,
        secret: `secret-${sessions}`,
        expiresIn: 600,
        pageUrl: `${SERVICE}/#code=${code}`,
      });
    }
    if (delivered && now < delivered.until)
      return reply(200, { status: 'sent', url: delivered.url });
    if (gone || now >= expiresAt) return reply(404, { error: 'expired' });
    if (sent !== undefined) {
      delivered = { url: sent, until: now + 30000 };
      sent = undefined;
      gone = true;
      return reply(200, { status: 'sent', url: delivered.url });
    }
    return reply(200, { status: 'waiting', expiresIn: Math.round((expiresAt - now) / 1000) });
  };

  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(SERVICE.length);
    calls.push({ path, body: init?.body });
    if (down) return Promise.reject(new TypeError('Failed to fetch'));
    const response = answer(path);
    if (!loseNext) return response;
    // The relay acts on the request, but its answer never reaches the TV.
    loseNext = false;
    return new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new TypeError('Failed to fetch')), 10000),
    );
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    send(url: string) {
      sent = url;
      expiresAt = Math.max(expiresAt, Date.now() + 30000);
    },
    expire: () => void (gone = true),
    setDown: (value: boolean) => void (down = value),
    loseNextAnswer: () => void (loseNext = true),
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

describe('createPairing', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('opens a session, waits for the phone, hands over the address and opens a new code', async () => {
    const relay = fakeRelay();
    const received: string[] = [];
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.onAddress((url) => received.push(url));
    const states: PairingState['status'][] = [];
    pairing.subscribe(() => states.push(pairing.get().status));

    pairing.start();
    await settle();
    const first = pairing.get();
    expect(first.status).toBe('waiting');
    if (first.status !== 'waiting') return;
    expect(first.session.code).toBe('CODE01');
    expect(first.session.pageUrl).toBe(`${SERVICE}/#code=CODE01`);

    await vi.advanceTimersByTimeAsync(3000);
    expect(relay.calls[1]).toEqual({ path: '/api/sessions/CODE01/collect', body: 'secret-1' });
    expect(received).toEqual([]);

    relay.send('https://addon.example.com/manifest.json');
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(received).toEqual(['https://addon.example.com/manifest.json']);
    const second = pairing.get();
    expect(second.status === 'waiting' && second.session.code).toBe('CODE02');
    expect(states).toEqual(['opening', 'waiting', 'opening', 'waiting']);
    pairing.stop();
  });

  it('says when the code has run out, and stops asking', async () => {
    const relay = fakeRelay();
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.start();
    await settle();
    relay.expire();
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(pairing.get().status).toBe('expired');
    const count = relay.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(relay.calls.length).toBe(count);
  });

  it('expires by the clock when the relay cannot be reached', async () => {
    const relay = fakeRelay();
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.start();
    await settle();
    relay.setDown(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(pairing.get().status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(600000);
    await settle();
    expect(pairing.get().status).toBe('expired');
  });

  it('collects an address sent at the very end, even when the first answer is lost', async () => {
    const relay = fakeRelay();
    const received: string[] = [];
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.onAddress((url) => received.push(url));
    pairing.start();
    await settle();
    // The phone sends just before the end, which keeps the session open 30 s more.
    await vi.advanceTimersByTimeAsync(598500);
    relay.send('https://addon.example.com/manifest.json');
    relay.setDown(true);
    await vi.advanceTimersByTimeAsync(27500);
    // The TV gets through at 627 s, and the relay hands over the address, but
    // the answer is lost; the TV asks again at 640 s, past its own end + 30 s.
    relay.setDown(false);
    relay.loseNextAnswer();
    await vi.advanceTimersByTimeAsync(13000);
    expect(received).toEqual([]);
    expect(pairing.get().status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(received).toEqual(['https://addon.example.com/manifest.json']);
    pairing.stop();
  });

  it('gives up once the relay has let the session go', async () => {
    const relay = fakeRelay();
    const received: string[] = [];
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.onAddress((url) => received.push(url));
    pairing.start();
    await settle();
    await vi.advanceTimersByTimeAsync(598500);
    relay.send('https://addon.example.com/manifest.json');
    relay.setDown(true);
    await vi.advanceTimersByTimeAsync(36500);
    relay.setDown(false);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(pairing.get().status).toBe('expired');
    expect(received).toEqual([]);
  });

  it('reports an unreachable relay, and ignores answers after stop', async () => {
    const relay = fakeRelay();
    relay.setDown(true);
    const onAddress = vi.fn();
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.onAddress(onAddress);
    pairing.start();
    await settle();
    expect(pairing.get().status).toBe('unavailable');

    relay.setDown(false);
    pairing.start();
    await settle();
    relay.send('https://addon.example.com/manifest.json');
    pairing.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(onAddress).not.toHaveBeenCalled();
    expect(relay.calls.filter((c) => c.path.endsWith('/collect'))).toEqual([]);
  });
});

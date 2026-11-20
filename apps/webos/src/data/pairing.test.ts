import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPairing, type PairingState } from './pairing';

const SERVICE = 'https://pair.example.com';

/**
 * A relay in memory that answers like services/pair, on the fake clock:
 * sessions last ten minutes, an address sent in the last 30 s keeps the
 * session open 30 s more, and a collected address can be collected again for
 * 30 s. It records what the TV sent.
 *
 * As it stands it is a relay from before session kinds, which opens an addon
 * session whatever it is asked. `kinds` makes it today's: it says each
 * session's kind, opens a SubDL key session when asked, and passes on what
 * the phone sealed. `keyPage` puts another page in a key session's answer,
 * and `keyAnswer` changes any other part of it.
 */
function fakeRelay(
  options: {
    kinds?: boolean;
    keyPage?: (code: string) => string;
    keyAnswer?: (code: string) => Record<string, unknown>;
  } = {},
) {
  const calls: { path: string; body: unknown }[] = [];
  let sessions = 0;
  let expiresAt = 0;
  let forKey = false;
  let sent: string | undefined;
  let delivered: { url: string; until: number } | undefined;
  let gone = false;
  let down = false;
  let loseNext = false;
  const reply = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  // What a collect hands over: an address, or what the phone sealed.
  const sentBody = (value: string) =>
    forKey ? { status: 'sent', sealed: value } : { status: 'sent', url: value };

  const answer = (path: string): Promise<Response> => {
    const now = Date.now();
    if (path === '/api/sessions' || path === '/api/sessions?for=subdl-key') {
      sessions++;
      expiresAt = now + 600000;
      sent = undefined;
      delivered = undefined;
      gone = false;
      forKey = options.kinds === true && path.endsWith('?for=subdl-key');
      const code = `CODE0${sessions}`.slice(-6);
      const body = {
        code,
        secret: `secret-${sessions}`,
        expiresIn: 600,
        pageUrl: `${SERVICE}/#code=${code}`,
      };
      if (!options.kinds) return reply(201, body);
      if (!forKey) return reply(201, { ...body, kind: 'addon' });
      const pageUrl = options.keyPage ? options.keyPage(code) : `${SERVICE}/subdl#code=${code}`;
      return reply(201, { ...body, pageUrl, kind: 'subdl-key', ...options.keyAnswer?.(code) });
    }
    if (delivered && now < delivered.until) return reply(200, sentBody(delivered.url));
    if (gone || now >= expiresAt) return reply(404, { error: 'expired' });
    if (sent !== undefined) {
      delivered = { url: sent, until: now + 30000 };
      sent = undefined;
      gone = true;
      return reply(200, sentBody(delivered.url));
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
    /** An address, or for a key session what the phone sealed. */
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

describe('createPairing for a SubDL key', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  // Stand-ins for what the phone seals: base64url text the TV never reads here.
  const SEALED = 'c2VhbGVkLW9uZQ-c2VhbGVkLW9uZQ-c2VhbGVkLW9uZQ-c2VhbGVk';
  const SEALED_AGAIN = 'c2VhbGVkLXR3bw-c2VhbGVkLXR3bw-c2VhbGVkLXR3bw-c2VhbGVk';

  it('asks for a key session, hands over what was sealed with its session and opens a new code', async () => {
    const relay = fakeRelay({ kinds: true });
    const sealed: { value: string; code: string }[] = [];
    const onAddress = vi.fn();
    const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
    pairing.onAddress(onAddress);
    pairing.onSealed((value, session) => sealed.push({ value, code: session.code }));
    const states: PairingState['status'][] = [];
    pairing.subscribe(() => states.push(pairing.get().status));

    pairing.start();
    await settle();
    expect(relay.calls[0]).toEqual({ path: '/api/sessions?for=subdl-key', body: undefined });
    const first = pairing.get();
    expect(first.status === 'waiting' && first.session.pageUrl).toBe(
      `${SERVICE}/subdl#code=CODE01`,
    );

    await vi.advanceTimersByTimeAsync(3000);
    expect(relay.calls[1]).toEqual({ path: '/api/sessions/CODE01/collect', body: 'secret-1' });
    relay.send(SEALED);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(sealed).toEqual([{ value: SEALED, code: 'CODE01' }]);
    const second = pairing.get();
    expect(second.status === 'waiting' && second.session.code).toBe('CODE02');
    expect(relay.calls[relay.calls.length - 1]!.path).toBe('/api/sessions?for=subdl-key');

    // Another key can follow on the new code.
    relay.send(SEALED_AGAIN);
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(sealed).toEqual([
      { value: SEALED, code: 'CODE01' },
      { value: SEALED_AGAIN, code: 'CODE02' },
    ]);
    expect(onAddress).not.toHaveBeenCalled();
    expect(states.slice(0, 4)).toEqual(['opening', 'waiting', 'opening', 'waiting']);
    pairing.stop();
  });

  it('takes an older relay, which opens an addon session whatever it is asked, as one that cannot', async () => {
    const relay = fakeRelay();
    const onSealed = vi.fn();
    const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
    pairing.onSealed(onSealed);
    pairing.start();
    await settle();
    expect(pairing.get()).toEqual({ status: 'unavailable', older: true });
    // Its addon page is never shown, and nothing is collected from it.
    await vi.advanceTimersByTimeAsync(30000);
    expect(relay.calls.map((c) => c.path)).toEqual(['/api/sessions?for=subdl-key']);
    expect(onSealed).not.toHaveBeenCalled();
  });

  it("shows no page but the relay's own key page", async () => {
    const elsewhere = [
      (code: string) => `https://other.example.com/subdl#code=${code}`,
      (code: string) => `${SERVICE}/#code=${code}`,
      (code: string) => `${SERVICE}/subdl?x=1#code=${code}`,
      () => `${SERVICE}/subdl#code=SOMEONE`,
    ];
    for (const keyPage of elsewhere) {
      const relay = fakeRelay({ kinds: true, keyPage });
      const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
      pairing.start();
      await settle();
      expect(pairing.get()).toEqual({ status: 'unavailable', older: true });
      pairing.stop();
    }
  });

  it("insists on the answer's kind, and on a code that cannot add to the page's address", async () => {
    const answers = [
      // The key page itself, but not said to be a key session.
      () => ({ kind: undefined }),
      () => ({ kind: 'addon' }),
      () => ({ kind: 'SUBDL-KEY' }),
      // A code that would put a second k in the QR code's address, on a page that matches it.
      () => ({ code: 'ABC234&k=X', pageUrl: `${SERVICE}/subdl#code=ABC234&k=X` }),
      () => ({ code: 'ABC 234', pageUrl: `${SERVICE}/subdl#code=ABC 234` }),
      () => ({ code: '', pageUrl: `${SERVICE}/subdl#code=` }),
    ];
    for (const keyAnswer of answers) {
      const relay = fakeRelay({ kinds: true, keyAnswer });
      const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
      pairing.start();
      await settle();
      expect(pairing.get(), JSON.stringify(keyAnswer())).toEqual({
        status: 'unavailable',
        older: true,
      });
      // Nothing is collected from such a session.
      await vi.advanceTimersByTimeAsync(10000);
      expect(relay.calls.map((c) => c.path)).toEqual(['/api/sessions?for=subdl-key']);
    }
    // The same answer as it should be is taken, so the cases above fail for their one change.
    const relay = fakeRelay({ kinds: true, keyAnswer: () => ({ kind: 'subdl-key' }) });
    const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
    pairing.start();
    await settle();
    expect(pairing.get().status).toBe('waiting');
    pairing.stop();
  });

  it('says an unreachable relay is unavailable, and can try again', async () => {
    const relay = fakeRelay({ kinds: true });
    relay.setDown(true);
    const pairing = createPairing({ service: SERVICE, kind: 'subdl-key', fetch: relay.fetch });
    pairing.start();
    await settle();
    expect(pairing.get()).toEqual({ status: 'unavailable' });
    relay.setDown(false);
    pairing.start();
    await settle();
    expect(pairing.get().status).toBe('waiting');
    pairing.stop();
  });

  it('keeps an addon session as it was on a relay that says its kinds', async () => {
    const relay = fakeRelay({ kinds: true });
    const received: string[] = [];
    const onSealed = vi.fn();
    const pairing = createPairing({ service: SERVICE, fetch: relay.fetch });
    pairing.onAddress((url) => received.push(url));
    pairing.onSealed(onSealed);
    pairing.start();
    await settle();
    expect(relay.calls[0]!.path).toBe('/api/sessions');
    const first = pairing.get();
    expect(first.status === 'waiting' && first.session.pageUrl).toBe(`${SERVICE}/#code=CODE01`);
    relay.send('https://addon.example.com/manifest.json');
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(received).toEqual(['https://addon.example.com/manifest.json']);
    expect(onSealed).not.toHaveBeenCalled();
    pairing.stop();
  });
});

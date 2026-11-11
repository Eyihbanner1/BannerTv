import { memoryKeyValueStore } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import {
  HELPER_PORT,
  HelperUnavailable,
  createStreamHelper,
  formatHelperAddress,
  helperOffer,
  parseHelperAddress,
  readHelperOffer,
} from './stream-helper';

const KEY = 'k'.repeat(32);

interface Call {
  url: string;
  init: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A helper on the home network that answers with `answer`, and notes every request. */
function fakeHelper(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function helperAnswers(call: Call): Response {
  if (call.url.endsWith('/status')) return json({ helper: 'bannertv' });
  if (call.url.endsWith('/pair')) {
    return String(call.init.body) === 'code=123456' ? json({ key: KEY }) : json({}, 403);
  }
  if (call.url.endsWith('/links')) return json({ link: '/s/token/aHR0cHM/live.m3u8' });
  if (call.url.endsWith('/forget')) return new Response(null, { status: 204 });
  return json({}, 404);
}

describe('helper address', () => {
  it('takes home-network addresses, with or without a port', () => {
    expect(parseHelperAddress('192.168.1.42')).toEqual({ host: '192.168.1.42', port: HELPER_PORT });
    expect(parseHelperAddress(' 10.0.0.7:47021 ')).toEqual({ host: '10.0.0.7', port: 47021 });
    expect(parseHelperAddress('172.20.3.4')).toEqual({ host: '172.20.3.4', port: HELPER_PORT });
  });

  it('refuses addresses off the home network or out of range', () => {
    for (const text of [
      '8.8.8.8',
      '172.32.0.1',
      '127.0.0.1',
      '192.168.1',
      '192.168.1.300',
      '192.168.1.4:0',
      '192.168.1.4:70000',
      'helper.local',
      // Leading zeros: the browser reads "010" as octal, so this would connect to 8.0.0.1.
      '010.0.0.1',
      '172.016.0.1',
      '192.168.01.42',
      '',
    ]) {
      expect(parseHelperAddress(text)).toBeNull();
    }
  });

  it('shows the port only when it is not the usual one', () => {
    expect(formatHelperAddress({ host: '192.168.1.42', port: HELPER_PORT })).toBe('192.168.1.42');
    expect(formatHelperAddress({ host: '192.168.1.42', port: 47021 })).toBe('192.168.1.42:47021');
  });
});

describe("a phone's offer", () => {
  it('carries the helper address and code, and reads back', () => {
    const offer = helperOffer('192.168.1.42', 47020, '123456');
    expect(offer).toBe('http://192.168.1.42:47020/pair?code=123456');
    expect(readHelperOffer(offer)).toEqual({ address: '192.168.1.42:47020', code: '123456' });
  });

  it('is refused for addon addresses, other networks and malformed codes', () => {
    expect(readHelperOffer('https://addon.example/manifest.json')).toBeNull();
    expect(readHelperOffer('http://8.8.8.8:47020/pair?code=123456')).toBeNull();
    expect(readHelperOffer('http://192.168.1.42:47020/pair?code=12345')).toBeNull();
    expect(readHelperOffer('http://192.168.1.42:47020/pair?code=123456&x=1')).toBeNull();
    expect(readHelperOffer('https://192.168.1.42:47020/pair?code=123456')).toBeNull();
    expect(readHelperOffer('http://192.168.1.42:99999/pair?code=123456')).toBeNull();
    expect(readHelperOffer('http://010.34.208.1:47020/pair?code=123456')).toBeNull();
  });
});

describe('pairing', () => {
  it('pairs with the code, keeps the key, and says the helper is on', async () => {
    const storage = memoryKeyValueStore();
    const helper = fakeHelper(helperAnswers);
    const tv = createStreamHelper({ storage, fetch: helper.fetch });
    expect(await tv.pair('192.168.1.42', '123 456')).toBe('paired');
    expect(tv.get()).toEqual({ host: '192.168.1.42', port: HELPER_PORT, key: KEY });
    expect(tv.reachability.get()).toBe('on');
    expect(helper.calls[0]!.url).toBe('http://192.168.1.42:47020/pair');

    const later = createStreamHelper({ storage, fetch: helper.fetch });
    await later.load();
    expect(later.get()).toEqual({ host: '192.168.1.42', port: HELPER_PORT, key: KEY });
  });

  it('says what went wrong without asking when the address or code is malformed', async () => {
    const helper = fakeHelper(helperAnswers);
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    expect(await tv.pair('8.8.8.8', '123456')).toBe('bad-address');
    expect(await tv.pair('192.168.1.42', '12345')).toBe('bad-code');
    expect(helper.calls).toHaveLength(0);
  });

  it('tells a wrong code from a helper that does not answer', async () => {
    const tv = createStreamHelper({
      storage: memoryKeyValueStore(),
      fetch: fakeHelper(helperAnswers).fetch,
    });
    expect(await tv.pair('192.168.1.42', '654321')).toBe('wrong-code');
    expect(tv.get()).toBeNull();

    const gone = fakeHelper(() => Promise.reject(new TypeError('Failed to fetch')));
    const away = createStreamHelper({ storage: memoryKeyValueStore(), fetch: gone.fetch });
    expect(await away.pair('192.168.1.42', '123456')).toBe('unreachable');
  });

  it('refuses a key that is not a key', async () => {
    const odd = fakeHelper(() => json({ key: 'short' }));
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: odd.fetch });
    expect(await tv.pair('192.168.1.42', '123456')).toBe('unreachable');
    expect(tv.get()).toBeNull();
  });

  it('forgets the helper on unpair, and tells it to forget this TV', async () => {
    const helper = fakeHelper(helperAnswers);
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    await tv.pair('192.168.1.42', '123456');
    await tv.unpair();
    const forget = helper.calls[helper.calls.length - 1]!;
    expect(forget.url).toBe('http://192.168.1.42:47020/forget');
    expect(forget.init.method).toBe('POST');
    expect((forget.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(tv.get()).toBeNull();
    expect(tv.reachability.get()).toBe('unknown');
    await expect(tv.link('https://a.example/live.m3u8', {})).rejects.toEqual(
      new HelperUnavailable('unpaired'),
    );
  });

  it('still unpairs when the helper is off', async () => {
    let on = true;
    const helper = fakeHelper((call) =>
      on ? helperAnswers(call) : Promise.reject(new TypeError('Failed to fetch')),
    );
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    await tv.pair('192.168.1.42', '123456');
    on = false;
    await tv.unpair();
    expect(tv.get()).toBeNull();
  });
});

describe('links', () => {
  it('asks the helper with the key and the headers, and gives its link', async () => {
    const helper = fakeHelper(helperAnswers);
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    await tv.pair('192.168.1.42', '123456');
    const link = await tv.link('https://a.example/live.m3u8?t=1', {
      Referer: 'https://a.example/',
    });
    expect(link).toBe('http://192.168.1.42:47020/s/token/aHR0cHM/live.m3u8');
    const asked = helper.calls[helper.calls.length - 1]!;
    expect(asked.url).toBe('http://192.168.1.42:47020/links');
    expect((asked.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(String(asked.init.body)).toBe(
      'url=https%3A%2F%2Fa.example%2Flive.m3u8%3Ft%3D1&h.Referer=https%3A%2F%2Fa.example%2F',
    );
  });

  it('throws refused when the helper forgot this TV, unreachable when it is off', async () => {
    let on = true;
    const helper = fakeHelper((call) => {
      if (!on) return Promise.reject(new TypeError('Failed to fetch'));
      return call.url.endsWith('/links') ? json({}, 401) : helperAnswers(call);
    });
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    await tv.pair('192.168.1.42', '123456');
    await expect(tv.link('https://a.example/x.m3u8', {})).rejects.toEqual(
      new HelperUnavailable('refused'),
    );
    on = false;
    await expect(tv.link('https://a.example/x.m3u8', {})).rejects.toEqual(
      new HelperUnavailable('unreachable'),
    );
    expect(tv.reachability.get()).toBe('off');
  });

  it("refuses a link that does not point at the helper's own streams", async () => {
    const helper = fakeHelper((call) =>
      call.url.endsWith('/links') ? json({ link: '//elsewhere.example/x' }) : helperAnswers(call),
    );
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: helper.fetch });
    await tv.pair('192.168.1.42', '123456');
    await expect(tv.link('https://a.example/x.m3u8', {})).rejects.toEqual(
      new HelperUnavailable('refused'),
    );
  });
});

describe('reachable', () => {
  it('asks again only after a while, unless forced', async () => {
    let clock = 0;
    const helper = fakeHelper(helperAnswers);
    const storage = memoryKeyValueStore();
    await createStreamHelper({ storage, fetch: helper.fetch }).pair('192.168.1.42', '123456');
    const tv = createStreamHelper({ storage, fetch: helper.fetch, now: () => clock });
    const statusCalls = () => helper.calls.filter((call) => call.url.endsWith('/status')).length;

    expect(await tv.reachable()).toBe(true);
    expect(statusCalls()).toBe(1);
    clock = 10_000;
    expect(await tv.reachable()).toBe(true);
    expect(statusCalls()).toBe(1);
    expect(await tv.reachable(true)).toBe(true);
    expect(statusCalls()).toBe(2);
    clock = 40_000;
    await Promise.all([tv.reachable(), tv.reachable()]);
    expect(statusCalls()).toBe(3);
  });

  it('is false when unpaired or when something else answers', async () => {
    const other = fakeHelper((call) =>
      call.url.endsWith('/status') ? json({ router: true }) : helperAnswers(call),
    );
    expect(
      await createStreamHelper({ storage: memoryKeyValueStore(), fetch: other.fetch }).reachable(),
    ).toBe(false);
    const tv = createStreamHelper({ storage: memoryKeyValueStore(), fetch: other.fetch });
    await tv.pair('192.168.1.42', '123456');
    expect(await tv.reachable(true)).toBe(false);
    expect(tv.reachability.get()).toBe('off');
  });
});

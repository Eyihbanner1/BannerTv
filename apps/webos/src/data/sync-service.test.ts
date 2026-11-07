import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncTransport, SYNC_SERVICE } from './sync-service';

const SERVICE = 'https://sync.example.com';

interface Sent {
  url: string;
  init: RequestInit;
}

function answering(status: number, text: string) {
  const sent: Sent[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    sent.push({ url, init });
    // A 204 may carry no body at all.
    return Promise.resolve(new Response(text === '' ? null : text, { status }));
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SYNC_SERVICE', () => {
  it('is an https address without a trailing slash, so paths join on', () => {
    expect(SYNC_SERVICE).toMatch(/^https:\/\/[^/]+$/);
  });
});

describe('createSyncTransport', () => {
  it('posts the JSON as a text/plain body, without credentials, so no preflight is sent', async () => {
    const { sent, fetch } = answering(200, '{"now":5,"docs":{}}');
    const transport = createSyncTransport({ service: SERVICE, fetch });
    const answer = await transport.post('/v1/pull', { account: 'a', want: ['x'] });
    expect(answer).toEqual({ status: 200, body: { now: 5, docs: {} } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${SERVICE}/v1/pull`);
    expect(sent[0]!.init.method).toBe('POST');
    expect(sent[0]!.init.credentials).toBe('omit');
    expect(sent[0]!.init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({ account: 'a', want: ['x'] });
  });

  it('gets without a body or credentials', async () => {
    const { sent, fetch } = answering(200, '{"create":true,"pullMinutes":10,"now":1}');
    const transport = createSyncTransport({ service: SERVICE, fetch });
    expect(await transport.get('/v1/status')).toEqual({
      status: 200,
      body: { create: true, pullMinutes: 10, now: 1 },
    });
    expect(sent[0]!.url).toBe(`${SERVICE}/v1/status`);
    expect(sent[0]!.init.method).toBe('GET');
    expect(sent[0]!.init.body).toBeUndefined();
    expect(sent[0]!.init.credentials).toBe('omit');
  });

  it('hands back an error status as an answer, with its body', async () => {
    const { fetch } = answering(429, '{"error":"limit","retryAfter":60,"now":9}');
    const transport = createSyncTransport({ service: SERVICE, fetch });
    expect(await transport.post('/v1/push', {})).toEqual({
      status: 429,
      body: { error: 'limit', retryAfter: 60, now: 9 },
    });
  });

  it('keeps the status of an answer that is empty or not JSON', async () => {
    const empty = createSyncTransport({ service: SERVICE, fetch: answering(204, '').fetch });
    expect(await empty.get('/v1/status')).toEqual({ status: 204, body: undefined });
    const page = createSyncTransport({
      service: SERVICE,
      fetch: answering(502, '<html>Bad gateway</html>').fetch,
    });
    expect(await page.get('/v1/status')).toEqual({ status: 502, body: undefined });
  });

  it('rejects without the address or the body when nothing answers', async () => {
    const fetch = vi.fn(() =>
      Promise.reject(new TypeError(`Failed to fetch ${SERVICE}/v1/pull secret-auth`)),
    );
    const transport = createSyncTransport({
      service: SERVICE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const error = await transport.post('/v1/pull', { auth: 'secret-auth' }).then(
      () => undefined,
      (reason: unknown) => reason as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain('secret-auth');
    expect(error!.message).not.toContain(SERVICE);
  });

  it('gives up on a request after its timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const transport = createSyncTransport({
      service: SERVICE,
      fetch: fetch as unknown as typeof globalThis.fetch,
      postTimeoutMs: 1000,
      getTimeoutMs: 500,
    });
    const posted = transport.post('/v1/pull', {}).then(
      () => 'answered',
      () => 'gave up',
    );
    const got = transport.get('/v1/status').then(
      () => 'answered',
      () => 'gave up',
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await got).toBe('gave up');
    await vi.advanceTimersByTimeAsync(500);
    expect(await posted).toBe('gave up');
  });

  it('sends nothing where no service is set', async () => {
    const { sent, fetch } = answering(200, '{}');
    const transport = createSyncTransport({ service: '', fetch });
    await expect(transport.get('/v1/status')).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

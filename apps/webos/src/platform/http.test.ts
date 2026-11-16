import { HttpError } from '@bannertv/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './http';

const URL = 'https://api.subdl.com/api/v2/me';
const HEADERS = { 'X-API-Key': 'FAKE-SUBDL-KEY-0000' };

afterEach(() => vi.unstubAllGlobals());

describe('requestJson', () => {
  it('resolves any status with its JSON body, and sends the headers without cookies', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{"error":"x"}', { status: 429 })));
    vi.stubGlobal('fetch', fetch);
    expect(await requestJson(URL, { headers: HEADERS, timeoutMs: 1000 })).toEqual({
      status: 429,
      body: { error: 'x' },
    });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual(HEADERS);
    expect(init.credentials).toBe('omit');
  });

  it('gives no body for an answer that is not JSON', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>', { status: 403 })));
    expect(await requestJson(URL, { headers: {}, timeoutMs: 1000 })).toEqual({
      status: 403,
      body: undefined,
    });
  });

  it('rejects with fixed words, never the address, when nothing answers', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError(`Failed to fetch ${URL}`)));
    const error = await requestJson(URL, { headers: HEADERS, timeoutMs: 1000 }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).kind).toBe('network');
    expect((error as Error).message).not.toContain('subdl.com/');
    expect((error as Error).message).not.toContain('FAKE');
  });

  it('times out', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const error = await requestJson(URL, { headers: {}, timeoutMs: 10 }).catch((e) => e);
    expect((error as HttpError).kind).toBe('timeout');
  });
});

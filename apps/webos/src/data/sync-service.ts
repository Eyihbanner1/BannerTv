import type { SyncTransport, WireAnswer } from '@bannertv/core';

/**
 * The BannerTV account's service (services/sync, ADR 0006). Empty hides the
 * account: Settings never shows it and nothing is asked of any service.
 */
export const SYNC_SERVICE = 'https://sync.bannertv.workers.dev';

/** A pull can bring a megabyte of documents to a slow TV. */
const POST_TIMEOUT_MS = 30000;
const GET_TIMEOUT_MS = 10000;

export interface SyncTransportOptions {
  service?: string;
  fetch?: typeof fetch;
  postTimeoutMs?: number;
  getTimeoutMs?: number;
}

/**
 * The core's SyncTransport over fetch. Requests stay simple, so the TV sends
 * no preflight from file://: GET, or POST with the JSON as a text/plain
 * body, and never credentials. Only a request that got no answer (no
 * network, or the timeout) rejects; an error status is an answer. Nothing
 * here logs what was sent or answered: it carries the account's keys.
 */
export function createSyncTransport(options: SyncTransportOptions = {}): SyncTransport {
  const {
    service = SYNC_SERVICE,
    postTimeoutMs = POST_TIMEOUT_MS,
    getTimeoutMs = GET_TIMEOUT_MS,
  } = options;
  const request = options.fetch ?? ((input, init) => fetch(input, init));

  async function send(path: string, init: RequestInit, timeoutMs: number): Promise<WireAnswer> {
    if (!service) throw new Error('BannerTV has no account service');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(service + path, {
        ...init,
        credentials: 'omit',
        signal: controller.signal,
      });
      let body: unknown;
      try {
        const text = await response.text();
        body = text === '' ? undefined : (JSON.parse(text) as unknown);
      } catch {
        // An answer that is not JSON still has its status.
        body = undefined;
      }
      return { status: response.status, body };
    } catch {
      // Said without the address or the body, which hold the account's keys.
      throw new Error('BannerTV could not reach its account service');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (path) => send(path, { method: 'GET' }, getTimeoutMs),
    post: (path, body) =>
      send(
        path,
        {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'text/plain' },
        },
        postTimeoutMs,
      ),
  };
}

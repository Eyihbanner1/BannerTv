import { createStore, readTraktAnswer, TraktError, type TraktSend } from '@bannertv/core';
import { API_SERVICE } from './api-service';

export { API_SERVICE };

const TRAKT_TIMEOUT_MS = 35000;
const STATUS_TIMEOUT_MS = 10000;

export interface ServiceStatus {
  /** The service has Trakt's keys, so Settings offers Trakt. */
  trakt: boolean;
  /** The service has TMDB's key, so Details asks TMDB. */
  tmdb: boolean;
  /** The service has Search's TMDB routes, so Search asks TMDB too. */
  search: boolean;
}

const OFF: ServiceStatus = { trakt: false, tmdb: false, search: false };
// The last answer, so Trakt and TMDB show at once on the next launch.
const KEY = 'bannertv.apiStatus';

function readStatus(value: unknown): ServiceStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { trakt, tmdb, search } = value as Record<string, unknown>;
  return { trakt: trakt === true, tmdb: tmdb === true, search: search === true };
}

function readSaved(): ServiceStatus {
  if (!API_SERVICE) return OFF;
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && readStatus(JSON.parse(raw))) || OFF;
  } catch {
    return OFF;
  }
}

/** What BannerTV's service can do, as it last said. Off until it first answers. */
export const serviceStatus = createStore<ServiceStatus>(readSaved());

function post(path: string, body: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A text/plain body keeps the request simple, so the TV sends no preflight.
  return fetch(API_SERVICE + path, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain' },
    credentials: 'omit',
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

/**
 * Asks the service what it can do. A service that answers without the keys,
 * or is not there, turns Trakt and TMDB off; no answer at all keeps the last one.
 * A service from before Search's routes says nothing of them, so Search leaves TMDB alone.
 */
export function checkServiceStatus(): void {
  if (!API_SERVICE) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  fetch(`${API_SERVICE}/status`, { credentials: 'omit', signal: controller.signal })
    .then(async (response) => {
      const status = response.ok ? readStatus(await response.json()) : undefined;
      return status ?? (response.status === 404 ? OFF : undefined);
    })
    .catch(() => undefined)
    .finally(() => clearTimeout(timer))
    .then((status) => {
      if (!status) return;
      const current = serviceStatus.get();
      if (
        current.trakt !== status.trakt ||
        current.tmdb !== status.tmdb ||
        current.search !== status.search
      ) {
        serviceStatus.set(status);
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(status));
      } catch {
        // Then the next launch asks again before showing them.
      }
    });
}

/**
 * The core's Trakt transport over the service's /trakt route. The request
 * carries the viewer's token, so no error says what was asked.
 */
export const traktSend: TraktSend = async (request) => {
  if (!API_SERVICE) throw new TraktError('unavailable', 'BannerTV has no service for Trakt');
  let response: Response;
  try {
    response = await post('/trakt', JSON.stringify(request), TRAKT_TIMEOUT_MS);
  } catch {
    throw new TraktError('network', 'BannerTV could not reach its service');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // readTraktAnswer reports a 200 without a body; other statuses need none.
  }
  return readTraktAnswer(response.status, body);
};

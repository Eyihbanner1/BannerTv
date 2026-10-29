/**
 * How the core reaches Trakt: through BannerTV's service, which holds the
 * app's keys (docs/adr/0004, item 9). The app supplies the transport, so the
 * core knows nothing of the service's address. Requests carry the viewer's
 * token, so nothing here logs a request or puts one in an error message.
 */

export type TraktMethod = 'GET' | 'POST' | 'DELETE';

export interface TraktRequest {
  method: TraktMethod;
  /** Trakt's path and query, such as `/sync/playback?extended=full`. */
  path: string;
  /** The access token, which the service sends on as a bearer token. */
  token?: string;
  body?: unknown;
}

export interface TraktResponse {
  /** Trakt's own HTTP status. */
  status: number;
  /** Trakt's parsed JSON body, or null. */
  data: unknown;
  /** Seconds to wait before asking again, from Trakt's Retry-After. */
  retryAfter?: number;
}

/**
 * Sends one request and resolves with Trakt's answer, whatever its status.
 * Rejects with a TraktError when there is no answer: no connection, a
 * timeout, or the service refusing the request.
 */
export type TraktSend = (request: TraktRequest) => Promise<TraktResponse>;

export type TraktErrorKind =
  /** No answer: offline, timed out, or Trakt could not be reached. */
  | 'network'
  /** BannerTV's service is not set up for Trakt, or refused the request. */
  | 'unavailable'
  /** The profile is not signed in to Trakt, or its sign-in ran out. */
  | 'signedOut'
  | 'other';

export class TraktError extends Error {
  readonly kind: TraktErrorKind;

  constructor(kind: TraktErrorKind, message: string) {
    super(message);
    this.name = 'TraktError';
    this.kind = kind;
  }
}

export function isSignedOutError(error: unknown): boolean {
  return error instanceof TraktError && error.kind === 'signedOut';
}

export function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * The service's answer as a TraktResponse, for the app's transport: the
 * HTTP status the service answered with and its parsed JSON body. Throws a
 * TraktError for anything but a relayed answer from Trakt.
 */
export function readTraktAnswer(httpStatus: number, body: unknown): TraktResponse {
  if (httpStatus === 400 || httpStatus === 503) {
    throw new TraktError('unavailable', `BannerTV's service refused the request (${httpStatus})`);
  }
  if (httpStatus === 502) throw new TraktError('network', 'Trakt could not be reached');
  if (httpStatus !== 200) {
    throw new TraktError('other', `BannerTV's service answered ${httpStatus}`);
  }
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { status, data, retryAfter } = raw;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    throw new TraktError('other', "BannerTV's service sent an answer without Trakt's status");
  }
  const response: TraktResponse = { status, data: data === undefined ? null : data };
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
    response.retryAfter = retryAfter;
  }
  return response;
}

/** setTimeout and clearTimeout, injected so tests can run on fake time. */
export interface TraktTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// The core is typed without the DOM, but every engine it runs in has these.
declare const setTimeout: (callback: () => void, ms: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

export const realTimers: TraktTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

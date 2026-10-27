/**
 * The core never calls fetch itself, so it runs anywhere. The app hands it a
 * `FetchJson` that does the request, applies the timeout and parses the body.
 */

export type HttpErrorKind =
  /** No answer: offline, DNS, refused, or blocked by CORS. */
  | 'network'
  | 'timeout'
  /** An answer with a status outside 200 to 299. */
  | 'status'
  /** An answer that is not JSON. */
  | 'invalid';

export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly status: number | undefined;

  constructor(kind: HttpErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status;
  }
}

export interface FetchJsonOptions {
  timeoutMs: number;
}

/**
 * GETs a URL and resolves with its parsed JSON body, or rejects with an
 * HttpError. Addon URLs can carry API keys, so implementations must not log
 * the URL.
 */
export type FetchJson = (url: string, options: FetchJsonOptions) => Promise<unknown>;

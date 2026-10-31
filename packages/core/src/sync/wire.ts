import type { AccountClock } from './clock';

/** An answer from the sync service: its HTTP status and its JSON body, undefined when it had none. */
export interface WireAnswer {
  status: number;
  body: unknown;
}

/**
 * How the engine reaches the sync service (ADR 0006, "HTTP"). The app's
 * adapter sends simple CORS requests to `SYNC_SERVICE`: GET, or POST with
 * the JSON as a `text/plain` body and no credentials. Both reject only when
 * no answer came back (no network, a timeout); an error status is an answer.
 * Nothing sent or answered is ever logged: it carries the account's keys.
 */
export interface SyncTransport {
  get(path: string): Promise<WireAnswer>;
  post(path: string, body: unknown): Promise<WireAnswer>;
}

/** What `GET /v1/status` says. */
export interface ServiceStatus {
  /** Whether a new account can be made now. */
  create: boolean;
  /** Whether making one needs the service's setup key (SyncEngine.create's `key`). */
  key: boolean;
  /** How often screens pull while on screen. */
  pullMinutes: number;
}

/** The protocol version this build speaks. */
export const PROTOCOL_VERSION = 1;
/** Pulls are never more often than this, nor rarer than a day, whatever the service says. */
const MIN_PULL_MINUTES = 15;
const MAX_PULL_MINUTES = 24 * 60;
export const DEFAULT_PULL_MINUTES = 30;

/** Documents in one push, names in one pull and characters of bodies in one request. */
export const WIRE_LIMITS = {
  puts: 12,
  wants: 64,
  bodyChars: 1000 * 1000,
} as const;

type Fields = { [field: string]: unknown };

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isVersion = (value: unknown): value is number =>
  typeof value === 'number' && Math.floor(value) === value && value >= 0 && value <= 9e15;
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The server's time in an answer, when it gave one. */
export function answerTime(body: unknown): number | undefined {
  return isObject(body) && isTime(body.now) ? body.now : undefined;
}

/** The error code of a refusal (`{"error": code, "now"}`), and when to try again for `limit`. */
export function readRefusal(body: unknown): { error?: string; retryAfter?: number } {
  if (!isObject(body)) return {};
  const refusal: { error?: string; retryAfter?: number } = {};
  if (isText(body.error)) refusal.error = body.error;
  if (isTime(body.retryAfter)) refusal.retryAfter = body.retryAfter;
  return refusal;
}

export function readServiceStatus(body: unknown): ServiceStatus | undefined {
  if (!isObject(body) || body.ok !== true || body.v !== PROTOCOL_VERSION) return undefined;
  const minutes = typeof body.pullMinutes === 'number' ? body.pullMinutes : DEFAULT_PULL_MINUTES;
  return {
    create: body.create === true,
    key: body.key === true,
    pullMinutes: Number.isFinite(minutes)
      ? Math.min(MAX_PULL_MINUTES, Math.max(MIN_PULL_MINUTES, Math.round(minutes)))
      : DEFAULT_PULL_MINUTES,
  };
}

/**
 * Asks whether the sync service is there and speaks this build's protocol,
 * as the BannerTV account section does before it shows itself. Undefined
 * when it did not answer or answered something else. With `clock`, the
 * answer's time also sets the account clock.
 */
export async function checkSyncService(
  transport: SyncTransport,
  clock?: AccountClock,
): Promise<ServiceStatus | undefined> {
  const sentAt = clock?.local();
  let answer: WireAnswer;
  try {
    answer = await transport.get('/v1/status');
  } catch {
    return undefined;
  }
  const now = answerTime(answer.body);
  if (clock && sentAt !== undefined && now !== undefined) clock.observe(now, sentAt);
  return answer.status === 200 ? readServiceStatus(answer.body) : undefined;
}

export interface CreateAnswer {
  epoch: string;
}

export function readCreateAnswer(body: unknown): CreateAnswer | undefined {
  return isObject(body) && isText(body.epoch) ? { epoch: body.epoch } : undefined;
}

/** A document's body as a pull brings it. */
export interface WireDocument {
  ver: number;
  /** Server milliseconds when this version was written. */
  at: number;
  body: string;
}

export interface PullAnswer {
  epoch: string;
  /** The version of every document the account holds, by name on the server. */
  vers: Map<string, number>;
  /** Bodies of the documents asked for whose version differs from the one named. */
  docs: Map<string, WireDocument>;
  /** Some bodies were left for another pull. */
  more: boolean;
}

export function readPullAnswer(body: unknown): PullAnswer | undefined {
  if (!isObject(body) || !isText(body.epoch)) return undefined;
  const vers = new Map<string, number>();
  if (isObject(body.vers)) {
    for (const name of Object.keys(body.vers)) {
      const ver = body.vers[name];
      if (isVersion(ver)) vers.set(name, ver);
    }
  }
  const docs = new Map<string, WireDocument>();
  if (isObject(body.docs)) {
    for (const name of Object.keys(body.docs)) {
      const doc = body.docs[name];
      if (!isObject(doc) || !isVersion(doc.ver) || !isTime(doc.at) || !isText(doc.body)) continue;
      docs.set(name, { ver: doc.ver, at: doc.at, body: doc.body });
    }
  }
  return { epoch: body.epoch, vers, docs, more: body.more === true };
}

export interface PushAnswer {
  epoch: string;
  /** Documents written, each at its new version. */
  done: Array<{ name: string; ver: number; at: number }>;
  /** Documents someone else wrote first. */
  conflicts: string[];
  /**
   * Documents refused because the account is at its limit of documents or
   * size. Their versions are unchanged, and they are not conflicts.
   */
  full: string[];
}

export function readPushAnswer(body: unknown): PushAnswer | undefined {
  if (!isObject(body) || !isText(body.epoch)) return undefined;
  const done: PushAnswer['done'] = [];
  for (const item of Array.isArray(body.done) ? body.done : []) {
    if (isObject(item) && isText(item.name) && isVersion(item.ver) && isTime(item.at)) {
      done.push({ name: item.name, ver: item.ver, at: item.at });
    }
  }
  const conflicts = (Array.isArray(body.conflicts) ? body.conflicts : []).filter(isText);
  const full = (Array.isArray(body.full) ? body.full : []).filter(isText);
  return { epoch: body.epoch, done, conflicts, full };
}

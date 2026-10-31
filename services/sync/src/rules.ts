/** The protocol version, which GET /v1/status names. */
export const PROTOCOL = 1;

/** The most a request may carry, in bytes: the largest body, with room for the rest of a push. */
export const MAX_REQUEST_BYTES = 1100 * 1000;
/** The longest sealed body, in characters. Bodies are base64url, so these are bytes too. */
export const MAX_BODY_CHARS = 1000 * 1000;
/** Documents in one push. */
export const MAX_PUTS = 12;
/** Names in one pull's `want`. */
export const MAX_WANT = 64;
/**
 * Characters of bodies in one pull answer. The rest wait for the next pull,
 * which the answer asks for with `more`.
 */
export const MAX_PULL_CHARS = 1000 * 1000;
/**
 * Documents one account may hold: three for each of six profiles and two for
 * the account make 20, and profiles deleted and made again add more over time.
 * Only a new document counts against it.
 */
export const MAX_DOCS = 120;
/** Characters of bodies one account may hold. Only a document that grows counts against it. */
export const MAX_ACCOUNT_CHARS = 10 * 1000 * 1000;
/**
 * Documents one account may write in a UTC day, counted as pushed, whether
 * each commits, conflicts or does not fit. A screen writes about 25 on a day of use.
 */
export const MAX_WRITES_PER_DAY = 2000;

/** How often screens pull, in minutes, when PULL_MINUTES is not set or cannot be read. */
export const PULL_MINUTES = 30;
/** A floor, so that a typo cannot make every screen pull every minute. */
export const MIN_PULL_MINUTES = 15;
export const MAX_PULL_MINUTES = 24 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 16 bytes in base64url without padding: an account id, a document's name or an epoch. */
const ID = /^[A-Za-z0-9_-]{22}$/;
/** 32 bytes in base64url without padding: an auth key. */
const KEY = /^[A-Za-z0-9_-]{43}$/;
/** A sealed body: "1.", the IV, a dot, and the ciphertext with its tag, all in base64url. */
const BODY = /^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const WHOLE = /^\d{1,9}$/;

/**
 * A setting from [vars] as text. TOML reads `"30"` as text and `30` as a
 * number, and Cloudflare passes either on as it is, so both count.
 */
function setting(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

/** MAX_ACCOUNTS as set. Missing or unreadable, it closes account creation: the safe way to be wrong. */
export function readMaxAccounts(value: unknown): number {
  const text = setting(value);
  return WHOLE.test(text) ? Number(text) : 0;
}

/** PULL_MINUTES as set, kept within MIN_PULL_MINUTES and MAX_PULL_MINUTES. */
export function readPullMinutes(value: unknown): number {
  const text = setting(value);
  if (!WHOLE.test(text)) return PULL_MINUTES;
  return Math.min(MAX_PULL_MINUTES, Math.max(MIN_PULL_MINUTES, Number(text)));
}

/**
 * The setup key a create must carry, from the CREATE_KEY secret, or '' when
 * none is set and anyone may create while there is a place. Spaces at either
 * end are dropped, as a pasted secret can bring them.
 */
export function readCreateKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An account id, a document's name or an epoch. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function isAuth(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value);
}

/** A document's version: 0 for one that does not exist yet, then 1, 2 and on. */
function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Why a request was refused before the Worker looked at its account. */
export type Refusal = 'bad-request' | 'too-big';

/** The account a request is for and its auth key, as every route but status takes them. */
export interface Signed {
  account: string;
  auth: string;
}

export interface PullRequest extends Signed {
  /** The epoch the screen knows, when it knows one. */
  epoch: string | undefined;
  /** The version of each document the screen holds. A document missing here is version 0. */
  have: Map<string, number>;
  /** The documents whose bodies the screen wants, most wanted first, each once. */
  want: string[];
}

export interface Put {
  name: string;
  /** The version the screen started from, 0 for a new document. */
  base: number;
  body: string;
}

export interface PushRequest extends Signed {
  epoch: string;
  put: Put[];
}

/** `{account, auth}`, or undefined when either is not in its form. */
export function readSigned(value: unknown): Signed | undefined {
  if (!isObject(value)) return undefined;
  const { account, auth } = value;
  if (!isId(account) || !isAuth(auth)) return undefined;
  return { account, auth };
}

/**
 * `{account, auth, epoch?, have?, want}`, or why it was refused: 'too-big'
 * for more than MAX_WANT names wanted or more than MAX_DOCS held,
 * 'bad-request' for anything else out of its form. A null epoch or have
 * counts as none, and a name wanted twice counts once.
 */
export function readPull(value: unknown): PullRequest | Refusal {
  const signed = readSigned(value);
  if (!signed || !isObject(value)) return 'bad-request';
  const { epoch, have, want } = value;
  if (epoch !== undefined && epoch !== null && !isId(epoch)) return 'bad-request';
  if (!Array.isArray(want)) return 'bad-request';
  if (want.length > MAX_WANT) return 'too-big';
  if (!want.every(isId)) return 'bad-request';
  const versions = new Map<string, number>();
  if (have !== undefined && have !== null) {
    if (!isObject(have)) return 'bad-request';
    const names = Object.keys(have);
    if (names.length > MAX_DOCS) return 'too-big';
    for (const name of names) {
      const ver = have[name];
      if (!isId(name) || !isVersion(ver)) return 'bad-request';
      versions.set(name, ver);
    }
  }
  return {
    ...signed,
    epoch: isId(epoch) ? epoch : undefined,
    have: versions,
    want: want.filter((name, index) => want.indexOf(name) === index),
  };
}

/**
 * `{account, auth, epoch, put: [{name, base, body}]}`, or why it was
 * refused: 'too-big' for more than MAX_PUTS documents or a body over
 * MAX_BODY_CHARS, 'bad-request' for anything else out of its form, a
 * document named twice included.
 */
export function readPush(value: unknown): PushRequest | Refusal {
  const signed = readSigned(value);
  if (!signed || !isObject(value)) return 'bad-request';
  const { epoch, put } = value;
  if (!isId(epoch) || !Array.isArray(put)) return 'bad-request';
  if (put.length > MAX_PUTS) return 'too-big';
  const puts: Put[] = [];
  const names = new Set<string>();
  for (const item of put) {
    if (!isObject(item)) return 'bad-request';
    const { name, base, body } = item;
    if (!isId(name) || names.has(name) || !isVersion(base)) return 'bad-request';
    if (typeof body !== 'string') return 'bad-request';
    if (body.length > MAX_BODY_CHARS) return 'too-big';
    if (!BODY.test(body)) return 'bad-request';
    names.add(name);
    puts.push({ name, base, body });
  }
  return { ...signed, epoch, put: puts };
}

/** A stored document without its body. */
export interface Listed {
  name: string;
  ver: number;
  /** Server milliseconds when this version was written. */
  at: number;
  /** The body's length in characters. */
  size: number;
}

/**
 * Which documents a pull answer carries: the wanted ones whose version
 * differs from the screen's, in the order wanted, until their bodies would
 * pass MAX_PULL_CHARS. The first always goes, so every pull gets somewhere,
 * and `more` says some were left for the next pull.
 */
export function choosePull(
  listing: Listed[],
  have: Map<string, number>,
  want: string[],
): { names: string[]; more: boolean } {
  const listed = new Map<string, Listed>();
  for (const doc of listing) listed.set(doc.name, doc);
  const names: string[] = [];
  let chars = 0;
  for (const name of want) {
    const doc = listed.get(name);
    if (!doc || doc.ver === (have.get(name) ?? 0)) continue;
    if (names.length > 0 && chars + doc.size > MAX_PULL_CHARS) return { names, more: true };
    names.push(name);
    chars += doc.size;
  }
  return { names, more: false };
}

/** The UTC day of a time, counted from 1 January 1970. */
export function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** Seconds until the next UTC midnight, when each account's write count starts again. */
export function secondsToMidnight(ms: number): number {
  return Math.ceil(((utcDay(ms) + 1) * DAY_MS - ms) / 1000);
}

/** Documents an account has written today, from the count it keeps for one UTC day. */
export function writesToday(account: { day: number; writes: number }, today: number): number {
  return account.day === today ? account.writes : 0;
}

/**
 * Whether two strings are equal, taking as long wherever they differ, so an
 * answer's timing says nothing about how much of an auth hash was right.
 * Lengths are not secret: every hash compared here has 43 characters.
 */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

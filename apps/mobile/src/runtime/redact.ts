/**
 * Takes out of a piece of text whatever could identify the person or open their accounts,
 * before it goes into a problem report (runtime/crash-log.ts). Errors quote what they were
 * working on, and on BannerTV that is often an addon's address, whose path and query hold the
 * person's keys (a debrid token, a sports addon's private id), or a title's stream link. So:
 *
 * - every address keeps only its scheme and host, with `/…` where its path or query was, and a
 *   path without a host keeps nothing but the `/…`;
 * - magnet links and data: addresses keep only their scheme;
 * - email addresses become [email];
 * - the value after a name such as token, apiKey, password, pin or code becomes [hidden], in
 *   JSON, in query strings and in headers;
 * - JSON web tokens, UUIDs, the account code, and long runs of letters and digits (keys,
 *   hashes, base64) become [hidden].
 *
 * It errs towards hiding: a report that hides a little too much still says where the problem
 * was. A stack frame keeps its line and column. Running it again changes nothing more. Pure, so
 * it is unit-tested; callers keep the text short first (crash-log.ts), as long text is slow here.
 */

export const HIDDEN = '[hidden]';
export const EMAIL = '[email]';
/** Where an address's path, query or fragment was. */
const CUT = '/…';

/** What an address runs on with: it ends at a space, a quote or an angle bracket. */
const URL_REST = String.raw`[^\s"'<>\x60“”‘’]*`;

/** An address's scheme, then its ://, written plainly, JSON-escaped (:\/\/) or percent-encoded. */
const SCHEME = String.raw`([a-z][a-z0-9+.-]*)(:\/\/|:\\\/\\\/|%3A%2F%2F)`;

const ADDRESS = new RegExp(String.raw`\b${SCHEME}(${URL_REST})`, 'gi');

/**
 * An address in quotes runs to the closing quote, spaces and all: a stream link may hold a
 * title's name with its spaces unencoded.
 */
const QUOTED_ADDRESSES = [
  ['"', '"'],
  ["'", "'"],
  ['\x60', '\x60'],
  ['“', '”'],
  ['‘', '’'],
].map(([open, close]) => ({
  pattern: new RegExp(String.raw`${open}${SCHEME}([^\n${close}]*)${close}`, 'gi'),
  open: open!,
  close: close!,
}));

function redactQuotedAddresses(text: string): string {
  return QUOTED_ADDRESSES.reduce(
    (result, { pattern, open, close }) =>
      result.replace(
        pattern,
        (match, scheme: string, separator: string, rest: string) =>
          `${open}${redactAddress(match, scheme, separator, rest)}${close}`,
      ),
    text,
  );
}

/** Where an address's host part ends, by how its :// was written. */
const AUTHORITY_END = {
  plain: /[/?#\\]/,
  escaped: /\\\/|[?#]/,
  encoded: /%2F|%3F|%23|[/?#]/i,
} as const;

/** Closing punctuation after an address, which belongs to the sentence around it. */
const TAIL = /[)\]}>.,;!?\\]+$/;
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * The punctuation that ends `rest` and belongs to the sentence. A closing bracket the address
 * opened itself is the address's own, as the end of a `[hidden]` in its path.
 */
function tailOf(rest: string): string {
  let tail = TAIL.exec(rest)?.[0] ?? '';
  while (tail) {
    const close = tail.charAt(0);
    const open = OPENER[close];
    if (!open || count(rest, close) > count(rest, open)) break;
    tail = tail.slice(1);
  }
  return tail;
}

/** A stack frame's line and column, as `:12:345`, at the end of an address or a file path. */
const LINE_COLUMN = /(?::\d+){1,2}$/;

/** What a cut path keeps: its stack frame's line and column, and the punctuation after it. */
function cutPath(path: string, tail: string): string {
  const body = path.slice(0, path.length - tail.length);
  const lineColumn = LINE_COLUMN.exec(body)?.[0] ?? '';
  // Nothing but a slash (or its escaped forms) before the line and column: nothing was cut.
  const cut = body.replace(/^(?:\/|\\\/|%2F)+/i, '').length > lineColumn.length ? CUT : '';
  return `${cut}${lineColumn}${tail}`;
}

/** The host of an address's authority: no user name or password, and no port. */
function hostOf(authority: string): string {
  let host = authority;
  const at = Math.max(host.lastIndexOf('@'), host.toLowerCase().lastIndexOf('%40'));
  if (at !== -1) host = host.slice(host.charAt(at) === '@' ? at + 1 : at + 3);
  host = /^[A-Za-z0-9.\-_~[\]:]*/.exec(host)?.[0] ?? '';
  // A port, or a bare colon; an IPv6 address keeps its brackets and the colons inside them.
  return host.replace(/:\d*$/, '').replace(/\.+$/, '');
}

function redactAddress(_match: string, scheme: string, separator: string, rest: string): string {
  const kind = separator === '://' ? 'plain' : separator.startsWith(':') ? 'escaped' : 'encoded';
  const end = AUTHORITY_END[kind].exec(rest);
  const authority = end ? rest.slice(0, end.index) : rest;
  const tail = tailOf(rest);
  const after = end ? cutPath(rest.slice(end.index), tail) : tail;
  return `${scheme}://${hostOf(authority)}${after}`;
}

/** A host name or an IPv4 address with a path after it, but no scheme in front. */
const BARE_PATH = new RegExp(
  String.raw`\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(\/${URL_REST})`,
  'gi',
);

function redactBarePath(_match: string, host: string, path: string): string {
  return `${host}${cutPath(path, tailOf(path))}`;
}

/**
 * A path on its own, as an error may quote the request it made
 * (`/realdebrid=…/stream/movie/tt1.json`), or a file's place on the phone. One part alone, as a
 * screen's `/settings`, stays.
 */
const RELATIVE_PATH = /(^|[\s(,=:])(\/[^\s/"'<>\x60()]+(?:\/[^\s/"'<>\x60()]*)+)/g;

function redactRelative(_match: string, before: string, path: string): string {
  return `${before}${cutPath(path, tailOf(path))}`;
}

/**
 * Names whose value is a secret or personal: a key, a token, a password, a PIN, a code, an
 * email or user name. `[\w-]*?` lets them end a longer name: realDebridToken, tmdb_api_key,
 * accountCode, X-Api-Key, infoHash.
 */
const SECRET_NAME = String.raw`[\w-]*?(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|key|auth|authorization|bearer|session|sessionid|cookie|signature|sig|salt|hash|pin|passcode|code|credential|email|e-mail|mail|user|username|login|account|(?:user|client|device|private|install|account|session|customer)[_-]?id)s?`;

/** `"token": "abc def"` or `token: 'abc'`: the whole quoted value. */
const QUOTED_SECRET = new RegExp(
  String.raw`(["']?)(\b${SECRET_NAME})\1(\s*(?:[:=]|%3A|%3D)\s*)(["'])((?:\\.|(?!\4)[^\\])*)\4`,
  'gi',
);

/** `token=abc`, `pin: 1234`, `"pin": 1234`: the value, up to a space or a separator. */
const BARE_SECRET = new RegExp(
  String.raw`(["']?)(\b${SECRET_NAME})\1(\s*(?:[:=]|%3A|%3D)\s*)([^\s"'&,;(){}[\]]+)`,
  'gi',
);

/** "PIN 1234", "code is 482913": the name, then digits, with no colon between. */
const SPOKEN_PIN = /\b(pin|passcode|code)(\s+(?:is\s+)?)\d{4,}\b/gi;

/**
 * A status or error number ("code: 404") says what went wrong and is no secret, nor is the kind
 * of an Authorization header, whose token the steps before have hidden.
 */
function keepsValue(value: string): boolean {
  return /^(?:\d{1,3}|null|undefined|Bearer|Basic)$/.test(value);
}

function redactSecrets(text: string): string {
  return text
    .replace(
      QUOTED_SECRET,
      (match, quote: string, name: string, separator: string, open: string, value: string) =>
        value === '' || value === HIDDEN
          ? match
          : `${quote}${name}${quote}${separator}${open}${HIDDEN}${open}`,
    )
    .replace(BARE_SECRET, (match, quote: string, name: string, separator: string, value: string) =>
      keepsValue(value) ? match : `${quote}${name}${quote}${separator}${HIDDEN}`,
    )
    .replace(SPOKEN_PIN, `$1$2${HIDDEN}`);
}

/** A run that may be a key: letters and digits, with the marks base64 and addresses add. */
const RUN = /[A-Za-z0-9_+=%-]{16,}/g;

function looksLikeKey(run: string): boolean {
  return (
    (/\d/.test(run) && /[A-Za-z]/.test(run)) ||
    /^[0-9a-f]+$/i.test(run) ||
    // Capitals and the digits 2 to 9: the account code's letters, and base32.
    /^[A-Z2-9]+$/.test(run) ||
    run.length >= 40
  );
}

/** The account code as shown: five groups of four, `K7QM 3XTP W9RD HE4A 6BNC`. */
const ACCOUNT_CODE = /\b[A-HJKMNP-Z2-9]{4}(?:[ -][A-HJKMNP-Z2-9]{4}){4}\b/g;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** A JSON web token, or any base64 JSON (`eyJ` is how `{"` starts): often a configuration. */
const JWT = /\beyJ[A-Za-z0-9_\-+/=%]{6,}(?:\.[A-Za-z0-9_\-+/=%]*){0,2}/g;

const EMAIL_ADDRESS =
  /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/gi;

/** `Bearer abc` and `Basic dXNlcjpwYXNz`, as an Authorization header carries them. */
const BEARER = /\b(Bearer)(\s+)[^\s"',;()[\]{}<>]+/gi;
const BASIC = /\b(Basic)(\s+)(?=[A-Za-z0-9+/]*(?:[0-9+/=]|[a-z][A-Z]))[A-Za-z0-9+/]{6,}=*/g;

/** The text with every address cut to its scheme and host and every secret hidden. */
export function redact(text: string): string {
  const links = text
    .replace(/\bmagnet:[^\s"'<>]+/gi, `magnet:${HIDDEN}`)
    .replace(/\bdata:[a-z]+\/[\w.+-]+[;,][^\s"'<>]*/gi, `data:${HIDDEN}`)
    .replace(JWT, HIDDEN);
  const cut = redactQuotedAddresses(links)
    .replace(ADDRESS, redactAddress)
    .replace(EMAIL_ADDRESS, EMAIL)
    .replace(BEARER, `$1$2${HIDDEN}`)
    .replace(BASIC, `$1$2${HIDDEN}`)
    .replace(BARE_PATH, redactBarePath)
    .replace(RELATIVE_PATH, redactRelative)
    .replace(UUID, HIDDEN)
    .replace(ACCOUNT_CODE, HIDDEN)
    .replace(RUN, (run) => (looksLikeKey(run) ? HIDDEN : run))
    .replace(/\b\d{9,}\b/g, HIDDEN);
  // Last, so a secret's name hides its value whatever the steps above left of it.
  return redactSecrets(cut);
}

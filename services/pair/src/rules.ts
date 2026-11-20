/** How long a pairing session waits for the phone. */
export const SESSION_TTL_MS = 10 * 60 * 1000;
/**
 * How long a collected address can be collected again, for a TV whose first
 * answer was lost. The TV gives up on a request after 10 s and asks again 3 s later.
 */
export const REDELIVER_MS = 30 * 1000;
/** Some addons keep their whole configuration in the address, so allow long ones. */
export const MAX_URL_LENGTH = 8192;

/** Pairing codes: six characters with no 0/O, 1/I/L lookalikes, easy to read off a TV. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** A code as typed on a phone: case, spaces and dashes do not matter. */
export function readCode(value: string): string | undefined {
  const code = value.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return undefined;
  for (const char of code) if (CODE_ALPHABET.indexOf(char) === -1) return undefined;
  return code;
}

/**
 * An addon address the phone sent, with stremio:// links turned into https://.
 * The rules match the TV's normalizeManifestUrl (packages/protocol), so the
 * phone hears at once about an address the TV would refuse. The one addition
 * is the length cap, which bounds what a session holds in memory.
 */
export function readAddonUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return undefined;
  if (/^stremio:\/\//i.test(text)) text = 'https://' + text.slice('stremio://'.length);
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;
  if (!/^https?:\/\/[^\s/?#]+/i.test(text) || /\s/.test(text)) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname) return undefined;
  } catch {
    return undefined;
  }
  return text;
}

/**
 * What a session carries: an addon address (the first kind, and the default)
 * or a viewer's SubDL key, sealed on the phone with a key only the TV holds.
 */
export type SessionKind = 'addon' | 'subdl-key';
export const SESSION_KINDS: readonly SessionKind[] = ['addon', 'subdl-key'];

/**
 * The kind a TV asks for with `?for=`. None is an addon session, as before
 * there were kinds. Anything else is undefined, so a TV asking for a kind this
 * relay does not know hears so, rather than getting a session of another kind.
 */
export function readSessionKind(value: string | null): SessionKind | undefined {
  if (value === null) return 'addon';
  for (const kind of SESSION_KINDS) if (kind === value) return kind;
  return undefined;
}

/** The phone page a SubDL key session's QR code opens; `/` stays the addon page. */
export const SUBDL_PAGE_PATH = '/subdl';

/**
 * A SubDL key as the phone page checks it before sealing. It must match
 * SUBDL_KEY_PATTERN in packages/core/src/integrations/subdl/key.ts, which the
 * TV checks again once it has opened the key. The relay never sees a key.
 */
export const SUBDL_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * The phone seals a key with this and the session's code as its additional
 * data, so a sealed key opens only for the session it was sent to.
 */
export const SUBDL_KEY_AAD_PREFIX = 'bannertv subdl-key v1 ';

/**
 * A sealed key is base64url, with no padding, of a 12-byte IV, the ciphertext
 * and a 16-byte tag: 48 characters for the shortest key (8 bytes) and 208 for
 * the longest (128). The cap leaves room and bounds what a session holds.
 */
export const SEALED_MIN_LENGTH = 48;
export const SEALED_MAX_LENGTH = 256;

/** A sealed key as the phone sent it. The relay cannot open it, only check its shape. */
export function readSealed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length < SEALED_MIN_LENGTH || value.length > SEALED_MAX_LENGTH) return undefined;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

/** What a session holds once the phone has sent it, and what the TV collects. */
export type Payload = { url: string } | { sealed: string };

export type SubmitError = 'invalid-url' | 'too-long' | 'invalid-key' | 'wrong-kind';

/**
 * What the phone sent, read by the rules of the session's kind. Each kind
 * takes one field. The other kind's field on its own means the phone has the
 * wrong page for this code, so it hears that rather than a format error.
 */
export function readSubmission(kind: SessionKind, body: unknown): Payload | { error: SubmitError } {
  const { url, sealed } = (typeof body === 'object' && body !== null ? body : {}) as {
    url?: unknown;
    sealed?: unknown;
  };
  if (kind === 'subdl-key') {
    if (sealed === undefined && url !== undefined) return { error: 'wrong-kind' };
    const value = readSealed(sealed);
    return value === undefined ? { error: 'invalid-key' } : { sealed: value };
  }
  if (url === undefined && sealed !== undefined) return { error: 'wrong-kind' };
  if (typeof url === 'string' && url.trim().length > MAX_URL_LENGTH) return { error: 'too-long' };
  const value = readAddonUrl(url);
  return value === undefined ? { error: 'invalid-url' } : { url: value };
}

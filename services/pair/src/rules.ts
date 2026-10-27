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

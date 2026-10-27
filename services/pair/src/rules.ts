/** How long a pairing session waits for the phone. */
export const SESSION_TTL_MS = 10 * 60 * 1000;
export const MAX_URL_LENGTH = 2048;

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

/** An addon address the phone sent, with stremio:// links turned into https://. */
export function readAddonUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return undefined;
  if (/^stremio:\/\//i.test(text)) text = 'https://' + text.slice('stremio://'.length);
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = 'https://' + text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname) return undefined;
  } catch {
    return undefined;
  }
  return text;
}

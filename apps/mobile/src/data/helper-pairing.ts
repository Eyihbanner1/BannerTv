import { PAIR_SERVICE } from '@tv/data/pairing';
import { helperOffer } from '@tv/data/stream-helper';

/*
 * "Pair with your TV" on the phone's Stream helper screen: the LG's Stream helper screen shows a
 * short code from the pairing relay (services/pair), and the phone sends its helper's address
 * and code there (helperOffer), so nothing is typed with the remote. The LG then pairs with the
 * helper itself, on the home network.
 */

/** The relay's codes: six characters with no 0/O, 1/I/L lookalikes (services/pair rules.ts). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const REQUEST_TIMEOUT_MS = 10000;

export type SendResult = 'sent' | 'bad-code' | 'gone' | 'used' | 'offline';

/** The TV's code as typed on the phone: case, spaces and dashes do not matter. */
export function readTvCode(text: string): string | undefined {
  const code = text.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return undefined;
  for (const char of code) if (CODE_ALPHABET.indexOf(char) === -1) return undefined;
  return code;
}

export interface HelperToSend {
  host: string;
  port: number;
  /** The six digits the helper shows now. */
  code: string;
}

/** Sends this phone's helper to the TV showing `typed`. */
export async function sendHelperToTv(
  typed: string,
  helper: HelperToSend,
  request: typeof fetch = (input, init) => fetch(input, init),
  service: string = PAIR_SERVICE,
): Promise<SendResult> {
  const code = readTvCode(typed);
  if (!code || !/^\d{6}$/.test(helper.code)) return 'bad-code';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await request(`${service}/api/sessions/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: helperOffer(helper.host, helper.port, helper.code) }),
      signal: controller.signal,
    });
    if (response.ok) return 'sent';
    // The relay answers 404 for a code that is not open, or has run out.
    if (response.status === 404) return 'gone';
    if (response.status === 409) return 'used';
    return 'offline';
  } catch {
    return 'offline';
  } finally {
    clearTimeout(timeout);
  }
}

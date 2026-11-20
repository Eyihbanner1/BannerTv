import {
  fromBase64Url,
  SUBDL_KEY_PATTERN,
  type SyncCrypto,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '@bannertv/core';
import type { Pairing, PairSession } from './pairing';

/**
 * A SubDL key sent from the phone through the pairing relay (a 'subdl-key'
 * session). For each session the TV makes a sealing key, K, and puts it in the
 * QR code's fragment, which the phone's browser never sends anywhere. The
 * phone seals the key with K (AES-256-GCM) and the relay only passes on what
 * was sealed, so it never sees the key. K lives in memory for its session and
 * is never stored, logged or sent.
 */

/** K's length: AES-256. */
export const SEALING_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** The shortest and longest key SUBDL_KEY_PATTERN allows, in bytes: it is all ASCII. */
const KEY_MIN_BYTES = 8;
const KEY_MAX_BYTES = 128;
/** The longest sealed text a key can make, so nothing longer is even decoded. */
const SEALED_MAX_CHARS = Math.ceil(((IV_BYTES + TAG_BYTES + KEY_MAX_BYTES) * 4) / 3);
/** Ties what was sealed to its session's code, so it opens for that session only. */
const AAD_PREFIX = 'bannertv subdl-key v1 ';

/** A new K for one session, from the secure random source. */
export function newSealingKey(crypto: SyncCrypto): Uint8Array {
  return crypto.random(SEALING_KEY_BYTES);
}

/** The QR code's text: the phone page with K after the code, in the fragment only. */
export function phoneKeyQrText(pageUrl: string, key: Uint8Array): string {
  return `${pageUrl}&k=${toBase64Url(key)}`;
}

/**
 * The SubDL key in what the phone sealed with K for the session `code`, or
 * null for anything else: not base64url, the wrong length, changed on the way,
 * sealed with another K or for another code, not UTF-8, or not a SubDL key.
 * Never rejects, and never says why: the key is in no error.
 */
export async function openPhoneKey(
  crypto: SyncCrypto,
  key: Uint8Array,
  code: string,
  sealed: string,
): Promise<string | null> {
  try {
    if (key.length !== SEALING_KEY_BYTES || typeof sealed !== 'string') return null;
    if (sealed.length > SEALED_MAX_CHARS) return null;
    const bytes = fromBase64Url(sealed);
    if (!bytes) return null;
    const length = bytes.length - IV_BYTES - TAG_BYTES;
    if (length < KEY_MIN_BYTES || length > KEY_MAX_BYTES) return null;
    const plain = await crypto.aesGcmDecrypt(
      key,
      bytes.subarray(0, IV_BYTES),
      utf8Encode(AAD_PREFIX + code),
      bytes.subarray(IV_BYTES),
    );
    const text = utf8Decode(plain);
    return SUBDL_KEY_PATTERN.test(text) ? text : null;
  } catch {
    return null;
  }
}

export type PhoneKeyState =
  | { status: 'opening' }
  /** `qrText` holds K: it goes into the QR code and nowhere else. */
  | { status: 'waiting'; qrText: string; host: string }
  | { status: 'expired' }
  | { status: 'unavailable' }
  /**
   * The phone way cannot work here: the relay is an older one, there are no
   * random bytes, or the page's Web Crypto failed its self-test.
   */
  | { status: 'off' };

export interface PhoneKeyLink {
  get(): PhoneKeyState;
  subscribe(listener: () => void): () => void;
  /**
   * Sets who gets each key the phone sends, once opened: null when what came
   * did not open. A new code, with a new K, follows each one at once.
   */
  onKey(handler: (key: string | null) => void): () => void;
  /** Opens a new session (a new code and K) and waits for the phone. */
  start(): void;
  /** Stops asking, and lets go of K. */
  stop(): void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * A SubDL key session over `pairing` (made with kind 'subdl-key'): the QR
 * code's text with each session's own K, and each key the phone sends, opened
 * with the K of the session it came by. `cryptoWorks` is the self-test of
 * `crypto` (webCryptoWorks): the link stays opening, asking the relay nothing,
 * until it passes, and is off if it fails, since what the phone sealed would
 * never open here.
 */
export function createPhoneKeyLink(
  pairing: Pairing,
  crypto: SyncCrypto,
  cryptoWorks: () => Promise<boolean>,
): PhoneKeyLink {
  const listeners = new Set<() => void>();
  let handler: ((key: string | null) => void) | undefined;
  // K for the session on screen, and for no other.
  let sealing: { session: PairSession; key: Uint8Array } | undefined;
  let state: PhoneKeyState = { status: 'opening' };
  // Each start or stop moves this on, so a self-test that answers late starts nothing.
  let starts = 0;

  const tell = () => listeners.forEach((listener) => listener());

  const follow = () => {
    const next = pairing.get();
    if (next.status !== 'waiting') {
      sealing = undefined;
      state =
        next.status === 'unavailable' && next.older ? { status: 'off' } : { status: next.status };
    } else {
      const { session } = next;
      try {
        if (!sealing || sealing.session !== session) {
          sealing = { session, key: newSealingKey(crypto) };
        }
        state = {
          status: 'waiting',
          qrText: phoneKeyQrText(session.pageUrl, sealing.key),
          host: hostOf(session.pageUrl),
        };
      } catch {
        sealing = undefined;
        state = { status: 'off' };
      }
    }
    tell();
  };

  pairing.subscribe(follow);
  pairing.onSealed((sealed, session) => {
    // The pairing opens the next session as soon as this returns, and K goes with this one.
    const key = sealing && sealing.session === session ? sealing.key : undefined;
    if (!key) {
      handler?.(null);
      return;
    }
    void openPhoneKey(crypto, key, session.code, sealed).then((opened) => handler?.(opened));
  });

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onKey(next) {
      handler = next;
      return () => {
        if (handler === next) handler = undefined;
      };
    },
    start() {
      const current = ++starts;
      void Promise.resolve()
        .then(cryptoWorks)
        .catch(() => false)
        .then((works) => {
          if (current !== starts) return;
          if (works) {
            pairing.start();
          } else {
            state = { status: 'off' };
            tell();
          }
        });
    },
    stop() {
      starts++;
      pairing.stop();
      sealing = undefined;
      state = { status: 'opening' };
      tell();
    },
  };
}

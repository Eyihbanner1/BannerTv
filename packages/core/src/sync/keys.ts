import { toBase64Url, utf8Encode } from './bytes';
import type { SyncCrypto } from './crypto';

/** HKDF's salt for every key of an account (ADR 0006, "Codes and keys"). */
const SALT = 'bannertv account v1';

/**
 * Everything the account code gives. Whoever holds these can read the
 * account, so none of them is ever logged or shown.
 */
export interface AccountKeys {
  /** The account's number on the server: 22 base64url characters. */
  readonly accountId: string;
  /** Proves to the server that a screen holds the code: 43 base64url characters. */
  readonly auth: string;
  /** AES-256-GCM key for every document. */
  readonly dataKey: Uint8Array;
  /** HMAC-SHA256 key for document names, so the server cannot tell one document from another. */
  readonly nameKey: Uint8Array;
}

/** Derives the account's id and keys from its code (20 symbols, as readAccountCode gives it). */
export async function deriveAccountKeys(crypto: SyncCrypto, code: string): Promise<AccountKeys> {
  const ikm = utf8Encode(code);
  const salt = utf8Encode(SALT);
  const derive = (info: string, length: number) => crypto.hkdf(ikm, salt, utf8Encode(info), length);
  const [id, auth, dataKey, nameKey] = await Promise.all([
    derive('id', 16),
    derive('auth', 32),
    derive('data', 32),
    derive('name', 32),
  ]);
  return { accountId: toBase64Url(id), auth: toBase64Url(auth), dataKey, nameKey };
}

const names = new WeakMap<AccountKeys, Map<string, Promise<string>>>();

/**
 * A document's name on the server: base64url of the first 16 bytes of
 * HMAC-SHA256(name key, `bannertv/doc/<document>`). Worked out once per
 * document for each set of keys.
 */
export function wireName(crypto: SyncCrypto, keys: AccountKeys, document: string): Promise<string> {
  let known = names.get(keys);
  if (!known) {
    known = new Map();
    names.set(keys, known);
  }
  let name = known.get(document);
  if (!name) {
    name = crypto
      .hmacSha256(keys.nameKey, utf8Encode(`bannertv/doc/${document}`))
      .then((mac) => toBase64Url(mac.slice(0, 16)));
    known.set(document, name);
    // A failure is not kept, so the next call tries again.
    name.catch(() => known!.delete(document));
  }
  return name;
}

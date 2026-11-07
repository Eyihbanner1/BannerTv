import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from './bytes';
import type { SyncCrypto } from './crypto';
import { canon, type Items, readItems } from './items';
import type { AccountKeys } from './keys';

/** The document format this build reads and writes (`s` in the plaintext). */
export const DOCUMENT_FORMAT = 1;

/** Why a body could not be opened. */
export type OpenError = 'unreadable' | 'newer';

export class SealError extends Error {
  readonly kind: OpenError;

  constructor(kind: OpenError) {
    super(kind === 'newer' ? 'Written by a newer BannerTV' : 'The document cannot be read');
    this.name = 'SealError';
    this.kind = kind;
  }
}

const SPACE = 0x20;

/**
 * Pads with spaces to a multiple of 1 KB, or of 8 KB above 64 KB, so the
 * server learns only roughly how big a document is (ADR 0006, decision 9).
 */
export function padPlaintext(bytes: Uint8Array): Uint8Array {
  const block = bytes.length > 65536 ? 8192 : 1024;
  const length = Math.max(block, Math.ceil(bytes.length / block) * block);
  if (length === bytes.length) return bytes;
  const padded = new Uint8Array(length);
  padded.fill(SPACE);
  padded.set(bytes);
  return padded;
}

/**
 * Binds a body to its account, its document and the version it is written
 * as, so a body swapped between documents or replayed at another version
 * will not open.
 */
function additionalData(keys: AccountKeys, document: string, version: number): Uint8Array {
  return utf8Encode(`bannertv/1|${keys.accountId}|${document}|${version}`);
}

/**
 * Seals a document's items as version `version` (its base plus one):
 * `1.<iv>.<ciphertext and tag>`, both base64url.
 */
export async function sealDocument(
  crypto: SyncCrypto,
  keys: AccountKeys,
  document: string,
  version: number,
  items: Items,
): Promise<string> {
  const plain = padPlaintext(utf8Encode(canon({ s: DOCUMENT_FORMAT, items })));
  const iv = crypto.random(12);
  const sealed = await crypto.aesGcmEncrypt(
    keys.dataKey,
    iv,
    additionalData(keys, document, version),
    plain,
  );
  return `1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
}

/**
 * Opens a body that the server says is `document` at `version`. Rejects with
 * a SealError: `newer` for a format this build does not know, which must be
 * neither applied nor pushed over; `unreadable` for anything else.
 */
export async function openDocument(
  crypto: SyncCrypto,
  keys: AccountKeys,
  document: string,
  version: number,
  body: string,
): Promise<Items> {
  const parts = body.split('.');
  const iv = parts.length === 3 && parts[0] === '1' ? fromBase64Url(parts[1]!) : undefined;
  const sealed = iv ? fromBase64Url(parts[2]!) : undefined;
  if (!iv || iv.length !== 12 || !sealed || sealed.length < 16) {
    throw new SealError('unreadable');
  }
  let parsed: unknown;
  try {
    const plain = await crypto.aesGcmDecrypt(
      keys.dataKey,
      iv,
      additionalData(keys, document, version),
      sealed,
    );
    parsed = JSON.parse(utf8Decode(plain));
  } catch {
    throw new SealError('unreadable');
  }
  const format =
    typeof parsed === 'object' && parsed !== null ? (parsed as { s?: unknown }).s : undefined;
  if (typeof format === 'number' && format > DOCUMENT_FORMAT) throw new SealError('newer');
  if (format !== DOCUMENT_FORMAT) throw new SealError('unreadable');
  return readItems((parsed as { items?: unknown }).items);
}

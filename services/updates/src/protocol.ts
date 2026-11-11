/**
 * The Expo Updates protocol, version 1 (https://docs.expo.dev/technical-specs/expo-updates-1/),
 * as this Worker speaks it, and the names of what it keeps in Workers KV. Where the spec leaves
 * something open, expo-updates' own Android client (58.0.21, loader/FileDownloader.kt) decides:
 * it checks each signature over the exact bytes of its part, it knows the directives
 * `noUpdateAvailable` and `rollBackToEmbedded`, and it reads a 204 that carries
 * `expo-protocol-version: 1` as "nothing new".
 *
 * The publish script (scripts/lib/update.mjs) writes the same keys; the round-trip test checks
 * the two agree.
 */

export const PROTOCOL_VERSION = '1';
/** The structured-field version the headers are written in. */
export const SFV_VERSION = '0';
/** The only algorithm expo-updates checks a signature with. */
export const SIGNATURE_ALGORITHM = 'rsa-v1_5-sha256';

/** A manifest is never cached: the newest one has to win as soon as it is published. */
export const MANIFEST_CACHE = 'private, max-age=0';
/** An asset's address is its SHA-256, so what it names can never change. */
export const ASSET_CACHE = 'public, max-age=31536000, immutable';

export type Platform = 'android' | 'ios';

/** What a client asked for, read from its headers. */
export interface UpdateRequest {
  platform: Platform;
  runtimeVersion: string;
  channel: string;
  /** Whether it sent `expo-expect-signature`, so wants each part signed. */
  expectSignature: boolean;
}

export interface Refusal {
  status: 400 | 406;
  error: string;
}

/**
 * A runtime version: the fingerprint's 40 hex characters, or a hand-set one such as "1.2.0".
 * No colon, since it is part of a key.
 */
const RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
/** A channel such as "main", "test" or "pr-12". */
const CHANNEL = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** SHA-256 in base64url without padding. */
const SHA256 = /^[A-Za-z0-9_-]{43}$/;
/** An update id, as the publish script makes them (crypto.randomUUID). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Standard base64, as a stored signature is: safe inside an sf-string without escapes. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** A content type the publish script wrote: a type, a subtype, nothing else. */
const CONTENT_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/;

export const isRuntimeVersion = (value: string): boolean => RUNTIME_VERSION.test(value);
export const isChannel = (value: string): boolean => CHANNEL.test(value);
export const isAssetHash = (value: string): boolean => SHA256.test(value);
export const isUpdateId = (value: string): boolean => UUID.test(value);

export function readPlatform(value: string | null): Platform | undefined {
  return value === 'android' || value === 'ios' ? value : undefined;
}

/**
 * Whether an Accept header takes multipart/mixed, the one format this Worker answers in: a
 * directive cannot be sent as plain JSON. No header takes anything.
 */
export function acceptsMultipart(accept: string | null): boolean {
  if (accept === null || accept.trim() === '') return true;
  return accept.split(',').some((range) => {
    const [type = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase());
    const q = params.find((param) => param.startsWith('q='));
    if (q !== undefined && !(Number(q.slice(2)) > 0)) return false;
    return type === 'multipart/mixed' || type === 'multipart/*' || type === '*/*';
  });
}

/**
 * The request's protocol headers, or why it is refused. Only these headers are read: the
 * client also sends a per-install id (eas-client-id) and the last crash's message, and neither
 * is looked at, kept or passed on.
 */
export function readUpdateRequest(headers: Headers): UpdateRequest | Refusal {
  const protocol = headers.get('expo-protocol-version');
  if (protocol === null) return { status: 400, error: 'expo-protocol-version' };
  // Version 0 clients (before SDK 46) would misread a version 1 answer.
  if (protocol.trim() !== PROTOCOL_VERSION) return { status: 406, error: 'protocol' };
  if (!acceptsMultipart(headers.get('accept'))) return { status: 406, error: 'accept' };

  const platform = readPlatform(headers.get('expo-platform'));
  if (!platform) return { status: 400, error: 'expo-platform' };
  const runtimeVersion = headers.get('expo-runtime-version')?.trim() ?? '';
  if (!isRuntimeVersion(runtimeVersion)) return { status: 400, error: 'expo-runtime-version' };
  // Every BannerTV build names its channel, so a request without one is not from BannerTV.
  const channel = headers.get('expo-channel-name')?.trim() ?? '';
  if (!isChannel(channel)) return { status: 400, error: 'expo-channel-name' };

  const expectSignature = (headers.get('expo-expect-signature') ?? '').trim() !== '';
  return { platform, runtimeVersion, channel, expectSignature };
}

// What is kept in KV. Assets and manifests never change once written; the index (which update
// a runtime version gets now), the directive (a roll back to the app's own update) and the
// history (what rollback-previous steps back through) are rewritten by each publish or roll back.

export const assetKey = (hash: string): string => `asset:${hash}`;
export const manifestKey = (id: string): string => `manifest:${id}`;
const scope = (channel: string, platform: Platform, runtimeVersion: string): string =>
  `${channel}:${platform}:${runtimeVersion}`;
export const indexKey = (channel: string, platform: Platform, runtimeVersion: string): string =>
  `index:${scope(channel, platform, runtimeVersion)}`;
export const directiveKey = (channel: string, platform: Platform, runtimeVersion: string): string =>
  `directive:${scope(channel, platform, runtimeVersion)}`;
export const historyKey = (channel: string, platform: Platform, runtimeVersion: string): string =>
  `history:${scope(channel, platform, runtimeVersion)}`;

/** An index record: the update a runtime version gets, and when it was made. */
export interface Index {
  id: string;
  createdAt: string;
}

/** The metadata kept beside a manifest or directive: the signature CI made over its text. */
export interface Signed {
  sig: string;
  keyid: string;
}

export interface AssetMetadata {
  contentType: string;
}

export function readIndex(text: string | null): Index | undefined {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<Index> | null;
    if (typeof value?.id !== 'string' || !isUpdateId(value.id)) return undefined;
    if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
      return undefined;
    }
    return { id: value.id, createdAt: value.createdAt };
  } catch {
    return undefined;
  }
}

/** A stored signature, when it has the form a header can carry. */
export function readSigned(metadata: unknown): Signed | undefined {
  const value = metadata as Partial<Signed> | null;
  if (typeof value?.sig !== 'string' || !BASE64.test(value.sig)) return undefined;
  if (typeof value.keyid !== 'string' || !KEY_ID.test(value.keyid)) return undefined;
  return { sig: value.sig, keyid: value.keyid };
}

export function readContentType(metadata: unknown): string {
  const type = (metadata as Partial<AssetMetadata> | null)?.contentType;
  return typeof type === 'string' && CONTENT_TYPE.test(type) ? type : 'application/octet-stream';
}

/** When a stored rollBackToEmbedded directive was made, or undefined when it is not one. */
export function directiveTime(text: string | null): number | undefined {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as {
      type?: unknown;
      parameters?: { commitTime?: unknown };
    } | null;
    if (value?.type !== 'rollBackToEmbedded') return undefined;
    const time = value.parameters?.commitTime;
    const ms = typeof time === 'string' ? Date.parse(time) : NaN;
    return Number.isNaN(ms) ? undefined : ms;
  } catch {
    return undefined;
  }
}

/**
 * Whether the directive wins over the indexed update: the newer of the two does, as the client
 * itself only takes an update or a roll back newer than what it runs. So a publish after a roll
 * back undoes it, and a roll back after a publish wins, whichever key was written last.
 */
export function directiveWins(directiveMs: number | undefined, index: Index | undefined): boolean {
  if (directiveMs === undefined) return false;
  return index === undefined || directiveMs >= Date.parse(index.createdAt);
}

/** The expo-signature header for a part, as a structured-field dictionary. */
export function signatureHeader(signed: Signed): string {
  return `sig="${signed.sig}", keyid="${signed.keyid}", alg="${SIGNATURE_ALGORITHM}"`;
}

export interface Part {
  name: 'manifest' | 'directive';
  /** The exact text that was signed: the client checks the signature over these bytes. */
  body: string;
  signed?: Signed;
}

/**
 * A multipart/mixed body. Each part's body runs from the blank line after its headers to the
 * CRLF before the next delimiter, and the client reads it as exactly that: nothing is added.
 */
export function multipartBody(parts: Part[], boundary: string): string {
  let body = '';
  for (const part of parts) {
    body += `--${boundary}\r\n`;
    body += `content-disposition: form-data; name="${part.name}"\r\n`;
    body += 'content-type: application/json; charset=utf-8\r\n';
    if (part.signed) body += `expo-signature: ${signatureHeader(part.signed)}\r\n`;
    body += `\r\n${part.body}\r\n`;
  }
  return `${body}--${boundary}--\r\n`;
}

/** A boundary none of the parts contains. */
export function chooseBoundary(parts: Part[], random: () => string): string {
  for (;;) {
    const boundary = `bannertv-${random()}`;
    if (!parts.some((part) => part.body.includes(boundary))) return boundary;
  }
}

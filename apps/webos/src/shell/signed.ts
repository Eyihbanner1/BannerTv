/**
 * Reading what the updates Worker answers, and checking it, before anything
 * is downloaded or stored. The Worker serves the manifest's text exactly as
 * the publish workflow signed it (rsa-v1_5-sha256 over its UTF-8 bytes) with
 * the signature beside it; the TV checks that signature against the public
 * key in its own index.html, then holds every field to this .ipk.
 */
import {
  BUILT_IN_TYPE,
  type BuiltInDirective,
  type FileEntry,
  type Manifest,
  PLATFORM,
  type ShellConfig,
  UPDATE_TYPE,
} from './contract';

/** No single file an update carries comes near this: the app's script is about 1.2 MB. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** All of an update's files together. */
export const MAX_UPDATE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 16;

/**
 * The only files an update may name: a script in one of the folders the
 * build writes scripts to, by a plain name. Nothing outside the app's folder,
 * nothing that is not a script.
 */
const FILE_PATH = /^(assets|vendor|data)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.js$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

/** What the Worker answers with 200. */
export interface SignedAnswer {
  text: string;
  sig: string;
  keyId: string;
}

function fail(reason: string): never {
  throw new Error(reason);
}

/** The signed text, its signature and key from the Worker's JSON, or a reason it is out of form. */
export function readAnswer(value: unknown): SignedAnswer {
  const body = value as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') fail('answer');
  const text = typeof body.manifest === 'string' ? body.manifest : body.directive;
  if (typeof text !== 'string' || typeof body.sig !== 'string' || typeof body.keyid !== 'string') {
    fail('answer');
  }
  return { text, sig: body.sig, keyId: body.keyid };
}

function readFiles(value: unknown): Record<string, FileEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('files');
  const files: Record<string, FileEntry> = {};
  const paths = Object.keys(value);
  if (paths.length === 0 || paths.length > MAX_FILES) fail('files');
  let total = 0;
  for (const path of paths) {
    const entry = (value as Record<string, unknown>)[path] as Partial<FileEntry> | null;
    if (!FILE_PATH.test(path) || path.indexOf('..') !== -1) fail('files');
    if (!entry || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) fail('files');
    const size = entry.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
      fail('files');
    }
    total += size;
    files[path] = { sha256: entry.sha256, size };
  }
  if (total > MAX_UPDATE_BYTES) fail('files');
  return files;
}

/**
 * The manifest or directive in a signed text, held to this .ipk: its channel,
 * platform and runtime must be this build's. Throws a short reason otherwise.
 * Call it only once the signature is good.
 */
export function readSigned(
  text: string,
  config: Pick<ShellConfig, 'runtime' | 'updates'>,
): Manifest | BuiltInDirective {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail('manifest');
  }
  if (!value || typeof value !== 'object') fail('manifest');
  if (value.channel !== config.updates?.channel || value.platform !== PLATFORM) fail('scope');
  if (value.runtime !== config.runtime) fail('runtime');
  const channel = value.channel as string;
  const runtime = value.runtime as string;
  const createdAt = value.createdAt;
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) fail('manifest');
  if (value.type === BUILT_IN_TYPE) {
    return {
      type: BUILT_IN_TYPE,
      createdAt,
      channel,
      platform: PLATFORM,
      runtime,
    };
  }
  if (value.type !== UPDATE_TYPE) fail('manifest');
  const { id, version, commit, launch } = value;
  if (typeof id !== 'string' || !UUID.test(id)) fail('manifest');
  if (typeof version !== 'string' || !VERSION.test(version)) fail('manifest');
  if (commit !== null && (typeof commit !== 'string' || !COMMIT.test(commit))) fail('manifest');
  const files = readFiles(value.files);
  if (typeof launch !== 'string' || !files[launch] || launch.indexOf('assets/') !== 0) {
    fail('manifest');
  }
  return {
    type: UPDATE_TYPE,
    id,
    createdAt,
    channel,
    platform: PLATFORM,
    runtime,
    version,
    commit: commit as string | null,
    launch,
    files,
  };
}

export function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/** The update key from index.html, ready to check signatures. */
export function importUpdateKey(subtle: SubtleCrypto, spkiBase64: string): Promise<CryptoKey> {
  return Promise.resolve(subtle.importKey('spki', base64Bytes(spkiBase64), RSA, false, ['verify']));
}

/** Whether `sig` (base64) is the key's rsa-v1_5-sha256 signature over the text's UTF-8 bytes. */
export async function verifyText(
  subtle: SubtleCrypto,
  key: CryptoKey,
  text: string,
  sig: string,
): Promise<boolean> {
  try {
    return await subtle.verify(RSA, key, base64Bytes(sig), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/** SHA-256 in lower-case hex, as manifests name files. */
export async function sha256Hex(subtle: SubtleCrypto, bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < digest.length; i++)
    hex += (digest[i]! < 16 ? '0' : '') + digest[i]!.toString(16);
  return hex;
}

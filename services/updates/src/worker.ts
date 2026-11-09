/**
 * BannerTV's update service: a Cloudflare Worker that answers the phone app's expo-updates (the
 * Expo Updates protocol, version 1) and the LG TV's Homebrew Channel (webos.ts) from Workers KV.
 *
 * It holds no key and has no way to write. The "Publish phone update" workflow exports the app's
 * JavaScript, signs the manifest with the private key only GitHub holds, and uploads the files
 * with wrangler; this Worker serves the manifest and its signature exactly as uploaded, so the
 * phone checks CI's signature, not the Worker's word. Requests carry a per-install id
 * (eas-client-id), so nothing here reads it, logs, or keeps anything about a request.
 *
 *   GET /expo/manifest       the newest update for the request's channel, platform and runtime
 *                            version, a roll back to the app's own update, or 204 for none
 *   GET /expo/assets/<hash>  a file an update names, by its SHA-256
 *   GET /webos/repo.json     the Homebrew Channel repository: the LG build main last published,
 *                            or no package before the first publish
 *   GET /webos/ipk/<sha256>.ipk, GET /webos/icon/<sha256>.png
 *                            the .ipk and icon the repository names, by their SHA-256
 *   GET /status              for the workflows: whether storage is bound, with ?channel,
 *                            platform and runtimeVersion what that runtime version is served, and
 *                            with ?channel and platform=webos what the LG repository offers
 *
 * The LG routes are written by the "Publish LG update" workflow, which builds the .ipk and the
 * repository's index; Homebrew Channel checks each .ipk against the SHA-256 the index gives.
 *
 * A Worker module may export only its handler and Durable Object classes (and types), so the
 * protocol's rules live in protocol.ts, and the LG repository's in webos.ts.
 */
import {
  ASSET_CACHE,
  type AssetMetadata,
  assetKey,
  chooseBoundary,
  directiveKey,
  directiveTime,
  directiveWins,
  type Index,
  indexKey,
  isAssetHash,
  isChannel,
  isRuntimeVersion,
  MANIFEST_CACHE,
  manifestKey,
  multipartBody,
  type Part,
  type Platform,
  PROTOCOL_VERSION,
  readContentType,
  readIndex,
  readPlatform,
  readSigned,
  readUpdateRequest,
  SFV_VERSION,
  type Signed,
} from './protocol';
import * as webos from './webos';

// The few KV types this file uses, so it needs no type package. It only ever reads.
export interface KVNamespace {
  get(key: string, type: 'text'): Promise<string | null>;
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  getWithMetadata<M>(
    key: string,
    type: 'text',
  ): Promise<{ value: string | null; metadata: M | null }>;
  getWithMetadata<M>(
    key: string,
    type: 'stream',
  ): Promise<{ value: ReadableStream | null; metadata: M | null }>;
}

export interface Env {
  /** Bound at deploy time by the Deploy updates Worker workflow; missing, nothing is served. */
  UPDATES?: KVNamespace;
}

const JSON_TYPE = 'application/json; charset=utf-8';

/** What every answer to the update protocol carries. */
const PROTOCOL_HEADERS = {
  'expo-protocol-version': PROTOCOL_VERSION,
  'expo-sfv-version': SFV_VERSION,
  'cache-control': MANIFEST_CACHE,
  'x-content-type-options': 'nosniff',
};

function json(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'content-type': JSON_TYPE },
  });
}

const plain = (value: unknown, status: number) =>
  json(value, status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });

/** No update: the protocol's empty answer, which the client reads as "keep what you have". */
const noUpdate = () => new Response(null, { status: 204, headers: PROTOCOL_HEADERS });

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function multipart(parts: Part[]): Response {
  const boundary = chooseBoundary(parts, randomHex);
  return new Response(multipartBody(parts, boundary), {
    status: 200,
    headers: { ...PROTOCOL_HEADERS, 'content-type': `multipart/mixed; boundary=${boundary}` },
  });
}

interface Served {
  index: Index | undefined;
  /** The stored directive's text and signature, when it is newer than the index. */
  directive: { text: string; signed: Signed | undefined } | undefined;
  directiveMs: number | undefined;
}

/** The index and directive for one runtime version, read together. */
async function lookUp(
  kv: KVNamespace,
  channel: string,
  platform: Platform,
  runtimeVersion: string,
): Promise<Served> {
  const [indexText, directive] = await Promise.all([
    kv.get(indexKey(channel, platform, runtimeVersion), 'text'),
    kv.getWithMetadata<unknown>(directiveKey(channel, platform, runtimeVersion), 'text'),
  ]);
  const index = readIndex(indexText);
  const directiveMs = directiveTime(directive.value);
  return {
    index,
    directiveMs,
    directive:
      directive.value !== null && directiveWins(directiveMs, index)
        ? { text: directive.value, signed: readSigned(directive.metadata) }
        : undefined,
  };
}

async function manifest(request: Request, env: Env): Promise<Response> {
  const asked = readUpdateRequest(request.headers);
  if ('error' in asked) return json({ error: asked.error }, asked.status, PROTOCOL_HEADERS);
  const kv = env.UPDATES;
  if (!kv) return json({ error: 'unconfigured' }, 503, PROTOCOL_HEADERS);

  const { channel, platform, runtimeVersion, expectSignature } = asked;
  // A signature goes only to a client that asked for one, as the spec has it.
  const sign = (signed: Signed | undefined) => (expectSignature ? signed : undefined);
  try {
    const served = await lookUp(kv, channel, platform, runtimeVersion);
    if (served.directive) {
      const { text, signed } = served.directive;
      return multipart([{ name: 'directive', body: text, signed: sign(signed) }]);
    }
    if (!served.index) return noUpdate();
    const stored = await kv.getWithMetadata<unknown>(manifestKey(served.index.id), 'text');
    // An index seen before its manifest has reached this location: try again on the next check.
    if (stored.value === null) return noUpdate();
    return multipart([
      { name: 'manifest', body: stored.value, signed: sign(readSigned(stored.metadata)) },
    ]);
  } catch {
    return json({ error: 'storage' }, 503, PROTOCOL_HEADERS);
  }
}

async function asset(hash: string, env: Env): Promise<Response> {
  if (!isAssetHash(hash)) return plain({ error: 'not-found' }, 404);
  const kv = env.UPDATES;
  if (!kv) return plain({ error: 'unconfigured' }, 503);
  try {
    const { value, metadata } = await kv.getWithMetadata<AssetMetadata>(assetKey(hash), 'stream');
    // Not cached: an asset missing now may only not have reached this location yet.
    if (value === null) return plain({ error: 'not-found' }, 404);
    return new Response(value, {
      status: 200,
      headers: {
        'content-type': readContentType(metadata),
        'cache-control': ASSET_CACHE,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return plain({ error: 'storage' }, 503);
  }
}

async function status(url: URL, env: Env): Promise<Response> {
  const kv = env.UPDATES;
  const params = url.searchParams;
  if (!params.has('channel') && !params.has('platform') && !params.has('runtimeVersion')) {
    return plain({ storage: Boolean(kv), protocol: Number(PROTOCOL_VERSION) }, 200);
  }
  if (params.get('platform') === 'webos') return webosStatus(params, kv);
  const channel = params.get('channel') ?? '';
  const platform = readPlatform(params.get('platform'));
  const runtimeVersion = params.get('runtimeVersion') ?? '';
  if (!isChannel(channel) || !platform || !isRuntimeVersion(runtimeVersion)) {
    return plain({ error: 'bad-request' }, 400);
  }
  if (!kv) return plain({ storage: false, protocol: Number(PROTOCOL_VERSION) }, 503);
  try {
    const served = await lookUp(kv, channel, platform, runtimeVersion);
    return plain(
      {
        storage: true,
        protocol: Number(PROTOCOL_VERSION),
        update: served.index ?? null,
        directive:
          served.directiveMs === undefined
            ? null
            : {
                type: 'rollBackToEmbedded',
                commitTime: new Date(served.directiveMs).toISOString(),
              },
        serving: served.directive ? 'directive' : served.index ? 'update' : 'none',
      },
      200,
    );
  } catch {
    return plain({ error: 'storage' }, 503);
  }
}

// The LG TV's Homebrew Channel repository. Every answer, a refusal too, carries
// access-control-allow-origin: Homebrew Channel reads the index from its own web page.
const WEBOS_HEADERS = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };

const webosError = (error: string, status: number) =>
  json({ error }, status, { ...WEBOS_HEADERS, 'cache-control': 'no-store' });

/** The index before anything is published: a repository with no package, not an error. */
const EMPTY_REPO = '{"packages":[]}';

async function webosRepo(env: Env): Promise<Response> {
  const kv = env.UPDATES;
  if (!kv) return webosError('unconfigured', 503);
  try {
    const stored = await kv.get(webos.repoKey(webos.WEBOS_CHANNEL), 'text');
    // Exactly as the workflow wrote it, the .ipk and icon it names stored before it.
    return new Response(stored ?? EMPTY_REPO, {
      status: 200,
      headers: {
        ...WEBOS_HEADERS,
        'content-type': webos.REPO_TYPE,
        'cache-control': webos.REPO_CACHE,
      },
    });
  } catch {
    return webosError('storage', 503);
  }
}

/**
 * An .ipk or icon, read whole rather than streamed so that it is sent with its length: Homebrew
 * Channel shows its download's progress from content-length. The largest value KV keeps is
 * 25 MiB, and the .ipk is about 1.3 MB.
 */
async function webosFile(key: string, type: string, env: Env): Promise<Response> {
  const kv = env.UPDATES;
  if (!kv) return webosError('unconfigured', 503);
  try {
    const bytes = await kv.get(key, 'arrayBuffer');
    // Not cached: a file missing now may only not have reached this location yet.
    if (bytes === null) return webosError('not-found', 404);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...WEBOS_HEADERS,
        'content-type': type,
        'content-length': String(bytes.byteLength),
        'cache-control': webos.FILE_CACHE,
      },
    });
  } catch {
    return webosError('storage', 503);
  }
}

/** /status?channel=main&platform=webos: the build the LG repository offers, read from its index. */
async function webosStatus(
  params: URLSearchParams,
  kv: KVNamespace | undefined,
): Promise<Response> {
  const channel = params.get('channel') ?? '';
  // An LG build has no runtime version: the .ipk carries everything.
  if (!isChannel(channel) || params.has('runtimeVersion')) {
    return plain({ error: 'bad-request' }, 400);
  }
  if (!kv) return plain({ storage: false, protocol: Number(PROTOCOL_VERSION) }, 503);
  try {
    const update = webos.readRepoIndex(await kv.get(webos.repoKey(channel), 'text'));
    return plain(
      {
        storage: true,
        protocol: Number(PROTOCOL_VERSION),
        update: update ?? null,
        serving: update ? 'update' : 'none',
      },
      200,
    );
  } catch {
    return plain({ error: 'storage' }, 503);
  }
}

const ASSETS = '/expo/assets/';
const WEBOS_IPK = /^\/webos\/ipk\/([0-9a-f]{64})\.ipk$/;
const WEBOS_ICON = /^\/webos\/icon\/([0-9a-f]{64})\.png$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // GET alone: like every other route, a HEAD is a 404 (Homebrew Channel only ever GETs).
    if (request.method === 'GET') {
      const path = url.pathname;
      if (path === '/expo/manifest') return manifest(request, env);
      if (path.startsWith(ASSETS)) return asset(path.slice(ASSETS.length), env);
      if (path === '/status') return status(url, env);
      if (path === '/webos/repo.json') return webosRepo(env);
      const ipk = WEBOS_IPK.exec(path)?.[1];
      if (ipk) return webosFile(webos.ipkKey(ipk), webos.IPK_TYPE, env);
      const icon = WEBOS_ICON.exec(path)?.[1];
      if (icon) return webosFile(webos.iconKey(icon), webos.ICON_TYPE, env);
    }
    return plain({ error: 'not-found' }, 404);
  },
};

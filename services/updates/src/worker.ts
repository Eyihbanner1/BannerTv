/**
 * BannerTV's update service for the phone app: a Cloudflare Worker that answers expo-updates
 * (the Expo Updates protocol, version 1) from Workers KV.
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
 *   GET /status              for the workflows: whether storage is bound, and with ?channel,
 *                            platform and runtimeVersion, what that runtime version is served
 *
 * A Worker module may export only its handler and Durable Object classes (and types), so the
 * protocol's rules live in protocol.ts.
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

// The few KV types this file uses, so it needs no type package. It only ever reads.
export interface KVNamespace {
  get(key: string, type: 'text'): Promise<string | null>;
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

const ASSETS = '/expo/assets/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (url.pathname === '/expo/manifest') return manifest(request, env);
      if (url.pathname.startsWith(ASSETS)) return asset(url.pathname.slice(ASSETS.length), env);
      if (url.pathname === '/status') return status(url, env);
    }
    return plain({ error: 'not-found' }, 404);
  },
};

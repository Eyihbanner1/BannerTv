import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  assetKey,
  directiveKey,
  historyKey,
  indexKey,
  manifestKey,
  type Platform,
} from './protocol';
import { testKV, type TestKV } from './test/kv';
import { boundaryOf, partName, readDictionary, readMultipart } from './test/multipart';
import * as webos from './webos';
import worker, { type Env } from './worker';

const ORIGIN = 'https://updates.example.workers.dev';
const RUNTIME = '0123456789abcdef0123456789abcdef01234567';
const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const OLDER_ID = '0c3b8e1a-1f2e-4b6a-9d3c-5e7f9a1b2c3d';
const CREATED = '2026-11-09T12:00:00.000Z';
const HASH = 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg';

/** The headers expo-updates 58 sends on Android, with BannerTV's channel and code signing. */
const CLIENT: Record<string, string> = {
  accept: 'multipart/mixed,application/expo+json,application/json',
  'expo-platform': 'android',
  'expo-protocol-version': '1',
  'expo-api-version': '1',
  'expo-updates-environment': 'BARE',
  'expo-json-error': 'true',
  'eas-client-id': 'a-per-install-id',
  'expo-runtime-version': RUNTIME,
  'expo-channel-name': 'main',
  'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
};

function ask(path: string, headers: Record<string, string | null> = {}, method = 'GET') {
  const sent = new Headers();
  for (const [name, value] of Object.entries({ ...CLIENT, ...headers })) {
    if (value !== null) sent.set(name, value);
  }
  return new Request(`${ORIGIN}${path}`, { method, headers: sent });
}

const manifestRequest = (headers: Record<string, string | null> = {}) =>
  ask('/expo/manifest', headers);

let keys: CryptoKeyPair;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
});

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function sign(text: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    new TextEncoder().encode(text),
  );
  return base64(signature);
}

function manifestText(id = ID, createdAt = CREATED): string {
  // Not ASCII-only on purpose: the signature covers UTF-8 bytes, as the client checks them.
  return JSON.stringify({
    id,
    createdAt,
    runtimeVersion: RUNTIME,
    launchAsset: {
      hash: HASH,
      key: 'c892f8a7c49e90b352b60c3e765521ba',
      contentType: 'application/javascript',
      fileExtension: '.bundle',
      url: `${ORIGIN}/expo/assets/${HASH}`,
    },
    assets: [],
    metadata: {},
    extra: { expoClient: { name: 'BannerTV — phone test', version: '0.1.0' } },
  });
}

interface Publish {
  id?: string;
  createdAt?: string;
  channel?: string;
  platform?: Platform;
  signed?: boolean;
}

/** What the publish workflow uploads for one update. */
async function publish(kv: TestKV, options: Publish = {}): Promise<string> {
  const { id = ID, createdAt = CREATED, channel = 'main', platform = 'android' } = options;
  const text = manifestText(id, createdAt);
  const metadata = options.signed === false ? null : { sig: await sign(text), keyid: 'main' };
  kv.put(manifestKey(id), text, { metadata });
  kv.put(indexKey(channel, platform, RUNTIME), JSON.stringify({ id, createdAt }));
  kv.put(historyKey(channel, platform, RUNTIME), JSON.stringify([{ id, createdAt }]));
  return text;
}

async function rollBack(kv: TestKV, commitTime: string): Promise<string> {
  const text = JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime } });
  kv.put(directiveKey('main', 'android', RUNTIME), text, {
    metadata: { sig: await sign(text), keyid: 'main' },
  });
  return text;
}

async function verify(text: string, signatureHeader: string | undefined): Promise<boolean> {
  const { sig } = readDictionary(signatureHeader ?? '');
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    keys.publicKey,
    unbase64(sig ?? ''),
    new TextEncoder().encode(text),
  );
}

function setUp(): { kv: TestKV; env: Env } {
  const kv = testKV();
  return { kv, env: { UPDATES: kv } };
}

async function parts(response: Response) {
  const boundary = boundaryOf(response.headers.get('content-type'));
  return readMultipart(await response.text(), boundary);
}

function expectProtocolHeaders(response: Response) {
  expect(response.headers.get('expo-protocol-version')).toBe('1');
  expect(response.headers.get('expo-sfv-version')).toBe('0');
  expect(response.headers.get('cache-control')).toBe('private, max-age=0');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /expo/manifest', () => {
  it('serves the indexed update as a signed manifest part, byte for byte', async () => {
    const { kv, env } = setUp();
    const text = await publish(kv);
    const response = await worker.fetch(manifestRequest(), env);
    expect(response.status).toBe(200);
    expectProtocolHeaders(response);
    const [part, ...rest] = await parts(response);
    expect(rest).toEqual([]);
    expect(part && partName(part)).toBe('manifest');
    expect(part?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(part?.body).toBe(text);
    expect(readDictionary(part?.headers['expo-signature'] ?? '')).toMatchObject({
      keyid: 'main',
      alg: 'rsa-v1_5-sha256',
    });
    expect(await verify(part?.body ?? '', part?.headers['expo-signature'])).toBe(true);
  });

  it('leaves the signature off for a client that did not ask for one', async () => {
    const { kv, env } = setUp();
    await publish(kv);
    const response = await worker.fetch(manifestRequest({ 'expo-expect-signature': null }), env);
    const [part] = await parts(response);
    expect(part?.headers['expo-signature']).toBeUndefined();
  });

  it('serves a manifest stored without a signature as it is, for the client to refuse', async () => {
    const { kv, env } = setUp();
    await publish(kv, { signed: false });
    const [part] = await parts(await worker.fetch(manifestRequest(), env));
    expect(partName(part!)).toBe('manifest');
    expect(part?.headers['expo-signature']).toBeUndefined();
  });

  it('answers 204 with the protocol headers when nothing is published', async () => {
    const { env } = setUp();
    const response = await worker.fetch(manifestRequest(), env);
    expect(response.status).toBe(204);
    expectProtocolHeaders(response);
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('answers 204 to a runtime version nothing was published for', async () => {
    const { kv, env } = setUp();
    await publish(kv);
    const other = 'fedcba9876543210fedcba9876543210fedcba98';
    const response = await worker.fetch(manifestRequest({ 'expo-runtime-version': other }), env);
    expect(response.status).toBe(204);
  });

  it('answers 204 on another channel or platform', async () => {
    const { kv, env } = setUp();
    await publish(kv);
    expect((await worker.fetch(manifestRequest({ 'expo-channel-name': 'test' }), env)).status).toBe(
      204,
    );
    expect((await worker.fetch(manifestRequest({ 'expo-platform': 'ios' }), env)).status).toBe(204);
  });

  it('answers 204 when the index arrived before its manifest', async () => {
    const { kv, env } = setUp();
    kv.put(indexKey('main', 'android', RUNTIME), JSON.stringify({ id: ID, createdAt: CREATED }));
    expect((await worker.fetch(manifestRequest(), env)).status).toBe(204);
  });

  it('refuses a platform expo-updates does not have', async () => {
    const { env } = setUp();
    const response = await worker.fetch(manifestRequest({ 'expo-platform': 'web' }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'expo-platform' });
  });

  it.each(['expo-protocol-version', 'expo-platform', 'expo-runtime-version', 'expo-channel-name'])(
    'refuses a request without %s, before reading storage',
    async (header) => {
      const { kv, env } = setUp();
      const response = await worker.fetch(manifestRequest({ [header]: null }), env);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: header });
      expect(kv.reads).toEqual([]);
    },
  );

  it('refuses another protocol version or a client that cannot take multipart with 406', async () => {
    const { env } = setUp();
    const old = await worker.fetch(manifestRequest({ 'expo-protocol-version': '0' }), env);
    expect(old.status).toBe(406);
    const json = await worker.fetch(manifestRequest({ accept: 'application/json' }), env);
    expect(json.status).toBe(406);
    expectProtocolHeaders(json);
  });

  describe('rolling back to the app’s own update', () => {
    it('serves a newer directive as a signed directive part', async () => {
      const { kv, env } = setUp();
      await publish(kv);
      const text = await rollBack(kv, '2026-11-09T13:00:00.000Z');
      const response = await worker.fetch(manifestRequest(), env);
      expect(response.status).toBe(200);
      expectProtocolHeaders(response);
      const [part, ...rest] = await parts(response);
      expect(rest).toEqual([]);
      expect(partName(part!)).toBe('directive');
      expect(part?.body).toBe(text);
      expect(await verify(part?.body ?? '', part?.headers['expo-signature'])).toBe(true);
    });

    it('serves a directive with nothing published', async () => {
      const { kv, env } = setUp();
      await rollBack(kv, CREATED);
      const [part] = await parts(await worker.fetch(manifestRequest(), env));
      expect(partName(part!)).toBe('directive');
    });

    it('serves an update published after the roll back', async () => {
      const { kv, env } = setUp();
      await rollBack(kv, '2026-11-09T11:00:00.000Z');
      await publish(kv);
      const [part] = await parts(await worker.fetch(manifestRequest(), env));
      expect(partName(part!)).toBe('manifest');
    });

    it('ignores a directive it cannot read', async () => {
      const { kv, env } = setUp();
      await publish(kv);
      kv.put(directiveKey('main', 'android', RUNTIME), '{"type":"rollBackToEmbedded"}');
      const [part] = await parts(await worker.fetch(manifestRequest(), env));
      expect(partName(part!)).toBe('manifest');
    });
  });

  it('answers 503 when storage fails or is not bound', async () => {
    const { kv, env } = setUp();
    await publish(kv);
    kv.down = true;
    const down = await worker.fetch(manifestRequest(), env);
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: 'storage' });
    const unbound = await worker.fetch(manifestRequest(), {});
    expect(unbound.status).toBe(503);
    expect(await unbound.json()).toEqual({ error: 'unconfigured' });
  });

  it('reads no header but the protocol’s, writes nothing and logs nothing', async () => {
    const { kv, env } = setUp();
    await publish(kv);
    const writes = kv.writes.length;
    const read: string[] = [];
    const get = Headers.prototype.get;
    vi.spyOn(Headers.prototype, 'get').mockImplementation(function (this: Headers, name: string) {
      read.push(name.toLowerCase());
      return get.call(this, name);
    });
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    );
    await worker.fetch(manifestRequest(), env);
    await worker.fetch(ask(`/expo/assets/${HASH}`), env);
    await worker.fetch(ask(`/status?channel=main&platform=android&runtimeVersion=${RUNTIME}`), env);
    vi.mocked(Headers.prototype.get).mockRestore();

    const protocol = [
      'accept',
      'expo-channel-name',
      'expo-expect-signature',
      'expo-platform',
      'expo-protocol-version',
      'expo-runtime-version',
    ];
    // The Worker's own response headers are read by nothing here, so every name is a request's.
    expect([...new Set(read)].sort()).toEqual(protocol);
    expect(read).not.toContain('eas-client-id');
    expect(kv.writes).toHaveLength(writes);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

describe('GET /expo/assets/<hash>', () => {
  it('streams the stored file with its type, cached for good', async () => {
    const { kv, env } = setUp();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 13, 10]);
    kv.put(assetKey(HASH), bytes, { metadata: { contentType: 'image/png' } });
    const response = await worker.fetch(ask(`/expo/assets/${HASH}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    [{ contentType: 'application/javascript' }, 'application/javascript'],
    [{ contentType: 'font/ttf' }, 'font/ttf'],
    [{ contentType: 'not a type' }, 'application/octet-stream'],
    [null, 'application/octet-stream'],
  ])('serves metadata %j as %s', async (metadata, type) => {
    const { kv, env } = setUp();
    kv.put(assetKey(HASH), 'x', { metadata });
    const response = await worker.fetch(ask(`/expo/assets/${HASH}`), env);
    expect(response.headers.get('content-type')).toBe(type);
  });

  it('answers 404, not cached, for a file it does not have', async () => {
    const { env } = setUp();
    const response = await worker.fetch(ask(`/expo/assets/${HASH}`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['', 'short', `${HASH}x`, `${HASH.slice(0, 42)}=`, `../${HASH.slice(3)}`])(
    'answers 404 for %j without reading storage',
    async (hash) => {
      const { kv, env } = setUp();
      const response = await worker.fetch(ask(`/expo/assets/${hash}`), env);
      expect(response.status).toBe(404);
      expect(kv.reads).toEqual([]);
    },
  );

  it('answers 503 when storage fails', async () => {
    const { kv, env } = setUp();
    kv.down = true;
    expect((await worker.fetch(ask(`/expo/assets/${HASH}`), env)).status).toBe(503);
  });
});

describe('GET /status', () => {
  const query = `/status?channel=main&platform=android&runtimeVersion=${RUNTIME}`;

  it('says whether storage is bound', async () => {
    const { env } = setUp();
    const bound = await worker.fetch(ask('/status'), env);
    expect(bound.headers.get('cache-control')).toBe('no-store');
    expect(await bound.json()).toEqual({ storage: true, protocol: 1 });
    expect(await (await worker.fetch(ask('/status'), {})).json()).toEqual({
      storage: false,
      protocol: 1,
    });
  });

  it('says what a runtime version is served', async () => {
    const { kv, env } = setUp();
    expect(await (await worker.fetch(ask(query), env)).json()).toEqual({
      storage: true,
      protocol: 1,
      update: null,
      directive: null,
      serving: 'none',
    });
    await publish(kv);
    expect(await (await worker.fetch(ask(query), env)).json()).toMatchObject({
      update: { id: ID, createdAt: CREATED },
      directive: null,
      serving: 'update',
    });
    await rollBack(kv, '2026-11-09T13:00:00.000Z');
    expect(await (await worker.fetch(ask(query), env)).json()).toMatchObject({
      update: { id: ID },
      directive: { type: 'rollBackToEmbedded', commitTime: '2026-11-09T13:00:00.000Z' },
      serving: 'directive',
    });
    await publish(kv, { id: OLDER_ID, createdAt: '2026-11-09T14:00:00.000Z' });
    expect(await (await worker.fetch(ask(query), env)).json()).toMatchObject({
      update: { id: OLDER_ID },
      serving: 'update',
    });
  });

  it.each([
    '/status?channel=main',
    '/status?channel=Main&platform=android&runtimeVersion=1.0',
    '/status?channel=main&platform=web&runtimeVersion=1.0',
    '/status?channel=main&platform=android&runtimeVersion=a:b',
  ])('refuses %s', async (path) => {
    const { env } = setUp();
    expect((await worker.fetch(ask(path), env)).status).toBe(400);
  });

  it('answers 503 when storage fails', async () => {
    const { kv, env } = setUp();
    kv.down = true;
    expect((await worker.fetch(ask(query), env)).status).toBe(503);
  });
});

describe('the LG TV’s Homebrew Channel repository', () => {
  const SHA = 'ef9ec4ad015859d4b48ca7760f42299b09b2e00681cf7bb63399b9965317c38a';
  const ICON_SHA = '81a179f14fc8c9543040f8088633daaba0b559af90fdb6588cfb2f4cf045ea34';
  const IPK = new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0, 255, 13, 10, 7]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

  /** An index as the publish workflow writes it (scripts/lib/webos.mjs), with a line not ASCII. */
  function indexText(version = '0.1.4') {
    const iconUri = `https://updates.bannertv.workers.dev/webos/icon/${ICON_SHA}.png`;
    return `${JSON.stringify(
      {
        packages: [
          {
            id: 'com.bannertv.app',
            title: 'BannerTV',
            iconUri,
            shortDescription: `BannerTV from main — version ${version}`,
            manifest: {
              id: 'com.bannertv.app',
              version,
              type: 'web',
              title: 'BannerTV',
              iconUri,
              ipkUrl: `https://updates.bannertv.workers.dev/webos/ipk/${SHA}.ipk`,
              ipkHash: { sha256: SHA },
              ipkSize: IPK.length,
              rootRequired: false,
            },
            channel: 'main',
            commit: 'ed387a1228288492187ba32540e721775a2f3292',
            publishedAt: CREATED,
            restoredAt: null,
          },
        ],
      },
      null,
      2,
    )}\n`;
  }

  function stored(): { kv: TestKV; env: Env; text: string } {
    const { kv, env } = setUp();
    const text = indexText();
    kv.put(webos.ipkKey(SHA), IPK, { metadata: { version: '0.1.4' } });
    kv.put(webos.iconKey(ICON_SHA), PNG);
    kv.put(webos.repoKey('main'), text);
    return { kv, env, text };
  }

  function expectWebosHeaders(response: Response) {
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }

  describe('GET /webos/repo.json', () => {
    it('serves the stored index byte for byte, never cached stale, to any origin', async () => {
      const { env, text } = stored();
      const response = await worker.fetch(ask('/webos/repo.json'), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expectWebosHeaders(response);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(text));
    });

    it('serves a repository with no package before the first publish', async () => {
      const { env } = setUp();
      const response = await worker.fetch(ask('/webos/repo.json'), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expectWebosHeaders(response);
      expect(await response.text()).toBe('{"packages":[]}');
    });

    it('answers 503, to any origin, when storage fails or is not bound', async () => {
      const { kv, env } = stored();
      kv.down = true;
      const down = await worker.fetch(ask('/webos/repo.json'), env);
      expect(down.status).toBe(503);
      expect(down.headers.get('cache-control')).toBe('no-store');
      expectWebosHeaders(down);
      expect(await down.json()).toEqual({ error: 'storage' });
      const unbound = await worker.fetch(ask('/webos/repo.json'), {});
      expect(unbound.status).toBe(503);
      expect(await unbound.json()).toEqual({ error: 'unconfigured' });
    });
  });

  describe('GET /webos/ipk/<sha256>.ipk and /webos/icon/<sha256>.png', () => {
    it('serves the .ipk whole, with its length, cached for good', async () => {
      const { env } = stored();
      const response = await worker.fetch(ask(`/webos/ipk/${SHA}.ipk`), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('content-length')).toBe(String(IPK.length));
      expectWebosHeaders(response);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(IPK);
    });

    it('serves the icon as a PNG, cached for good', async () => {
      const { env } = stored();
      const response = await worker.fetch(ask(`/webos/icon/${ICON_SHA}.png`), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expectWebosHeaders(response);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    });

    it('answers 404, not cached, for a file it does not have', async () => {
      const { env } = setUp();
      for (const path of [`/webos/ipk/${SHA}.ipk`, `/webos/icon/${ICON_SHA}.png`]) {
        const response = await worker.fetch(ask(path), env);
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expectWebosHeaders(response);
      }
    });

    it.each([
      `/webos/ipk/${SHA.toUpperCase()}.ipk`,
      `/webos/ipk/${SHA.slice(1)}.ipk`,
      `/webos/ipk/${SHA}`,
      `/webos/ipk/${SHA}.png`,
      `/webos/icon/${ICON_SHA}.ipk`,
      `/webos/ipk/x/${SHA}.ipk`,
      '/webos/repo/main',
      '/webos/history/main',
      `/webos/ipk/${SHA}.ipk/`,
    ])('answers 404 for %s without reading storage', async (path) => {
      const { kv, env } = stored();
      const reads = kv.reads.length;
      const response = await worker.fetch(ask(path), env);
      expect(response.status).toBe(404);
      expect(kv.reads).toHaveLength(reads);
    });

    it('answers 503 when storage fails or is not bound', async () => {
      const { kv, env } = stored();
      kv.down = true;
      expect((await worker.fetch(ask(`/webos/ipk/${SHA}.ipk`), env)).status).toBe(503);
      expect((await worker.fetch(ask(`/webos/icon/${ICON_SHA}.png`), {})).status).toBe(503);
    });
  });

  describe('GET /status?channel=main&platform=webos', () => {
    const query = '/status?channel=main&platform=webos';

    it('says what the repository offers', async () => {
      const { env } = setUp();
      expect(await (await worker.fetch(ask(query), env)).json()).toEqual({
        storage: true,
        protocol: 1,
        update: null,
        serving: 'none',
      });
      const full = stored();
      const response = await worker.fetch(ask(query), full.env);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        storage: true,
        protocol: 1,
        update: {
          version: '0.1.4',
          sha256: SHA,
          ipkSize: IPK.length,
          commit: 'ed387a1228288492187ba32540e721775a2f3292',
          publishedAt: CREATED,
          restoredAt: null,
        },
        serving: 'update',
      });
    });

    it.each([
      '/status?platform=webos',
      '/status?channel=Main&platform=webos',
      `/status?channel=main&platform=webos&runtimeVersion=${RUNTIME}`,
    ])('refuses %s', async (path) => {
      const { kv, env } = stored();
      const reads = kv.reads.length;
      expect((await worker.fetch(ask(path), env)).status).toBe(400);
      expect(kv.reads).toHaveLength(reads);
    });

    it('answers 503 when storage fails or is not bound', async () => {
      const { kv, env } = stored();
      kv.down = true;
      expect((await worker.fetch(ask(query), env)).status).toBe(503);
      const unbound = await worker.fetch(ask(query), {});
      expect(unbound.status).toBe(503);
      expect(await unbound.json()).toEqual({ storage: false, protocol: 1 });
    });
  });

  describe('in-app updates for the LG app', () => {
    const LG_RUNTIME = 'webos-1-0123456789abcdef';
    const FILE_SHA = 'c'.repeat(64);
    const SCRIPT = new TextEncoder().encode('console.log("app");');
    const update = '?channel=main&runtime=' + LG_RUNTIME;
    /** An answer as the workflow stores it; the Worker never reads it but for /status. */
    const answer = (fields: Record<string, unknown>, kind = 'manifest') =>
      JSON.stringify({
        [kind]: JSON.stringify({
          createdAt: CREATED,
          channel: 'main',
          platform: 'webos',
          ...fields,
        }),
        sig: 'c2ln',
        keyid: 'lg-0123456789abcdef',
      });
    const MANIFEST = answer({
      type: 'bannertv-lg-update',
      id: '00000000-0000-4000-8000-000000000001',
      version: '0.1.9',
      commit: 'ed387a1',
      runtime: LG_RUNTIME,
    });

    function withApp(text = MANIFEST) {
      const { kv, env } = setUp();
      kv.put(webos.appKey('main', LG_RUNTIME), text);
      kv.put(webos.appFileKey(FILE_SHA), SCRIPT);
      return { kv, env };
    }

    it('serves the stored answer byte for byte, never cached, to any origin', async () => {
      const { env } = withApp();
      const response = await worker.fetch(ask(`/webos/update${update}`), env);
      expect(response.status).toBe(200);
      expectWebosHeaders(response);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.text()).toBe(MANIFEST);
    });

    it('answers 204, readable from file://, when nothing was published for that runtime', async () => {
      const { env } = withApp();
      const response = await worker.fetch(
        ask('/webos/update?channel=main&runtime=webos-1-ffffffffffffffff'),
        env,
      );
      expect(response.status).toBe(204);
      expectWebosHeaders(response);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('serves a script by its SHA-256 with its length, for ever', async () => {
      const { env } = withApp();
      const response = await worker.fetch(ask(`/webos/file/${FILE_SHA}`), env);
      expect(response.status).toBe(200);
      expectWebosHeaders(response);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-length')).toBe(String(SCRIPT.length));
      expect(response.headers.get('cache-control')).toBe(webos.FILE_CACHE);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(SCRIPT);
      const missing = await worker.fetch(ask(`/webos/file/${'d'.repeat(64)}`), env);
      expect(missing.status).toBe(404);
      expectWebosHeaders(missing);
      expect(missing.headers.get('cache-control')).toBe('no-store');
    });

    it.each([
      '/webos/update',
      '/webos/update?channel=main',
      '/webos/update?runtime=webos-1-0123456789abcdef',
      '/webos/update?channel=Main&runtime=webos-1-0123456789abcdef',
      '/webos/update?channel=main&runtime=webos-1-0123456789ABCDEF',
      '/webos/update?channel=main&runtime=1.0.0',
    ])('refuses %s without reading storage', async (path) => {
      const { kv, env } = withApp();
      const reads = kv.reads.length;
      const response = await worker.fetch(ask(path), env);
      expect(response.status).toBe(400);
      expectWebosHeaders(response);
      expect(kv.reads).toHaveLength(reads);
    });

    it.each([
      `/webos/file/${FILE_SHA.toUpperCase()}`,
      `/webos/file/${FILE_SHA}.js`,
      '/webos/file/',
    ])('%s is 404', async (path) => {
      const { env } = withApp();
      expect((await worker.fetch(ask(path), env)).status).toBe(404);
    });

    it('answers 503 when storage fails or is not bound', async () => {
      const { kv, env } = withApp();
      kv.down = true;
      for (const path of [`/webos/update${update}`, `/webos/file/${FILE_SHA}`]) {
        const response = await worker.fetch(ask(path), env);
        expect(response.status).toBe(503);
        expectWebosHeaders(response);
        expect((await worker.fetch(ask(path), {})).status).toBe(503);
      }
    });

    it('says on /status what a runtime is served', async () => {
      const query = `/status?channel=main&platform=webos&runtime=${LG_RUNTIME}`;
      expect(await (await worker.fetch(ask(query), setUp().env)).json()).toEqual({
        storage: true,
        protocol: 1,
        update: null,
        serving: 'none',
      });
      expect(await (await worker.fetch(ask(query), withApp().env)).json()).toEqual({
        storage: true,
        protocol: 1,
        update: {
          type: 'update',
          id: '00000000-0000-4000-8000-000000000001',
          version: '0.1.9',
          commit: 'ed387a1',
          createdAt: CREATED,
          keyId: 'lg-0123456789abcdef',
        },
        serving: 'update',
      });
      const back = withApp(
        answer({ type: 'bannertv-lg-built-in', runtime: LG_RUNTIME }, 'directive'),
      );
      expect(await (await worker.fetch(ask(query), back.env)).json()).toMatchObject({
        update: { type: 'built-in', id: null, version: null, createdAt: CREATED },
        serving: 'built-in',
      });
      const junk = withApp('{"manifest":"not json"}');
      expect(await (await worker.fetch(ask(query), junk.env)).json()).toMatchObject({
        update: null,
        serving: 'none',
      });
      const bad = await worker.fetch(
        ask(`/status?channel=main&platform=webos&runtime=x`),
        setUp().env,
      );
      expect(bad.status).toBe(400);
    });

    it('reads no request header, writes nothing and logs nothing', async () => {
      const { kv, env } = withApp();
      const writes = kv.writes.length;
      const read: string[] = [];
      const get = Headers.prototype.get;
      vi.spyOn(Headers.prototype, 'get').mockImplementation(function (this: Headers, name: string) {
        read.push(name.toLowerCase());
        return get.call(this, name);
      });
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level),
      );
      await worker.fetch(ask(`/webos/update${update}`), env);
      await worker.fetch(ask(`/webos/file/${FILE_SHA}`), env);
      vi.mocked(Headers.prototype.get).mockRestore();
      expect(read).toEqual([]);
      expect(kv.writes).toHaveLength(writes);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    });
  });

  it('reads no request header, writes nothing and logs nothing', async () => {
    const { kv, env } = stored();
    const writes = kv.writes.length;
    const read: string[] = [];
    const get = Headers.prototype.get;
    vi.spyOn(Headers.prototype, 'get').mockImplementation(function (this: Headers, name: string) {
      read.push(name.toLowerCase());
      return get.call(this, name);
    });
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    );
    await worker.fetch(ask('/webos/repo.json'), env);
    await worker.fetch(ask(`/webos/ipk/${SHA}.ipk`), env);
    await worker.fetch(ask(`/webos/icon/${ICON_SHA}.png`), env);
    await worker.fetch(ask('/status?channel=main&platform=webos'), env);
    vi.mocked(Headers.prototype.get).mockRestore();
    expect(read).toEqual([]);
    expect(kv.writes).toHaveLength(writes);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

describe('everything else', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/expo'],
    ['GET', '/expo/manifest/x'],
    ['POST', '/expo/manifest'],
    ['PUT', `/expo/assets/${HASH}`],
    ['DELETE', '/status'],
    ['HEAD', '/status'],
    ['GET', '/webos'],
    ['GET', '/webos/repo'],
    ['HEAD', '/webos/repo.json'],
    ['POST', '/webos/repo.json'],
    ['PUT', `/webos/ipk/${'a'.repeat(64)}.ipk`],
    ['POST', '/webos/update?channel=main&runtime=webos-1-0123456789abcdef'],
    ['HEAD', `/webos/file/${'a'.repeat(64)}`],
    ['GET', '/webos/file'],
  ])('%s %s is 404', async (method, path) => {
    const { kv, env } = setUp();
    const response = await worker.fetch(ask(path, {}, method), env);
    expect(response.status).toBe(404);
    expect(kv.reads).toEqual([]);
  });
});

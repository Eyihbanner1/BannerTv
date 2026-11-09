import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testKV } from '../../src/test/kv.ts';
import { boundaryOf, partName, readDictionary, readMultipart } from '../../src/test/multipart.ts';
import * as protocol from '../../src/protocol.ts';
import worker from '../../src/worker.ts';
import { makeCodeSigningPair } from './test/certificate.mjs';
import {
  asciiJson,
  assetKey,
  checkRollback,
  chunkEntries,
  describeRuntimes,
  directiveKey,
  historyKey,
  indexKey,
  manifestKey,
  md5,
  planPublish,
  planRollbackPrevious,
  planRollbackToEmbedded,
  previousId,
  readExport,
  readHistory,
  readKeyList,
  readRuntimes,
  readSigningKey,
  sha256,
  verifyText,
} from './update.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'publish.mjs');
const RUNTIME = '0123456789abcdef0123456789abcdef01234567';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const ID_2 = '2b4e28ba-2fa1-41d2-883f-0016d3cca427';
const ID_3 = '3b4e28ba-2fa1-41d2-883f-0016d3cca427';
const ORIGIN = 'https://updates.bannertv.workers.dev';
// Not ASCII on purpose: the manifest text must still be ASCII, and parse back to this.
const EXPO_CLIENT = {
  name: 'BannerTV phone test — ünïcode',
  slug: 'bannertv-phone',
  version: '0.1.0',
};

const BUNDLE = Buffer.from('hermes bytecode stand-in \u0000ÿ', 'latin1');
const ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const VECTOR = Buffer.from('<vector xmlns:android="http://schemas.android.com/apk/res/android"/>');

let work;
let pair;
let signingKey;
let certificate;

/** An `expo export --platform android` folder, laid out as SDK 58 writes it. */
function writeExport(dir, files = { bundle: BUNDLE, assets: [ICON, VECTOR, ICON] }) {
  const bundlePath = '_expo/static/js/android/index-73ae05803919b25f037a6be9525d1245.hbc';
  mkdirSync(join(dir, '_expo/static/js/android'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, bundlePath), files.bundle);
  const exts = ['png', 'xml', 'png'];
  const assets = files.assets.map((bytes, i) => {
    // The same bytes under a second name, as two images that happen to match would be.
    const path = `assets/${md5(bytes)}${i === 2 ? '-copy' : ''}`;
    writeFileSync(join(dir, path), bytes);
    return { path, ext: exts[i] ?? 'png' };
  });
  const metadata = {
    version: 0,
    bundler: 'metro',
    fileMetadata: { android: { bundle: bundlePath, assets } },
  };
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata));
  return dir;
}

function folder(name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'bannertv-updates-'));
  pair = makeCodeSigningPair();
  certificate = pair.certificatePem;
  signingKey = readSigningKey(pair.privateKeyPem, { certificate, now: NOW });
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

function publishPlan(overrides = {}) {
  return planPublish({
    exportDir: overrides.exportDir ?? writeExport(folder(`export-${Math.random()}`)),
    channel: 'main',
    runtimeVersion: RUNTIME,
    expoClient: EXPO_CLIENT,
    commit: 'abc1234',
    signingKey,
    id: ID,
    now: NOW,
    ...overrides,
  });
}

const b64url = (bytes) => createHash('sha256').update(bytes).digest('base64url');

describe('hashing', () => {
  it('gives SHA-256 in base64url without padding, and MD5 in hex', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    expect(md5(Buffer.from('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

describe('reading an export', () => {
  it('reads the platform’s bundle and assets from metadata.json', () => {
    const files = readExport(writeExport(folder('read')), 'android');
    expect(files.bundle.bytes.equals(BUNDLE)).toBe(true);
    expect(files.assets.map((asset) => asset.ext)).toEqual(['png', 'xml', 'png']);
  });

  it('refuses a folder without the platform, or naming a file outside it', () => {
    const dir = writeExport(folder('outside'));
    expect(() => readExport(dir, 'ios')).toThrow(/no ios bundle/);
    const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    metadata.fileMetadata.android.assets.push({ path: '../../secret', ext: 'png' });
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata));
    expect(() => readExport(dir, 'android')).toThrow(/outside the export/);
    expect(() => readExport(folder('empty'), 'android')).toThrow(/no readable metadata.json/);
  });

  it('refuses an extension a file could not be stored under', () => {
    const dir = writeExport(folder('extension'));
    const metadata = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    metadata.fileMetadata.android.assets[0].ext = 'png/../x';
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata));
    expect(() => readExport(dir, 'android')).toThrow(/extension/);
  });
});

describe('the signing key', () => {
  it('takes the key that belongs to the certificate', () => {
    expect(readSigningKey(pair.privateKeyPem, { certificate, now: NOW }).asymmetricKeyType).toBe(
      'rsa',
    );
  });

  it('refuses another key, which phones would refuse', () => {
    const other = makeCodeSigningPair();
    expect(() => readSigningKey(other.privateKeyPem, { certificate, now: NOW })).toThrow(
      /does not belong/,
    );
  });

  it('refuses a certificate out of date', () => {
    const old = makeCodeSigningPair({ from: new Date('2020-01-01'), to: new Date('2021-01-01') });
    expect(() =>
      readSigningKey(old.privateKeyPem, { certificate: old.certificatePem, now: NOW }),
    ).toThrow(/valid from/);
  });

  it('refuses a certificate that is not for code signing, which phones would refuse', () => {
    const plain = makeCodeSigningPair({ codeSigning: false });
    expect(() =>
      readSigningKey(plain.privateKeyPem, { certificate: plain.certificatePem, now: NOW }),
    ).toThrow(/not for code signing/);
  });

  it('refuses text that is not a key, without repeating it', () => {
    expect(() => readSigningKey('not a key with s3cret')).toThrow(
      'EXPO_UPDATES_PRIVATE_KEY is not a PEM private key.',
    );
  });

  it('refuses a key that is not RSA', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => readSigningKey(privateKey.export({ type: 'pkcs8', format: 'pem' }))).toThrow(
      /must be RSA/,
    );
  });
});

describe('publishing', () => {
  it('builds the manifest the spec describes', () => {
    const plan = publishPlan();
    const manifest = JSON.parse(plan.manifestText);
    const bundleHash = b64url(BUNDLE);
    expect(Object.keys(manifest)).toEqual([
      'id',
      'createdAt',
      'runtimeVersion',
      'launchAsset',
      'assets',
      'metadata',
      'extra',
    ]);
    expect(manifest).toEqual({
      id: ID,
      createdAt: '2026-11-09T12:00:00.000Z',
      runtimeVersion: RUNTIME,
      launchAsset: {
        hash: bundleHash,
        key: md5(BUNDLE),
        contentType: 'application/javascript',
        fileExtension: '.bundle',
        url: `${ORIGIN}/expo/assets/${bundleHash}`,
      },
      // The second copy of the icon is the same asset, so it is listed once.
      assets: [
        {
          hash: b64url(ICON),
          key: md5(ICON),
          contentType: 'image/png',
          fileExtension: '.png',
          url: `${ORIGIN}/expo/assets/${b64url(ICON)}`,
        },
        {
          hash: b64url(VECTOR),
          key: md5(VECTOR),
          contentType: 'application/xml',
          fileExtension: '.xml',
          url: `${ORIGIN}/expo/assets/${b64url(VECTOR)}`,
        },
      ],
      metadata: {},
      extra: { expoClient: EXPO_CLIENT },
    });
  });

  it('writes the manifest as ASCII, signed over its exact bytes', () => {
    const plan = publishPlan();
    expect(plan.manifestText).toMatch(/^[\x20-\x7e]+$/);
    expect(plan.manifestText).toBe(asciiJson(JSON.parse(plan.manifestText)));
    const entry = plan.content.find((item) => item.key === manifestKey(ID));
    expect(entry.value).toBe(plan.manifestText);
    expect(entry.metadata.keyid).toBe('main');
    const publicKey = new X509Certificate(certificate).publicKey;
    expect(verifyText(plan.manifestText, entry.metadata.sig, publicKey)).toBe(true);
    expect(verifyText(`${plan.manifestText} `, entry.metadata.sig, publicKey)).toBe(false);
  });

  it('uploads each file once, by its hash, with its type, then the manifest', () => {
    const plan = publishPlan();
    expect(plan.content.map((item) => item.key)).toEqual([
      assetKey(b64url(BUNDLE)),
      assetKey(b64url(ICON)),
      assetKey(b64url(VECTOR)),
      manifestKey(ID),
    ]);
    const [bundle, icon] = plan.content;
    expect(bundle).toMatchObject({
      base64: true,
      metadata: { contentType: 'application/javascript' },
    });
    expect(Buffer.from(bundle.value, 'base64').equals(BUNDLE)).toBe(true);
    expect(Buffer.from(icon.value, 'base64').equals(ICON)).toBe(true);
    expect(icon.metadata).toEqual({ contentType: 'image/png' });
    expect(plan.files).toEqual({ uploaded: 3, skipped: 0 });
  });

  it('leaves out files the store has already', () => {
    const plan = publishPlan({ stored: new Set([assetKey(b64url(BUNDLE)), 'asset:other']) });
    expect(plan.content.map((item) => item.key)).toEqual([
      assetKey(b64url(ICON)),
      assetKey(b64url(VECTOR)),
      manifestKey(ID),
    ]);
    expect(plan.files).toEqual({ uploaded: 2, skipped: 1 });
  });

  it('points the index at it and puts it first in a history of at most 20', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-2fa1-41d2-883f-0016d3cca427`,
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    const plan = publishPlan({ history });
    expect(plan.pointer.map((item) => item.key)).toEqual([
      indexKey('main', 'android', RUNTIME),
      historyKey('main', 'android', RUNTIME),
    ]);
    expect(JSON.parse(plan.pointer[0].value)).toEqual({ id: ID, createdAt: NOW.toISOString() });
    const kept = JSON.parse(plan.pointer[1].value);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toEqual({ id: ID, createdAt: NOW.toISOString(), commit: 'abc1234' });
    expect(kept[19]).toEqual(history[18]);
    // The newest entry rides on the key, so one listing names each runtime version's last publish.
    expect(plan.pointer[1].metadata).toEqual(kept[0]);
  });

  it('refuses a file larger than KV keeps', () => {
    expect(() => publishPlan({ maxValueBytes: 8 })).toThrow(/more than Workers KV keeps/);
  });

  it.each([
    [{ channel: 'Main' }, /not a channel/],
    [{ runtimeVersion: '' }, /not a runtime version/],
    [{ runtimeVersion: undefined }, /not a runtime version/],
    [{ expoClient: null }, /app config/],
    [{ keyId: 'a b' }, /key id/],
    [{ id: 'not-a-uuid' }, /not an update id/],
  ])('refuses %j', (overrides, message) => {
    expect(() => publishPlan(overrides)).toThrow(message);
  });
});

describe('rolling back', () => {
  const history = [
    { id: ID_3, createdAt: '2026-11-09T11:00:00.000Z', commit: 'ccc' },
    { id: ID_2, createdAt: '2026-11-08T11:00:00.000Z', commit: 'bbb' },
    { id: ID, createdAt: '2026-11-07T11:00:00.000Z', commit: 'aaa' },
  ];

  it('goes back to the update before the current one', () => {
    expect(previousId(history)).toBe(ID_2);
    expect(() => previousId(history.slice(0, 1))).toThrow(/Only one update/);
    expect(() => previousId([])).toThrow(/Nothing was published/);
  });

  it('publishes the previous update again, newer, and drops the undone one', () => {
    const previous = publishPlan({ id: ID_2 }).manifestText;
    const newId = '4b4e28ba-2fa1-41d2-883f-0016d3cca427';
    const later = new Date('2026-11-09T13:00:00.000Z');
    const plan = planRollbackPrevious({
      channel: 'main',
      runtimeVersion: RUNTIME,
      history,
      previousManifestText: previous,
      signingKey,
      id: newId,
      now: later,
    });
    const old = JSON.parse(previous);
    const manifest = JSON.parse(plan.manifestText);
    expect(manifest).toEqual({ ...old, id: newId, createdAt: later.toISOString() });
    expect(plan.content.map((item) => item.key)).toEqual([manifestKey(newId)]);
    expect(verifyText(plan.manifestText, plan.content[0].metadata.sig, pair.publicKey)).toBe(true);
    expect(JSON.parse(plan.pointer[1].value)).toEqual([
      { id: newId, createdAt: later.toISOString(), commit: 'bbb', republishOf: ID_2 },
      history[2],
    ]);
    expect(plan.commit).toBe('bbb');
  });

  it('refuses a manifest that is not the previous update’s', () => {
    const wrong = publishPlan({ id: ID }).manifestText;
    expect(() =>
      planRollbackPrevious({
        channel: 'main',
        runtimeVersion: RUNTIME,
        history,
        previousManifestText: wrong,
        signingKey,
        id: ID_3,
        now: NOW,
      }),
    ).toThrow(`not ${ID_2}`);
  });

  it('sends phones back to their own update with a signed directive', () => {
    const plan = planRollbackToEmbedded({
      channel: 'main',
      runtimeVersion: RUNTIME,
      history,
      signingKey,
      now: NOW,
    });
    expect(plan.content).toEqual([]);
    expect(plan.pointer.map((item) => item.key)).toEqual([
      directiveKey('main', 'android', RUNTIME),
    ]);
    expect(JSON.parse(plan.directiveText)).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: NOW.toISOString() },
    });
    expect(plan.pointer[0].value).toBe(plan.directiveText);
    expect(verifyText(plan.directiveText, plan.pointer[0].metadata.sig, pair.publicKey)).toBe(true);
  });

  // After a native change merges, main builds a new runtime version no phone has yet. A blank
  // runtime_version would roll that one back, and the phones on the old one keep the bad update.
  const OLD_RUNTIME = 'fedcba9876543210fedcba9876543210fedcba98';
  const runtimes = [
    {
      runtimeVersion: OLD_RUNTIME,
      id: ID_3,
      createdAt: '2026-11-09T11:00:00.000Z',
      commit: 'c0ffee12345',
    },
  ];

  it('refuses to send phones back from a runtime version nothing was published to', () => {
    const roll = (extra) =>
      planRollbackToEmbedded({
        channel: 'main',
        runtimeVersion: RUNTIME,
        signingKey,
        now: NOW,
        ...extra,
      });
    expect(() => roll({ history: [], runtimes })).toThrow(
      `Nothing was published to runtime version ${RUNTIME} on channel main`,
    );
    expect(() => roll({ history: [], runtimes })).toThrow(
      `${OLD_RUNTIME} (last published 2026-11-09T11:00:00.000Z, commit c0ffee1)`,
    );
    expect(() => roll({})).toThrow(/Nothing was published/);
  });

  it('refuses to step back from a runtime version nothing was published to, naming others', () => {
    expect(() =>
      planRollbackPrevious({
        channel: 'main',
        runtimeVersion: RUNTIME,
        history: [],
        runtimes,
        previousManifestText: '{}',
        signingKey,
        id: ID_3,
        now: NOW,
      }),
    ).toThrow(`Runtime versions with a publish on channel main, newest first: ${OLD_RUNTIME}`);
  });

  it('says before signing what each roll back can do', () => {
    const scope = { channel: 'main', runtimeVersion: RUNTIME, runtimes };
    const one = history.slice(0, 1);
    expect(checkRollback({ action: 'rollback-previous', history, ...scope })).toBe(ID_2);
    expect(checkRollback({ action: 'rollback-to-embedded', history, ...scope })).toBeNull();
    expect(checkRollback({ action: 'rollback-to-embedded', history: one, ...scope })).toBeNull();
    expect(() => checkRollback({ action: 'rollback-previous', history: one, ...scope })).toThrow(
      /Only one update/,
    );
    for (const action of ['rollback-previous', 'rollback-to-embedded']) {
      expect(() => checkRollback({ action, history: [], ...scope })).toThrow(OLD_RUNTIME);
    }
    expect(() => checkRollback({ action: 'publish', history, ...scope })).toThrow(
      /not a roll back/,
    );
  });
});

describe('stored state', () => {
  it('reads a missing history as none', () => {
    expect(readHistory(undefined)).toEqual([]);
    expect(readHistory('')).toEqual([]);
    expect(() => readHistory('{"id":1}')).toThrow(/not a list/);
    expect(() => readHistory('[{}]')).toThrow(/no id/);
  });

  it('reads which runtime versions have publishes, newest first, from a history listing', () => {
    const meta = (id, createdAt, commit) => ({ id, createdAt, commit });
    const listing = [
      { name: 'history:main:android:old', metadata: meta(ID, '2026-10-01T00:00:00.000Z', 'aaa') },
      { name: 'history:main:android:new', metadata: meta(ID_2, '2026-11-01T00:00:00.000Z', null) },
      { name: 'history:main:android:bare' },
      { name: 'history:main:ios:other', metadata: meta(ID_3, '2026-12-01T00:00:00.000Z') },
      { name: 'history:test:android:x', metadata: meta(ID_3, '2026-12-01T00:00:00.000Z') },
    ];
    const runtimes = readRuntimes(JSON.stringify(listing), {
      channel: 'main',
      platform: 'android',
    });
    expect(runtimes).toEqual([
      { runtimeVersion: 'new', id: ID_2, createdAt: '2026-11-01T00:00:00.000Z', commit: null },
      { runtimeVersion: 'old', id: ID, createdAt: '2026-10-01T00:00:00.000Z', commit: 'aaa' },
      { runtimeVersion: 'bare', id: null, createdAt: null, commit: null },
    ]);
    expect(describeRuntimes(runtimes, 'main')).toBe(
      'Runtime versions with a publish on channel main, newest first: new (last published 2026-11-01T00:00:00.000Z); old (last published 2026-10-01T00:00:00.000Z, commit aaa); bare. Give one as runtime_version.',
    );
    expect(readRuntimes(undefined, { channel: 'main' })).toEqual([]);
    expect(describeRuntimes([], 'main')).toBe('Nothing has been published on channel main at all.');
  });

  it('reads the keys of a wrangler kv key list answer', () => {
    expect(
      readKeyList(JSON.stringify([{ name: 'asset:a' }, { name: 'asset:b', metadata: {} }])),
    ).toEqual(new Set(['asset:a', 'asset:b']));
    expect(readKeyList(undefined)).toEqual(new Set());
  });

  it('splits entries into files under the size given, in order', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, value: 'x'.repeat(40) }));
    const files = chunkEntries(entries, 130);
    expect(files.map((file) => file.map((entry) => entry.key))).toEqual([
      ['k0', 'k1'],
      ['k2', 'k3'],
      ['k4'],
    ]);
    for (const file of files) expect(JSON.stringify(file).length).toBeLessThanOrEqual(130);
    expect(chunkEntries([{ key: 'big', value: 'x'.repeat(500) }], 130)).toHaveLength(1);
  });
});

describe('the Worker serves what the script wrote', () => {
  const CLIENT = {
    accept: 'multipart/mixed,application/expo+json,application/json',
    'expo-platform': 'android',
    'expo-protocol-version': '1',
    'expo-runtime-version': RUNTIME,
    'expo-channel-name': 'main',
    'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    'eas-client-id': 'a-per-install-id',
  };
  const ask = (path) => new Request(`${ORIGIN}${path}`, { headers: CLIENT });

  /** What `wrangler kv bulk put` does with the files, content first. */
  function upload(kv, plan) {
    for (const file of chunkEntries(plan.content)) kv.bulkPut(file);
    kv.bulkPut(plan.pointer);
  }

  async function served(env) {
    const response = await worker.fetch(ask('/expo/manifest'), env);
    if (response.status === 204) return { status: 204 };
    const [part] = readMultipart(
      await response.text(),
      boundaryOf(response.headers.get('content-type')),
    );
    const { sig, keyid } = readDictionary(part.headers['expo-signature']);
    // As expo-updates checks it: SHA256withRSA over the part's bytes, with the embedded certificate.
    const verified = verifyText(part.body, sig, new X509Certificate(certificate).publicKey);
    return {
      status: response.status,
      name: partName(part),
      body: JSON.parse(part.body),
      keyid,
      verified,
    };
  }

  it('uses the same keys as the Worker', () => {
    for (const name of ['assetKey', 'manifestKey']) {
      expect(protocol[name]('x')).toBe({ assetKey, manifestKey }[name]('x'));
    }
    const scope = ['main', 'android', RUNTIME];
    expect(protocol.indexKey(...scope)).toBe(indexKey(...scope));
    expect(protocol.directiveKey(...scope)).toBe(directiveKey(...scope));
    expect(protocol.historyKey(...scope)).toBe(historyKey(...scope));
  });

  it('publishes, rolls back and publishes again, end to end', async () => {
    const kv = testKV();
    const env = { UPDATES: kv };
    expect((await served(env)).status).toBe(204);

    const first = publishPlan({ id: ID, now: new Date('2026-11-09T10:00:00.000Z') });
    upload(kv, first);
    let answer = await served(env);
    expect(answer).toMatchObject({ status: 200, name: 'manifest', keyid: 'main', verified: true });
    expect(answer.body.id).toBe(ID);
    expect(answer.body.extra.expoClient).toEqual(EXPO_CLIENT);

    // Every file the manifest names is served with the bytes its hash promises.
    for (const asset of [answer.body.launchAsset, ...answer.body.assets]) {
      const response = await worker.fetch(ask(new URL(asset.url).pathname), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(asset.contentType);
      expect(sha256(Buffer.from(await response.arrayBuffer()))).toBe(asset.hash);
    }

    const second = publishPlan({
      id: ID_2,
      now: new Date('2026-11-09T11:00:00.000Z'),
      exportDir: writeExport(folder('second'), {
        bundle: Buffer.from('v2'),
        assets: [ICON, VECTOR, ICON],
      }),
      history: JSON.parse(first.pointer[1].value),
      stored: new Set(first.content.map((item) => item.key)),
    });
    expect(second.files).toEqual({ uploaded: 1, skipped: 2 });
    upload(kv, second);
    expect((await served(env)).body.id).toBe(ID_2);

    const embedded = planRollbackToEmbedded({
      channel: 'main',
      runtimeVersion: RUNTIME,
      history: JSON.parse(second.pointer[1].value),
      signingKey,
      now: new Date('2026-11-09T12:00:00.000Z'),
    });
    upload(kv, embedded);
    answer = await served(env);
    expect(answer).toMatchObject({ name: 'directive', verified: true });
    expect(answer.body.type).toBe('rollBackToEmbedded');

    const back = planRollbackPrevious({
      channel: 'main',
      runtimeVersion: RUNTIME,
      history: JSON.parse(second.pointer[1].value),
      previousManifestText: first.manifestText,
      signingKey,
      id: ID_3,
      now: new Date('2026-11-09T13:00:00.000Z'),
    });
    upload(kv, back);
    answer = await served(env);
    expect(answer).toMatchObject({ name: 'manifest', verified: true });
    expect(answer.body.id).toBe(ID_3);
    expect(answer.body.launchAsset).toEqual(JSON.parse(first.manifestText).launchAsset);
  });
});

describe('the command', () => {
  function run(args, env = {}) {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
        env: { PATH: process.env.PATH, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      return { code: error.status, stdout: error.stdout, stderr: error.stderr };
    }
  }

  it('writes the bulk-put files for a publish', () => {
    const exportDir = writeExport(folder('command-export'));
    const config = join(folder('command-config'), 'config.json');
    writeFileSync(config, JSON.stringify(EXPO_CLIENT));
    const certFile = join(folder('command-cert'), 'certificate.pem');
    writeFileSync(certFile, certificate);
    const out = join(work, 'command-out');
    const result = run(
      [
        'publish',
        '--export',
        exportDir,
        '--expo-config',
        config,
        '--certificate',
        certFile,
        '--commit',
        'abc1234',
        '--channel',
        'main',
        '--runtime-version',
        RUNTIME,
        '--history',
        join(work, 'no-such-history.json'),
        '--out',
        out,
      ],
      { EXPO_UPDATES_PRIVATE_KEY: pair.privateKeyPem },
    );
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      'content-1.json',
      'manifest.json',
      'pointer.json',
      'summary.json',
    ]);
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      action: 'publish',
      channel: 'main',
      platform: 'android',
      runtimeVersion: RUNTIME,
      commit: 'abc1234',
      files: { uploaded: 3, skipped: 0 },
    });
    expect(JSON.parse(result.stdout)).toEqual(summary);
    const manifest = readFileSync(join(out, 'manifest.json'), 'utf8');
    expect(JSON.parse(manifest).id).toBe(summary.id);
    const content = JSON.parse(readFileSync(join(out, 'content-1.json'), 'utf8'));
    expect(content.at(-1)).toMatchObject({ key: manifestKey(summary.id), value: manifest });
    const pointer = JSON.parse(readFileSync(join(out, 'pointer.json'), 'utf8'));
    expect(pointer[0].key).toBe(indexKey('main', 'android', RUNTIME));
  });

  it('refuses to sign without the key, and says so without a stack', () => {
    const result = run([
      'rollback-to-embedded',
      '--channel',
      'main',
      '--runtime-version',
      RUNTIME,
      '--out',
      join(work, 'x'),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      '::error::Set EXPO_UPDATES_PRIVATE_KEY (or pass --key-file): every update is signed.\n',
    );
  });

  it('refuses a key that is not the certificate’s', () => {
    const certFile = join(folder('command-cert-2'), 'certificate.pem');
    writeFileSync(certFile, certificate);
    const other = makeCodeSigningPair();
    const result = run(
      [
        'rollback-to-embedded',
        '--channel',
        'main',
        '--runtime-version',
        RUNTIME,
        '--certificate',
        certFile,
        '--out',
        join(work, 'y'),
      ],
      { EXPO_UPDATES_PRIVATE_KEY: other.privateKeyPem },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/does not belong to apps\/mobile\/certs\/certificate.pem/);
    expect(result.stderr).not.toMatch(/PRIVATE KEY-----/);
  });

  describe('check-rollback', () => {
    const scope = ['--channel', 'main', '--runtime-version', RUNTIME];
    let historyFile;
    let runtimesFile;
    beforeAll(() => {
      historyFile = join(folder('command-history'), 'history.json');
      writeFileSync(
        historyFile,
        JSON.stringify([
          { id: ID_2, createdAt: NOW.toISOString() },
          { id: ID, createdAt: NOW.toISOString() },
        ]),
      );
      runtimesFile = join(folder('command-history'), 'runtimes.json');
      writeFileSync(
        runtimesFile,
        JSON.stringify([
          {
            name: `history:main:android:${RUNTIME}`,
            metadata: { id: ID_2, createdAt: NOW.toISOString() },
          },
          {
            name: 'history:main:android:older',
            metadata: { id: ID_3, createdAt: '2026-10-01T00:00:00.000Z', commit: 'abcdef0123' },
          },
        ]),
      );
    });

    it('prints the id rollback-previous needs, and nothing for rollback-to-embedded', () => {
      const check = (action) =>
        run(['check-rollback', '--action', action, '--history', historyFile, ...scope]);
      expect(check('rollback-previous')).toEqual({ code: 0, stdout: `${ID}\n`, stderr: '' });
      expect(check('rollback-to-embedded')).toEqual({ code: 0, stdout: '\n', stderr: '' });
    });

    it('refuses either roll back of a runtime version nothing was published to', () => {
      for (const action of ['rollback-previous', 'rollback-to-embedded']) {
        const result = run([
          'check-rollback',
          '--action',
          action,
          '--history',
          join(work, 'none.json'),
          '--runtimes',
          runtimesFile,
          ...scope,
        ]);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/^::error::Nothing was published to runtime version/);
        expect(result.stderr).toContain(
          `newest first: ${RUNTIME} (last published ${NOW.toISOString()}); older (last published 2026-10-01T00:00:00.000Z, commit abcdef0)`,
        );
      }
    });

    it('refuses what is not a roll back, or a runtime version out of form', () => {
      expect(run(['check-rollback', '--action', 'publish', ...scope]).stderr).toMatch(
        /not a roll back/,
      );
      expect(
        run(['check-rollback', '--action', 'rollback-previous', '--channel', 'main']).stderr,
      ).toMatch(/not a runtime version/);
    });
  });

  it('refuses rollback-to-embedded with no history even when signing would work', () => {
    const certFile = join(folder('command-cert-3'), 'certificate.pem');
    writeFileSync(certFile, certificate);
    const out = join(work, 'z');
    const result = run(
      [
        'rollback-to-embedded',
        '--channel',
        'main',
        '--runtime-version',
        RUNTIME,
        '--certificate',
        certFile,
        '--history',
        join(work, 'none.json'),
        '--out',
        out,
      ],
      { EXPO_UPDATES_PRIVATE_KEY: pair.privateKeyPem },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^::error::Nothing was published to runtime version/);
    expect(existsSync(out)).toBe(false);
  });

  it('gives a public key the certificate agrees with', () => {
    // A sanity check of the test's own certificate, so the tests above prove something.
    const cert = new X509Certificate(certificate);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(
      cert.publicKey
        .export({ type: 'spki', format: 'der' })
        .equals(createPublicKey(pair.privateKeyPem).export({ type: 'spki', format: 'der' })),
    ).toBe(true);
  });
});

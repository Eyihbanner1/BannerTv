/**
 * In-app updates for the LG app, as the Publish LG update workflow makes them: Build describes the
 * scripts in its bundle, Sign signs them with the LG update key, Upload checks and stores them,
 * the Worker serves them, and the TV's own reader (apps/webos/src/shell/signed.ts) takes them.
 */
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, webcrypto } from 'node:crypto';
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
import {
  importUpdateKey,
  readAnswer,
  readSigned,
  verifyText as tvVerifies,
} from '../../../../apps/webos/src/shell/signed.ts';
import { testKV } from '../../src/test/kv.ts';
import * as served from '../../src/webos.ts';
import worker from '../../src/worker.ts';
import { makeIpk } from './test/ipk.mjs';
import { chunkEntries } from './update.mjs';
import {
  APP_BASE_URL,
  appFileKey,
  appKey,
  checkSigned,
  describeBuild,
  describeUpdate,
  lgKeyId,
  planPublish,
  planRollbackPrevious,
  readHistory,
  readLgPublicKey,
  readLgSigningKey,
  readShellConfig,
  runSummary,
  servesApp,
  signRollback,
  signUpdate,
} from './webos.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'webos.mjs');
const ORIGIN = 'https://updates.bannertv.workers.dev';
const COMMIT = 'ed387a1228288492187ba32540e721775a2f3292';
const COMMIT_2 = '4a5614f0123456789abcdef0123456789abcdef0';
const RUNTIME = 'webos-1-0123456789abcdef';
const BUILT_AT = '2026-11-11T09:00:00.000Z';
const NOW = new Date('2026-11-11T09:05:00.000Z');
const LATER = new Date('2026-11-11T12:00:00.000Z');
const NONE = readHistory(undefined);

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function rsaPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const PAIR = rsaPair();
const OTHER = rsaPair();
const publicKey = readLgPublicKey(PAIR.publicKey);
const privateKey = readLgSigningKey(PAIR.privateKey, publicKey);
const KEY_ID = lgKeyId(publicKey);

let work;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'bannertv-webos-app-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function folder(name) {
  const dir = join(work, `${name}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A build's scripts by path, as text the tests can tell apart. */
function scripts(app = 'app:one') {
  return {
    'assets/index-a1.js': Buffer.from(`/* ${app} */`),
    'vendor/hls.min.js': Buffer.from('/* hls */'),
    'data/sports-data.js': Buffer.from('/* sports */'),
  };
}

/** index.html as apps/webos/build/shell.ts writes it, for these scripts. */
function shellHtml(files, { version = '0.1.2', commit = COMMIT, updates, runtime = RUNTIME } = {}) {
  const entries = {};
  for (const [path, bytes] of Object.entries(files)) {
    entries[path] = { sha256: sha256Hex(bytes), size: bytes.length };
  }
  const config = {
    contract: 1,
    runtime,
    build: { id: 'b'.repeat(32), version, commit, builtAt: BUILT_AT },
    launch: 'assets/index-a1.js',
    files: entries,
    updates:
      updates === undefined
        ? { channel: 'main', url: APP_BASE_URL, key: 'unused', keyId: KEY_ID }
        : updates,
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><script id="bannertv-shell" type="application/json">${json}</script><script defer src="./loader.js"></script></head><body><div id="root"></div></body></html>`;
}

function describe_(files = scripts(), options = {}) {
  return describeUpdate({
    html: shellHtml(files, options),
    readFile: (path) => {
      if (!files[path]) throw new Error('ENOENT');
      return files[path];
    },
    version: options.version ?? '0.1.2',
    commit: options.commit ?? COMMIT,
  });
}

/** What the TV's loader does with an answer: its own reader, with Web Crypto. */
async function tvReads(body, runtime = RUNTIME) {
  const answer = readAnswer(JSON.parse(body));
  const key = await importUpdateKey(
    webcrypto.subtle,
    publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  );
  expect(answer.keyId).toBe(KEY_ID);
  expect(await tvVerifies(webcrypto.subtle, key, answer.text, answer.sig)).toBe(true);
  return readSigned(answer.text, { runtime, updates: { channel: 'main' } });
}

describe('what Build describes', () => {
  it('reads the shell config and checks every script against it', () => {
    const files = scripts();
    const description = describe_(files);
    expect(description).toEqual({
      runtime: RUNTIME,
      version: '0.1.2',
      commit: COMMIT,
      builtAt: BUILT_AT,
      launch: 'assets/index-a1.js',
      files: Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [
          path,
          { sha256: sha256Hex(bytes), size: bytes.length },
        ]),
      ),
      updates: { channel: 'main', keyId: KEY_ID },
    });
    expect(readShellConfig(shellHtml(files)).runtime).toBe(RUNTIME);
  });

  it('says a build without updates takes none', () => {
    expect(describe_(scripts(), { updates: null }).updates).toBeNull();
  });

  it('refuses a script that is not the one named, or is not there', () => {
    const files = scripts();
    const html = shellHtml(files);
    const changed = { ...files, 'vendor/hls.min.js': Buffer.from('/* hls, changed */') };
    expect(() =>
      describeUpdate({ html, readFile: (path) => changed[path], version: '0.1.2', commit: COMMIT }),
    ).toThrow(/vendor\/hls.min.js is not the file the shell config names/);
    expect(() =>
      describeUpdate({
        html,
        readFile: () => {
          throw new Error('ENOENT');
        },
        version: '0.1.2',
        commit: COMMIT,
      }),
    ).toThrow(/is not in the build/);
  });

  it('refuses a build of another version or commit, asking elsewhere, or without the loader', () => {
    const files = scripts();
    const read = (path) => files[path];
    expect(() =>
      describeUpdate({ html: shellHtml(files), readFile: read, version: '0.1.3', commit: COMMIT }),
    ).toThrow(/was the version stamped before the build/);
    expect(() =>
      describe_(files, {
        updates: { channel: 'main', url: 'https://updates.example/webos/', keyId: KEY_ID },
      }),
    ).toThrow(/asks https:\/\/updates.example\/webos\//);
    expect(() =>
      describe_(files, { updates: { channel: 'beta', url: APP_BASE_URL, keyId: KEY_ID } }),
    ).toThrow(/follows beta/);
    expect(() => describe_(files, { runtime: '1.0.0' })).toThrow(/no runtime version/);
    expect(() =>
      describeUpdate({ html: '<html></html>', readFile: read, version: '0.1.2', commit: COMMIT }),
    ).toThrow(/carries no shell config/);
  });

  it('refuses scripts the TV would refuse', () => {
    const bad = { ...scripts(), 'licenses/notice.txt': Buffer.from('x') };
    expect(() => describe_(bad)).toThrow(/names licenses\/notice.txt, not a script/);
  });
});

describe('signing', () => {
  it('signs a manifest the TV verifies and reads back, timed now', async () => {
    const signed = signUpdate({ description: describe_(), privateKey, publicKey, now: NOW });
    expect(signed.off).toBe(false);
    expect(signed.update).toMatchObject({
      kind: 'update',
      runtime: RUNTIME,
      keyId: KEY_ID,
      createdAt: NOW.toISOString(),
      version: '0.1.2',
      commit: COMMIT,
    });
    // ASCII only, so its bytes are the same wherever it is read.
    expect(/^[\x20-\x7e]*$/.test(signed.body)).toBe(true);
    const manifest = await tvReads(signed.body);
    expect(manifest).toMatchObject({
      type: 'bannertv-lg-update',
      id: signed.update.id,
      createdAt: NOW.toISOString(),
      version: '0.1.2',
      commit: COMMIT,
      launch: 'assets/index-a1.js',
    });
    expect(manifest.files).toEqual(signed.update.files);
    expect(checkSigned(signed, publicKey)).toEqual({ update: signed.update, body: signed.body });
  });

  it('refuses a key that is not the committed one, or a build that names another', () => {
    expect(() => readLgSigningKey(OTHER.privateKey, publicKey)).toThrow(
      /LG_UPDATES_PRIVATE_KEY does not belong to apps\/webos\/certs\/lg-updates.pem/,
    );
    expect(() => readLgSigningKey('not a key', publicKey)).toThrow(
      /^LG_UPDATES_PRIVATE_KEY is not a PEM private key\.$/,
    );
    const elsewhere = describe_(scripts(), {
      updates: { channel: 'main', url: APP_BASE_URL, keyId: 'lg-ffffffffffffffff' },
    });
    expect(() => signUpdate({ description: elsewhere, privateKey, publicKey, now: NOW })).toThrow(
      /carries the key lg-ffffffffffffffff/,
    );
    expect(() =>
      signUpdate({ description: describe_(), privateKey, publicKey, now: new Date(BUILT_AT) }),
    ).toThrow(/after now/);
  });

  it('is refused by Upload when changed or signed by another key', () => {
    const signed = signUpdate({ description: describe_(), privateKey, publicKey, now: NOW });
    const other = readLgPublicKey(OTHER.publicKey);
    expect(() => checkSigned(signed, other)).toThrow(/not apps\/webos\/certs\/lg-updates.pem's/);
    const body = JSON.parse(signed.body);
    const tampered = {
      ...signed,
      body: JSON.stringify({ ...body, manifest: body.manifest.replace('0.1.2', '0.1.9') }),
    };
    expect(() => checkSigned(tampered, publicKey)).toThrow(/is not the update Sign says it signed/);
    const forged = {
      update: { ...signed.update, version: '0.1.9' },
      body: signed.body.replace('0.1.2', '0.1.9'),
    };
    expect(() => checkSigned(forged, publicKey)).toThrow(/does not verify/);
    expect(checkSigned({ off: true, reason: 'none' }, undefined)).toBeNull();
  });
});

/** What Build hands on for a publish: the .ipk with what it is, and the update's scripts. */
function build(version, commit, app) {
  const files = scripts(app);
  const ipkBytes = makeIpk({ version });
  return {
    ipkBytes,
    build: describeBuild(ipkBytes, { version, commit, ipkName: `b_${version}.ipk` }),
    description: describe_(files, { version, commit }),
    appFiles: (sha) => Object.values(files).find((bytes) => sha256Hex(bytes) === sha),
  };
}

function publish(
  version,
  { history = NONE, commit = COMMIT, app = `app:${version}`, stored = new Set(), now = NOW } = {},
) {
  const made = build(version, commit, app);
  const signed = signUpdate({ description: made.description, privateKey, publicKey, now });
  return planPublish({
    ...made,
    version,
    commit,
    history,
    stored,
    now,
    signed,
    publicKey,
  });
}

const after = (plan) => readHistory(plan.history.value);
const keysOf = (...plans) => new Set(plans.flatMap((plan) => plan.content.map((item) => item.key)));

describe('publishing', () => {
  it('uploads the scripts not stored, and keeps the update in the history', () => {
    const first = publish('0.1.2');
    const fileKeys = first.content
      .map((item) => item.key)
      .filter((key) => key.startsWith('webos/file/'));
    expect(fileKeys).toHaveLength(3);
    expect(first.app).toEqual({ key: appKey(RUNTIME), value: expect.any(String) });
    expect(first.entry.update).toMatchObject({
      kind: 'update',
      version: '0.1.2',
      runtime: RUNTIME,
    });
    expect(after(first).publishes[0].update).toEqual(first.entry.update);
    expect(first.inApp).toMatchObject({
      off: false,
      kind: 'update',
      version: '0.1.2',
      uploaded: 3,
    });
    expect(first.files).toEqual({ uploaded: 5, skipped: 0 });

    // Only the app's script changed, so only it goes up.
    const second = publish('0.1.3', {
      history: after(first),
      stored: keysOf(first),
      commit: COMMIT_2,
    });
    expect(second.content.filter((item) => item.key.startsWith('webos/file/'))).toHaveLength(1);
    expect(second.files).toEqual({ uploaded: 2, skipped: 3 });
  });

  it('refuses scripts other than the ones signed, or none', () => {
    const made = build('0.1.2', COMMIT, 'app:x');
    const signed = signUpdate({ description: made.description, privateKey, publicKey, now: NOW });
    const base = {
      ...made,
      version: '0.1.2',
      commit: COMMIT,
      history: NONE,
      now: NOW,
      signed,
      publicKey,
    };
    expect(() => planPublish({ ...base, appFiles: () => undefined })).toThrow(
      /handed on no script/,
    );
    expect(() => planPublish({ ...base, appFiles: () => Buffer.from('other') })).toThrow(
      /is not the one the update names/,
    );
    expect(() =>
      planPublish({
        ...base,
        version: '0.1.3',
        build: describeBuild(makeIpk({ version: '0.1.3' }), {
          version: '0.1.3',
          commit: COMMIT,
          ipkName: 'b.ipk',
        }),
        ipkBytes: makeIpk({ version: '0.1.3' }),
      }),
    ).toThrow(/Sign signed 0\.1\.2 of .*, not 0\.1\.3/);
  });

  it('publishes for Homebrew Channel alone when nothing was signed', () => {
    const made = build('0.1.2', COMMIT, 'app:x');
    const plan = planPublish({
      ...made,
      version: '0.1.2',
      commit: COMMIT,
      history: NONE,
      now: NOW,
      signed: { off: true, reason: 'No key yet.' },
    });
    expect(plan.app).toBeNull();
    expect(plan.entry.update).toBeUndefined();
    expect(plan.inApp).toEqual({ off: true, reason: 'No key yet.' });
    expect(runSummary({ ...summaryOf(plan) }, { result: 'success' })).toContain(
      '| In-app update | none: No key yet. |',
    );
  });
});

function summaryOf(plan) {
  return {
    action: plan.action,
    version: plan.entry.version,
    commit: plan.entry.commit,
    sha256: plan.entry.sha256,
    ipkSize: plan.entry.ipkSize,
    repoUrl: `${ORIGIN}/webos/repo.json`,
    before: plan.previous,
    files: plan.files,
    inApp: plan.inApp,
  };
}

describe('rolling back', () => {
  function two(secondOptions = {}) {
    const first = publish('0.1.2');
    const second = publish('0.1.3', {
      history: after(first),
      stored: keysOf(first),
      commit: COMMIT_2,
      ...secondOptions,
    });
    const stored = new Set([...keysOf(first, second)]);
    return { first, second, history: after(second), stored };
  }

  it('sends the build before again, with a new id and time, when its scripts are stored', async () => {
    const { first, history, stored } = two();
    const signed = signRollback({ history, stored, privateKey, publicKey, now: LATER });
    expect(signed.update).toMatchObject({
      kind: 'update',
      version: '0.1.2',
      createdAt: LATER.toISOString(),
    });
    expect(signed.update.id).not.toBe(first.entry.update.id);
    expect(signed.update.files).toEqual(first.entry.update.files);
    expect((await tvReads(signed.body)).version).toBe('0.1.2');
    const plan = planRollbackPrevious({ history, stored, now: LATER, signed, publicKey });
    expect(plan.content).toEqual([]);
    expect(plan.app.key).toBe(appKey(RUNTIME));
    expect(plan.entry).toMatchObject({ version: '0.1.2', update: signed.update });
    expect(plan.files).toEqual({ uploaded: 0, skipped: 3 });
  });

  it('sends TVs back to their own .ipk when the build before was of another runtime or gone', async () => {
    const first = publish('0.1.2');
    const other = { ...after(first) };
    other.publishes = other.publishes.map((entry) => ({
      ...entry,
      update: { ...entry.update, runtime: 'webos-1-ffffffffffffffff' },
    }));
    const second = publish('0.1.3', { history: other, stored: keysOf(first), commit: COMMIT_2 });
    const history = after(second);
    const stored = keysOf(first, second);
    const signed = signRollback({ history, stored, privateKey, publicKey, now: LATER });
    expect(signed.update).toEqual({
      kind: 'built-in',
      runtime: RUNTIME,
      keyId: KEY_ID,
      createdAt: LATER.toISOString(),
    });
    const directive = await tvReads(signed.body);
    expect(directive).toMatchObject({
      type: 'bannertv-lg-built-in',
      createdAt: LATER.toISOString(),
    });
    const plan = planRollbackPrevious({ history, stored, now: LATER, signed, publicKey });
    expect(plan.inApp).toMatchObject({ kind: 'built-in', runtime: RUNTIME });
    expect(runSummary(summaryOf(plan), { result: 'success' })).toContain(
      'goes back to the code of the .ipk installed on it',
    );

    // The same when a script of the build before is no longer stored.
    const gone = two();
    const missing = new Set([...gone.stored].filter((key) => !key.startsWith('webos/file/')));
    for (const file of Object.values(gone.second.entry.update.files))
      missing.add(appFileKey(file.sha256));
    expect(
      signRollback({ history: gone.history, stored: missing, privateKey, publicKey, now: LATER })
        .update.kind,
    ).toBe('built-in');
  });

  it('signs nothing when the build undone took no in-app update', () => {
    const plain = (version, history) =>
      planPublish({
        ...build(version, COMMIT, `app:${version}`),
        version,
        commit: COMMIT,
        history,
        now: NOW,
      });
    const first = plain('0.1.2', NONE);
    const second = plain('0.1.3', after(first));
    const signed = signRollback({ history: after(second), stored: keysOf(first, second) });
    expect(signed).toEqual({
      off: true,
      reason: '0.1.3 went out through Homebrew Channel only, so there is no in-app update to undo.',
    });
  });

  it('refuses what Sign signed for another runtime', () => {
    const { history, stored } = two();
    const wrong = signRollback({ history, stored, privateKey, publicKey, now: LATER });
    const changed = {
      ...history,
      publishes: history.publishes.map((entry, at) =>
        at === 0
          ? { ...entry, update: { ...entry.update, runtime: 'webos-1-ffffffffffffffff' } }
          : entry,
      ),
    };
    expect(() =>
      planRollbackPrevious({ history: changed, stored, now: LATER, signed: wrong, publicKey }),
    ).toThrow(/not the runtime of 0\.1\.3/);
  });
});

describe('the Worker and the TV take what the scripts wrote', () => {
  const ask = (path) => new Request(new URL(path, ORIGIN));

  function upload(kv, plan) {
    for (const file of chunkEntries(plan.content)) kv.bulkPut(file);
    kv.bulkPut([plan.history]);
    if (plan.app) kv.bulkPut([plan.app]);
    kv.bulkPut([plan.repo]);
  }

  /** As the loader asks: the answer, checked, then each script by its SHA-256. */
  async function asTv(env) {
    const response = await worker.fetch(ask(`/webos/update?channel=main&runtime=${RUNTIME}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const manifest = await tvReads(await response.text());
    if (manifest.type === 'bannertv-lg-built-in') return manifest;
    for (const file of Object.values(manifest.files)) {
      const got = await worker.fetch(ask(`/webos/file/${file.sha256}`), env);
      expect(got.status).toBe(200);
      expect(sha256Hex(Buffer.from(await got.arrayBuffer()))).toBe(file.sha256);
    }
    return manifest;
  }

  it('uses the same keys as the Worker', () => {
    expect(served.appKey('main', RUNTIME)).toBe(appKey(RUNTIME));
    expect(served.appFileKey('a'.repeat(64))).toBe(appFileKey('a'.repeat(64)));
    expect(served.isWebosRuntime(RUNTIME)).toBe(true);
  });

  it('publishes, rolls back and publishes again, end to end', async () => {
    const kv = testKV();
    const env = { UPDATES: kv };
    const none = await worker.fetch(ask(`/webos/update?channel=main&runtime=${RUNTIME}`), env);
    expect(none.status).toBe(204);

    const first = publish('0.1.2');
    upload(kv, first);
    // The answer after the history and before the index.
    expect(kv.writes.slice(-3)).toEqual(['webos/history/main', appKey(RUNTIME), 'webos/repo/main']);
    expect((await asTv(env)).version).toBe('0.1.2');

    const second = publish('0.1.3', {
      history: after(first),
      stored: new Set(kv.writes),
      commit: COMMIT_2,
    });
    upload(kv, second);
    expect((await asTv(env)).version).toBe('0.1.3');
    const status = await worker.fetch(
      ask(`/status?channel=main&platform=webos&runtime=${RUNTIME}`),
      env,
    );
    expect(await status.json()).toMatchObject({
      update: { type: 'update', version: '0.1.3', id: second.entry.update.id, keyId: KEY_ID },
      serving: 'update',
    });

    const stored = new Set(kv.writes);
    const signed = signRollback({
      history: after(second),
      stored,
      privateKey,
      publicKey,
      now: LATER,
    });
    const back = planRollbackPrevious({
      history: after(second),
      stored,
      now: LATER,
      signed,
      publicKey,
    });
    upload(kv, back);
    const again = await asTv(env);
    expect(again).toMatchObject({ version: '0.1.2', createdAt: LATER.toISOString() });
    expect(
      servesApp(
        await (
          await worker.fetch(ask(`/webos/update?channel=main&runtime=${RUNTIME}`), env)
        ).text(),
        back.app,
      ),
    ).toBe(true);

    const third = publish('0.1.4', {
      history: after(back),
      stored: new Set(kv.writes),
      now: new Date('2026-11-11T13:00:00.000Z'),
    });
    upload(kv, third);
    expect((await asTv(env)).version).toBe('0.1.4');
  });
});

describe('the commands', () => {
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

  /** An apps/webos/dist with the shell config and its scripts. */
  function dist(options = {}) {
    const dir = folder('dist');
    const files = scripts(options.app);
    writeFileSync(join(dir, 'index.html'), shellHtml(files, options));
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), bytes);
    }
    return dir;
  }

  function keyFile(pem = PAIR.publicKey) {
    const path = join(folder('certs'), 'lg-updates.pem');
    writeFileSync(path, pem);
    return path;
  }

  it('describes, signs, publishes with the update, and checks the Worker serves it', () => {
    const dir = folder('flow');
    const update = join(dir, 'update');
    const described = run([
      'describe-update',
      ...['--dist', dist(), '--version', '0.1.2', '--commit', COMMIT, '--out', update],
    ]);
    expect(described.stderr).toBe('');
    expect(described.code).toBe(0);
    expect(readdirSync(join(update, 'files'))).toHaveLength(3);

    const pem = keyFile();
    const signedPath = join(dir, 'signed.json');
    const sign = ['sign-update', '--update', update, '--public-key', pem, '--out', signedPath];
    const noSecret = run(sign);
    expect(noSecret.code).toBe(1);
    expect(noSecret.stderr).toMatch(
      /^::error::Add the repository secret LG_UPDATES_PRIVATE_KEY first/,
    );
    const wrongSecret = run(sign, { LG_UPDATES_PRIVATE_KEY: OTHER.privateKey });
    expect(wrongSecret.stderr).toMatch(/does not belong to apps\/webos\/certs\/lg-updates.pem/);
    // Neither quotes the key.
    expect(wrongSecret.stderr).not.toContain('PRIVATE KEY');
    const signedRun = run(sign, { LG_UPDATES_PRIVATE_KEY: PAIR.privateKey });
    expect(signedRun.code).toBe(0);
    const signed = JSON.parse(readFileSync(signedPath, 'utf8'));
    expect(signed).toMatchObject({ off: false, update: { version: '0.1.2', kind: 'update' } });

    const ipk = join(dir, 'com.bannertv.app_0.1.2_all.ipk');
    writeFileSync(ipk, makeIpk({ version: '0.1.2' }));
    const buildJson = join(dir, 'build.json');
    run([
      'describe-build',
      '--ipk',
      ipk,
      '--version',
      '0.1.2',
      '--commit',
      COMMIT,
      '--out',
      buildJson,
    ]);
    const missing = join(dir, 'none.json');
    const keys = join(dir, 'keys.json');
    writeFileSync(keys, '[]');
    const out = join(dir, 'publish');
    const published = run([
      'publish',
      ...['--ipk', ipk, '--build', buildJson, '--version', '0.1.2', '--commit', COMMIT],
      ...['--history', missing, '--history-now', missing, '--keys', keys],
      ...['--update', update, '--signed', signedPath, '--public-key', pem, '--out', out],
    ]);
    expect(published.stderr).toBe('');
    expect(readdirSync(out).sort()).toEqual([
      'app.json',
      'content-1.json',
      'history.json',
      'index.json',
      'repo.json',
      'summary.json',
    ]);
    const app = JSON.parse(readFileSync(join(out, 'app.json'), 'utf8'))[0];
    expect(app).toEqual({ key: appKey(RUNTIME), value: signed.body });
    const content = JSON.parse(readFileSync(join(out, 'content-1.json'), 'utf8'));
    expect(
      content.map((item) => item.key).filter((key) => key.startsWith('webos/file/')),
    ).toHaveLength(3);
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary.inApp).toMatchObject({
      kind: 'update',
      version: '0.1.2',
      runtime: RUNTIME,
      uploaded: 3,
    });
    expect(summary.inApp.url).toBe(`${ORIGIN}/webos/update?channel=main&runtime=${RUNTIME}`);

    const servedPath = join(dir, 'served.json');
    writeFileSync(servedPath, signed.body);
    expect(run(['serves-app', '--plan', out, '--served', servedPath]).code).toBe(0);
    writeFileSync(servedPath, `${signed.body} `);
    expect(run(['serves-app', '--plan', out, '--served', servedPath]).code).toBe(1);

    // A roll back with one publish has nothing to go back to.
    const history = join(dir, 'history.json');
    writeFileSync(history, JSON.parse(readFileSync(join(out, 'history.json'), 'utf8'))[0].value);
    const back = run(
      [
        'sign-rollback',
        '--history',
        history,
        '--keys',
        keys,
        '--public-key',
        pem,
        '--out',
        join(dir, 'b.json'),
      ],
      { LG_UPDATES_PRIVATE_KEY: PAIR.privateKey },
    );
    expect(back.code).toBe(1);
    expect(back.stderr).toMatch(/Only 0\.1\.2 is left in the LG history/);
  });

  it('signs nothing, with a notice, for a build that takes no updates', () => {
    const dir = folder('off');
    const update = join(dir, 'update');
    run([
      'describe-update',
      ...[
        '--dist',
        dist({ updates: null }),
        '--version',
        '0.1.2',
        '--commit',
        COMMIT,
        '--out',
        update,
      ],
    ]);
    const out = join(dir, 'signed.json');
    const result = run([
      'sign-update',
      ...['--update', update, '--public-key', join(dir, 'no-key.pem'), '--out', out],
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^::notice::No in-app update this run\. .*is not committed yet/);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ off: true });
    expect(existsSync(join(update, 'files'))).toBe(true);
  });

  it('refuses a folder that exists, or files the shell config does not name', () => {
    const dir = folder('refuse');
    expect(
      run([
        'describe-update',
        '--dist',
        dist(),
        '--version',
        '0.1.2',
        '--commit',
        COMMIT,
        '--out',
        dir,
      ]).stderr,
    ).toMatch(/exists already/);
    const changed = dist();
    writeFileSync(join(changed, 'data', 'sports-data.js'), 'changed');
    expect(
      run([
        'describe-update',
        ...['--dist', changed, '--version', '0.1.2', '--commit', COMMIT, '--out', join(dir, 'u')],
      ]).stderr,
    ).toMatch(/data\/sports-data.js is not the file the shell config names/);
  });
});

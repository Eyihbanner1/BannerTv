import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testKV } from '../../src/test/kv.ts';
import * as served from '../../src/webos.ts';
import worker from '../../src/worker.ts';
import { ar, ICON, makeIpk, tar } from './test/ipk.mjs';
import { chunkEntries, MAX_VALUE_BYTES } from './update.mjs';
import {
  buildIndex,
  checkIpk,
  checkRollback,
  compareVersions,
  describeBuild,
  historyKey,
  iconKey,
  indexText,
  ipkKey,
  nextVersion,
  offers,
  parseVersion,
  planPublish,
  planRollbackPrevious,
  readAr,
  readControl,
  readHistory,
  readIpk,
  readStoredHistory,
  readTar,
  repoKey,
  runSummary,
  sha256Hex,
  stampVersion,
} from './webos.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'webos.mjs');
const ORIGIN = 'https://updates.bannertv.workers.dev';
const COMMIT = 'ed387a1228288492187ba32540e721775a2f3292';
const COMMIT_2 = '4a5614f0123456789abcdef0123456789abcdef0';
const NOW = new Date('2026-11-09T12:00:00.000Z');
const NONE = readHistory(undefined);

let work;

function folder(name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'bannertv-webos-'));
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

/** What Build hands Upload for an .ipk. */
function built(version = '0.1.1', commit = COMMIT, options = {}) {
  const bytes = makeIpk({ version, ...options });
  return { bytes, build: describeBuild(bytes, { version, commit, ipkName: `b_${version}.ipk` }) };
}

function publish(version, { history = NONE, commit = COMMIT, now = NOW, stored, ...rest } = {}) {
  const { bytes, build } = built(version, commit);
  return planPublish({ ipkBytes: bytes, build, version, commit, history, stored, now, ...rest });
}

/** The history a plan writes, read back as the next run would. */
const after = (plan) => readHistory(plan.history.value);

describe('versions', () => {
  it('reads major.minor.patch by check-version’s rules', () => {
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0]);
    expect(parseVersion('2.999.999')).toEqual([2, 999, 999]);
    for (const bad of ['0.1', '0.1.0.1', 'v0.1.0', '0.1.0-beta', '', undefined]) {
      expect(() => parseVersion(bad)).toThrow(/is not major.minor.patch/);
    }
    expect(() => parseVersion('0.1000.0')).toThrow(/below 1000/);
    expect(() => parseVersion('0.1.1000')).toThrow(/below 1000/);
  });

  it('compares versions as numbers, not text', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.999')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.999.999')).toBeGreaterThan(0);
    expect(compareVersions('0.1.5', '0.1.5')).toBe(0);
    expect(compareVersions('0.1.4', '0.1.5')).toBeLessThan(0);
  });

  describe('the version a publish stamps', () => {
    const history = (highest) => ({ highest, publishes: [] });

    it('is one patch above appinfo.json’s on the first publish', () => {
      expect(nextVersion({ committed: '0.1.0', history: NONE })).toBe('0.1.1');
    });

    it('is one patch above the highest published, so it rises with every publish', () => {
      expect(nextVersion({ committed: '0.1.0', history: history('0.1.1') })).toBe('0.1.2');
      expect(nextVersion({ committed: '0.1.0', history: history('0.1.41') })).toBe('0.1.42');
    });

    it('stays above appinfo.json’s patch when that rose past what was published', () => {
      expect(nextVersion({ committed: '0.1.7', history: history('0.1.3') })).toBe('0.1.8');
    });

    it('starts again from appinfo.json’s new minor or major', () => {
      expect(nextVersion({ committed: '0.2.0', history: history('0.1.41') })).toBe('0.2.1');
      expect(nextVersion({ committed: '1.0.0', history: history('0.9.12') })).toBe('1.0.1');
    });

    it('refuses before building when the patch would reach 1000', () => {
      expect(nextVersion({ committed: '0.1.0', history: history('0.1.998') })).toBe('0.1.999');
      expect(() => nextVersion({ committed: '0.1.0', history: history('0.1.999') })).toThrow(
        /would be 0\.1\.1000.*Raise the minor version .* \(to 0\.2\.0\)/,
      );
      expect(() => nextVersion({ committed: '0.1.999', history: NONE })).toThrow(/below 1000/);
    });

    it('refuses when appinfo.json went below what was published', () => {
      expect(() => nextVersion({ committed: '0.1.9', history: history('0.2.3') })).toThrow(
        /appinfo.json says 0\.1\.9, but 0\.2\.3 was published already.*to 0\.2\.0 or more/,
      );
      expect(() => nextVersion({ committed: '0.9.0', history: history('1.0.1') })).toThrow(
        /1\.0\.0 or more/,
      );
    });

    it('refuses an appinfo.json version check-version would refuse', () => {
      expect(() => nextVersion({ committed: '0.1', history: NONE })).toThrow(
        /appinfo.json’s version "0.1" is not major.minor.patch/,
      );
    });
  });

  describe('stamping', () => {
    const appinfo = `${JSON.stringify(
      { id: 'com.bannertv.app', version: '0.1.0', title: 'BannerTV', requiredACG: ['a'] },
      null,
      2,
    )}\n`;
    const pkg = `${JSON.stringify({ name: '@bannertv/webos', version: '0.1.0', private: true }, null, 2)}\n`;

    it('writes the version into appinfo.json and package.json, and nothing else', () => {
      const stamped = stampVersion({ appinfoText: appinfo, packageText: pkg, version: '0.1.7' });
      expect(JSON.parse(stamped.appinfoText)).toEqual({ ...JSON.parse(appinfo), version: '0.1.7' });
      expect(JSON.parse(stamped.packageText)).toEqual({ ...JSON.parse(pkg), version: '0.1.7' });
      expect(stamped.appinfoText.endsWith('}\n')).toBe(true);
    });

    it('refuses a version that is not a publish of the committed one', () => {
      for (const version of ['0.1.0', '0.2.1', '1.1.1']) {
        expect(() => stampVersion({ appinfoText: appinfo, packageText: pkg, version })).toThrow(
          /is not a publish of 0\.1\.0/,
        );
      }
      expect(() =>
        stampVersion({ appinfoText: appinfo, packageText: pkg, version: '0.1.1000' }),
      ).toThrow(/below 1000/);
    });

    it('refuses files that disagree, or another app', () => {
      const other = pkg.replace('0.1.0', '0.1.1');
      expect(() =>
        stampVersion({ appinfoText: appinfo, packageText: other, version: '0.1.2' }),
      ).toThrow(/package.json says 0\.1\.1 but appinfo.json says 0\.1\.0/);
      expect(() =>
        stampVersion({
          appinfoText: appinfo.replace('com.bannertv.app', 'com.other.app'),
          packageText: pkg,
          version: '0.1.2',
        }),
      ).toThrow(/is for com\.other\.app/);
    });
  });
});

describe('reading an .ipk', () => {
  it('reads the control file and appinfo.json as ares-package writes them', () => {
    const ipk = readIpk(makeIpk({ version: '0.1.4' }));
    expect(ipk.control).toMatchObject({ Package: 'com.bannertv.app', Version: '0.1.4' });
    expect(ipk.control.Description).toBe('This is a webOS application.\nA continued line.');
    expect(ipk.appinfo).toMatchObject({ id: 'com.bannertv.app', version: '0.1.4' });
    expect(ipk.file('icon_130.png')).toEqual(ICON);
  });

  it('takes "./" paths, GNU ar names and GNU long names', () => {
    const ipk = readIpk(makeIpk({ prefix: './', gnu: true, longPath: true }));
    expect(ipk.appinfo.version).toBe('0.1.1');
    expect(ipk.file(`assets/${'a-long-name-'.repeat(10)}.js`)?.toString()).toBe('long');
  });

  it('reads members of odd length, which ar pads to an even byte', () => {
    const members = readAr(ar({ a: Buffer.from('odd'), b: Buffer.from('even') }));
    expect([...members].map(([name, bytes]) => [name, bytes.toString()])).toEqual([
      ['a', 'odd'],
      ['b', 'even'],
    ]);
  });

  it('reads a tar archive’s files and leaves out its folders', () => {
    const files = readTar(tar({ 'dir/': Buffer.alloc(0), 'dir/x': Buffer.from('x'.repeat(600)) }));
    expect([...files.keys()]).toEqual(['dir/x']);
    expect(files.get('dir/x')?.length).toBe(600);
  });

  it('reads a control file’s fields', () => {
    expect(readControl('Package: a\nVersion: 1.2.3\n')).toEqual({ Package: 'a', Version: '1.2.3' });
  });

  it('refuses what is not an .ipk', () => {
    expect(() => readIpk(Buffer.from('PK\u0003\u0004 a zip'))).toThrow(/not an ar archive/);
    expect(() => readIpk(ar({ 'debian-binary': Buffer.from('2.0\n') }))).toThrow(/not an .ipk/);
    expect(() =>
      readIpk(
        ar({
          'debian-binary': Buffer.from('2.0\n'),
          'control.tar.gz': Buffer.from('not gzip'),
          'data.tar.gz': gzipSync(tar({})),
        }),
      ),
    ).toThrow(/control.tar.gz that is not gzip/);
    expect(() => readIpk(makeIpk().subarray(0, 300))).toThrow(/cut short/);
  });

  describe('checking it against the version stamped', () => {
    it('gives the title and the 130 px icon', () => {
      expect(checkIpk(makeIpk({ version: '0.1.3' }), { version: '0.1.3' })).toEqual({
        title: 'BannerTV',
        icon: { name: 'icon_130.png', bytes: ICON },
      });
    });

    it.each([
      [
        { version: '0.1.0' },
        /is version 0\.1\.0 \(control file 0\.1\.0\), not 0\.1\.1: was the version stamped/,
      ],
      [{ controlVersion: '0.1.0' }, /control file 0\.1\.0/],
      [{ id: 'com.other.app' }, /is the package com\.other\.app/],
      [{ appinfo: { type: 'native' } }, /gives the type native/],
      [{ appinfo: { largeIcon: 'icon.jpg' } }, /names no PNG largeIcon/],
      [{ icon: null }, /has no PNG icon_130\.png/],
      [{ icon: Buffer.from('GIF89a') }, /has no PNG icon_130\.png/],
    ])('refuses %j', (options, message) => {
      expect(() => checkIpk(makeIpk(options), { version: '0.1.1', name: 'b.ipk' })).toThrow(
        message,
      );
    });

    it('refuses an .ipk larger than KV keeps, before reading it', () => {
      expect(() => checkIpk(Buffer.alloc(MAX_VALUE_BYTES + 1), { version: '0.1.1' })).toThrow(
        /more than Workers KV keeps/,
      );
    });

    it('describes the build for Upload, with lower-case hex SHA-256s', () => {
      const bytes = makeIpk({ version: '0.1.2' });
      const build = describeBuild(bytes, { version: '0.1.2', commit: COMMIT, ipkName: 'b.ipk' });
      expect(build).toEqual({
        version: '0.1.2',
        commit: COMMIT,
        ipkName: 'b.ipk',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ipkSize: bytes.length,
        iconName: 'icon_130.png',
        iconSha256: sha256Hex(ICON),
      });
      expect(build.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(() => describeBuild(bytes, { version: '0.1.2', commit: 'main' })).toThrow(
        /"main" is not a commit/,
      );
    });
  });
});

describe('the index', () => {
  it('is what Homebrew Channel reads, with the contract’s fields and absolute URLs', () => {
    const plan = publish('0.1.1');
    const { sha256, iconSha256, ipkSize } = plan.entry;
    const description = `BannerTV from main: version 0.1.1, commit ed387a1, published 2026-11-09 12:00 UTC.`;
    expect(JSON.parse(plan.repo.value)).toEqual({
      packages: [
        {
          id: 'com.bannertv.app',
          title: 'BannerTV',
          iconUri: `${ORIGIN}/webos/icon/${iconSha256}.png`,
          shortDescription: description,
          manifest: {
            id: 'com.bannertv.app',
            version: '0.1.1',
            type: 'web',
            title: 'BannerTV',
            appDescription: description,
            iconUri: `${ORIGIN}/webos/icon/${iconSha256}.png`,
            ipkUrl: `${ORIGIN}/webos/ipk/${sha256}.ipk`,
            ipkHash: { sha256 },
            ipkSize,
            rootRequired: false,
          },
          channel: 'main',
          commit: COMMIT,
          publishedAt: NOW.toISOString(),
          restoredAt: null,
        },
      ],
    });
    expect(plan.repo.value).toBe(indexText(plan.entry));
  });

  it('says on the TV when a roll back offers a build again', () => {
    const entry = { ...publish('0.1.1').entry, restoredAt: '2026-11-10T08:30:00.000Z' };
    expect(buildIndex(entry).packages[0].shortDescription).toBe(
      'BannerTV from main: version 0.1.1, commit ed387a1, published 2026-11-09 12:00 UTC. Offered again by a roll back on 2026-11-10 08:30 UTC.',
    );
  });

  it('knows a served index that offers the build, and one that does not', () => {
    const { entry, repo } = publish('0.1.1');
    expect(offers(repo.value, entry)).toBe(true);
    expect(offers(repo.value, { ...entry, version: '0.1.2' })).toBe(false);
    expect(offers(repo.value, { ...entry, sha256: '0'.repeat(64) })).toBe(false);
    expect(offers('{"packages":[]}', entry)).toBe(false);
    expect(offers('<html>', entry)).toBe(false);
  });
});

describe('the history', () => {
  it('reads a missing history as none', () => {
    expect(readHistory(undefined)).toEqual({ highest: null, publishes: [] });
    expect(readHistory('  ')).toEqual({ highest: null, publishes: [] });
  });

  it('never lets the highest version fall below a publish it holds', () => {
    const { entry } = publish('0.1.4');
    const text = JSON.stringify({ highest: '0.1.2', publishes: [entry] });
    expect(readHistory(text).highest).toBe('0.1.4');
  });

  it('refuses a history the key listing names but that was not read', () => {
    const stored = new Set(['webos/history/main']);
    expect(() => readStoredHistory(undefined, { stored })).toThrow(/was not read/);
    expect(readStoredHistory(undefined, { stored: new Set() })).toEqual(NONE);
    const text = after(publish('0.1.1'));
    expect(readStoredHistory(JSON.stringify(text), { stored })).toEqual(text);
  });

  it('refuses a history it cannot read', () => {
    expect(() => readHistory('not json')).toThrow(/not JSON/);
    expect(() => readHistory('{"highest":null}')).toThrow(/no list of publishes/);
    expect(() => readHistory('{"publishes":[{"version":"0.1.1"}]}')).toThrow(/no .ipk SHA-256/);
  });
});

describe('publishing', () => {
  it('uploads the .ipk and icon first, by their SHA-256, then the history, then the index', () => {
    const { bytes, build } = built('0.1.1');
    const plan = planPublish({
      ipkBytes: bytes,
      build,
      version: '0.1.1',
      commit: COMMIT,
      history: NONE,
      now: NOW,
    });
    expect(plan.content.map((item) => item.key)).toEqual([
      ipkKey(build.sha256),
      iconKey(build.iconSha256),
    ]);
    expect(plan.content[0]).toMatchObject({
      base64: true,
      metadata: { version: '0.1.1', commit: COMMIT },
    });
    expect(Buffer.from(plan.content[0].value, 'base64')).toEqual(bytes);
    expect(Buffer.from(plan.content[1].value, 'base64')).toEqual(ICON);
    expect(plan.history.key).toBe('webos/history/main');
    expect(plan.repo.key).toBe('webos/repo/main');
    expect(after(plan)).toEqual({ highest: '0.1.1', publishes: [plan.entry] });
    expect(plan.files).toEqual({ uploaded: 2, skipped: 0 });
    expect(plan.previous).toBeNull();
  });

  it('leaves out an icon the store has already', () => {
    const first = publish('0.1.1');
    const second = publish('0.1.2', {
      history: after(first),
      stored: new Set(first.content.map((item) => item.key)),
    });
    expect(second.content.map((item) => item.key)).toEqual([ipkKey(second.entry.sha256)]);
    expect(second.files).toEqual({ uploaded: 1, skipped: 1 });
    expect(second.previous).toEqual(first.entry);
  });

  it('keeps the last 20 publishes, newest first', () => {
    let history = NONE;
    for (let patch = 1; patch <= 22; patch += 1)
      history = after(publish(`0.1.${patch}`, { history }));
    expect(history.highest).toBe('0.1.22');
    expect(history.publishes).toHaveLength(20);
    expect(history.publishes[0].version).toBe('0.1.22');
    expect(history.publishes.at(-1).version).toBe('0.1.3');
  });

  it('refuses a version not above the highest published', () => {
    const history = after(publish('0.1.3'));
    expect(() => publish('0.1.3', { history })).toThrow(/0\.1\.3 is not above 0\.1\.3/);
    expect(() => publish('0.1.2', { history })).toThrow(/not above 0\.1\.3/);
  });

  it('refuses an .ipk or icon other than the ones Build made', () => {
    const { build } = built('0.1.1');
    const other = makeIpk({ version: '0.1.1', bundle: Buffer.from('changed') });
    const plan = (changes) =>
      planPublish({
        ipkBytes: other,
        build,
        version: '0.1.1',
        commit: COMMIT,
        history: NONE,
        now: NOW,
        ...changes,
      });
    expect(() => plan()).toThrow(/not the one Build made/);
    expect(() =>
      plan({ build: { ...build, sha256: sha256Hex(other), iconSha256: 'f'.repeat(64) } }),
    ).toThrow(/icon is not the one Build found/);
    expect(() => plan({ version: '0.1.2' })).toThrow(/Build made 0\.1\.1 of ed387a1/);
    expect(() => plan({ commit: COMMIT_2 })).toThrow(/Build made 0\.1\.1/);
  });

  it('refuses when the history changed since Read the store read it', () => {
    const history = after(publish('0.1.1'));
    const newer = after(publish('0.1.2', { history }));
    expect(() => publish('0.1.2', { history, historyNow: newer })).toThrow(
      /changed since Read the store read it/,
    );
    expect(() => publish('0.1.1', { history: NONE, historyNow: history })).toThrow(/changed/);
    expect(
      publish('0.1.2', { history, historyNow: readHistory(JSON.stringify(history)) }).entry.version,
    ).toBe('0.1.2');
  });
});

describe('rolling back', () => {
  /** Three publishes, all files stored. */
  function three() {
    let history = NONE;
    const stored = new Set();
    for (const version of ['0.1.1', '0.1.2', '0.1.3']) {
      const plan = publish(version, { history });
      for (const item of plan.content) stored.add(item.key);
      history = after(plan);
    }
    return { history, stored };
  }

  it('offers the build before the current one again, without building', () => {
    const { history, stored } = three();
    const later = new Date('2026-11-10T08:00:00.000Z');
    const plan = planRollbackPrevious({ history, stored, now: later });
    expect(plan.content).toEqual([]);
    expect(plan.entry).toEqual({ ...history.publishes[1], restoredAt: later.toISOString() });
    expect(plan.previous.version).toBe('0.1.3');
    const index = JSON.parse(plan.repo.value);
    expect(index.packages[0].manifest).toMatchObject({
      version: '0.1.2',
      ipkHash: { sha256: history.publishes[1].sha256 },
    });
    expect(index.packages[0].restoredAt).toBe(later.toISOString());
  });

  it('keeps the highest version, so the next publish is above the undone build', () => {
    const { history, stored } = three();
    const back = after(planRollbackPrevious({ history, stored, now: NOW }));
    expect(back.highest).toBe('0.1.3');
    expect(back.publishes.map((entry) => entry.version)).toEqual(['0.1.2', '0.1.1']);
    expect(nextVersion({ committed: '0.1.0', history: back })).toBe('0.1.4');
  });

  it('steps back one more each time, until nothing is left before it', () => {
    const { history, stored } = three();
    const once = after(planRollbackPrevious({ history, stored, now: NOW }));
    const twice = after(planRollbackPrevious({ history: once, stored, now: NOW }));
    expect(twice.publishes.map((entry) => entry.version)).toEqual(['0.1.1']);
    expect(() => checkRollback({ history: twice, stored })).toThrow(
      /Only 0\.1\.1 is left in the LG history .* Publish a fix instead/,
    );
  });

  it('refuses with nothing published, or the earlier files gone', () => {
    expect(() => checkRollback({ history: NONE })).toThrow(/Nothing has been published/);
    const { history, stored } = three();
    stored.delete(ipkKey(history.publishes[1].sha256));
    expect(() => checkRollback({ history, stored })).toThrow(
      /The .ipk or icon of 0\.1\.2 is no longer in the store/,
    );
    expect(() => planRollbackPrevious({ history, stored, now: NOW })).toThrow(/no longer/);
  });

  it('refuses when the history changed since Read the store read it', () => {
    const { history, stored } = three();
    expect(() => planRollbackPrevious({ history, historyNow: NONE, stored, now: NOW })).toThrow(
      /changed since Read the store/,
    );
  });
});

describe('the run’s summary', () => {
  const summary = (changes = {}) => ({
    action: 'publish',
    version: '0.1.5',
    commit: COMMIT,
    sha256: 'a'.repeat(64),
    ipkSize: 1269838,
    repoUrl: `${ORIGIN}/webos/repo.json`,
    before: { version: '0.1.4', commit: COMMIT_2 },
    files: { uploaded: 1, skipped: 1 },
    ...changes,
  });

  it('gives the version, commit and SHA-256, and what to press on the TV', () => {
    const text = runSummary(summary(), { result: 'success' });
    expect(text).toContain('| Result | done |');
    expect(text).toContain('| Version | `0.1.5` |');
    expect(text).toContain(`| Commit | \`${COMMIT}\` |`);
    expect(text).toContain(`| .ipk SHA-256 | \`${'a'.repeat(64)}\` |`);
    expect(text).toContain('| Offered before this run | `0.1.4`, commit `4a5614f` |');
    expect(text).toContain('| Files uploaded | 1 (1 stored already) |');
    expect(text).toMatch(
      /never looks for updates by itself.*choose BannerTV.*press \*\*Update\*\*/,
    );
    expect(text).toContain(`Add repository, ${ORIGIN}/webos/repo.json`);
    expect(text).not.toContain('lower');
  });

  it('says a roll back offers a lower version, and what to do if the TV refuses it', () => {
    const text = runSummary(summary({ action: 'rollback-previous', version: '0.1.3' }), {
      result: 'success',
    });
    expect(text).toContain('| Version offered again | `0.1.3` |');
    expect(text).toMatch(/lower than `0\.1\.4`.*revert the change on main and publish instead/);
  });

  it('says nothing about the TV when the run failed', () => {
    const text = runSummary(summary({ before: null }), { result: 'failure' });
    expect(text).toContain('| Result | failed: see the steps above |');
    expect(text).toContain('| Offered before this run | nothing |');
    expect(text).not.toContain('On the TV');
  });
});

describe('the Worker serves what the script wrote', () => {
  const ask = (path) => new Request(new URL(path, ORIGIN));

  /** What the workflow's `wrangler kv bulk put` uploads do, in their order. */
  function upload(kv, plan) {
    for (const file of chunkEntries(plan.content)) kv.bulkPut(file);
    kv.bulkPut([plan.history]);
    kv.bulkPut([plan.repo]);
  }

  async function repo(env) {
    const response = await worker.fetch(ask('/webos/repo.json'), env);
    expect(response.status).toBe(200);
    return response.text();
  }

  /** As Homebrew Channel installs: the .ipk at ipkUrl, checked against ipkHash.sha256. */
  async function download(env, text) {
    const { manifest } = JSON.parse(text).packages[0];
    const response = await worker.fetch(ask(manifest.ipkUrl), env);
    expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(sha256Hex(bytes)).toBe(manifest.ipkHash.sha256);
    expect(bytes.length).toBe(manifest.ipkSize);
    const icon = await worker.fetch(ask(manifest.iconUri), env);
    expect(icon.status).toBe(200);
    expect(Buffer.from(await icon.arrayBuffer())).toEqual(ICON);
    return readIpk(bytes).appinfo.version;
  }

  it('uses the same keys as the Worker', () => {
    const sha = 'a'.repeat(64);
    expect(served.repoKey('main')).toBe(repoKey('main'));
    expect(served.historyKey('main')).toBe(historyKey('main'));
    expect(served.ipkKey(sha)).toBe(ipkKey(sha));
    expect(served.iconKey(sha)).toBe(iconKey(sha));
  });

  it('publishes, rolls back and publishes again, end to end', async () => {
    const kv = testKV();
    const env = { UPDATES: kv };
    expect(JSON.parse(await repo(env))).toEqual({ packages: [] });

    const stored = () => new Set(kv.writes);
    const first = publish('0.1.1');
    upload(kv, first);
    expect(kv.writes.slice(-2)).toEqual(['webos/history/main', 'webos/repo/main']);
    let text = await repo(env);
    expect(text).toBe(first.repo.value);
    expect(await download(env, text)).toBe('0.1.1');

    const second = publish('0.1.2', { history: after(first), stored: stored(), commit: COMMIT_2 });
    upload(kv, second);
    text = await repo(env);
    expect(await download(env, text)).toBe('0.1.2');
    const status = await worker.fetch(ask('/status?channel=main&platform=webos'), env);
    expect(await status.json()).toEqual({
      storage: true,
      protocol: 1,
      update: {
        version: '0.1.2',
        sha256: second.entry.sha256,
        ipkSize: second.entry.ipkSize,
        commit: COMMIT_2,
        publishedAt: NOW.toISOString(),
        restoredAt: null,
      },
      serving: 'update',
    });

    const back = planRollbackPrevious({ history: after(second), stored: stored(), now: NOW });
    upload(kv, back);
    text = await repo(env);
    expect(offers(text, back.entry)).toBe(true);
    expect(await download(env, text)).toBe('0.1.1');

    const third = publish('0.1.3', { history: after(back), stored: stored() });
    upload(kv, third);
    expect(await download(env, await repo(env))).toBe('0.1.3');
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

  function write(name, text) {
    const path = join(folder(`files-${Math.random()}`), name);
    writeFileSync(path, text);
    return path;
  }

  const keyList = (keys) => write('keys.json', JSON.stringify(keys.map((name) => ({ name }))));

  it('says whether a key list names a key, and never answers "no" when it cannot tell', () => {
    const keys = keyList(['webos/history/main']);
    expect(run(['has-key', '--keys', keys, '--key', 'webos/history/main']).code).toBe(0);
    expect(run(['has-key', '--keys', keys, '--key', 'webos/repo/main']).code).toBe(1);
    expect(run(['has-key', '--keys', join(work, 'none.json'), '--key', 'x']).code).toBe(2);
    expect(run(['has-key', '--keys', write('keys.json', 'not json'), '--key', 'x']).code).toBe(2);
    expect(run(['has-key', '--key', 'x']).code).toBe(2);
  });

  it('prints the next version, and refuses before building when it cannot be had', () => {
    const appinfo = write('appinfo.json', JSON.stringify({ version: '0.1.0' }));
    const none = ['--history', join(work, 'none.json'), '--keys', keyList([])];
    expect(run(['next-version', '--appinfo', appinfo, ...none])).toEqual({
      code: 0,
      stdout: '0.1.1\n',
      stderr: '',
    });
    const history = write('history.json', JSON.stringify({ highest: '0.1.999', publishes: [] }));
    const keys = keyList(['webos/history/main']);
    const refused = run([
      'next-version',
      '--appinfo',
      appinfo,
      '--history',
      history,
      '--keys',
      keys,
    ]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toMatch(/^::error::The next LG publish would be 0\.1\.1000/);
  });

  it('refuses to choose a version when the store lists a history that was not read', () => {
    const appinfo = write('appinfo.json', JSON.stringify({ version: '0.1.0' }));
    const result = run([
      'next-version',
      ...['--appinfo', appinfo, '--history', join(work, 'none.json')],
      ...['--keys', keyList(['webos/history/main'])],
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/has webos\/history\/main, but it was not read/);
    expect(run(['next-version', '--appinfo', appinfo]).stderr).toBe('::error::Give --keys.\n');
  });

  it('prints the run’s summary with what to press on the TV', () => {
    const plan = publish('0.1.2');
    const summary = write(
      'summary.json',
      JSON.stringify({
        action: 'publish',
        version: '0.1.2',
        commit: COMMIT,
        sha256: plan.entry.sha256,
        ipkSize: plan.entry.ipkSize,
        repoUrl: `${ORIGIN}/webos/repo.json`,
        before: null,
        files: plan.files,
      }),
    );
    const result = run(['summary', '--summary', summary, '--result', 'success']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('| Version | `0.1.2` |');
    expect(result.stdout).toContain('press **Update**');
  });

  it('stamps the version into both files', () => {
    const dir = folder('stamp');
    const appinfo = join(dir, 'appinfo.json');
    const pkg = join(dir, 'package.json');
    writeFileSync(appinfo, JSON.stringify({ id: 'com.bannertv.app', version: '0.1.0' }));
    writeFileSync(pkg, JSON.stringify({ name: '@bannertv/webos', version: '0.1.0' }));
    const result = run(['stamp', '--version', '0.1.5', '--appinfo', appinfo, '--package', pkg]);
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(appinfo, 'utf8')).version).toBe('0.1.5');
    expect(JSON.parse(readFileSync(pkg, 'utf8')).version).toBe('0.1.5');
    expect(
      run(['stamp', '--version', '0.1.5', '--appinfo', appinfo, '--package', pkg]).stderr,
    ).toMatch(/is not a publish of 0\.1\.5/);
  });

  it('describes a build, publishes it, checks it is served, and rolls back', () => {
    const dir = folder('command');
    const ipk = join(dir, 'com.bannertv.app_0.1.1_all.ipk');
    writeFileSync(ipk, makeIpk({ version: '0.1.1' }));
    const build = join(dir, 'build.json');
    expect(
      run([
        'describe-build',
        '--ipk',
        ipk,
        '--version',
        '0.1.1',
        '--commit',
        COMMIT,
        '--out',
        build,
      ]).code,
    ).toBe(0);
    expect(JSON.parse(readFileSync(build, 'utf8'))).toMatchObject({
      ipkName: 'com.bannertv.app_0.1.1_all.ipk',
      iconName: 'icon_130.png',
    });

    const out = join(dir, 'publish');
    const missing = join(dir, 'no-history.json');
    const published = run([
      'publish',
      ...['--ipk', ipk, '--build', build, '--version', '0.1.1', '--commit', COMMIT],
      ...['--history', missing, '--history-now', missing, '--keys', keyList([]), '--out', out],
    ]);
    expect(published.stderr).toBe('');
    expect(published.code).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      'content-1.json',
      'history.json',
      'index.json',
      'repo.json',
      'summary.json',
    ]);
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(JSON.parse(published.stdout)).toEqual(summary);
    expect(summary).toMatchObject({
      action: 'publish',
      channel: 'main',
      version: '0.1.1',
      commit: COMMIT,
      repoUrl: `${ORIGIN}/webos/repo.json`,
      before: null,
      files: { uploaded: 2, skipped: 0 },
    });
    expect(summary.ipkUrl).toBe(`${ORIGIN}/webos/ipk/${summary.sha256}.ipk`);
    const index = readFileSync(join(out, 'index.json'), 'utf8');
    expect(JSON.parse(readFileSync(join(out, 'repo.json'), 'utf8'))).toEqual([
      { key: 'webos/repo/main', value: index },
    ]);
    const summaryFile = join(out, 'summary.json');
    expect(run(['offers', '--index', join(out, 'index.json'), '--summary', summaryFile]).code).toBe(
      0,
    );
    const empty = write('repo.json', '{"packages":[]}');
    expect(run(['offers', '--index', empty, '--summary', summaryFile]).code).toBe(1);

    // A second publish, then a roll back to the first.
    const history = write(
      'history.json',
      JSON.parse(readFileSync(join(out, 'history.json'), 'utf8'))[0].value,
    );
    const ipk2 = join(dir, 'com.bannertv.app_0.1.2_all.ipk');
    writeFileSync(ipk2, makeIpk({ version: '0.1.2' }));
    const build2 = join(dir, 'build2.json');
    run([
      'describe-build',
      '--ipk',
      ipk2,
      '--version',
      '0.1.2',
      '--commit',
      COMMIT_2,
      '--out',
      build2,
    ]);
    const out2 = join(dir, 'publish-2');
    const keys = keyList([`webos/ipk/${summary.sha256}`, `webos/icon/${summary.iconSha256}`]);
    expect(
      run([
        'publish',
        ...['--ipk', ipk2, '--build', build2, '--version', '0.1.2', '--commit', COMMIT_2],
        ...['--history', history, '--history-now', history, '--keys', keys, '--out', out2],
      ]).code,
    ).toBe(0);
    const history2 = write(
      'history.json',
      JSON.parse(readFileSync(join(out2, 'history.json'), 'utf8'))[0].value,
    );
    const summary2 = JSON.parse(readFileSync(join(out2, 'summary.json'), 'utf8'));
    expect(summary2.files).toEqual({ uploaded: 1, skipped: 1 });
    const keys2 = keyList([
      'webos/history/main',
      'webos/repo/main',
      `webos/ipk/${summary.sha256}`,
      `webos/icon/${summary.iconSha256}`,
      `webos/ipk/${summary2.sha256}`,
    ]);
    expect(run(['check-rollback', '--history', history2, '--keys', keys2])).toEqual({
      code: 0,
      stdout: '0.1.1\n',
      stderr: '',
    });
    const out3 = join(dir, 'rollback');
    const back = run([
      'rollback-previous',
      ...['--history', history2, '--history-now', history2, '--keys', keys2, '--out', out3],
    ]);
    expect(back.code).toBe(0);
    expect(readdirSync(out3).sort()).toEqual([
      'history.json',
      'index.json',
      'repo.json',
      'summary.json',
    ]);
    expect(JSON.parse(back.stdout)).toMatchObject({
      action: 'rollback-previous',
      version: '0.1.1',
      sha256: summary.sha256,
      before: { version: '0.1.2', commit: COMMIT_2 },
      files: { uploaded: 0, skipped: 0 },
    });
  });

  it('refuses a publish whose history changed, and writes nothing', () => {
    const dir = folder('changed');
    const ipk = join(dir, 'b.ipk');
    writeFileSync(ipk, makeIpk({ version: '0.1.1' }));
    const build = join(dir, 'build.json');
    run(['describe-build', '--ipk', ipk, '--version', '0.1.1', '--commit', COMMIT, '--out', build]);
    const now = write('history.json', JSON.stringify({ highest: '0.1.1', publishes: [] }));
    const out = join(dir, 'out');
    const result = run([
      'publish',
      ...['--ipk', ipk, '--build', build, '--version', '0.1.1', '--commit', COMMIT],
      ...['--history', join(dir, 'none.json'), '--history-now', now, '--out', out],
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^::error::The LG history in the store changed/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a roll back with nothing to go back to, without a stack', () => {
    const result = run([
      'check-rollback',
      ...['--history', join(work, 'none.json'), '--keys', keyList([])],
    ]);
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr:
        '::error::Nothing has been published to the LG repository yet, so there is nothing to roll back.\n',
    });
  });

  it('refuses an unknown command or a missing argument', () => {
    expect(run(['deploy']).stderr).toMatch(/^::error::Say one of has-key, next-version/);
    expect(run(['stamp', '--version', '0.1.1']).stderr).toBe(
      '::error::Give --appinfo, --package.\n',
    );
  });
});

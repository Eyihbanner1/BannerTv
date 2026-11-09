import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkRuntimeVersion,
  CI_REASONS,
  expectedReasons,
  loadFingerprintConfig,
  readResolved,
} from './runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'runtime-version.mjs');
const MOBILE = join(HERE, '..', '..', '..', '..', 'apps', 'mobile');
const HASH = '0123456789abcdef0123456789abcdef01234567';

/** A config like apps/mobile/fingerprint.config.js, with two extra sources. */
const CONFIG = {
  extraSources: [
    { type: 'dir', filePath: 'assets/images', reasons: ['nativeImages'] },
    { type: 'contents', id: 'buildTools', contents: 'x', reasons: ['buildTools'] },
  ],
};

/** The sources @expo/fingerprint gives for a project, with these reasons among them. */
const sources = (...reasons) => [
  { type: 'file', filePath: 'app.config.ts', reasons: ['expoConfig'], hash: 'a' },
  { type: 'dir', filePath: 'node_modules/expo', reasons: ['expoAutolinkingAndroid'], hash: 'b' },
  // Dedup merges the reasons of sources that share a path, so one source can carry several.
  {
    type: 'dir',
    filePath: 'node_modules/react-native',
    reasons: ['rncoreAutolinkingAndroid', 'bareRncliAutolinking'],
    hash: 'c',
  },
  ...reasons.map((reason) => ({ type: 'contents', id: reason, reasons: [reason], hash: 'd' })),
];

const resolveOutput = (answer) => `${JSON.stringify(answer)}\n`;

let work;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'bannertv-runtime-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function writeConfig(name, text) {
  const path = join(work, `${name}.config.js`);
  writeFileSync(path, text);
  return path;
}

describe('the sources a fingerprint must have', () => {
  it('are CI’s and every extra source’s in the config', () => {
    expect(expectedReasons(CONFIG).sort()).toEqual([...CI_REASONS, 'nativeImages'].sort());
    expect(expectedReasons({})).toEqual(CI_REASONS);
  });

  it('are CI’s four, as .github/workflows/ci.yml’s Native side step requires them', () => {
    expect(CI_REASONS).toEqual([
      'expoConfig',
      'expoAutolinkingAndroid',
      'rncoreAutolinkingAndroid',
      'buildTools',
    ]);
  });
});

describe('reading the answer', () => {
  it('reads the last line of runtimeversion:resolve', () => {
    const answer = { runtimeVersion: HASH, fingerprintSources: sources(), workflow: 'managed' };
    expect(readResolved(`a warning first\n${resolveOutput(answer)}\n`)).toEqual({
      runtimeVersion: HASH,
      sources: answer.fingerprintSources,
    });
  });

  it('reads fingerprint:generate, which ci.yml runs', () => {
    expect(readResolved(JSON.stringify({ hash: HASH, sources: sources() }))).toEqual({
      runtimeVersion: HASH,
      sources: sources(),
    });
  });

  it('refuses an answer that is not JSON', () => {
    expect(() => readResolved('')).toThrow(/JSON answer/);
    expect(() => readResolved('Error: something')).toThrow(/JSON answer/);
    expect(() => readResolved('null')).toThrow(/object/);
  });
});

describe('the runtime version', () => {
  it('is the fingerprint when every source is there', () => {
    const resolved = { runtimeVersion: HASH, sources: sources('nativeImages', 'buildTools') };
    expect(checkRuntimeVersion({ resolved, config: CONFIG })).toBe(HASH);
  });

  it('is refused when the config was dropped, as @expo/fingerprint drops one that throws', () => {
    // What expo-updates answers then: the same fingerprint, less what the config adds.
    const resolved = { runtimeVersion: HASH, sources: sources() };
    expect(() => checkRuntimeVersion({ resolved, config: CONFIG })).toThrow(
      'The fingerprint has no buildTools, nativeImages source',
    );
  });

  it('is refused when a source of the config’s own is missing', () => {
    const config = {
      extraSources: [
        ...CONFIG.extraSources,
        { type: 'dir', filePath: '../helper', reasons: ['streamHelperCore'] },
      ],
    };
    const resolved = { runtimeVersion: HASH, sources: sources('nativeImages', 'buildTools') };
    expect(() => checkRuntimeVersion({ resolved, config })).toThrow(/no streamHelperCore source/);
  });

  it('is refused when one of CI’s sources is missing', () => {
    const resolved = {
      runtimeVersion: HASH,
      sources: sources('nativeImages', 'buildTools').filter(
        (source) => !source.reasons.includes('expoAutolinkingAndroid'),
      ),
    };
    expect(() => checkRuntimeVersion({ resolved, config: CONFIG })).toThrow(
      /no expoAutolinkingAndroid source/,
    );
  });

  it('is refused when it is not a fingerprint at all', () => {
    expect(() =>
      checkRuntimeVersion({
        resolved: { runtimeVersion: '1.0.0', sources: null },
        config: CONFIG,
      }),
    ).toThrow(/policy: "fingerprint"/);
    expect(() =>
      checkRuntimeVersion({ resolved: { runtimeVersion: null, sources: null }, config: CONFIG }),
    ).toThrow(/sets no runtimeVersion/);
    expect(() =>
      checkRuntimeVersion({
        resolved: { runtimeVersion: '../x', sources: sources('nativeImages', 'buildTools') },
        config: CONFIG,
      }),
    ).toThrow(/not a runtime version/);
  });
});

describe('loading the config', () => {
  it('passes on the error @expo/fingerprint would swallow', () => {
    const path = writeConfig('throws', "throw new Error('cannot find @expo/prebuild-config');");
    expect(() => loadFingerprintConfig(path)).toThrow(
      /does not load \(cannot find @expo\/prebuild-config\)/,
    );
  });

  it('refuses a config that is not an object', () => {
    expect(() => loadFingerprintConfig(writeConfig('string', "module.exports = 'x';"))).toThrow(
      /not export a config object/,
    );
  });

  // Only where the phone app's packages are installed (CI's quick check installs everything;
  // Deploy updates Worker installs this package alone).
  const expoThere = (() => {
    try {
      createRequire(join(MOBILE, 'package.json')).resolve('expo/package.json');
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!expoThere)('reads the phone app’s own config, with the sources it adds', () => {
    const reasons = expectedReasons(loadFingerprintConfig(join(MOBILE, 'fingerprint.config.js')));
    expect(reasons).toEqual(expect.arrayContaining([...CI_REASONS, 'nativeImages']));
    if (existsSync(join(MOBILE, '..', 'androidtv', 'helper-core', 'src', 'main', 'java'))) {
      expect(reasons).toContain('streamHelperCore');
    }
  });
});

describe('the command', () => {
  function run(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      return { code: error.status, stdout: error.stdout, stderr: error.stderr };
    }
  }

  const config = () =>
    writeConfig(
      'good',
      `module.exports = ${JSON.stringify(CONFIG)};
`,
    );

  function resolvedFile(name, answer) {
    const path = join(work, `${name}.json`);
    writeFileSync(path, resolveOutput(answer));
    return path;
  }

  it('prints the runtime version', () => {
    const resolved = resolvedFile('good', {
      runtimeVersion: HASH,
      fingerprintSources: sources('nativeImages', 'buildTools'),
      workflow: 'managed',
    });
    expect(run(['--resolved', resolved, '--config', config()])).toEqual({
      code: 0,
      stdout: `${HASH}\n`,
      stderr: '',
    });
  });

  it('fails, as a workflow error, for a fingerprint without the config', () => {
    const resolved = resolvedFile('dropped', {
      runtimeVersion: HASH,
      fingerprintSources: sources(),
      workflow: 'managed',
    });
    const result = run(['--resolved', resolved, '--config', config()]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^::error::The fingerprint has no buildTools, nativeImages/);
  });

  it('fails for a config that throws, whatever the answer says', () => {
    const resolved = resolvedFile('any', {
      runtimeVersion: HASH,
      fingerprintSources: sources('nativeImages', 'buildTools'),
    });
    const result = run([
      '--resolved',
      resolved,
      '--config',
      writeConfig('throws-2', "throw new Error('broken');"),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/does not load \(broken\)/);
  });
});

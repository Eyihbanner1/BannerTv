/**
 * The runtime version a publish goes to, from expo-updates' own `runtimeversion:resolve`, checked
 * before anything is exported or signed.
 *
 * The runtime version is Expo's native fingerprint, built from apps/mobile/fingerprint.config.js.
 * When that file throws, @expo/fingerprint quietly carries on without it, so the APK's Gradle
 * build and this publish both work out the same smaller fingerprint: one that leaves out what the
 * file adds (the images folder, the stream helper's Kotlin core, the build tools). A later change
 * to only those would then keep the runtime version, and the publish would send JavaScript that
 * needs the new native code to phones whose APK lacks it. So the answer counts only when every
 * source CI's Native side step requires is there (ci.yml, job `mobile`), and every source the
 * config file adds as well, read from the file itself.
 *
 * Node's own modules only: this runs in the publish workflow before anything else is trusted.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { RUNTIME_VERSION } from './update.mjs';

/** The sources .github/workflows/ci.yml's Native side step requires of the fingerprint. */
export const CI_REASONS = [
  'expoConfig',
  'expoAutolinkingAndroid',
  'rncoreAutolinkingAndroid',
  'buildTools',
];

/**
 * fingerprint.config.js, loaded as @expo/fingerprint loads it, except that an error is passed
 * on rather than swallowed.
 */
export function loadFingerprintConfig(path) {
  const require = createRequire(import.meta.url);
  let config;
  try {
    config = require(resolve(path));
  } catch (error) {
    const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(
      `${path} does not load (${why}). The fingerprint would leave out what it adds, so the runtime version could miss a native change.`,
      { cause: error },
    );
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${path} does not export a config object.`);
  }
  return config;
}

/** Every reason the fingerprint must name: CI's, and those of each extra source in the config. */
export function expectedReasons(config) {
  const extra = Array.isArray(config?.extraSources) ? config.extraSources : [];
  const reasons = new Set(CI_REASONS);
  for (const source of extra) {
    for (const reason of Array.isArray(source?.reasons) ? source.reasons : []) {
      if (typeof reason === 'string') reasons.add(reason);
    }
  }
  return [...reasons];
}

/**
 * The runtime version and the fingerprint's sources from a command's output: the last line of
 * `expo-updates runtimeversion:resolve` ({runtimeVersion, fingerprintSources}), or of
 * `fingerprint fingerprint:generate` ({hash, sources}), which ci.yml runs.
 */
export function readResolved(text) {
  const line = String(text ?? '')
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .at(-1);
  let answer;
  try {
    answer = JSON.parse(line ?? '');
  } catch {
    throw new Error('runtimeversion:resolve did not end with a JSON answer.');
  }
  if (answer === null || typeof answer !== 'object') {
    throw new Error('runtimeversion:resolve did not answer with an object.');
  }
  if ('fingerprintSources' in answer || 'runtimeVersion' in answer) {
    return { runtimeVersion: answer.runtimeVersion, sources: answer.fingerprintSources };
  }
  return { runtimeVersion: answer.hash, sources: answer.sources };
}

/** The runtime version, once the fingerprint is shown to have every source it should. */
export function checkRuntimeVersion({ resolved, config }) {
  const { runtimeVersion, sources } = resolved;
  if (typeof runtimeVersion !== 'string' || runtimeVersion === '') {
    throw new Error('app.config.ts sets no runtimeVersion.');
  }
  if (!Array.isArray(sources)) {
    throw new Error(
      'The runtime version is not a fingerprint: app.config.ts must use runtimeVersion { policy: "fingerprint" }.',
    );
  }
  if (!RUNTIME_VERSION.test(runtimeVersion)) {
    throw new Error(`"${runtimeVersion}" is not a runtime version.`);
  }
  const named = new Set(
    sources.flatMap((source) => (Array.isArray(source?.reasons) ? source.reasons : [])),
  );
  const missing = expectedReasons(config).filter((reason) => !named.has(reason));
  if (missing.length > 0) {
    throw new Error(
      `The fingerprint has no ${missing.join(', ')} source, so it is not the one the APK should carry. Did fingerprint.config.js fail to load in expo-updates? Nothing was published.`,
    );
  }
  return runtimeVersion;
}

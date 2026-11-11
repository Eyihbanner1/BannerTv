const fs = require('node:fs');
const path = require('node:path');

/**
 * What Expo's native fingerprint (@expo/fingerprint, which comes with expo) hashes for this app:
 * the files and packages the Android build reads, never the JavaScript. It has two jobs. CI
 * compares a pull request's fingerprint with its base's, and skips the Android build when they
 * match (.github/workflows/ci.yml, job `mobile`). And it is the app's runtime version
 * (app.config.ts): an over-the-air update only reaches APKs with the same fingerprint, so it must
 * change whenever the APK's native side could. On its own the fingerprint misses these, added
 * here:
 * - the images folder: it hashes the icon, the adaptive icon's foreground and the splash image,
 *   but not other images a config plugin names (the monochrome icon, a notification icon);
 * - the stream helper's Kotlin core, which its module compiles through a srcDir outside the
 *   folders the fingerprint reads, while that folder exists;
 * - the Expo tools that write the Android project (`expo prebuild`), which it does not count
 *   as native packages;
 * - what CI's Native side step checks by itself, because the fingerprint hashes a native
 *   package by its name and version only: pnpm's patches, its settings, overrides and patched
 *   packages at the top of the lockfile, pnpm-workspace.yaml and .npmrc;
 * - how the phone job builds the APK: the machine, the Java version, the prebuild and the Gradle
 *   command with its -P flags and ABI list (PHONE_ABIS);
 * - the certificate updates are checked against, which the APK carries: a new one needs a new
 *   APK, and the old APKs then wait for theirs rather than refuse every update.
 * Not the app's version in apps/webos/webos-meta/appinfo.json, which CI also builds an APK for:
 * it goes up for each LG test build, and nothing native depends on it, so counting it would ask
 * for a phone reinstall each time.
 * The buildTools source also tells CI this file loaded: the fingerprint drops a config that throws.
 */
const HELPER_CORE = '../androidtv/helper-core/src/main/java';
const REPO = '../..';
const CI_WORKFLOW = `${REPO}/.github/workflows/ci.yml`;
const PHONE_JOB = 'mobile';
/** The phone job's steps that make and build the Android project, as CI runs them. */
const NATIVE_STEPS = [
  /^- uses: actions\/setup-java@/,
  /^- name: Generate the Android project$/,
  /^- name: Build$/,
];

function buildTools() {
  const version = (name, from) =>
    `${name}@${require(require.resolve(`${name}/package.json`, { paths: [from] })).version}`;
  const expo = path.dirname(require.resolve('expo/package.json', { paths: [__dirname] }));
  const cli = path.dirname(require.resolve('@expo/cli/package.json', { paths: [expo] }));
  return [
    ...['@expo/cli', '@expo/config', '@expo/config-plugins', 'expo-modules-autolinking'].map(
      (name) => version(name, expo),
    ),
    version('@expo/prebuild-config', cli),
  ].join('\n');
}

function exists(filePath) {
  return fs.existsSync(path.join(__dirname, filePath));
}

/**
 * A file's text, or a stand-in when it cannot be read, rather than throwing: the fingerprint
 * would quietly drop this whole config, and the runtime version with it.
 */
function read(filePath) {
  try {
    return fs.readFileSync(path.join(__dirname, filePath), 'utf8');
  } catch {
    return `${filePath} could not be read`;
  }
}

/** The lockfile up to `importers:`, as ci.yml's lock_head reads it. All of it if that is gone. */
function lockHead() {
  const lines = read(`${REPO}/pnpm-lock.yaml`).split('\n');
  const end = lines.findIndex((line) => /^importers:/.test(line));
  return (end === -1 ? lines : lines.slice(0, end + 1)).join('\n');
}

/**
 * The phone job's machine and the steps in NATIVE_STEPS, without comments or blank lines, so
 * a change to the journeys, an upload or another job leaves the fingerprint alone. When the job
 * or one of the steps cannot be found (renamed, moved), the whole workflow file stands in: the
 * fingerprint then changes more often than it needs to, never less.
 */
function phoneBuildSteps() {
  const lines = read(CI_WORKFLOW)
    .split('\n')
    .filter((line) => !/^\s*(#|$)/.test(line));
  const start = lines.findIndex((line) => new RegExp(`^  ${PHONE_JOB}:\\s*(#.*)?$`).test(line));
  const length =
    start === -1 ? -1 : lines.slice(start + 1).findIndex((line) => /^ {0,2}\S/.test(line));
  const job =
    start === -1 ? [] : lines.slice(start + 1, length === -1 ? undefined : start + 1 + length);
  const steps = [];
  for (const line of job) {
    if (/^ {6}- /.test(line)) steps.push([line.slice(6)]);
    else if (/^ {6,}/.test(line) && steps.length > 0) steps[steps.length - 1].push(line.slice(6));
  }
  const picked = NATIVE_STEPS.map((pattern) => steps.find((step) => pattern.test(step[0])));
  const machine = job.find((line) => /^ {4}runs-on:/.test(line));
  if (!machine || picked.some((step) => step === undefined)) {
    console.warn(
      `fingerprint.config.js: the ${PHONE_JOB} job's build steps were not found in ci.yml`,
    );
    return lines.join('\n');
  }
  return [machine.trim(), ...picked.map((step) => step.join('\n'))].join('\n');
}

/** The files that may not be there, each counted from when it is. */
function optionalFiles(files, reason) {
  return files.filter(exists).map((filePath) => ({ type: 'file', filePath, reasons: [reason] }));
}

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [
    { type: 'dir', filePath: 'assets/images', reasons: ['nativeImages'] },
    ...(exists(HELPER_CORE)
      ? [{ type: 'dir', filePath: HELPER_CORE, reasons: ['streamHelperCore'] }]
      : []),
    { type: 'contents', id: 'buildTools', contents: buildTools(), reasons: ['buildTools'] },
    ...(exists(`${REPO}/patches`)
      ? [{ type: 'dir', filePath: `${REPO}/patches`, reasons: ['pnpmPatches'] }]
      : []),
    { type: 'contents', id: 'pnpmLockHead', contents: lockHead(), reasons: ['pnpmSettings'] },
    ...optionalFiles([`${REPO}/pnpm-workspace.yaml`, `${REPO}/.npmrc`, '.npmrc'], 'pnpmSettings'),
    {
      type: 'contents',
      id: 'phoneBuildSteps',
      contents: phoneBuildSteps(),
      reasons: ['phoneBuildSteps'],
    },
    ...optionalFiles(['certs/certificate.pem'], 'updatesCertificate'),
  ],
};

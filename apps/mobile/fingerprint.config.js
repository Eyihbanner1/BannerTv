const fs = require('node:fs');
const path = require('node:path');

/**
 * What Expo's native fingerprint (@expo/fingerprint, which comes with expo) hashes for this app:
 * the files and packages the Android build reads, never the JavaScript. CI compares a pull
 * request's fingerprint with its base's, and skips the Android build when they match
 * (.github/workflows/ci.yml, job `mobile`). On its own the fingerprint misses three things,
 * added here:
 * - the images folder: it hashes the icon, the adaptive icon's foreground and the splash image,
 *   but not other images a config plugin names (the monochrome icon, a notification icon);
 * - the stream helper's Kotlin core, which its module compiles through a srcDir outside the
 *   folders the fingerprint reads, while that folder exists;
 * - the Expo tools that write the Android project (`expo prebuild`), which it does not count
 *   as native packages.
 * The last source also tells CI this file loaded: the fingerprint drops a config that throws.
 */
const HELPER_CORE = '../androidtv/helper-core/src/main/java';

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

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [
    { type: 'dir', filePath: 'assets/images', reasons: ['nativeImages'] },
    ...(fs.existsSync(path.join(__dirname, HELPER_CORE))
      ? [{ type: 'dir', filePath: HELPER_CORE, reasons: ['streamHelperCore'] }]
      : []),
    { type: 'contents', id: 'buildTools', contents: buildTools(), reasons: ['buildTools'] },
  ],
};

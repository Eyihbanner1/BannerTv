const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const ROOT = path.resolve(__dirname, '../..');
const SHARED_WEB = path.resolve(__dirname, '../webos/src');
const PHONE = path.resolve(__dirname, '../mobile/src');
const SHIMS = path.join(PHONE, 'shims');

// The app reads the LG app's and the phone app's source, and the brand tokens.
config.watchFolders = [ROOT];

/** The same three swaps as the phone app's metro.config.js (ADR 0007). */
const REPLACED = {
  [path.join(SHARED_WEB, 'platform/idb.ts')]: path.join(SHIMS, 'idb.ts'),
  [path.join(SHARED_WEB, 'platform/web-crypto.ts')]: path.join(SHIMS, 'web-crypto.ts'),
  [path.join(SHARED_WEB, 'data/sync-reload.ts')]: path.join(SHIMS, 'sync-reload.ts'),
};

/**
 * Packages that must be this app's own copy wherever they are imported from. React Native is
 * the TV fork here (react-native-tvos), and a second React, React Native or Expo module in one
 * bundle breaks hooks and native views, so the LG app's and the phone app's files get these from
 * apps/tv/node_modules too.
 */
const OWN_COPY =
  /^(react|react-dom|react-native|react-native-svg|react-i18next|i18next|expo|expo-[a-z-]+|@expo\/[a-z-]+|@noble\/[a-z]+)(\/.*)?$/;

/**
 * The import aliases, done here rather than from tsconfig.json: its `paths` also point bare
 * packages at this app's type definitions for the type checker, which Metro must not follow.
 */
const ALIASES = [
  ['@tv/', SHARED_WEB],
  ['@phone/', PHONE],
  ['@brand/', path.join(ROOT, 'brand')],
];

/** The workspace packages, which only the pnpm install links (into apps/webos/node_modules). */
const WORKSPACE = /^@bannertv\//;

const inside = (file, dir) => file.startsWith(dir + path.sep);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  for (const [prefix, dir] of ALIASES) {
    if (moduleName.startsWith(prefix)) {
      moduleName = path.join(dir, moduleName.slice(prefix.length));
      break;
    }
  }
  const origin = context.originModulePath;
  const fromNodeModules = origin.includes(`${path.sep}node_modules${path.sep}`);
  let from = null;
  if (!fromNodeModules && !inside(origin, __dirname) && OWN_COPY.test(moduleName)) {
    from = path.join(__dirname, 'package.json');
  } else if (!fromNodeModules && inside(origin, __dirname) && WORKSPACE.test(moduleName)) {
    from = path.join(SHARED_WEB, '..', 'package.json');
  }
  const resolution = resolve(
    from ? { ...context, originModulePath: from } : context,
    moduleName,
    platform,
  );
  if (resolution.type === 'sourceFile') {
    const replacement = REPLACED[resolution.filePath];
    if (replacement) return { type: 'sourceFile', filePath: replacement };
  }
  return resolution;
};

module.exports = config;

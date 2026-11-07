const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const SHARED_WEB = path.resolve(__dirname, '../webos/src');
const SHIMS = path.resolve(__dirname, 'src/shims');

/**
 * Shared web modules the phone replaces with its own, by the file they resolve to. Only these
 * touch what a phone does differently: IndexedDB (SQLite here), Web Crypto (none in Hermes) and
 * starting the app again once a join has finished (no page to reload). See ADR 0007.
 */
const REPLACED = {
  [path.join(SHARED_WEB, 'platform/idb.ts')]: path.join(SHIMS, 'idb.ts'),
  [path.join(SHARED_WEB, 'platform/web-crypto.ts')]: path.join(SHIMS, 'web-crypto.ts'),
  [path.join(SHARED_WEB, 'data/sync-reload.ts')]: path.join(SHIMS, 'sync-reload.ts'),
};

/**
 * Packages the shared web modules import that must be the phone's own copy: the LG app pins
 * React 18, a second React in one bundle breaks every hook, and react-i18next (and so i18next,
 * whose instance it holds) must be the copy built against the phone's React.
 */
const OWN_COPY = /^(react|react\/.*|react-dom|react-dom\/.*|react-i18next|i18next)$/;

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const fromShared = context.originModulePath.startsWith(SHARED_WEB);
  if (fromShared && OWN_COPY.test(moduleName)) {
    return resolve(
      { ...context, originModulePath: path.join(__dirname, 'package.json') },
      moduleName,
      platform,
    );
  }
  const resolution = resolve(context, moduleName, platform);
  if (platform !== 'web' && resolution.type === 'sourceFile') {
    const replacement = REPLACED[resolution.filePath];
    if (replacement) return { type: 'sourceFile', filePath: replacement };
  }
  return resolution;
};

module.exports = config;

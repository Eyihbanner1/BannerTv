const path = require('node:path');

/** The shared web modules the phone app bundles: data/, player/ and platform/ of the LG app. */
const SHARED_WEB = path.resolve(__dirname, '../webos/src');

module.exports = function config(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        test: (file) => typeof file === 'string' && file.startsWith(SHARED_WEB),
        plugins: [
          [
            require.resolve('./build/web-globals-plugin.js'),
            // No extension, so Metro picks web-globals.web.ts for the web build and web-globals.ts on phones.
            { source: path.resolve(__dirname, 'src/runtime/web-globals') },
          ],
        ],
      },
    ],
  };
};

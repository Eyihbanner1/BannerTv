const path = require('node:path');

/** The shared web modules: data/, player/ and platform/ of the LG app, as the phone app uses them. */
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
            // The phone app's plugin and globals: the TV runs the same Hermes with the same gaps.
            require.resolve('../mobile/build/web-globals-plugin.js'),
            { source: path.resolve(__dirname, '../mobile/src/runtime/web-globals') },
          ],
        ],
      },
    ],
  };
};

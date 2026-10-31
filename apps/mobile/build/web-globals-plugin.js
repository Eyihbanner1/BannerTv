/**
 * Babel plugin for the shared web modules (apps/webos/src) when they are bundled into the phone
 * app. Those modules read browser globals (localStorage, sessionStorage, window.location to start
 * again, window.name, document.hidden). React Native has none of them, and defining them for the
 * whole app would make React Native libraries think they run in a browser (expo-router checks
 * `typeof document`). So each shared module that reads one gets an import of the phone's stand-ins
 * instead, and nothing global changes. See src/runtime/web-globals.ts and ADR 0007.
 */
const SHIMMED = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'history',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'HTMLMediaElement',
  'TextDecoder',
];

module.exports = function webGlobals({ types: t }, options) {
  const source = options.source;
  if (!source) throw new Error('web-globals-plugin needs the shim module as `source`');
  return {
    name: 'bannertv-web-globals',
    visitor: {
      Program(path) {
        const used = SHIMMED.filter(
          (name) => path.scope.hasGlobal(name) && !path.scope.hasBinding(name),
        );
        if (used.length === 0) return;
        const specifiers = used.map((name) =>
          t.importSpecifier(t.identifier(name), t.identifier(name)),
        );
        path.unshiftContainer('body', t.importDeclaration(specifiers, t.stringLiteral(source)));
      },
    },
  };
};

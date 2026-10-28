import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * The sports matcher data as a classic script that sets one global, emitted
 * next to index.html and served at the same path by the dev server. A script
 * rather than a JSON file because a packaged app reads from file://, where
 * fetch and XHR of local files are not dependable on every webOS version.
 * JSON.parse of a string literal is also much quicker for the TV than
 * parsing the same data as a JavaScript object.
 */
export function sportsData(options: { file: string; global: string; from: string }): Plugin {
  const source = () => {
    // Re-serialised so a hand-edited file with stray whitespace stays small.
    const json = JSON.stringify(JSON.parse(readFileSync(options.from, 'utf8')));
    // Chromium 68 predates ES2019's JSON superset: these two must be escaped in a string literal.
    const literal = JSON.stringify(json)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    return `window.${options.global}=JSON.parse(${literal});\n`;
  };
  return {
    name: 'bannertv:sports-data',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (path !== options.file) return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: options.file, source: source() });
    },
  };
}

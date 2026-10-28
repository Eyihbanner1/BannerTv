import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);

/**
 * Copies the playback engines next to index.html under fixed names, byte for
 * byte, and serves the same paths from the dev server. The app loads them as
 * classic scripts only when a stream needs one (src/player/engines/vendor.ts).
 *
 * A `?url` import would also work, but resolves through document.currentScript
 * and breaks if read after start-up; `new URL(…, import.meta.url)` throws in
 * IIFE output. Fixed names relative to index.html have neither problem.
 */
export function vendorScripts(files: Record<string, { file: string; from: string }>): Plugin {
  const sources = new Map(
    Object.values(files).map(({ file, from }) => [file, require.resolve(from)] as const),
  );
  return {
    name: 'bannertv:vendor-scripts',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!.replace(/^\//, '');
        const source = sources.get(path);
        if (!source) return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      sources.forEach((source, fileName) => {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      });
    },
  };
}

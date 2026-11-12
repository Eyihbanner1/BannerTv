import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

interface Options {
  /** Folder holding appinfo.json. */
  metaDir: string;
  /** Folder holding the brand kit's webOS icons and splash. */
  brandDir: string;
  /** Extra files to copy into the package, as { packagePath: sourcePath }. */
  extraFiles?: Record<string, string>;
}

/**
 * Turns Vite's output into a webOS app folder that `ares-package` accepts.
 *
 * - No module script is left: the shell plugin (build/shell.ts) swaps the
 *   entry for the loader, a classic script, as Chromium can block module
 *   scripts loaded from file://, which is where packaged apps run. Any other
 *   module script fails the build.
 * - `crossorigin` attributes and module preloads go, since file:// has no CORS.
 * - appinfo.json, the launcher icons and the splash land next to index.html.
 */
export function webosPackage({ metaDir, brandDir, extraFiles = {} }: Options): Plugin {
  return {
    name: 'bannertv:webos-package',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => toClassicScripts(html),
    },
    generateBundle() {
      const appinfoPath = resolve(metaDir, 'appinfo.json');
      const appinfo = JSON.parse(readFileSync(appinfoPath, 'utf8')) as Record<string, unknown>;
      this.emitFile({
        type: 'asset',
        fileName: 'appinfo.json',
        source: `${JSON.stringify(appinfo, null, 2)}\n`,
      });

      const files: Record<string, string> = { ...extraFiles };
      for (const key of ['icon', 'largeIcon', 'splashBackground']) {
        const name = appinfo[key];
        if (typeof name !== 'string') throw new Error(`appinfo.json is missing "${key}"`);
        files[name] = resolve(brandDir, name);
      }
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      }
    },
  };
}

export function toClassicScripts(html: string): string {
  if (/<script\b[^>]*\btype="module"/.test(html)) {
    throw new Error(
      'index.html still has a module script: the shell plugin should have swapped it.',
    );
  }
  return html
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, '')
    .replace(/(<(?:link|script)\b[^>]*?)\s+crossorigin(="[^"]*")?/g, '$1');
}

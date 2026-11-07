import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * A trimmed copy of apps/webos/build/webos-package.ts, so the trial builds
 * with its own dependencies: a classic deferred script (Chromium can block
 * module scripts from file://), no crossorigin, and appinfo.json, the icons
 * and the splash next to index.html.
 */
export function webosPackage(options: {
  metaDir: string;
  brandDir: string;
  extraFiles?: Record<string, string>;
}): Plugin {
  return {
    name: 'bannertv:motion-trial-package',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) =>
        html
          .replace(/<script\b([^>]*)>/g, (tag: string, attrs: string) => {
            if (!/\btype="module"/.test(attrs)) return tag;
            const rest = attrs
              .replace(/\s*\btype="module"/, '')
              .replace(/\s*\bcrossorigin(="[^"]*")?/, '');
            return `<script defer${rest}>`;
          })
          .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/g, '')
          .replace(/(<link\b[^>]*?)\s+crossorigin(="[^"]*")?/g, '$1'),
    },
    generateBundle() {
      const appinfo = JSON.parse(
        readFileSync(resolve(options.metaDir, 'appinfo.json'), 'utf8'),
      ) as Record<string, unknown>;
      this.emitFile({
        type: 'asset',
        fileName: 'appinfo.json',
        source: `${JSON.stringify(appinfo, null, 2)}\n`,
      });
      const files: Record<string, string> = { ...options.extraFiles };
      for (const key of ['icon', 'largeIcon', 'splashBackground']) {
        const name = appinfo[key];
        if (typeof name !== 'string') throw new Error(`appinfo.json is missing "${key}"`);
        files[name] = resolve(options.brandDir, name);
      }
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
      }
    },
  };
}

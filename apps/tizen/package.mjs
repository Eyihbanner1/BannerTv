#!/usr/bin/env node
// Packages the web build for Samsung TVs: `pnpm package:tizen` after `pnpm build`.
// Writes out/bannertv_<version>.wgt at the repository's root, beside the .ipk.
//
//   node package.mjs [--version 0.1.7] [--out path/to/file.wgt]
//
// The version is the LG app's (apps/webos/webos-meta/appinfo.json) unless given.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { appVersion, isFolder, wgtEntries, zip } from './wgt.mjs';

const here = import.meta.dirname;
const root = resolve(here, '../..');
const { values } = parseArgs({
  options: { version: { type: 'string' }, out: { type: 'string' } },
});

const dist = resolve(root, 'apps/webos/dist');
if (!isFolder(dist)) {
  console.error('✗ apps/webos/dist is missing: run pnpm build first');
  process.exit(1);
}
const version = values.version ?? appVersion(resolve(root, 'apps/webos/webos-meta/appinfo.json'));
const out = resolve(values.out ?? resolve(root, 'out', `bannertv_${version}.wgt`));

try {
  const entries = wgtEntries({
    dist,
    template: readFileSync(resolve(here, 'config.xml'), 'utf8'),
    icon: readFileSync(resolve(root, 'brand/store/icon_400.png')),
    version,
  });
  const wgt = zip(entries);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, wgt);
  const kb = (wgt.length / 1024).toFixed(0);
  console.log(
    `✓ ${relative(process.cwd(), out)}: ${Object.keys(entries).length} files, ${kb} KB, version ${version}`,
  );
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

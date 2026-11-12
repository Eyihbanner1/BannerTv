#!/usr/bin/env node
// Checks a webOS build folder before it is packaged: classic scripts only,
// relative URLs, appinfo.json and its images present, the loader and the
// config it reads (apps/webos/src/shell), ES2017 syntax, no built-ins newer
// than ES2018, and the size budgets from docs/PLAN.md.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.argv[2] ?? 'dist');
const JS_GZIP_BUDGET = 600 * 1024;
// hls.js and Shaka load only when a stream needs them, so they have their own budget.
const VENDOR_GZIP_BUDGET = 450 * 1024;
const PACKAGE_BUDGET = 15 * 1024 * 1024;
const problems = [];

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/type="module"/.test(html)) problems.push('index.html still has a module script');
if (/\bcrossorigin\b/.test(html)) problems.push('index.html has a crossorigin attribute');
if (/modulepreload/.test(html)) problems.push('index.html has a modulepreload link');
for (const [, url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  if (!url.startsWith('./')) problems.push(`index.html references ${url}, not a relative ./ path`);
}

// The loader starts the app: index.html runs loader.js and nothing else, and the config beside it
// names every script an update can replace, by the hash of the file in this folder.
const SHELL_CONFIG = /<script id="bannertv-shell" type="application\/json">([^<]*)<\/script>/;
const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => src);
if (scriptTags.join(' ') !== './loader.js') {
  problems.push(
    `index.html must run ./loader.js and no other script, not ${scriptTags.join(', ') || 'none'}`,
  );
}
if (!existsSync(join(dist, 'loader.js'))) problems.push('loader.js is not in the build');
const configText = SHELL_CONFIG.exec(html)?.[1];
let shellConfig = null;
try {
  shellConfig = configText === undefined ? null : JSON.parse(configText);
} catch {
  problems.push('the shell config in index.html is not JSON');
}
if (configText === undefined) problems.push('index.html carries no shell config');
if (shellConfig) {
  const named = Object.keys(shellConfig.files ?? {});
  if (!named.includes(shellConfig.launch) || !String(shellConfig.launch).startsWith('assets/')) {
    problems.push(
      `the shell config launches ${shellConfig.launch}, not a script it names in assets/`,
    );
  }
  for (const path of named) {
    const file = join(dist, path);
    if (!existsSync(file)) {
      problems.push(`the shell config names ${path}, which is not in the build`);
      continue;
    }
    const bytes = readFileSync(file);
    const { sha256, size } = shellConfig.files[path];
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== size || hash !== sha256) {
      problems.push(`the shell config's hash or size for ${path} is not the file's`);
    }
  }
  // An update carries scripts only: an image or font left beside them would be missing from it.
  for (const dir of ['assets', 'vendor', 'data']) {
    if (!existsSync(join(dist, dir))) continue;
    for (const entry of readdirSync(join(dist, dir))) {
      if (!named.includes(`${dir}/${entry}`)) {
        problems.push(`${dir}/${entry} is not in the shell config: assets must be inlined`);
      }
    }
  }
}

const appinfo = JSON.parse(readFileSync(join(dist, 'appinfo.json'), 'utf8'));
for (const key of ['id', 'version', 'type', 'main', 'title', 'icon']) {
  if (!appinfo[key]) problems.push(`appinfo.json is missing "${key}"`);
}
for (const key of ['main', 'icon', 'largeIcon', 'splashBackground']) {
  if (appinfo[key] && !existsSync(join(dist, appinfo[key]))) {
    problems.push(`appinfo.json ${key} "${appinfo[key]}" is not in the build`);
  }
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const all = files(dist);
const vendorDir = join(dist, 'vendor');
const isVendor = (path) => path.startsWith(vendorDir);
const scripts = all.filter((path) => path.endsWith('.js') && !isVendor(path));
const vendorScripts = all.filter((path) => path.endsWith('.js') && isVendor(path));
const gzipped = (paths) =>
  paths.reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0);
const jsGzip = gzipped(scripts);
const vendorGzip = gzipped(vendorScripts);
const total = all.reduce((sum, path) => sum + statSync(path).size, 0);
if (jsGzip > JS_GZIP_BUDGET)
  problems.push(`JavaScript is ${kb(jsGzip)} gzipped, budget ${kb(JS_GZIP_BUDGET)}`);
if (vendorGzip > VENDOR_GZIP_BUDGET)
  problems.push(`Vendor players are ${kb(vendorGzip)} gzipped, budget ${kb(VENDOR_GZIP_BUDGET)}`);
if (total > PACKAGE_BUDGET) problems.push(`build is ${kb(total)}, budget ${kb(PACKAGE_BUDGET)}`);

// Syntax must parse on Chromium 68. Built-ins newer than ES2018 need a polyfill
// first. Iterator only appears behind a typeof guard in tslib's generator helper.
// hls.js and Shaka are checked for syntax only: they test for newer built-ins
// (globalThis, BigInt, Uint8Array.fromBase64 …) before using them, which a
// static feature scan cannot tell from unguarded use.
const checks = [
  [['es2017'], [...scripts, ...vendorScripts]],
  [['es2018', '--checkFeatures', '--allowList', 'Iterator'], scripts],
];
for (const [args, paths] of checks) {
  if (paths.length === 0) continue;
  const result = spawnSync('pnpm', ['exec', 'es-check', ...args, ...paths], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0)
    problems.push(`es-check ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log(
  `JavaScript ${kb(jsGzip)} gzipped, vendor players ${kb(vendorGzip)}, whole build ${kb(total)}`,
);
if (problems.length > 0) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log('✓ build is ready for ares-package');

#!/usr/bin/env node
// Checks a webOS build folder before it is packaged: classic scripts only,
// relative URLs, appinfo.json and its images present, ES2017 syntax, no
// built-ins newer than ES2018, and the size budgets from docs/PLAN.md.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.argv[2] ?? 'dist');
const JS_GZIP_BUDGET = 600 * 1024;
const PACKAGE_BUDGET = 15 * 1024 * 1024;
const problems = [];

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (/type="module"/.test(html)) problems.push('index.html still has a module script');
if (/\bcrossorigin\b/.test(html)) problems.push('index.html has a crossorigin attribute');
if (/modulepreload/.test(html)) problems.push('index.html has a modulepreload link');
for (const [, url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  if (!url.startsWith('./')) problems.push(`index.html references ${url}, not a relative ./ path`);
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
const scripts = all.filter((path) => path.endsWith('.js'));
const jsGzip = scripts.reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0);
const total = all.reduce((sum, path) => sum + statSync(path).size, 0);
if (jsGzip > JS_GZIP_BUDGET)
  problems.push(`JavaScript is ${kb(jsGzip)} gzipped, budget ${kb(JS_GZIP_BUDGET)}`);
if (total > PACKAGE_BUDGET) problems.push(`build is ${kb(total)}, budget ${kb(PACKAGE_BUDGET)}`);

// Syntax must parse on Chromium 68. Built-ins newer than ES2018 need a polyfill
// first. Iterator only appears behind a typeof guard in tslib's generator helper.
for (const args of [['es2017'], ['es2018', '--checkFeatures', '--allowList', 'Iterator']]) {
  const result = spawnSync('pnpm', ['exec', 'es-check', ...args, ...scripts], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0)
    problems.push(`es-check ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log(`JavaScript ${kb(jsGzip)} gzipped, whole build ${kb(total)}`);
if (problems.length > 0) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log('✓ build is ready for ares-package');

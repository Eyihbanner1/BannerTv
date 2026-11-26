#!/usr/bin/env node
// Checks the website in site/ (privacy policy, terms, help) before GitHub Pages
// publishes it: every relative link, image and stylesheet url() must exist inside
// site/, and with --publish no placeholder may be left, so a policy without a real
// name and email never goes live. Run it with --publish before copying site/ anywhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

const ROOT = 'site';
const PLACEHOLDERS = /class="todo"|SUPPORT_EMAIL|CONTROLLER_NAME|JURISDICTION|EMAIL_PROVIDER|<!--/;
const publish = process.argv.includes('--publish');

function siteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return siteFiles(path);
    return /\.(?:html|css)$/.test(entry.name) ? [path] : [];
  });
}

// The targets a file points at: href, src and each srcset candidate in HTML,
// url() in CSS.
function targets(file, source) {
  if (file.endsWith('.css')) {
    return [...source.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]);
  }
  return [...source.matchAll(/(href|src|srcset)="([^"]+)"/g)].flatMap(([, attribute, value]) =>
    attribute === 'srcset'
      ? value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0])
      : [value],
  );
}

// Why a target is broken, or null when it resolves to a file inside site/.
// Root-relative links ("/privacy/") break when the site is served from a
// subpath such as /BannerTv/, so only relative links are allowed.
function problem(file, target) {
  if (target.startsWith('/')) return 'starts with "/"; use a relative link';
  const path = join(dirname(file), target.split(/[?#]/)[0]);
  const inside = relative(ROOT, path);
  if (inside.startsWith('..') || isAbsolute(inside)) return 'points outside site/';
  const found =
    existsSync(path) && (!statSync(path).isDirectory() || existsSync(join(path, 'index.html')));
  return found ? null : 'missing';
}

const broken = [];
const todos = [];
for (const file of siteFiles(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const name = relative(process.cwd(), file);

  if (file.endsWith('.html')) {
    source.split('\n').forEach((line, index) => {
      if (PLACEHOLDERS.test(line)) todos.push(`${name}:${index + 1}  ${line.trim()}`);
    });
  }

  for (const target of targets(file, source)) {
    if (/^(?:[a-z]+:|#)/i.test(target) || target.startsWith('//')) continue;
    const reason = problem(file, target);
    if (reason) broken.push(`${name}  ${target}  (${reason})`);
  }
}

if (broken.length > 0) {
  console.error(`Links in site/ that lead nowhere:\n${broken.join('\n')}`);
  process.exit(1);
}
if (todos.length > 0) {
  const message = `Placeholders or HTML comments still to remove:\n${todos.join('\n')}`;
  if (publish) {
    console.error(`${message}\n\nFill them in before the site is published.`);
    process.exit(1);
  }
  console.warn(message);
}
console.log('✓ site/ links resolve');

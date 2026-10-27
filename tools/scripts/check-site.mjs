#!/usr/bin/env node
// Checks the website in site/ (privacy policy, terms, help) before GitHub Pages
// publishes it: every relative link and image must exist, and with --publish no
// placeholder may be left, so a policy without a real name and email never goes live.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = 'site';
const PLACEHOLDERS = /class="todo"|SUPPORT_EMAIL|CONTROLLER_NAME|JURISDICTION/;
const publish = process.argv.includes('--publish');

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

const broken = [];
const todos = [];
for (const file of htmlFiles(ROOT)) {
  const source = readFileSync(file, 'utf8');
  const name = relative(process.cwd(), file);

  source.split('\n').forEach((line, index) => {
    if (PLACEHOLDERS.test(line)) todos.push(`${name}:${index + 1}  ${line.trim()}`);
  });

  for (const [, target] of source.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
    const path = join(dirname(file), target.split(/[?#]/)[0]);
    const found =
      existsSync(path) && (!statSync(path).isDirectory() || existsSync(join(path, 'index.html')));
    if (!found) broken.push(`${name}  ${target}`);
  }
}

if (broken.length > 0) {
  console.error(`Links in site/ that lead nowhere:\n${broken.join('\n')}`);
  process.exit(1);
}
if (todos.length > 0) {
  const message = `Placeholders still to fill in:\n${todos.join('\n')}`;
  if (publish) {
    console.error(`${message}\n\nFill them in before the site is published.`);
    process.exit(1);
  }
  console.warn(message);
}
console.log('✓ site/ links resolve');

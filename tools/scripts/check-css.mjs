#!/usr/bin/env node
// Fails on CSS that Chromium 68 (webOS 5.0, the oldest supported TV) cannot
// render. The build lowers JavaScript syntax but cannot polyfill these.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps/webos/src'];

const RULES = [
  [
    /(^|[;{\s])(row-|column-)?gap\s*:/,
    'flex gap needs Chromium 84; use margins (grid-gap is fine)',
  ],
  [/aspect-ratio\s*:/, 'aspect-ratio needs Chromium 88; give the box a width and height'],
  [/:focus-visible/, ':focus-visible needs Chromium 86; style the focused class instead'],
  [/backdrop-filter/, 'backdrop-filter needs Chromium 76'],
  [/(^|[;{\s])inset\s*:/, 'inset needs Chromium 87; use top, right, bottom and left'],
  [/:(is|where)\(/, ':is() and :where() need Chromium 88'],
  [/:has\(/, ':has() needs Chromium 105'],
  [/(^|[^\w-])(min|max|clamp)\(/, 'min(), max() and clamp() need Chromium 79'],
  [/scroll-snap/, 'scroll snapping needs Chromium 69'],
  [/@(container|layer)\b/, '@container and @layer need Chromium 99 or newer'],
  [/(^|[;{\s])(translate|scale|rotate)\s*:/, 'individual transform properties need Chromium 104'],
  [/-(inline|block)(-start|-end)?\s*:/, 'logical properties need Chromium 87; use physical ones'],
  [/\b(color-mix|oklch|oklab|lch|lab)\(/, 'modern colour functions need Chromium 111'],
];

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

const problems = [];
for (const file of ROOTS.flatMap(cssFiles)) {
  // Blank out comments but keep line numbers.
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' '),
  );
  source.split('\n').forEach((line, index) => {
    for (const [pattern, message] of RULES) {
      if (pattern.test(line))
        problems.push(`${relative(process.cwd(), file)}:${index + 1}  ${message}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`CSS that webOS 5.0 cannot render:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('✓ CSS is safe for Chromium 68');

// Builds the redesign's tokens for each platform from one source, brand/tokens/design.json:
//   brand/tokens/design.css  CSS custom properties for the web apps (--bt-color-bg and so on)
//   brand/tokens/design.ts   constants for the React Native apps (color.bg and so on)
// Run with --check to fail when the built files are out of date instead of writing them.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'brand', 'tokens');
const source = JSON.parse(readFileSync(join(dir, 'design.json'), 'utf8'));

const HEADER =
  'Built from brand/tokens/design.json by tools/scripts/build-tokens.mjs. Do not edit.';

/** How each group's numbers read in CSS. Groups not named here are pixels. */
const CSS_UNITS = { motion: 'ms', font: '', ease: '' };
const UNITLESS = new Set(['focused.tile-scale', 'player.seek-step']);

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const groups = Object.entries(source).filter(([key]) => !key.startsWith('$'));

export function buildCss() {
  const lines = [`/* ${HEADER} */`, ':root {'];
  for (const [group, tokens] of groups) {
    lines.push(`  /* ${group} */`);
    for (const [name, value] of Object.entries(tokens)) {
      let css;
      if (group === 'ease') css = `cubic-bezier(${value.join(', ')})`;
      else if (group === 'font' && name === 'family') css = `"${value}", system-ui, sans-serif`;
      else if (typeof value === 'number') {
        const unit = UNITLESS.has(`${group}.${name}`) ? '' : (CSS_UNITS[group] ?? 'px');
        css = `${value}${unit}`;
      } else css = value;
      lines.push(`  --bt-${group}-${name}: ${css};`);
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

export function buildTs() {
  const lines = [`// ${HEADER}`, ''];
  for (const [group, tokens] of groups) {
    lines.push(`export const ${camel(group)} = {`);
    for (const [name, value] of Object.entries(tokens)) {
      const ts = Array.isArray(value)
        ? `[${value.join(', ')}] as [number, number, number, number]`
        : JSON.stringify(value).replace(/"/g, "'");
      lines.push(`  ${camel(name)}: ${ts},`);
    }
    lines.push('} as const;', '');
  }
  return lines.join('\n');
}

const outputs = { 'design.css': buildCss(), 'design.ts': buildTs() };
const check = process.argv.includes('--check');
let stale = false;
for (const [file, text] of Object.entries(outputs)) {
  const path = join(dir, file);
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    // Not built yet.
  }
  if (current === text) continue;
  if (check) {
    console.error(`brand/tokens/${file} is out of date: run node tools/scripts/build-tokens.mjs`);
    stale = true;
  } else {
    writeFileSync(path, text);
    console.log(`Wrote brand/tokens/${file}`);
  }
}
if (stale) process.exit(1);

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { singleQuoted, sportsData } from './sports-data.ts';

const GLOBAL = '__TEST_SPORTS_DATA__';
const REAL_DATA = resolve(
  import.meta.dirname,
  '../../../packages/core/src/sports/data/sports-data.json',
);

/** The script the plugin emits for the JSON file at `from`. */
function emitted(from: string): string {
  const plugin = sportsData({ file: 'data/sports-data.js', global: GLOBAL, from });
  const files: Array<{ fileName: string; source: string }> = [];
  const hook = plugin.generateBundle;
  if (typeof hook !== 'function') throw new Error('generateBundle is not a function');
  hook.call(
    { emitFile: (file: { fileName: string; source: string }) => files.push(file) } as never,
    {} as never,
    {},
    false,
  );
  expect(files.map((file) => file.fileName)).toEqual(['data/sports-data.js']);
  return files[0]!.source;
}

/** What the script sets when the TV runs it. */
function run(script: string): unknown {
  const window: Record<string, unknown> = {};
  new Function('window', script)(window);
  return window[GLOBAL];
}

function fileWith(value: unknown, raw?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'sports-data-')), 'data.json');
  writeFileSync(path, raw ?? JSON.stringify(value));
  return path;
}

describe('singleQuoted', () => {
  it.each([
    'plain',
    '{"name":"Brighton & Hove Albion"}',
    "Borussia M'gladbach",
    'a backslash \\ and a \\u escape',
    'line\u2028and\u2029paragraph',
    "\\'",
    '',
  ])('reads back as %j', (text) => {
    const literal = singleQuoted(text);
    expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
    expect(new Function(`return ${literal};`)()).toBe(text);
    // Nothing a pre-ES2019 parser would read as the end of the line.
    expect(literal).not.toMatch(/[\n\r\u2028\u2029]/);
  });
});

describe('sportsData', () => {
  it('sets the same data as the JSON file, from a single-quoted literal', () => {
    const value = {
      teams: [{ name: "Nottingham Forest's", short: 'Forest', aliases: ['"Reds"', 'a\\b'] }],
      note: 'line\nbreak, tab\t, separators \u2028 \u2029, emoji \u{1F3C6}',
      count: 3,
    };
    const script = emitted(fileWith(value, `${JSON.stringify(value, null, 2)}\n`));
    expect(script.startsWith(`window.${GLOBAL}=JSON.parse('`)).toBe(true);
    expect(script.endsWith("');\n")).toBe(true);
    expect(run(script)).toEqual(value);
  });

  it('keeps the real matcher data whole, and smaller than a double-quoted literal', () => {
    const json = readFileSync(REAL_DATA, 'utf8');
    const script = emitted(REAL_DATA);
    expect(run(script)).toEqual(JSON.parse(json));
    // A double-quoted literal needs a backslash before every double quote.
    const doubleQuoted = JSON.stringify(JSON.stringify(JSON.parse(json)));
    expect(script.length).toBeLessThan(doubleQuoted.length * 0.9);
  });
});

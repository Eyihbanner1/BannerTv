import { afterEach, describe, expect, it, vi } from 'vitest';

const marked = vi.hoisted(() => [] as string[]);
vi.mock('./marks', () => ({ bootMark: (name: string) => marked.push(name) }));

/** A fresh copy of the module: a new page load. */
async function load() {
  vi.resetModules();
  return import('./launch');
}

afterEach(() => {
  marked.length = 0;
});

describe('noteHomeFocused', () => {
  it('marks Home’s first focus of the page load, and no later showing', async () => {
    const { noteHomeFocused } = await load();
    noteHomeFocused();
    noteHomeFocused();
    expect(marked).toEqual(['boot:first-focus']);
  });
});

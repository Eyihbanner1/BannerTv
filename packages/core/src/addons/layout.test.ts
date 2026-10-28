import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { buildBoard } from './board';
import type { InstalledAddon } from './collection';
import { DEFAULT_ADDONS } from './defaults';
import {
  arrangeBoard,
  createHomeLayout,
  EMPTY_LAYOUT,
  moveRow,
  orderedRows,
  rowIdentities,
  rowIdentity,
  setRowHidden,
} from './layout';

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

const cinemeta = DEFAULT_ADDONS.map((a) => installed(a.manifest, a.transportUrl));
const shorts = installed(
  {
    id: 'com.example.shorts',
    version: '1.0.0',
    name: 'Shorts',
    types: ['movie'],
    resources: ['catalog'],
    catalogs: [{ type: 'movie', id: 'trending', name: 'Trending shorts' }],
  },
  'https://shorts.example/manifest.json',
);

const names = (rows: ReturnType<typeof buildBoard>) => rows.map((row) => rowIdentity(row));

describe('Home layout', () => {
  const board = buildBoard([...cinemeta, shorts]);
  const ids = names(board);

  it('names rows by addon, type, catalog and genre, whatever the addon order', () => {
    expect(ids.slice(0, 2)).toEqual([
      'com.linvo.cinemeta|movie|top|',
      'com.linvo.cinemeta|series|top|',
    ]);
    expect(ids).toContain('com.linvo.cinemeta|movie|top|Action');
    const reordered = buildBoard([shorts, ...cinemeta]);
    expect(names(reordered).sort()).toEqual(ids.slice().sort());
    expect(reordered[0]!.key).not.toBe(board[board.length - 1]!.key);
  });

  it('leaves the board alone with no layout', () => {
    expect(arrangeBoard(board, EMPTY_LAYOUT)).toEqual(board);
  });

  it('moves rows and hides them, keeping hidden rows in the order', () => {
    const trending = 'com.example.shorts|movie|trending|';
    let layout = EMPTY_LAYOUT;
    for (let i = 0; i < ids.length; i++) layout = moveRow(board, layout, trending, -1);
    expect(names(arrangeBoard(board, layout))[0]).toBe(trending);
    // Already first: nothing to do.
    expect(moveRow(board, layout, trending, -1)).toBe(layout);

    layout = setRowHidden(layout, ids[0]!, true);
    expect(setRowHidden(layout, ids[0]!, true)).toBe(layout);
    const shown = names(arrangeBoard(board, layout));
    expect(shown).not.toContain(ids[0]);
    expect(names(orderedRows(board, layout))).toContain(ids[0]);
    layout = setRowHidden(layout, ids[0]!, false);
    expect(names(arrangeBoard(board, layout))).toContain(ids[0]);
  });

  it('tells apart two installs of one addon, to move and hide each on its own', () => {
    const english = { ...shorts, transportUrl: 'https://shorts.example/en/manifest.json' };
    const twice = buildBoard([...cinemeta, shorts, english]);
    const both = rowIdentities(twice);
    const trending = twice.filter((row) => row.catalog.id === 'trending');
    expect(trending.map((row) => both.get(row))).toEqual([
      'com.example.shorts|movie|trending|',
      'com.example.shorts|movie|trending|#2',
    ]);
    let layout = setRowHidden(EMPTY_LAYOUT, 'com.example.shorts|movie|trending|#2', true);
    expect(arrangeBoard(twice, layout)).toContain(trending[0]);
    expect(arrangeBoard(twice, layout)).not.toContain(trending[1]);
    layout = moveRow(twice, EMPTY_LAYOUT, 'com.example.shorts|movie|trending|#2', -1);
    const order = orderedRows(twice, layout);
    expect(order.indexOf(trending[1]!)).toBe(order.indexOf(trending[0]!) - 1);
  });

  it('puts rows it has not seen after the ones it has', () => {
    const layout = { order: [ids[3]!, ids[0]!], hidden: [] };
    const arranged = names(arrangeBoard(board, layout));
    expect(arranged.slice(0, 2)).toEqual([ids[3], ids[0]]);
    expect(arranged.slice(2)).toEqual(ids.filter((id) => id !== ids[3] && id !== ids[0]));
  });

  it('is kept per store and read leniently', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('homeLayout', { order: ['a', 'a', 3, 'b'], hidden: 'nope' });
    const store = createHomeLayout({ storage });
    await store.load();
    expect(store.get()).toEqual({ order: ['a', 'b'], hidden: [] });
    await store.update((layout) => setRowHidden(layout, 'b', true));
    expect(await storage.get('homeLayout')).toEqual({ order: ['a', 'b'], hidden: ['b'] });
  });
});

import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { buildBoard } from './board';
import { type InstalledAddon, installIdOf } from './collection';
import { BANNERTV_DEMO_URL, DEFAULT_ADDONS } from './defaults';
import {
  arrangeBoard,
  createHomeLayout,
  EMPTY_LAYOUT,
  hiddenRowIds,
  type HomeLayout,
  moveRow,
  orderedRows,
  rowIdentities,
  rowIdentity,
  setRowHidden,
} from './layout';

function installed(manifest: unknown, transportUrl: string): InstalledAddon {
  return { transportUrl, manifest: parseManifest(manifest), official: false, fetchedAt: 0 };
}

// Cinemeta and OpenSubtitles v3, without BannerTV Demo.
const cinemeta = DEFAULT_ADDONS.filter((a) => a.transportUrl !== BANNERTV_DEMO_URL).map((a) =>
  installed(a.manifest, a.transportUrl),
);
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

    layout = setRowHidden(board, layout, ids[0]!, true);
    expect(setRowHidden(board, layout, ids[0]!, true)).toBe(layout);
    const shown = names(arrangeBoard(board, layout));
    expect(shown).not.toContain(ids[0]);
    expect(names(orderedRows(board, layout))).toContain(ids[0]);
    layout = setRowHidden(board, layout, ids[0]!, false);
    expect(names(arrangeBoard(board, layout))).toContain(ids[0]);
    expect(layout.hidden).toEqual([]);
  });

  describe('one addon installed twice', () => {
    const base = 'com.example.shorts|movie|trending|';
    const english = { ...shorts, transportUrl: 'https://shorts.example/en/manifest.json' };
    const twice = buildBoard([...cinemeta, shorts, english]);
    const trendingOf = (rows: ReturnType<typeof buildBoard>, url: string) =>
      rows.find((row) => row.catalog.id === 'trending' && row.addon.transportUrl === url)!;
    const idOf = (rows: ReturnType<typeof buildBoard>, url: string) =>
      rowIdentities(rows).get(trendingOf(rows, url))!;

    it('names each copy by its install, without its address', () => {
      const first = idOf(twice, shorts.transportUrl);
      const second = idOf(twice, english.transportUrl);
      expect(first).not.toBe(second);
      for (const id of [first, second]) {
        expect(id.indexOf(`${base}#`)).toBe(0);
        expect(id).not.toContain('shorts.example');
      }
      const ids = Array.from(rowIdentities(twice).values());
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('moves and hides each copy on its own, whichever is installed first', () => {
      let layout = setRowHidden(twice, EMPTY_LAYOUT, idOf(twice, english.transportUrl), true);
      expect(arrangeBoard(twice, layout)).toContain(trendingOf(twice, shorts.transportUrl));
      expect(arrangeBoard(twice, layout)).not.toContain(trendingOf(twice, english.transportUrl));
      // The addons swap places in Addons: the hidden one is still the English one.
      const swapped = buildBoard([...cinemeta, english, shorts]);
      expect(arrangeBoard(swapped, layout)).toContain(trendingOf(swapped, shorts.transportUrl));
      expect(arrangeBoard(swapped, layout)).not.toContain(
        trendingOf(swapped, english.transportUrl),
      );

      layout = moveRow(twice, EMPTY_LAYOUT, idOf(twice, english.transportUrl), -1);
      const order = orderedRows(swapped, layout);
      expect(order.indexOf(trendingOf(swapped, english.transportUrl))).toBe(
        order.indexOf(trendingOf(swapped, shorts.transportUrl)) - 1,
      );
    });

    it('keeps settings saved for the addon on both copies until one is changed', () => {
      let layout: HomeLayout = { order: [base], hidden: [base] };
      expect(hiddenRowIds(twice, layout)).toEqual(
        new Set([idOf(twice, shorts.transportUrl), idOf(twice, english.transportUrl)]),
      );
      expect(orderedRows(twice, layout).slice(0, 2)).toEqual([
        trendingOf(twice, shorts.transportUrl),
        trendingOf(twice, english.transportUrl),
      ]);
      layout = setRowHidden(twice, layout, idOf(twice, english.transportUrl), false);
      expect(arrangeBoard(twice, layout)).toContain(trendingOf(twice, english.transportUrl));
      expect(arrangeBoard(twice, layout)).not.toContain(trendingOf(twice, shorts.transportUrl));
      expect(layout.hidden).toEqual([idOf(twice, shorts.transportUrl)]);
    });

    it('lets a copy left on its own keep what it had, and the other copy keep nothing of it', () => {
      const layout = setRowHidden(twice, EMPTY_LAYOUT, idOf(twice, english.transportUrl), true);
      const onlyEnglish = buildBoard([...cinemeta, english]);
      const onlyFirst = buildBoard([...cinemeta, shorts]);
      expect(idOf(onlyEnglish, english.transportUrl)).toBe(base);
      expect(arrangeBoard(onlyEnglish, layout)).not.toContain(
        trendingOf(onlyEnglish, english.transportUrl),
      );
      expect(arrangeBoard(onlyFirst, layout)).toContain(trendingOf(onlyFirst, shorts.transportUrl));
      // Shown again on its own: nothing of it stays hidden.
      const shown = setRowHidden(onlyEnglish, layout, base, false);
      expect(shown.hidden).toEqual([]);
    });

    it('keeps a copy set up again with new settings as it was', () => {
      const layout = setRowHidden(twice, EMPTY_LAYOUT, idOf(twice, english.transportUrl), true);
      // The collection carries the install's name over to its new address.
      const configured = {
        ...english,
        transportUrl: 'https://shorts.example/en-gb/manifest.json',
        installId: installIdOf(english),
      };
      const after = buildBoard([...cinemeta, shorts, configured]);
      expect(arrangeBoard(after, layout)).not.toContain(trendingOf(after, configured.transportUrl));
      expect(arrangeBoard(after, layout)).toContain(trendingOf(after, shorts.transportUrl));
    });

    it('keeps what was saved for addons that are not installed', () => {
      const layout = { order: [], hidden: ['com.other|movie|top|'] };
      const hidden = setRowHidden(twice, layout, idOf(twice, shorts.transportUrl), true);
      expect(hidden.hidden).toEqual(['com.other|movie|top|', idOf(twice, shorts.transportUrl)]);
    });
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
    await store.update((layout) => setRowHidden([], layout, 'b', true));
    expect(await storage.get('homeLayout')).toEqual({ order: ['a', 'b'], hidden: ['b'] });
  });
});

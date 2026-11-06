import { parseManifest } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { buildBoard } from './board';
import type { InstalledAddon } from './collection';
import {
  CONTINUE_LINE,
  type HomeLine,
  homeLines,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
  moveLine,
  type OwnLine,
  ownLinePlaces,
  setLineHidden,
} from './home-lines';
import { EMPTY_LAYOUT, moveRow, rowIdentity, setRowHidden } from './layout';

const addon: InstalledAddon = {
  transportUrl: 'https://rows.example/manifest.json',
  manifest: parseManifest({
    id: 'com.example.rows',
    version: '1.0.0',
    name: 'Rows',
    types: ['movie'],
    resources: ['catalog'],
    catalogs: ['a', 'b', 'c'].map((id) => ({ type: 'movie', id, name: id })),
  }),
  official: false,
  fetchedAt: 0,
};
const board = buildBoard([addon]);
const [A, B, C] = board.map((row) => rowIdentity(row)) as [string, string, string];

const OWN: OwnLine[] = [
  { id: CONTINUE_LINE, place: 0, fixed: true },
  { id: MY_LIST_LINE, place: 0 },
  { id: LIVE_SPORT_LINE, place: 1 },
];
const ids = (lines: HomeLine[]) => lines.map((line) => line.id);

describe('Home lines', () => {
  it('puts Home’s own lines at their places until they are moved', () => {
    expect(ids(homeLines(board, EMPTY_LAYOUT, OWN))).toEqual([
      CONTINUE_LINE,
      MY_LIST_LINE,
      A,
      LIVE_SPORT_LINE,
      B,
      C,
    ]);
    // A place past the rows is the end.
    expect(ids(homeLines(board, EMPTY_LAYOUT, [{ id: LIVE_SPORT_LINE, place: 9 }]))).toEqual([
      A,
      B,
      C,
      LIVE_SPORT_LINE,
    ]);
  });

  it('moves lines among the rows and keeps where they were moved to', () => {
    let layout = moveLine(board, EMPTY_LAYOUT, OWN, LIVE_SPORT_LINE, 1);
    layout = moveLine(board, layout, OWN, LIVE_SPORT_LINE, 1);
    expect(ids(homeLines(board, layout, OWN))).toEqual([
      CONTINUE_LINE,
      MY_LIST_LINE,
      A,
      B,
      C,
      LIVE_SPORT_LINE,
    ]);
    // Last already, and Continue Watching stays first.
    expect(moveLine(board, layout, OWN, LIVE_SPORT_LINE, 1)).toBe(layout);
    expect(moveLine(board, layout, OWN, CONTINUE_LINE, 1)).toBe(layout);
    expect(moveLine(board, layout, OWN, MY_LIST_LINE, -1)).toBe(layout);

    // A row moved the old way, by a screen that knows only rows, keeps the rest in place.
    const older = moveRow(board, layout, C, -1);
    expect(ids(homeLines(board, older, OWN).filter((line) => line.row))).toEqual([A, C, B]);
  });

  it('keeps a moved line by the rows around it while it is not shown', () => {
    const layout = moveLine(board, EMPTY_LAYOUT, OWN, MY_LIST_LINE, 1);
    // Sport left: My List keeps its place after A.
    const withoutSport = OWN.filter((line) => line.id !== LIVE_SPORT_LINE);
    expect(ids(homeLines(board, layout, withoutSport))).toEqual([
      CONTINUE_LINE,
      A,
      MY_LIST_LINE,
      B,
      C,
    ]);
  });

  it('hides and shows lines of either kind, and Home counts only what it shows', () => {
    let layout = setLineHidden(board, EMPTY_LAYOUT, CONTINUE_LINE, true);
    layout = setLineHidden(board, layout, A, true);
    expect(setLineHidden(board, layout, CONTINUE_LINE, true)).toBe(layout);
    const lines = homeLines(board, layout, OWN);
    expect(lines.filter((line) => line.hidden).map((line) => line.id)).toEqual([CONTINUE_LINE, A]);
    expect(ownLinePlaces(lines)).toEqual(
      new Map([
        [MY_LIST_LINE, 0],
        [LIVE_SPORT_LINE, 0],
      ]),
    );
    // Rows hidden the old way keep Home's own hidden too.
    layout = setRowHidden(board, layout, A, false);
    expect(layout.hidden).toEqual([CONTINUE_LINE]);
    layout = setLineHidden(board, layout, CONTINUE_LINE, false);
    expect(layout.hidden).toEqual([]);
  });
});

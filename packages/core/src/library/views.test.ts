import { describe, expect, it } from 'vitest';
import type { PlayedVideo } from '../playback/continue';
import type { ProgressEntry } from '../playback/progress';
import type { LibraryItem } from './library';
import { HISTORY_LIMIT, historyView, libraryView } from './views';

const item = (id: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({
  id,
  type: 'movie',
  name: id,
  addedAt: 0,
  ...extra,
});

describe('libraryView', () => {
  const items = [
    item('b', { name: 'banana', releaseInfo: '2011–2019', type: 'series' }),
    item('a', { name: 'Apple', releaseInfo: '2008', poster: 'https://p' }),
    item('c', { name: 'cherry' }),
    item('d', { name: 'apple', releaseInfo: '2008' }),
  ];

  it('keeps the saved order by default, and filters by kind', () => {
    expect(libraryView(items, 'all', 'added').map((p) => p.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(libraryView(items, 'movie', 'added').map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(libraryView(items, 'series', 'added').map((p) => p.id)).toEqual(['b']);
  });

  it('sorts A to Z ignoring case, and by year newest first with no year last', () => {
    expect(libraryView(items, 'all', 'name').map((p) => p.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(libraryView(items, 'all', 'year').map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('gives tiles what they need', () => {
    expect(libraryView(items, 'movie', 'added')[0]).toEqual({
      id: 'a',
      type: 'movie',
      name: 'Apple',
      posterShape: 'poster',
      poster: 'https://p',
      releaseInfo: '2008',
      genres: [],
      trailers: [],
    });
  });
});

describe('historyView', () => {
  const entry = (videoId: string, metaId: string, type: 'movie' | 'series'): ProgressEntry => ({
    metaId,
    type,
    videoId,
    position: 10,
    duration: 100,
    updatedAt: 0,
    watched: false,
  });
  const cards: Record<string, PlayedVideo> = {
    'tt2:1:2': { videoId: 'tt2:1:2', metaId: 'tt2', type: 'series', name: 'Show', updatedAt: 0 },
    'tt2:1:1': { videoId: 'tt2:1:1', metaId: 'tt2', type: 'series', name: 'Show', updatedAt: 0 },
    tt1: {
      videoId: 'tt1',
      metaId: 'tt1',
      type: 'movie',
      name: 'Film',
      poster: 'https://p',
      updatedAt: 0,
    },
  };

  it('lists each title once, most recent first, and skips videos with no card', () => {
    const entries = [
      entry('tt2:1:2', 'tt2', 'series'),
      entry('tt9', 'tt9', 'movie'),
      entry('tt1', 'tt1', 'movie'),
      entry('tt2:1:1', 'tt2', 'series'),
    ];
    const view = historyView(entries, (id) => cards[id], 'all');
    expect(view.map((p) => [p.id, p.name])).toEqual([
      ['tt2', 'Show'],
      ['tt1', 'Film'],
    ]);
    expect(historyView(entries, (id) => cards[id], 'movie').map((p) => p.id)).toEqual(['tt1']);
  });

  it('stops at the limit', () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) =>
      entry(`m${i}`, `m${i}`, 'movie'),
    );
    const view = historyView(entries, (id) => ({ ...cards.tt1!, videoId: id, metaId: id }), 'all');
    expect(view).toHaveLength(HISTORY_LIMIT);
  });
});

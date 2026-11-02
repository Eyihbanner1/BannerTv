import type { MetaDetail, Video } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import type { ProgressEntry } from '../playback/progress';
import {
  calendarDays,
  calendarEntries,
  calendarStart,
  calendarView,
  followedTitles,
} from './calendar';
import type { LibraryItem } from './library';

// Noon local time, so a day either side stays the same date wherever the tests run.
const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime();
const at = (days: number, hour = 12) => new Date(2026, 10, 1 + days, hour, 0, 0).toISOString();

const meta = (id: string, type: string, extra: Partial<MetaDetail> = {}): MetaDetail => ({
  id,
  type,
  name: id,
  posterShape: 'poster',
  genres: [],
  trailers: [],
  videos: [],
  cast: [],
  directors: [],
  writers: [],
  links: [],
  behaviorHints: { hasScheduledVideos: false },
  ...extra,
});

const episode = (id: string, season: number, number: number, released?: string): Video => {
  const video: Video = {
    id: `${id}:${season}:${number}`,
    title: `Episode ${number}`,
    season,
    episode: number,
  };
  if (released) video.released = released;
  return video;
};

const item = (id: string, type: string): LibraryItem => ({ id, type, name: id, addedAt: 0 });
const played = (metaId: string, type: string): ProgressEntry => ({
  metaId,
  type,
  videoId: type === 'series' ? `${metaId}:1:1` : metaId,
  position: 10,
  duration: 100,
  updatedAt: 0,
  watched: false,
});

describe('followedTitles', () => {
  it('puts series being watched first, then My List series, then My List films', () => {
    const titles = followedTitles(
      [item('film', 'movie'), item('listed', 'series'), item('watching', 'series')],
      [played('watching', 'series'), played('seen', 'movie'), played('other', 'series')],
    );
    expect(titles).toEqual([
      { id: 'watching', type: 'series' },
      { id: 'other', type: 'series' },
      { id: 'listed', type: 'series' },
      { id: 'film', type: 'movie' },
    ]);
  });

  it('leaves out channels and stops at the limit', () => {
    const items = [item('tv', 'channel'), item('a', 'series'), item('b', 'series')];
    expect(followedTitles(items, [], 1)).toEqual([{ id: 'a', type: 'series' }]);
  });
});

describe('calendarEntries', () => {
  it('lists dated episodes inside the window and skips specials and undated ones', () => {
    const show = meta('tt1', 'series', {
      videos: [
        episode('tt1', 0, 1, at(1)),
        episode('tt1', 1, 1, at(-30)),
        episode('tt1', 1, 2, at(-3)),
        episode('tt1', 1, 3, at(4)),
        episode('tt1', 1, 4),
        episode('tt1', 1, 5, at(90)),
      ],
    });
    const entries = calendarEntries(show, NOW);
    expect(entries.map((e) => e.videoId)).toEqual(['tt1:1:2', 'tt1:1:3']);
    expect(entries[1]).toMatchObject({
      kind: 'episode',
      season: 1,
      episode: 3,
      episodeTitle: 'Episode 3',
      title: { id: 'tt1', name: 'tt1', type: 'series' },
    });
    expect('videos' in entries[1]!.title).toBe(false);
  });

  it('gives a film its release day, and nothing when it is outside the window', () => {
    expect(calendarEntries(meta('tt2', 'movie', { released: at(10) }), NOW)).toMatchObject([
      { kind: 'movie', videoId: 'tt2' },
    ]);
    expect(calendarEntries(meta('tt3', 'movie', { released: at(-40) }), NOW)).toEqual([]);
    expect(calendarEntries(meta('tt4', 'movie', { released: 'soon' }), NOW)).toEqual([]);
  });
});

describe('calendarDays', () => {
  it('groups by local day, earliest first, with each day counted from today', () => {
    const a = meta('a', 'series', {
      videos: [episode('a', 2, 1, at(1)), episode('a', 2, 2, at(8))],
    });
    const b = meta('b', 'series', { videos: [episode('b', 1, 7, at(-1, 20))] });
    const days = calendarView([a, b], NOW);
    expect(days.map((d) => [d.offset, d.entries.map((e) => e.videoId)])).toEqual([
      [-1, ['b:1:7']],
      [1, ['a:2:1']],
      [8, ['a:2:2']],
    ]);
    expect(calendarStart(days)).toBe(1);
  });

  it('folds a season out the same day into one entry', () => {
    const show = meta('s', 'series', {
      videos: [1, 2, 3].map((n) => episode('s', 3, n, at(2, 8))),
    });
    const [day] = calendarView([show], NOW);
    expect(day!.entries).toHaveLength(1);
    expect(day!.entries[0]).toMatchObject({ season: 3, episode: 1, lastEpisode: 3 });
    expect(day!.entries[0]!.episodeTitle).toBeUndefined();
  });

  it('sorts titles on the same moment by name, and filters by kind', () => {
    const z = meta('z', 'series', { name: 'Zed', videos: [episode('z', 1, 1, at(0))] });
    const y = meta('y', 'movie', { name: 'Why', released: at(0) });
    expect(calendarView([z, y], NOW)[0]!.entries.map((e) => e.title.name)).toEqual(['Why', 'Zed']);
    expect(calendarView([z, y], NOW, 'movie')[0]!.entries.map((e) => e.kind)).toEqual(['movie']);
    expect(calendarView([z, y], NOW, 'series')[0]!.entries.map((e) => e.kind)).toEqual(['episode']);
  });

  it('opens on the last day when everything has passed, and on 0 when empty', () => {
    const past = meta('p', 'series', {
      videos: [episode('p', 1, 1, at(-5)), episode('p', 1, 2, at(-2))],
    });
    expect(calendarStart(calendarView([past], NOW))).toBe(1);
    expect(calendarStart(calendarDays([], NOW))).toBe(0);
  });
});

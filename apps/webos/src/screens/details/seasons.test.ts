import { describe, expect, it } from 'vitest';
import type { ProgressEntry } from '@bannertv/core';
import { defaultSeason, episodeState, groupSeasons, seasonOf } from './seasons';

const video = (id: string, season?: number, episode?: number, released?: string) => ({
  id,
  title: id,
  ...(season === undefined ? {} : { season }),
  ...(episode === undefined ? {} : { episode }),
  ...(released === undefined ? {} : { released }),
});

describe('groupSeasons', () => {
  it('orders seasons, puts Specials and unnumbered videos last, and sorts episodes', () => {
    const seasons = groupSeasons([
      video('s2e1', 2, 1),
      video('special', 0, 1),
      video('s1e2', 1, 2),
      video('extra'),
      video('s1e1', 1, 1),
    ]);
    expect(seasons.map((s) => [s.number, s.videos.map((v) => v.id)])).toEqual([
      [1, ['s1e1', 's1e2']],
      [2, ['s2e1']],
      [0, ['special']],
      [null, ['extra']],
    ]);
    expect(defaultSeason(seasons)).toBe(0);
  });

  it('orders videos without episode numbers by release date', () => {
    const [season] = groupSeasons([
      video('late', undefined, undefined, '2024-02-01T00:00:00.000Z'),
      video('early', undefined, undefined, '2024-01-01T00:00:00.000Z'),
    ]);
    expect(season!.videos.map((v) => v.id)).toEqual(['early', 'late']);
  });

  it('starts on Specials when that is all there is', () => {
    expect(defaultSeason(groupSeasons([video('special', 0, 1)]))).toBe(0);
    expect(defaultSeason([])).toBe(0);
  });
});

describe('seasonOf', () => {
  const seasons = groupSeasons([video('s1e1', 1, 1), video('s2e1', 2, 1), video('special', 0, 1)]);

  it('finds the season holding the video, Specials included', () => {
    expect(seasons[seasonOf(seasons, 's2e1')]!.number).toBe(2);
    expect(seasons[seasonOf(seasons, 'special')]!.number).toBe(0);
  });

  it('falls back to the default season when the video is not listed', () => {
    expect(seasons[seasonOf(seasons, 'elsewhere')]!.number).toBe(1);
  });
});

describe('episodeState', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const seen = (position: number, duration: number, watched = false) =>
    ({ position, duration, watched }) as ProgressEntry;

  it('is not out yet only with a readable date still to come', () => {
    expect(episodeState(video('e', 1, 1, '2026-11-12'), undefined, false, now).kind).toBe(
      'upcoming',
    );
    expect(episodeState(video('e', 1, 1), undefined, false, now).kind).toBe('new');
    expect(episodeState(video('e', 1, 1, 'soon'), undefined, false, now).kind).toBe('new');
  });

  it('is watched here or on Trakt', () => {
    expect(episodeState(video('e', 1, 1), seen(10, 40, true), false, now).kind).toBe('watched');
    expect(episodeState(video('e', 1, 1), undefined, true, now).kind).toBe('watched');
  });

  it('is part watched with how far in and how long is left', () => {
    expect(episodeState(video('e', 1, 1), seen(15, 40), false, now)).toEqual({
      kind: 'started',
      fraction: 0.375,
      secondsLeft: 25,
    });
    // A length not known yet, or nothing played, is not a start.
    expect(episodeState(video('e', 1, 1), seen(15, 0), false, now).kind).toBe('new');
    expect(episodeState(video('e', 1, 1), seen(0, 40), false, now).kind).toBe('new');
  });
});

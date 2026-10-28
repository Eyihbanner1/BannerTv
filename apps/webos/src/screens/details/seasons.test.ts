import { describe, expect, it } from 'vitest';
import { defaultSeason, groupSeasons } from './seasons';

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

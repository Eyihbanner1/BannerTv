import type { ProgressEntry } from '@bannertv/core';
import type { Video } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { episodeLines } from './episode-lines';

const now = Date.UTC(2026, 10, 9, 21, 0, 0);

const episode = (number: number, over: Partial<Video> = {}): Video => ({
  id: `tt1:1:${number}`,
  title: `Episode ${number}`,
  season: 1,
  episode: number,
  released: '2024-01-01T00:00:00.000Z',
  ...over,
});

const seen = (videoId: string, position: number, duration: number, watched = false) =>
  ({
    metaId: 'tt1',
    type: 'series',
    videoId,
    position,
    duration,
    updatedAt: 1,
    watched,
  }) as ProgressEntry;

describe('episodeLines', () => {
  const season = [
    episode(1),
    episode(2),
    episode(3),
    episode(4),
    episode(5, { released: '2099-01-01T00:00:00.000Z' }),
  ];
  const progress: Record<string, ProgressEntry> = {
    'tt1:1:1': seen('tt1:1:1', 1500, 1500, true),
    'tt1:1:3': seen('tt1:1:3', 600, 1500),
  };
  const lines = episodeLines(
    season,
    'tt1:1:2',
    (id) => progress[id],
    (id) => id === 'tt1:1:4',
    now,
  );

  it('marks the episode playing, whatever else is known of it', () => {
    expect(lines[1]!.note).toEqual({ kind: 'playing' });
    expect(lines[1]!.playable).toBe(true);
  });

  it('says what is watched, here or on Trakt, and what is part watched', () => {
    expect(lines[0]!.note).toEqual({ kind: 'watched' });
    expect(lines[3]!.note).toEqual({ kind: 'watched' });
    expect(lines[2]!.note).toEqual({ kind: 'started', minutesLeft: 15 });
  });

  it('says when an episode not out yet comes, and does not play it', () => {
    expect(lines[4]!.note).toEqual({ kind: 'upcoming', released: '2099-01-01T00:00:00.000Z' });
    expect(lines[4]!.playable).toBe(false);
  });

  it('numbers episodes by the addon, else by their place', () => {
    expect(lines.map((line) => line.number)).toEqual([1, 2, 3, 4, 5]);
    const unnumbered = episodeLines(
      [episode(1, { episode: undefined }), episode(2, { episode: undefined })],
      'none',
      () => undefined,
      () => false,
      now,
    );
    expect(unnumbered.map((line) => line.number)).toEqual([1, 2]);
    expect(unnumbered[0]!.note).toEqual({ kind: 'none' });
  });

  it('never counts less than a minute left', () => {
    const [line] = episodeLines(
      [episode(1)],
      'none',
      () => seen('tt1:1:1', 1490, 1500),
      () => false,
      now,
    );
    expect(line!.note).toEqual({ kind: 'started', minutesLeft: 1 });
  });
});

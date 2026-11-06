import { describe, expect, it } from 'vitest';
import type { ProgressEntry } from '@bannertv/core';
import type { MetaDetail } from '@bannertv/protocol';
import {
  defaultSeason,
  episodeState,
  groupSeasons,
  markOffer,
  openingEpisode,
  seasonOf,
  type StartReader,
  startPoint,
  startReader,
} from './seasons';

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

  it('is not watched once marked so here, whatever Trakt ticks', () => {
    const unmarked = { ...seen(0, 40), updatedAt: 5, unmarkedAt: 5 } as ProgressEntry;
    expect(episodeState(video('e', 1, 1), unmarked, true, now).kind).toBe('new');
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

describe('startPoint and openingEpisode', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const meta = {
    id: 'tt1',
    type: 'series',
    name: 'Show',
    videos: [
      video('s1e1', 1, 1),
      video('s1e2', 1, 2),
      video('s2e1', 2, 1),
      video('s2e2', 2, 2, '2026-12-12'),
      video('special', 0, 1),
    ],
  } as unknown as MetaDetail;
  const seasons = groupSeasons(meta.videos);
  const entry = (videoId: string, position: number, duration: number, watched = false) =>
    ({ metaId: 'tt1', type: 'series', videoId, position, duration, watched }) as ProgressEntry;
  const reader = (
    latest: ProgressEntry | undefined,
    options: { resume?: number; ticked?: string[] } = {},
  ): StartReader => ({
    latest,
    resumeAt: (videoId) => (latest && videoId === latest.videoId ? options.resume : undefined),
    ticked: (videoId) => (options.ticked ?? []).indexOf(videoId) !== -1,
  });
  const point = (r: StartReader) => {
    const found = startPoint(meta, seasons, r, now);
    return found && [found.kind, found.video.id];
  };

  it('resumes the episode left part-way, in its season', () => {
    const r = reader(entry('s2e1', 600, 2400), { resume: 600 });
    expect(startPoint(meta, seasons, r, now)).toEqual({
      kind: 'resume',
      video: meta.videos[2],
      at: 600,
    });
    expect(openingEpisode(seasons, startPoint(meta, seasons, r, now), r)).toEqual({
      season: 1,
      index: 0,
    });
  });

  it('offers the next episode after a finished one, across seasons', () => {
    const r = reader(entry('s1e2', 2400, 2400, true));
    expect(point(r)).toEqual(['next', 's2e1']);
    expect(openingEpisode(seasons, startPoint(meta, seasons, r, now), r)).toEqual({
      season: 1,
      index: 0,
    });
  });

  it('plays an episode stopped in its first seconds again', () => {
    expect(point(reader(entry('s1e2', 12, 2400)))).toEqual(['again', 's1e2']);
  });

  it('has nothing to offer when the next episode is not out yet, and opens on the last played', () => {
    const r = reader(entry('s2e1', 2400, 2400, true));
    expect(point(r)).toBeUndefined();
    expect(openingEpisode(seasons, undefined, r)).toEqual({ season: 1, index: 0 });
  });

  it('starts a new series at its first episode', () => {
    const r = reader(undefined);
    expect(point(r)).toEqual(['first', 's1e1']);
    expect(openingEpisode(seasons, startPoint(meta, seasons, r, now), r)).toEqual({
      season: 0,
      index: 0,
    });
  });

  it('goes on after the furthest episode Trakt ticks, leaving Specials aside', () => {
    const r = reader(undefined, { ticked: ['s1e1', 's1e2', 'special'] });
    expect(point(r)).toEqual(['next', 's2e1']);
  });

  it('has no first episode for a series announced but not out', () => {
    const announced = {
      ...meta,
      videos: [video('s1e1', 1, 1, '2027-01-01')],
    } as unknown as MetaDetail;
    expect(startPoint(announced, groupSeasons(announced.videos), reader(undefined), now)).toBe(
      undefined,
    );
  });

  it('offers nothing for progress on an episode the addon no longer lists', () => {
    const r = reader(entry('gone', 2400, 2400, true));
    expect(point(r)).toBeUndefined();
    expect(openingEpisode(seasons, undefined, r)).toEqual({ season: 0, index: 0 });
  });
});

describe('startReader', () => {
  const entry = (videoId: string, updatedAt: number, extra: Partial<ProgressEntry> = {}) =>
    ({
      metaId: 'tt1',
      type: 'series',
      videoId,
      position: 600,
      duration: 2400,
      updatedAt,
      watched: false,
      ...extra,
    }) as ProgressEntry;

  it('passes over episodes marked not watched, and their Trakt ticks', () => {
    const entries = [entry('s1e1', 3, { unmarkedAt: 3, position: 0 }), entry('s1e2', 2)];
    const progress = {
      forMeta: () => entries,
      get: (videoId: string) => entries.find((e) => e.videoId === videoId),
      resumeAt: () => undefined,
    };
    const reader = startReader(progress, { has: () => true }, 'tt1');
    expect(reader.latest?.videoId).toBe('s1e2');
    expect(reader.ticked('s1e1')).toBe(false);
    expect(reader.ticked('s2e1')).toBe(true);
  });
});

describe('markOffer', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const season = {
    number: 1,
    videos: [video('e1', 1, 1), video('e2', 1, 2), video('e3', 1, 3, '2026-12-01')],
  };

  it('offers the episode and the season episodes that are out', () => {
    const offer = markOffer(season.videos[0]!, season, (id) => id === 'e1', now);
    expect(offer).toMatchObject({ watched: true, allWatched: false, season: 1 });
    expect(offer.out.map((v) => v.id)).toEqual(['e1', 'e2']);
    expect(markOffer(season.videos[1]!, season, () => true, now).allWatched).toBe(true);
  });

  it('offers no season mark for Specials, unnumbered videos or one episode out', () => {
    expect(markOffer(season.videos[0]!, { ...season, number: 0 }, () => false, now).season).toBe(
      undefined,
    );
    expect(
      markOffer(season.videos[0]!, { ...season, number: null }, () => false, now).season,
    ).toBeUndefined();
    const single = { number: 2, videos: [video('e1', 2, 1)] };
    expect(markOffer(single.videos[0]!, single, () => false, now).season).toBeUndefined();
  });
});

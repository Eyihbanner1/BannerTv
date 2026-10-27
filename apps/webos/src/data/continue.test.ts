import {
  createPlayedVideos,
  createProgressStore,
  memoryKeyValueStore,
  playedCard,
  type QueryState,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  time: 0,
  progress: null as unknown as ReturnType<typeof createProgressStore>,
  played: null as unknown as ReturnType<typeof createPlayedVideos>,
}));

/** Meta answers by title id; an id missing here never answers. */
const metas = vi.hoisted(() => ({ answers: new Map<string, MetaDetail>(), asked: [] as string[] }));

vi.mock('./playback', () => ({
  get progress() {
    return stores.progress;
  },
  get playedVideos() {
    return stores.played;
  },
}));

vi.mock('./addons', () => ({
  addonClient: {
    meta(_type: string, id: string) {
      metas.asked.push(id);
      const data = metas.answers.get(id);
      const state: QueryState<MetaDetail> = data
        ? { status: 'success', data, stale: false }
        : { status: 'loading', stale: false };
      return { get: () => state, subscribe: () => () => undefined, load: () => undefined };
    },
  },
}));

// Fresh each test: the module remembers what it asked for this session.
let fillPlayedCards: () => void;

function preview(id: string, type: 'movie' | 'series'): MetaPreview {
  return { id, type, name: id, posterShape: 'poster', genres: [], trailers: [] };
}

function meta(id: string, type: 'movie' | 'series', videos: Video[] = []): MetaDetail {
  return {
    ...preview(id, type),
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: false },
  };
}

const ep = (show: string, season: number, episode: number): Video => ({
  id: `${show}:${season}:${episode}`,
  season,
  episode,
});

function watch(metaId: string, type: 'movie' | 'series', videoId: string, position: number) {
  stores.time += 1;
  stores.progress.record({ metaId, type, videoId, position, duration: 3000 });
}

beforeEach(async () => {
  stores.time = 0;
  const now = () => stores.time;
  stores.progress = createProgressStore({ storage: memoryKeyValueStore(), now });
  stores.played = createPlayedVideos({ storage: memoryKeyValueStore(), now });
  await Promise.all([stores.progress.load(), stores.played.load()]);
  metas.answers.clear();
  metas.asked.length = 0;
  vi.resetModules();
  ({ fillPlayedCards } = await import('./continue'));
});

describe('fillPlayedCards', () => {
  it('walks past finished films to a title further back that the row would show', () => {
    watch('tt99', 'series', 'tt99:1:4', 1500);
    // Twenty-five films watched to the end since, each with its card.
    for (let i = 0; i < 25; i++) {
      const id = `tt${i}`;
      stores.played.record(playedCard(preview(id, 'movie'), id, undefined));
      watch(id, 'movie', id, 2990);
    }
    metas.answers.set('tt99', meta('tt99', 'series', [ep('tt99', 1, 4), ep('tt99', 1, 5)]));

    fillPlayedCards();
    expect(metas.asked).toEqual(['tt99']);
    expect(stores.played.get('tt99:1:4')).toMatchObject({ metaId: 'tt99', season: 1, episode: 4 });
  });

  it('stops once the row would be full, counting only titles that can be on it', () => {
    for (let i = 0; i < 25; i++) watch(`tt${i}`, 'movie', `tt${i}`, 600);
    fillPlayedCards();
    // The twenty most recent.
    expect(metas.asked).toHaveLength(20);
    expect(metas.asked[0]).toBe('tt24');
  });

  it('fills in a series card saved before its episode list arrived', () => {
    watch('tt7', 'series', 'tt7:1:2', 10);
    stores.played.record(playedCard(preview('tt7', 'series'), 'tt7:1:2', undefined));
    metas.answers.set('tt7', meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2)]));

    fillPlayedCards();
    expect(stores.played.get('tt7:1:2')).toMatchObject({ season: 1, episode: 2 });
  });

  it('saves the card under the ids the progress uses, whatever the answer says', () => {
    watch('tmdb:5', 'movie', 'tmdb:5', 600);
    metas.answers.set('tmdb:5', meta('tt5', 'movie'));

    fillPlayedCards();
    expect(stores.played.get('tmdb:5')).toMatchObject({ metaId: 'tmdb:5', type: 'movie' });
  });

  it('asks once a session, and does nothing when nothing changed', () => {
    watch('tt1', 'movie', 'tt1', 600);
    fillPlayedCards();
    fillPlayedCards();
    watch('tt2', 'movie', 'tt2', 600);
    fillPlayedCards();
    expect(metas.asked).toEqual(['tt1', 'tt2']);
  });
});

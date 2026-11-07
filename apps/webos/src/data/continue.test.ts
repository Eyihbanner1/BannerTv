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

/**
 * Meta answers by title id; an id missing here never answers. A state set in
 * `states` wins, and `answer` changes it later, as a fetch landing would.
 */
const metas = vi.hoisted(() => ({
  answers: new Map<string, MetaDetail>(),
  states: new Map<string, QueryState<MetaDetail>>(),
  listeners: new Map<string, Set<() => void>>(),
  asked: [] as string[],
}));

function answer(id: string, state: QueryState<MetaDetail>) {
  metas.states.set(id, state);
  metas.listeners.get(id)?.forEach((listener) => listener());
}

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
      const get = (): QueryState<MetaDetail> => {
        const set = metas.states.get(id);
        if (set) return set;
        const data = metas.answers.get(id);
        return data
          ? { status: 'success', data, stale: false }
          : { status: 'loading', stale: false };
      };
      const subscribe = (listener: () => void) => {
        const listeners = metas.listeners.get(id) ?? new Set();
        metas.listeners.set(id, listeners);
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      return { get, subscribe, load: () => undefined };
    },
  },
}));

// Fresh each test: the module remembers what it asked for this session.
let fillPlayedCards: () => void;
let cardsMissing: () => boolean;
let onCardAnswer: (listener: () => void) => () => void;

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
  title: `S${season}E${episode}`,
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
  metas.states.clear();
  metas.listeners.clear();
  metas.asked.length = 0;
  vi.resetModules();
  ({ fillPlayedCards, cardsMissing, onCardAnswer } = await import('./continue'));
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
    const walks = vi.spyOn(stores.progress, 'recent');
    // A pass reads the history twice: for cards missing, and for series caught up.
    fillPlayedCards();
    fillPlayedCards();
    expect(walks).toHaveBeenCalledTimes(2);
    watch('tt2', 'movie', 'tt2', 600);
    fillPlayedCards();
    expect(walks).toHaveBeenCalledTimes(4);
    expect(metas.asked).toEqual(['tt1', 'tt2']);
  });

  it('walks further back once cards that arrive take no place on the row', () => {
    watch('tt0', 'movie', 'tt0', 1200);
    // Twenty series since, each finished at its last listed episode, none with a card.
    for (let i = 1; i <= 20; i++) watch(`tt${i}`, 'series', `tt${i}:1:1`, 2990);
    fillPlayedCards();
    expect(metas.asked).toHaveLength(20);
    expect(metas.asked).not.toContain('tt0');

    // Their answers land later; the next pass (Home runs one on every new card) gets past them.
    for (let i = 1; i <= 20; i++) {
      answer(`tt${i}`, {
        status: 'success',
        data: meta(`tt${i}`, 'series', [ep(`tt${i}`, 1, 1)]),
        stale: false,
      });
    }
    fillPlayedCards();
    expect(metas.asked).toContain('tt0');
  });

  it('walks again once a pass is over when answers it had cached saved cards during it', () => {
    watch('tt0', 'movie', 'tt0', 1200);
    for (let i = 1; i <= 20; i++) {
      watch(`tt${i}`, 'series', `tt${i}:1:1`, 2990);
      metas.answers.set(`tt${i}`, meta(`tt${i}`, 'series', [ep(`tt${i}`, 1, 1)]));
    }
    fillPlayedCards();
    expect(metas.asked).toHaveLength(21);
    expect(metas.asked[20]).toBe('tt0');
  });

  it('looks again once a day at a series watched to its last listed episode', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-06T12:00:00Z') });
    try {
      watch('tt7', 'series', 'tt7:1:2', 2990);
      const seasonOne = meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2)]);
      stores.played.record(playedCard(seasonOne, 'tt7:1:2', seasonOne));
      expect(stores.played.get('tt7:1:2')?.next).toBeUndefined();
      metas.answers.set('tt7', seasonOne);

      fillPlayedCards();
      expect(metas.asked).toEqual(['tt7']);
      expect(stores.played.get('tt7:1:2')?.next).toBeUndefined();
      // Nothing new the same day, however often Home shows.
      fillPlayedCards();
      expect(metas.asked).toEqual(['tt7']);

      // A day on, season 2 is listed: the card learns of it, and is not marked filled.
      vi.setSystemTime(Date.parse('2026-11-07T12:00:01Z'));
      metas.answers.set('tt7', meta('tt7', 'series', [...seasonOne.videos, ep('tt7', 2, 1)]));
      fillPlayedCards();
      expect(metas.asked).toEqual(['tt7', 'tt7']);
      expect(stores.played.get('tt7:1:2')).toMatchObject({
        next: { videoId: 'tt7:2:1', season: 2, episode: 1 },
      });
      expect(stores.played.get('tt7:1:2')?.filled).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not look again at a series whose card it has just made', () => {
    watch('tt7', 'series', 'tt7:1:2', 2990);
    metas.answers.set('tt7', meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2)]));
    fillPlayedCards();
    fillPlayedCards();
    expect(metas.asked).toEqual(['tt7']);
    expect(stores.played.get('tt7:1:2')).toMatchObject({ episode: 2, filled: true });
  });

  it('waits for the fresh answer when the cached one is old', () => {
    watch('tt7', 'series', 'tt7:1:2', 2990);
    const cached = meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2)]);
    metas.states.set('tt7', { status: 'success', data: cached, stale: true });
    fillPlayedCards();
    expect(stores.played.get('tt7:1:2')).toBeUndefined();

    const fresh = meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2), ep('tt7', 1, 3)]);
    answer('tt7', { status: 'success', data: fresh, stale: false });
    expect(stores.played.get('tt7:1:2')?.next).toMatchObject({ videoId: 'tt7:1:3' });
  });

  it('asks no addon about a video kept off the row, such as a sports replay', () => {
    // Twenty films played before it: a replay taking a place would leave the oldest out.
    for (let i = 0; i < 20; i++) watch(`tt${i}`, 'movie', `tt${i}`, 600);
    stores.time += 1;
    stores.progress.record({
      metaId: 'tsport:replay',
      type: 'sport',
      videoId: 'tsport:replay',
      position: 600,
      duration: 3000,
      continueRow: false,
    });

    fillPlayedCards();
    expect(metas.asked).not.toContain('tsport:replay');
    expect(metas.asked).toHaveLength(20);
    expect(stores.played.get('tsport:replay')).toBeUndefined();
  });

  it('saves from the cached answer when the fresh one fails', () => {
    watch('tt7', 'series', 'tt7:1:2', 2990);
    const cached = meta('tt7', 'series', [ep('tt7', 1, 1), ep('tt7', 1, 2)]);
    metas.states.set('tt7', { status: 'success', data: cached, stale: true });
    fillPlayedCards();
    answer('tt7', { status: 'success', data: cached, stale: true, error: new Error('offline') });
    expect(stores.played.get('tt7:1:2')).toMatchObject({ season: 1, episode: 2 });
  });
});

describe('cardsMissing', () => {
  it('holds while a title is still to be asked for or its answer has not come', () => {
    watch('tt5', 'movie', 'tt5', 600);
    expect(cardsMissing()).toBe(true);
    fillPlayedCards();
    expect(cardsMissing()).toBe(true);
  });

  it('lets go once the answer comes without a card, and says so', () => {
    watch('tt5', 'movie', 'tt5', 600);
    const answers = vi.fn();
    onCardAnswer(answers);
    fillPlayedCards();
    answer('tt5', { status: 'error', error: new Error('offline'), stale: false });
    expect(answers).toHaveBeenCalledTimes(1);
    expect(stores.played.get('tt5')).toBeUndefined();
    expect(cardsMissing()).toBe(false);
  });

  it('lets go once a card arrives, and says so after saving it', () => {
    watch('tt5', 'movie', 'tt5', 600);
    let saved: unknown;
    onCardAnswer(() => (saved = stores.played.get('tt5')));
    fillPlayedCards();
    answer('tt5', { status: 'success', data: meta('tt5', 'movie'), stale: false });
    expect(saved).toMatchObject({ metaId: 'tt5' });
    expect(cardsMissing()).toBe(false);
  });

  it('lets go of a series card the answer could not place, which is never on the row', () => {
    watch('tt7', 'series', 'tt7:9:9', 2990);
    fillPlayedCards();
    answer('tt7', {
      status: 'success',
      data: meta('tt7', 'series', [ep('tt7', 1, 1)]),
      stale: false,
    });
    expect(stores.played.get('tt7:9:9')?.episode).toBeUndefined();
    expect(cardsMissing()).toBe(false);
  });

  it('holds for nothing while a video kept off the row has no card', () => {
    stores.time += 1;
    stores.progress.record({
      metaId: 'tsport:replay',
      type: 'sport',
      videoId: 'tsport:replay',
      position: 600,
      duration: 3000,
      continueRow: false,
    });
    expect(cardsMissing()).toBe(false);
  });

  it('holds for nothing when every title already has its card', () => {
    stores.played.record(playedCard(preview('tt5', 'movie'), 'tt5', undefined));
    watch('tt5', 'movie', 'tt5', 600);
    expect(cardsMissing()).toBe(false);
  });
});

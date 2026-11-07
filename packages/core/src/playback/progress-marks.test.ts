import { describe, expect, it, vi } from 'vitest';
import { historyView } from '../library/views';
import { memoryKeyValueStore } from '../storage';
import { continueWatching, type PlayedVideo } from './continue';
import { createProgressStore, isUnmarked, type ProgressMark } from './progress';

function mark(videoId: string, metaId = 'tt9'): ProgressMark {
  return { metaId, type: 'series', videoId };
}

function episodeCard(videoId: string, episode: number, next?: string): PlayedVideo {
  const card: PlayedVideo = {
    videoId,
    metaId: 'tt9',
    type: 'series',
    name: 'A Show',
    season: 1,
    episode,
    updatedAt: 1,
  };
  if (next) card.next = { videoId: next, season: 1, episode: episode + 1 };
  return card;
}

async function store(time: { now: number }) {
  const progress = createProgressStore({ storage: memoryKeyValueStore(), now: () => time.now });
  await progress.load();
  return progress;
}

describe('marking watched and not watched', () => {
  it('puts a video marked watched at its end, a millisecond apart in the order given', async () => {
    const time = { now: 10_000 };
    const progress = await store(time);
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e1', position: 60, duration: 2400 });
    progress.mark([mark('e1'), mark('e2')], true);
    expect(progress.get('e1')).toEqual({
      metaId: 'tt9',
      type: 'series',
      videoId: 'e1',
      position: 2400,
      duration: 2400,
      updatedAt: 9_999,
      watched: true,
    });
    // Never played: its length is unknown, and stays so.
    expect(progress.get('e2')).toMatchObject({ position: 0, duration: 0, updatedAt: 10_000 });
    expect(progress.resumeAt('e1')).toBeUndefined();
    expect(progress.recent()[0]!.videoId).toBe('e2');
  });

  it('times a video marked not watched, which playing it again outdates', async () => {
    const time = { now: 10_000 };
    const progress = await store(time);
    progress.mark([mark('e1')], true);
    progress.mark([mark('e1'), mark('e5')], false);
    expect(progress.get('e1')).toMatchObject({
      watched: false,
      position: 0,
      updatedAt: 9_999,
      unmarkedAt: 9_999,
    });
    expect(isUnmarked(progress.get('e1'))).toBe(true);
    // Ticked on Trakt only: it gets an entry, so the tick no longer shows.
    expect(progress.get('e5')).toMatchObject({ watched: false, duration: 0, unmarkedAt: 10_000 });

    time.now = 20_000;
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e1', position: 90, duration: 2400 });
    // Kept, but older than the save: it no longer counts.
    expect(progress.get('e1')?.unmarkedAt).toBe(9_999);
    expect(isUnmarked(progress.get('e1'))).toBe(false);
  });

  it('keeps the mark not watched across launches', async () => {
    const storage = memoryKeyValueStore();
    const progress = createProgressStore({ storage, now: () => 5_000 });
    await progress.load();
    progress.mark([mark('e1')], false);
    await vi.waitFor(async () => expect(await storage.get('progress')).toHaveLength(1));
    const again = createProgressStore({ storage });
    await again.load();
    expect(isUnmarked(again.get('e1'))).toBe(true);
  });

  it('leaves the viewer where they are up to when earlier episodes are marked watched', async () => {
    const time = { now: 10_000 };
    const progress = await store(time);
    progress.record({
      metaId: 'tt9',
      type: 'series',
      videoId: 'e5',
      position: 600,
      duration: 2400,
    });
    time.now = 20_000;
    progress.mark([mark('e1'), mark('e2')], true, 'e5');
    expect(progress.recent().map((entry) => entry.videoId)).toEqual(['e5', 'e2', 'e1']);
    // Restamped only, so the account takes it as the latest and it still resumes.
    expect(progress.get('e5')).toMatchObject({ position: 600, updatedAt: 20_000 });
    expect(progress.get('e2')!.updatedAt).toBeLessThan(20_000);
  });

  it('keeps a video kept off Continue Watching off it when marked', async () => {
    const time = { now: 10_000 };
    const progress = await store(time);
    progress.record({
      metaId: 'tt9',
      type: 'series',
      videoId: 'e1',
      position: 60,
      duration: 2400,
      continueRow: false,
    });
    progress.mark([mark('e1')], true);
    expect(progress.get('e1')?.continueRow).toBe(false);
  });
});

describe('the time marked not watched', () => {
  it('is never dropped: starting over and Trakt progress keep it', async () => {
    const time = { now: 1_000 };
    const progress = await store(time);
    progress.mark([mark('e1')], false);
    time.now = 2_000;
    progress.clear('e1');
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e1', position: 5, duration: 2400 });
    expect(progress.get('e1')).toMatchObject({ position: 5, unmarkedAt: 1_000 });
    await progress.merge([
      {
        metaId: 'tt9',
        type: 'series',
        videoId: 'e1',
        position: 2400,
        duration: 2400,
        updatedAt: 3_000,
        watched: true,
        from: 'trakt',
      },
    ]);
    expect(progress.get('e1')).toMatchObject({ watched: true, unmarkedAt: 1_000 });
    // Marked watched, it keeps the time too.
    progress.mark([mark('e1')], true);
    expect(progress.get('e1')?.unmarkedAt).toBe(1_000);
  });
});

describe('taking a title off Continue Watching', () => {
  it('marks its latest entry to stay off the row, with a fresh time', async () => {
    const time = { now: 1_000 };
    const progress = await store(time);
    expect(progress.leaveRow('tt9')).toBe(false);
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e1', position: 60, duration: 2400 });
    time.now = 2_000;
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e2', position: 90, duration: 2400 });
    time.now = 3_000;
    expect(progress.leaveRow('tt9')).toBe(true);
    expect(progress.get('e2')).toMatchObject({
      position: 90,
      continueRow: false,
      updatedAt: 3_000,
    });
    expect(progress.get('e1')?.continueRow).toBeUndefined();
    const cards = new Map([['e2', episodeCard('e2', 2)]]);
    expect(continueWatching(progress, (id) => cards.get(id), 3_000)).toEqual([]);
    // Played again, it is back.
    time.now = 4_000;
    progress.record({ metaId: 'tt9', type: 'series', videoId: 'e2', position: 95, duration: 2400 });
    expect(continueWatching(progress, (id) => cards.get(id), 4_000)).toHaveLength(1);
  });

  it('drops the Trakt mark, so the choice is this screen own', async () => {
    const progress = await store({ now: 9_000 });
    await progress.merge([
      {
        metaId: 'tt1',
        type: 'movie',
        videoId: 'tt1',
        position: 600,
        duration: 3000,
        updatedAt: 2_000,
        watched: false,
        from: 'trakt',
      },
    ]);
    progress.leaveRow('tt1');
    expect(progress.get('tt1')?.from).toBeUndefined();
  });
});

describe('Continue Watching and History with marks', () => {
  it('offers the episode after one marked watched, even of unknown length', async () => {
    const progress = await store({ now: 5_000 });
    progress.mark([mark('e1')], true);
    const cards = new Map([['e1', episodeCard('e1', 1, 'e2')]]);
    expect(continueWatching(progress, (id) => cards.get(id), 5_000)).toEqual([
      expect.objectContaining({ videoId: 'e2', upNext: true, startAt: 0 }),
    ]);
  });

  it('passes over episodes marked not watched for where the viewer is up to', async () => {
    const time = { now: 1_000 };
    const progress = await store(time);
    progress.record({
      metaId: 'tt9',
      type: 'series',
      videoId: 'e3',
      position: 600,
      duration: 2400,
    });
    time.now = 2_000;
    progress.mark([mark('e1')], false);
    const cards = new Map([
      ['e1', episodeCard('e1', 1)],
      ['e3', episodeCard('e3', 3)],
    ]);
    expect(continueWatching(progress, (id) => cards.get(id), 2_000)).toEqual([
      expect.objectContaining({ videoId: 'e3', startAt: 600 }),
    ]);
    expect(historyView(progress.recent(), (id) => cards.get(id), 'all')).toHaveLength(1);
  });
});

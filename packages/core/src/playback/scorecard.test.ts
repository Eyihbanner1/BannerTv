import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import {
  createPlayScorecard,
  MAX_PLAYS,
  type PlayRecord,
  summarisePlays,
  TARGET_START_MS,
} from './scorecard';

/** Lets the scorecard's write, which waits for its load, finish. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const play = (over: Partial<PlayRecord> = {}): PlayRecord => ({
  at: 1_700_000_000_000,
  kind: 'film',
  outcome: 'played',
  startMs: 1500,
  playedS: 1800,
  waits: 0,
  waitMs: 0,
  failovers: 0,
  stepDowns: 0,
  retries: 0,
  audioChanged: false,
  subtitlesChanged: false,
  ...over,
});

describe('summarisePlays', () => {
  it('gives the middle start time and the share that started within the target', () => {
    const summary = summarisePlays([
      play({ startMs: 900 }),
      play({ startMs: TARGET_START_MS }),
      play({ startMs: 4000 }),
      play({ startMs: 6000 }),
    ]);
    expect(summary.medianStartMs).toBe(3000);
    expect(summary.quickStarts).toBe(0.5);
    expect(summary.plays).toBe(4);
  });

  it('counts waits per hour played, once enough has played to say', () => {
    const summary = summarisePlays([
      play({ playedS: 3600, waits: 3, waitMs: 9000 }),
      play({ playedS: 3600, waits: 1, waitMs: 1000 }),
    ]);
    expect(summary.hours).toBe(2);
    expect(summary.waitsPerHour).toBe(2);
    expect(summary.waitSecondsPerHour).toBe(5);
    expect(summarisePlays([play({ playedS: 60, waits: 1, waitMs: 2000 })]).waitsPerHour).toBe(
      undefined,
    );
  });

  it('leaves plays left before the picture out of the averages, and counts them apart', () => {
    const summary = summarisePlays([
      play({ outcome: 'left', startMs: undefined, playedS: 0 }),
      play({ outcome: 'failed', startMs: undefined, playedS: 0, failovers: 3 }),
      play({ audioChanged: true, subtitlesChanged: true, retries: 1, stepDowns: 1 }),
    ]);
    expect(summary).toMatchObject({
      plays: 2,
      left: 1,
      failed: 1,
      failovers: 3,
      stepDowns: 1,
      retries: 1,
      audioChanged: 1,
      subtitlesChanged: 1,
      medianStartMs: 1500,
      quickStarts: 1,
    });
  });

  it('says nothing of start times with no picture yet', () => {
    expect(summarisePlays([]).medianStartMs).toBe(undefined);
    expect(summarisePlays([]).quickStarts).toBe(undefined);
  });
});

describe('createPlayScorecard', () => {
  it('keeps the newest plays first, at most MAX_PLAYS, and reads them back', async () => {
    const storage = memoryKeyValueStore();
    const card = createPlayScorecard({ storage });
    await card.load();
    for (let i = 0; i < MAX_PLAYS + 5; i++) card.record(play({ at: i }));
    await flush();
    expect(card.plays()).toHaveLength(MAX_PLAYS);
    expect(card.plays()[0]!.at).toBe(MAX_PLAYS + 4);
    const again = createPlayScorecard({ storage });
    await again.load();
    expect(again.plays().map((p) => p.at)).toEqual(card.plays().map((p) => p.at));
  });

  it('keeps a play recorded before loading ahead of those stored', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-scorecard', { v: 1, plays: [play({ at: 1 })] });
    const card = createPlayScorecard({ storage });
    card.record(play({ at: 2 }));
    await card.load();
    expect(card.plays().map((p) => p.at)).toEqual([2, 1]);
  });

  it('refuses what is not a play, and drops stored plays that are not', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-scorecard', {
      v: 1,
      plays: [play({ at: 1 }), { at: 'soon' }, { ...play(), kind: 'trailer' }, null],
    });
    const card = createPlayScorecard({ storage });
    await card.load();
    expect(card.plays()).toHaveLength(1);
    expect(card.record({ ...play(), waits: -1 })).toBe(false);
    expect(card.record({ ...play(), url: 'https://debrid.example/key' } as PlayRecord)).toBe(true);
    expect(Object.keys(card.plays()[0]!)).not.toContain('url');
  });

  it('starts empty on a stored copy of another version', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('playback-scorecard', { v: 2, plays: [play()] });
    const card = createPlayScorecard({ storage });
    await card.load();
    expect(card.plays()).toEqual([]);
  });
});

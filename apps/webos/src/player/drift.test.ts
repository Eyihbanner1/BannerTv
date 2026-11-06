import { memoryKeyValueStore } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { createSubtitleDrifts, DRIFT_RATES, MAX_SUBTITLE_DRIFTS, stretchCues } from './drift';

const line = (text: string) => [[{ text }]];

describe('stretchCues', () => {
  it('leaves the cues as they are without a drift fix', () => {
    const cues = [{ start: 1, end: 2, lines: line('a') }];
    expect(stretchCues(cues, null)).toBe(cues);
  });

  it('moves a PAL file onto a film-speed video: lines that came early come later, more so later on', () => {
    const cues = [
      { start: 60, end: 62, lines: line('early') },
      { start: 6000, end: 6002, lines: line('late'), top: true },
    ];
    const [early, late] = stretchCues(cues, 'ahead');
    // A line the PAL file has at 100 minutes is spoken at 104 min 16 s in the film.
    expect(late!.start).toBeCloseTo(6256.25, 6);
    expect(late!.top).toBe(true);
    expect(early!.start).toBeCloseTo(62.5625, 3);
    expect(early!.end - early!.start).toBeCloseTo(2 / DRIFT_RATES.ahead, 6);
  });

  it('undoes one fix with the other', () => {
    expect(DRIFT_RATES.ahead * DRIFT_RATES.behind).toBeCloseTo(1, 12);
    const [cue] = stretchCues(
      stretchCues([{ start: 3600, end: 3601, lines: line('x') }], 'ahead'),
      'behind',
    );
    expect(cue!.start).toBeCloseTo(3600, 9);
  });
});

describe('createSubtitleDrifts', () => {
  it('keeps each file’s drift fix, forgets a fix taken off, and reads it back', async () => {
    const storage = memoryKeyValueStore();
    const drifts = createSubtitleDrifts({ storage });
    await drifts.remember('a', 'ahead');
    await drifts.remember('b', 'behind');
    expect(drifts.get('a')).toBe('ahead');
    expect(drifts.get('b')).toBe('behind');
    expect(drifts.get('c')).toBeUndefined();
    await drifts.remember('a', null);
    expect(drifts.get('a')).toBeUndefined();
    expect(await storage.get('subtitleDrift')).toEqual([{ key: 'b', drift: 'behind' }]);

    const again = createSubtitleDrifts({ storage });
    await again.load();
    expect(again.get('b')).toBe('behind');
  });

  it('drops damaged entries and the least recently changed past the limit', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleDrift', [
      { key: 'old', drift: 'ahead' },
      { key: '', drift: 'ahead' },
      { key: 'odd', drift: 'sideways' },
      { key: 'twice', drift: 'ahead' },
      { key: 'twice', drift: 'behind' },
      null,
    ]);
    const drifts = createSubtitleDrifts({ storage });
    await drifts.load();
    expect(drifts.get('twice')).toBe('behind');
    expect(drifts.get('odd')).toBeUndefined();
    for (let i = 0; i < MAX_SUBTITLE_DRIFTS; i++) await drifts.remember(`f${i}`, 'ahead');
    expect(drifts.get('old')).toBeUndefined();
    expect(drifts.get(`f${MAX_SUBTITLE_DRIFTS - 1}`)).toBe('ahead');
  });

  it('tells its listeners of a change, and not of a choice that changes nothing', async () => {
    const drifts = createSubtitleDrifts({ storage: memoryKeyValueStore() });
    await drifts.load();
    let told = 0;
    const stop = drifts.subscribe(() => told++);
    await drifts.remember('a', 'ahead');
    await drifts.remember('a', 'ahead');
    await drifts.remember('b', null);
    stop();
    expect(told).toBe(1);
  });
});

import { memoryKeyValueStore } from '@bannertv/core';
import { describe, expect, it } from 'vitest';
import { createSubtitleDrifts, DRIFT_RATES, stretchCues } from './drift';

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

describe('the drift store', () => {
  it('is the core one, under the same key, so fixes kept before still read', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('subtitleDrift', [{ key: 'a', drift: 'ahead' }]);
    const drifts = createSubtitleDrifts({ storage });
    await drifts.load();
    expect(drifts.get('a')).toBe('ahead');
  });
});

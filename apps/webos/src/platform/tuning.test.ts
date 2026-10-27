import { describe, expect, it } from 'vitest';
import { applyTuning, changedTuning, parseTuning, TUNING_DEFAULTS } from './tuning';

describe('parseTuning', () => {
  it('uses the defaults when nothing is stored or it is unreadable', () => {
    expect(parseTuning(null)).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('not json')).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('"jump"')).toEqual(TUNING_DEFAULTS);
  });

  it('takes valid switches and keeps the default for the rest', () => {
    expect(parseTuning('{"motion":"jump","heroDelayMs":600,"heroPan":false}')).toEqual({
      ...TUNING_DEFAULTS,
      motion: 'jump',
      heroDelayMs: 600,
      heroPan: false,
    });
  });

  it('ignores values out of range or of the wrong kind', () => {
    const value = parseTuning(
      '{"motion":"fly","zoom":1,"heroDelayMs":-5,"rowsAround":"3","overscan":99,"heroPan":"no"}',
    );
    expect(value).toEqual(TUNING_DEFAULTS);
  });
});

describe('changedTuning', () => {
  it('lists only the switches that differ from the defaults', () => {
    expect(changedTuning({ ...TUNING_DEFAULTS })).toEqual({});
    expect(changedTuning({ ...TUNING_DEFAULTS, zoom: 'off', overscan: 1 })).toEqual({
      zoom: 'off',
      overscan: 1,
    });
  });
});

describe('applyTuning', () => {
  it('adds a class for each CSS switch that is not the default', () => {
    const classes: string[] = [];
    const root = {
      classList: { add: (name: string) => classes.push(name) },
    } as unknown as HTMLElement;
    applyTuning(root, { ...TUNING_DEFAULTS });
    expect(classes).toEqual([]);
    applyTuning(root, { ...TUNING_DEFAULTS, motion: 'layer', zoom: 'instant', heroPan: false });
    expect(classes).toEqual(['tune-motion-layer', 'tune-zoom-instant', 'tune-no-pan']);
  });
});

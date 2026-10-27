import { describe, expect, it } from 'vitest';
import { applyTuning, changedTuning, parseTuning, TUNING_DEFAULTS } from './tuning';

describe('TUNING_DEFAULTS', () => {
  it('keeps what shipped before the switches existed', () => {
    expect(TUNING_DEFAULTS).toEqual({
      motion: 'slide',
      zoom: 'animate',
      heroDelayMs: 250,
      heroBusyMs: 250,
      heroArt: 'large',
      heroPan: true,
      rowsAround: 2,
      overscan: 2,
      decoding: 'auto',
      mips: true,
    });
  });
});

describe('parseTuning', () => {
  it('uses the defaults when nothing is stored or it is unreadable', () => {
    expect(parseTuning(null)).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('not json')).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('"jump"')).toEqual(TUNING_DEFAULTS);
  });

  it('takes valid switches and keeps the default for the rest', () => {
    expect(
      parseTuning(
        '{"motion":"jump","heroDelayMs":600,"heroBusyMs":800,"heroArt":"medium","heroPan":false,"decoding":"async","mips":false}',
      ),
    ).toEqual({
      ...TUNING_DEFAULTS,
      motion: 'jump',
      heroDelayMs: 600,
      heroBusyMs: 800,
      heroArt: 'medium',
      heroPan: false,
      decoding: 'async',
      mips: false,
    });
  });

  it('ignores values out of range or of the wrong kind', () => {
    const value = parseTuning(
      '{"motion":"fly","zoom":1,"heroDelayMs":-5,"heroBusyMs":9999,"heroArt":"small","rowsAround":"3","overscan":99,"heroPan":"no","decoding":"sync","mips":0}',
    );
    expect(value).toEqual(TUNING_DEFAULTS);
    // Every row and tile beside focus is always drawn, so 0 would mean nothing.
    expect(parseTuning('{"rowsAround":0,"overscan":0}')).toEqual(TUNING_DEFAULTS);
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
    applyTuning(root, {
      ...TUNING_DEFAULTS,
      motion: 'layer',
      zoom: 'instant',
      heroPan: false,
      mips: false,
    });
    expect(classes).toEqual([
      'tune-motion-layer',
      'tune-zoom-instant',
      'tune-no-pan',
      'tune-no-mips',
    ]);
  });
});

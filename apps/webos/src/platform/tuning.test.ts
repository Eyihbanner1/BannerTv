import { describe, expect, it } from 'vitest';
import { applyTuning, changedTuning, parseTuning, TUNING_DEFAULTS } from './tuning';

describe('TUNING_DEFAULTS', () => {
  it('are the lightest set the TV comparison chose', () => {
    expect(TUNING_DEFAULTS).toEqual({
      motion: 'jump',
      zoom: 'instant',
      heroDelayMs: 250,
      heroBusyMs: 800,
      heroArt: 'medium',
      wideArt: 'medium',
      heroPan: false,
      rowsAround: 2,
      overscan: 2,
      decoding: 'auto',
      mips: false,
      homeLayer: false,
      decodeAhead: true,
      heroFade: false,
      marks: false,
      idbPrune: 'open',
      idbRelaxed: false,
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
        '{"motion":"slide","heroDelayMs":600,"heroBusyMs":250,"heroArt":"large","wideArt":"small","heroPan":true,"decoding":"async","mips":true,"homeLayer":true,"decodeAhead":false,"heroFade":true,"marks":true}',
      ),
    ).toEqual({
      ...TUNING_DEFAULTS,
      motion: 'slide',
      heroDelayMs: 600,
      heroBusyMs: 250,
      heroArt: 'large',
      wideArt: 'small',
      heroPan: true,
      decoding: 'async',
      mips: true,
      homeLayer: true,
      decodeAhead: false,
      heroFade: true,
      marks: true,
    });
  });

  it('ignores values out of range or of the wrong kind', () => {
    const value = parseTuning(
      '{"motion":"fly","zoom":1,"heroDelayMs":-5,"heroBusyMs":9999,"heroArt":"small","wideArt":"large","rowsAround":"3","overscan":99,"heroPan":"no","decoding":"sync","mips":0,"homeLayer":1,"decodeAhead":"yes","heroFade":null,"marks":[]}',
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
  function classesFor(value: Parameters<typeof applyTuning>[1]): string[] {
    const classes: string[] = [];
    const root = {
      classList: { add: (name: string) => classes.push(name) },
    } as unknown as HTMLElement;
    applyTuning(root, value);
    return classes;
  }

  it('adds a class for each CSS switch away from what the stylesheets draw', () => {
    expect(classesFor({ ...TUNING_DEFAULTS })).toEqual([
      'tune-motion-jump',
      'tune-zoom-instant',
      'tune-no-pan',
      'tune-no-mips',
      'tune-no-hero-fade',
    ]);
    expect(classesFor({ ...TUNING_DEFAULTS, motion: 'layer', zoom: 'off' })).toEqual([
      'tune-motion-layer',
      'tune-zoom-off',
      'tune-no-pan',
      'tune-no-mips',
      'tune-no-hero-fade',
    ]);
    expect(classesFor({ ...TUNING_DEFAULTS, homeLayer: true, heroFade: true })).toEqual([
      'tune-motion-jump',
      'tune-zoom-instant',
      'tune-no-pan',
      'tune-no-mips',
      'tune-home-layer',
    ]);
    // Switches that work in code add no class.
    expect(classesFor({ ...TUNING_DEFAULTS, decodeAhead: false, marks: true })).toEqual(
      classesFor({ ...TUNING_DEFAULTS }),
    );
    expect(
      classesFor({
        ...TUNING_DEFAULTS,
        motion: 'slide',
        zoom: 'animate',
        heroPan: true,
        mips: true,
        heroFade: true,
      }),
    ).toEqual([]);
  });
});

// Launch switches (speed pass, U2), kept apart so they merge cleanly with other switches.
describe('the launch switches', () => {
  it('default to what shipped before them', () => {
    expect(TUNING_DEFAULTS.idbPrune).toBe('open');
    expect(TUNING_DEFAULTS.idbRelaxed).toBe(false);
  });

  it('take valid values and keep the default for the rest', () => {
    expect(parseTuning('{"idbPrune":"later"}')).toEqual({ ...TUNING_DEFAULTS, idbPrune: 'later' });
    expect(parseTuning('{"idbPrune":"never"}')).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('{"idbPrune":true}')).toEqual(TUNING_DEFAULTS);
    expect(parseTuning('{"idbRelaxed":true}')).toEqual({ ...TUNING_DEFAULTS, idbRelaxed: true });
    expect(parseTuning('{"idbRelaxed":"yes"}')).toEqual(TUNING_DEFAULTS);
  });

  it('are listed when changed', () => {
    expect(changedTuning({ ...TUNING_DEFAULTS, idbPrune: 'later', idbRelaxed: true })).toEqual({
      idbPrune: 'later',
      idbRelaxed: true,
    });
  });
});

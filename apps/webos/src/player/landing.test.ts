import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  againFor,
  aimFor,
  clearLandings,
  createLandingWatch,
  describeLanding,
  judgeReading,
  LANDING_DEFAULT,
  LANDING_KEY,
  type Landing,
  type LandingBounds,
  type LandingMode,
  LANDINGS_KEPT,
  landingStream,
  learnFrom,
  logLanding,
  NOTHING_LEARNT,
  parseLandingMode,
  readLandingMode,
  recentLandings,
} from './landing';

/** A two-hour film. */
const film: LandingBounds = { duration: 7200, window: null };
/** A broadcast that a rewind may take back to 7006, live at 7200, with no end. */
const broadcast: LandingBounds = { duration: Infinity, window: { start: 7006, live: 7200 } };

const stream = { engine: 'native', container: 'mkv' as const, sizeGb: 22.1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the tester switch', () => {
  it('ships learn', () => {
    expect(LANDING_DEFAULT).toBe('learn');
  });

  it('takes each mode, and the default for anything else', () => {
    expect(parseLandingMode('measure')).toBe('measure');
    expect(parseLandingMode('again')).toBe('again');
    expect(parseLandingMode(' Again ')).toBe('again');
    expect(parseLandingMode('learn')).toBe('learn');
    for (const raw of [null, '', 'fast', '"again"', '{"mode":"again"}']) {
      expect(parseLandingMode(raw)).toBe(LANDING_DEFAULT);
    }
  });

  it('is read from storage, and is the default when storage is missing or blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === LANDING_KEY ? 'measure' : null),
    });
    expect(readLandingMode()).toBe('measure');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readLandingMode()).toBe(LANDING_DEFAULT);
    vi.stubGlobal('localStorage', undefined);
    expect(readLandingMode()).toBe(LANDING_DEFAULT);
  });
});

describe('aimFor', () => {
  it('leaves a jump alone with nothing learnt, or less than the clock tick', () => {
    expect(aimFor(1800, 0, 600, film)).toBe(1800);
    expect(aimFor(1800, 0.4, 600, film)).toBe(1800);
    expect(aimFor(1800, -0.4, 600, film)).toBe(1800);
    expect(aimFor(1800, NaN, 600, film)).toBe(1800);
  });

  it('sends a jump further by the gap, whichever way the viewer jumps', () => {
    expect(aimFor(1800, 4, 600, film)).toBe(1804);
    expect(aimFor(590, 4, 600, film)).toBe(594);
    expect(aimFor(1800, -2, 600, film)).toBe(1798);
  });

  it("never passes the film's last second, nor goes before 0", () => {
    expect(aimFor(7197, 4, 7000, film)).toBe(7199);
    expect(aimFor(1, -3, 30, film)).toBe(0);
  });

  it('never passes live on a broadcast, nor goes before what a rewind may reach', () => {
    expect(aimFor(7198, 4, 7100, broadcast)).toBe(7200);
    expect(aimFor(7008, -4, 7100, broadcast)).toBe(7006);
    expect(aimFor(7100, 4, 7050, broadcast)).toBe(7104);
  });

  it('never turns a jump round', () => {
    // Forward to the end, where a gap the other way would send it back past where it was.
    expect(aimFor(7199, -4, 7197, film)).toBe(7199);
    // Forward to live on a broadcast.
    expect(aimFor(7200, -5, 7197, broadcast)).toBe(7200);
  });
});

describe('learnFrom', () => {
  it('takes the first landing as the gap, then a running average', () => {
    const first = learnFrom(NOTHING_LEARNT, 1800, 1796);
    expect(first).toEqual({ seconds: 4, landings: 1 });
    const second = learnFrom(first, 2400, 2398);
    expect(second).toEqual({ seconds: 3, landings: 2 });
    expect(learnFrom(second, 3000, 2997)).toEqual({ seconds: 3, landings: 3 });
  });

  it('counts short as short whichever way the viewer jumped', () => {
    // Back from 2400 to 2300, sent to 2304 and landed at 2300: four short.
    expect(learnFrom(NOTHING_LEARNT, 2304, 2300).seconds).toBe(4);
  });

  it('keeps the gap while jumps land well with it, and decays toward landings on their aim', () => {
    let gap = { seconds: 4, landings: 4 };
    // Sent to 1804 for 1800 and landed at 1800: the allowance was right.
    expect(learnFrom(gap, 1804, 1800)).toEqual(gap);
    // Landing where it was sent shows none is needed: a quarter of the way down each time.
    gap = learnFrom(gap, 1804, 1804);
    expect(gap.seconds).toBe(3);
    gap = learnFrom(gap, 1803, 1803);
    expect(gap.seconds).toBe(2.25);
  });

  it('lets misses the other way cancel out', () => {
    expect(learnFrom({ seconds: 4, landings: 1 }, 1800, 1804).seconds).toBe(0);
  });

  it('never passes the cap', () => {
    expect(learnFrom(NOTHING_LEARNT, 1800, 1780).seconds).toBe(8);
    expect(learnFrom(NOTHING_LEARNT, 1800, 1820).seconds).toBe(-8);
  });

  it('learns nothing from a landing too wild to be a keyframe', () => {
    const gap = { seconds: 3, landings: 2 };
    expect(learnFrom(gap, 1800, 1755)).toBe(gap);
    expect(learnFrom(gap, 1800, NaN)).toBe(gap);
  });
});

describe('againFor', () => {
  it('jumps again only after a miss of more than a second', () => {
    expect(againFor(1800, 1800, 1799.2, film)).toBeUndefined();
    expect(againFor(1800, 1800, 1800.9, film)).toBeUndefined();
  });

  it('sends the second further by the miss than the first was sent', () => {
    expect(againFor(1800, 1800, 1796, film)).toBe(1804);
    expect(againFor(1800, 1800, 1803, film)).toBe(1797);
    // A first jump already sent past its target goes further still.
    expect(againFor(1800, 1802, 1797, film)).toBe(1805);
  });

  it('keeps the second to the film, and makes none with nowhere new to go', () => {
    expect(againFor(7196, 7196, 7193, film)).toBe(7199);
    expect(againFor(7199, 7199, 7195, film)).toBeUndefined();
    expect(againFor(2, 2, 5, film)).toBe(0);
  });

  it('never sends the second past live', () => {
    expect(againFor(7150, 7150, 7146, broadcast)).toBe(7154);
    expect(againFor(7200, 7200, 7196, broadcast)).toBeUndefined();
  });

  it('makes none for a miss too wild to be a keyframe', () => {
    expect(againFor(1800, 1800, 1700, film)).toBeUndefined();
  });
});

describe('judgeReading', () => {
  it('waits for a reading that is a place', () => {
    for (const reading of [NaN, -1, Infinity]) {
      expect(judgeReading(reading, 1800, true)).toBe('wait');
    }
  });

  it('takes no 0 for a landing, unless the jump was to the start', () => {
    expect(judgeReading(0, 1800, false)).toBe('wait');
    expect(judgeReading(0, 1800, true)).toBe('wait');
    expect(judgeReading(0.25, 0, false)).toBe('landed');
  });

  it('waits while playing until the clock moves on from the target read back', () => {
    expect(judgeReading(1800, 1800, false)).toBe('wait');
    expect(judgeReading(1800.25, 1800, false)).toBe('landed');
    expect(judgeReading(1796.25, 1800, false)).toBe('landed');
  });

  it('is unsure of a paused jump that still reads exactly its aim', () => {
    expect(judgeReading(1800, 1800, true)).toBe('unsure');
    expect(judgeReading(1797, 1800, true)).toBe('landed');
  });
});

describe('a landing watch', () => {
  let clock = 0;
  const kept = vi.fn<(landing: Landing) => void>();

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 6, 20, 0, 0);
    kept.mockClear();
  });

  function watch(mode: LandingMode) {
    return createLandingWatch(mode, () => clock, kept);
  }

  /** The element finishes the watched jump, then reads `at` a moment later as its clock moves on. */
  function land(w: ReturnType<typeof watch>, at: number, bounds = film) {
    clock += 400;
    w.seeked();
    clock += 250;
    return w.read(at, false, bounds);
  }

  const jump = (wanted: number, aimed = wanted, paused = false) => ({
    wanted,
    aimed,
    paused,
    stream,
  });

  it('logs each jump once its clock moves on after seeked, with no word of its address', () => {
    const w = watch('measure');
    w.jumped(jump(1800));
    // The timeupdate the element sends before seeked is not a landing.
    expect(w.read(1800, false, film)).toBeUndefined();
    clock += 400;
    expect(w.seeked()).toBe(true);
    expect(w.seeked()).toBe(false);
    clock += 250;
    expect(w.read(1800, false, film)).toBeUndefined();
    expect(kept).not.toHaveBeenCalled();
    w.read(1796.25, false, film);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledWith({
      time: '2026-11-06T20:00:00.650Z',
      engine: 'native',
      container: 'mkv',
      sizeGb: 22.1,
      mode: 'measure',
      paused: false,
      wanted: 1800,
      aimed: 1800,
      landed: 1796.25,
      miss: -3.75,
      sure: true,
      corrected: false,
      secondAimed: null,
      secondLanded: null,
      secondMiss: null,
      learnt: 3.75,
      seekedMs: 400,
      readMs: 650,
      secondReadMs: null,
    });
    // Read once: later readings say nothing more.
    w.read(1797, false, film);
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('checks only the latest of jumps made before the last one landed', () => {
    const w = watch('measure');
    w.jumped(jump(1800));
    w.jumped(jump(2400));
    land(w, 2396);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept.mock.calls[0]![0]).toMatchObject({ wanted: 2400, landed: 2396 });
  });

  it("in 'again', jumps once more after a miss, and never corrects that second jump", () => {
    const w = watch('again');
    w.jumped(jump(1800));
    expect(land(w, 1796)).toBe(1804);
    expect(kept).not.toHaveBeenCalled();
    // The second falls short too, but is not chased.
    expect(land(w, 1802.5)).toBeUndefined();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept.mock.calls[0]![0]).toMatchObject({
      mode: 'again',
      aimed: 1800,
      landed: 1796,
      miss: -4,
      corrected: true,
      secondAimed: 1804,
      secondLanded: 1802.5,
      secondMiss: 2.5,
      readMs: 650,
      secondReadMs: 650,
    });
  });

  it('keeps a second jump that never landed as far as it got, when the viewer jumps again or leaves', () => {
    const w = watch('again');
    w.jumped(jump(1800));
    land(w, 1796);
    w.jumped(jump(2400));
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept.mock.calls[0]![0]).toMatchObject({
      corrected: true,
      secondAimed: 1804,
      secondLanded: null,
    });
    expect(describeLanding(kept.mock.calls[0]![0])).toContain('again aimed 1804.00, never landed');
    expect(land(w, 2396)).toBe(2404);
    w.reset();
    expect(kept).toHaveBeenCalledTimes(2);
    expect(kept.mock.calls[1]![0]).toMatchObject({ wanted: 2400, secondLanded: null });
  });

  it("in 'learn' alone, sends later jumps further by what it learnt", () => {
    for (const mode of ['measure', 'again', 'learn'] as const) {
      const w = watch(mode);
      w.jumped(jump(1800));
      land(w, 1796);
      expect(w.learnt()).toBe(4);
      expect(w.aim(2400, 1800, film)).toBe(mode === 'learn' ? 2404 : 2400);
      w.reset();
    }
  });

  it('learns nothing from, and does not correct, a paused jump that still reads its aim', () => {
    const w = watch('again');
    w.jumped(jump(1800, 1800, true));
    w.seeked();
    clock += 1500;
    expect(w.read(1800, true, film)).toBeUndefined();
    expect(kept.mock.calls[0]![0]).toMatchObject({ paused: true, sure: false, corrected: false });
    expect(w.learnt()).toBe(0);
  });

  it('logs a landing too wild to be a keyframe, and does nothing about it', () => {
    const w = watch('again');
    w.jumped(jump(1800));
    expect(land(w, 1700)).toBeUndefined();
    expect(kept.mock.calls[0]![0]).toMatchObject({ miss: -100, corrected: false, learnt: 0 });
  });

  it('forgets what it learnt for a new stream', () => {
    const w = watch('learn');
    w.jumped(jump(1800));
    land(w, 1796);
    w.reset();
    expect(w.learnt()).toBe(0);
    expect(w.aim(2400, 1800, film)).toBe(2400);
  });
});

describe('the log', () => {
  const landing = (wanted: number): Landing => ({
    time: '2026-11-06T20:00:00.650Z',
    ...stream,
    mode: 'learn',
    paused: false,
    wanted,
    aimed: wanted + 3.75,
    landed: wanted - 0.5,
    miss: -0.5,
    sure: true,
    corrected: false,
    secondAimed: null,
    secondLanded: null,
    secondMiss: null,
    learnt: 3.81,
    seekedMs: 850,
    readMs: 1100,
    secondReadMs: null,
  });

  beforeEach(() => clearLandings());

  it('keeps the last 30, newest last, for the web inspector, and prints each once on one line', () => {
    vi.stubGlobal('window', {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    for (let i = 0; i < LANDINGS_KEPT + 5; i++) logLanding(landing(i));
    expect(recentLandings()).toHaveLength(LANDINGS_KEPT);
    expect(recentLandings()[0]!.wanted).toBe(5);
    expect(recentLandings()[LANDINGS_KEPT - 1]!.wanted).toBe(LANDINGS_KEPT + 4);
    expect(window.bannertvLandings).toBe(recentLandings());
    expect(info).toHaveBeenCalledTimes(LANDINGS_KEPT + 5);
    for (const [line] of info.mock.calls) {
      expect(line).toMatch(/^\[BannerTV landing\] [^\n]+$/);
    }
  });

  it('reads as one line a tester can follow', () => {
    expect(describeLanding(landing(1800))).toBe(
      'native mkv 22.1 GB, learn, playing: wanted 1800.00 aimed 1803.75 landed 1799.50 miss -0.50; ' +
        'learnt 3.81; seeked after 850 ms, read after 1100 ms',
    );
    expect(
      describeLanding({
        ...landing(1800),
        mode: 'again',
        paused: true,
        aimed: 1800,
        landed: 1796,
        miss: -4,
        corrected: true,
        secondAimed: 1804,
        secondLanded: 1801.25,
        secondMiss: 1.25,
        secondReadMs: 900,
      }),
    ).toBe(
      'native mkv 22.1 GB, again, paused: wanted 1800.00 aimed 1800.00 landed 1796.00 miss -4.00; ' +
        'again aimed 1804.00 landed 1801.25 miss +1.25 read after 900 ms; ' +
        'learnt 3.81; seeked after 850 ms, read after 1100 ms',
    );
    expect(describeLanding({ ...landing(1800), sure: false, engine: null, sizeGb: null })).toBe(
      'no engine mkv, learn, playing: wanted 1800.00 aimed 1803.75 landed 1799.50 miss -0.50; ' +
        'unsure: still read its aim while paused; learnt 3.81; seeked after 850 ms, read after 1100 ms',
    );
  });

  it("takes the stream's container and size from its facts, and nothing else", () => {
    expect(
      landingStream('native', {
        hdr: [],
        audio: [],
        languages: [],
        container: 'mkv',
        sizeBytes: 22.14e9,
      }),
    ).toEqual({ engine: 'native', container: 'mkv', sizeGb: 22.1 });
    expect(landingStream(null, undefined)).toEqual({
      engine: null,
      container: null,
      sizeGb: null,
    });
  });
});

import { fileReleaseMatch, type LineTiming, type SubtitleFit } from '@bannertv/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createSubtitleAligner,
  decideMove,
  findReference,
  isFinal,
  moveCues,
  moveSize,
  readableTrack,
  readsWhole,
  type Reference,
  referenceStage,
  referenceTrack,
  syncedOf,
  timingOf,
  trackCoverage,
  withSync,
} from './subtitle-align';

const FITS: SubtitleFit = {
  script: 'right',
  signs: false,
  hearing: false,
  length: 'fits',
  unfit: false,
};

/** A film's lines, at irregular times as speech is: `seconds` long, the same for a seed. */
function film(seconds: number, seed = 1): LineTiming[] {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const lines: LineTiming[] = [];
  for (let at = 5 + random() * 5; at < seconds - 5;) {
    const length = 1 + random() * 3.5;
    lines.push({ start: at, end: at + length });
    at += length + 0.3 + random() * (random() < 0.1 ? 25 : 4);
  }
  return lines;
}

const shifted = (lines: readonly LineTiming[], by: number) =>
  lines.map((line) => ({ start: line.start + by, end: line.end + by }));

const track = (id: string, extra: Partial<{ forced: boolean; picture: boolean }> = {}) => ({
  id,
  lang: 'fr',
  label: 'Français',
  active: false,
  ...extra,
});

const video = { filename: 'Some.Film.2021.1080p.BluRay.x264-GROUP.mkv' };

interface File {
  key: string;
  url: string;
  lang: string;
  label?: string;
  hashMatch?: boolean;
}

const file = (key: string, extra: Partial<File> = {}): File => ({
  key,
  url: `https://subs.example/${key}.srt`,
  lang: 'eng',
  ...extra,
});

/** Slicing whose clock moves a millisecond each look, and whose pause lets others go at once. */
function testSlicing() {
  let now = 0;
  return { now: () => now++, pause: () => Promise.resolve(), sliceMs: 8 };
}

async function settled(aligner: ReturnType<typeof createSubtitleAligner>, url: string) {
  await vi.waitFor(() => expect(aligner.pending(url)).toBe(false));
  return aligner.result(url);
}

describe('which tracks can be a reference', () => {
  it('reads a track hls.js or Shaka hands over, and on Android only one it says is text', () => {
    expect(readableTrack(track('a'), 'hls.js')).toBe(true);
    expect(readableTrack(track('a'), 'shaka')).toBe(true);
    expect(readableTrack(track('a', { forced: true }), 'hls.js')).toBe(false);
    expect(readableTrack(track('a', { picture: false }), 'android')).toBe(true);
    // Android draws picture subtitles itself, and one it cannot tell might be.
    expect(readableTrack(track('a', { picture: true }), 'android')).toBe(false);
    expect(readableTrack(track('a'), 'android')).toBe(false);
    expect(readableTrack(track('a'), 'native')).toBe(false);
    const tracks = [track('signs', { forced: true }), track('full'), track('other')];
    expect(referenceTrack(tracks, 'hls.js', {})?.id).toBe('full');
    // The one that has handed over the most lines.
    expect(referenceTrack(tracks, 'hls.js', { other: film(600) })?.id).toBe('other');
    expect(referenceTrack(tracks, 'native', {})).toBeNull();
  });
});

describe('findReference', () => {
  const lines = film(1800);
  const read = new Map<string, LineTiming[]>([
    ['https://subs.example/linked.srt', lines],
    ['https://subs.example/named.srt', lines],
    ['https://subs.example/plain.srt', shifted(lines, 3)],
  ]);
  const linked = file('linked', { label: 'some_film.srt', hashMatch: true });
  const named = file('named', { label: 'Some.Film.2021.1080p.BluRay.x264-GROUP' });
  const plain = file('plain');
  const base = {
    track: null,
    duration: 1800,
    offered: [plain, named, linked],
    fit: () => FITS,
    lines: (url: string) => read.get(url),
    broken: () => false,
    video,
  };

  it('takes the stream’s own track once its lines cover the video, in any language', () => {
    const reference = findReference({ ...base, track: { id: 'fr', lines } });
    expect(reference).toMatchObject({ kind: 'track', id: 'fr', growing: false });
  });

  it('takes a file linked to the video by its hash, then one named for its release', () => {
    expect(findReference(base)).toMatchObject({ kind: 'linked', id: linked.url });
    expect(findReference({ ...base, offered: [plain, named] })).toMatchObject({
      kind: 'release',
      id: named.url,
    });
  });

  it('never takes a file that has not read whole, with no drift, nor a group agreeing alone', () => {
    for (const fit of [
      { ...FITS, drift: 'behind' as const },
      { ...FITS, length: 'short' as const },
      { ...FITS, length: undefined },
      { ...FITS, runsOn: true },
      { ...FITS, signs: true, unfit: true },
    ]) {
      expect(readsWhole(fit)).toBe(false);
      expect(findReference({ ...base, fit: () => fit })).toBeNull();
    }
    expect(findReference({ ...base, fit: () => undefined })).toBeNull();
    expect(findReference({ ...base, broken: () => true })).toBeNull();
    // Files agreeing with each other, none made for the release: no reference.
    expect(findReference({ ...base, offered: [plain, file('copy')] })).toBeNull();
  });

  it('keeps the reference it used while it still is one and nothing of a better kind has come', () => {
    const first = file('first', { label: 'Some.Film.2021.1080p.BluRay.x264-GROUP' });
    const second = file('second', { label: 'Some.Film.2021.1080p.BluRay.x264-GROUP' });
    read.set(first.url, lines);
    read.set(second.url, lines);
    const both = { ...base, offered: [first, second] };
    expect(findReference(both)).toMatchObject({ id: first.url });
    expect(findReference(both, { kind: 'release', id: second.url })).toMatchObject({
      id: second.url,
    });
    // A file linked to the video is of a better kind, and so is the track once it is in.
    expect(
      findReference(
        { ...both, offered: [first, second, linked] },
        { kind: 'release', id: second.url },
      ),
    ).toMatchObject({ kind: 'linked' });
    expect(
      findReference({ ...both, track: { id: 'fr', lines } }, { kind: 'release', id: second.url }),
    ).toMatchObject({ kind: 'track' });
  });

  it('takes a whole file over the stream’s track while its lines still arrive, then the track alone', () => {
    const arriving = { id: 'fr', lines: lines.filter((line) => line.end < 900) };
    expect(findReference({ ...base, track: arriving })).toMatchObject({ kind: 'linked' });
    expect(findReference({ ...base, offered: [plain], track: arriving })).toMatchObject({
      kind: 'track',
      growing: true,
    });
    // Too few lines yet to say anything.
    expect(
      findReference({ ...base, offered: [plain], track: { id: 'fr', lines: lines.slice(0, 10) } }),
    ).toBeNull();
  });

  it('counts how far a reference still arriving has come, by its minutes with lines', () => {
    const stage = (lines: LineTiming[]): number =>
      referenceStage({ kind: 'track', id: 'fr', growing: true, lines });
    expect([5, 12, 25, 60].map((minutes) => stage(film(minutes * 60)))).toEqual([0, 0, 1, 2]);
    // Skipped from the start to the end of an hour: the minutes with lines count, not the span.
    const hour = film(3600);
    expect(stage(hour.filter((line) => line.end < 540 || line.start > 3060))).toBe(0);
    expect(stage(hour.filter((line) => line.end < 900 || line.start > 2700))).toBe(1);
    expect(referenceStage({ kind: 'linked', id: 'x', growing: false, lines: [] })).toBe(3);
  });

  it('takes the stream’s track as complete only once its lines cover the video', () => {
    const hour = film(3600, 3);
    const track = (lines: LineTiming[]) =>
      findReference({ ...base, offered: [], duration: 3600, track: { id: 'fr', lines } });
    // Played from the start to past three quarters of the video: complete.
    expect(track(hour.filter((line) => line.end < 2800))).toMatchObject({ growing: false });
    // Resumed at 80%: the end is reached with twelve minutes of lines. Still to come.
    expect(track(hour.filter((line) => line.start > 2880))).toMatchObject({ growing: true });
    // Ten minutes watched, then a skip to 80%: still to come, with a long stretch skipped.
    const skipped = hour.filter((line) => line.end < 600 || line.start > 2880);
    expect(track(skipped)).toMatchObject({ growing: true });
    expect(trackCoverage(skipped)).toMatchObject({ gap: true });
    expect(trackCoverage(skipped).heard).toBeLessThan(25 * 60);
    // Half the video heard, reaching its last quarter: complete, but with a skip in it.
    const half = hour.filter((line) => line.end < 1500 || line.start > 2100);
    expect(track(half)).toMatchObject({ growing: false });
    expect(trackCoverage(half)).toMatchObject({ gap: true });
    // With no length to judge by, never complete.
    expect(
      findReference({ ...base, offered: [], duration: 0, track: { id: 'fr', lines: hour } }),
    ).toMatchObject({ growing: true });
  });

  it('never takes a file named for the release only loosely, read whole as it is', () => {
    // The episode and resolution alone, no group to confirm it: a loose match says nothing.
    const loose = file('loose', { label: 'Some.Film.2021.1080p.BluRay.x264' });
    read.set(loose.url, lines);
    expect(fileReleaseMatch(loose, video)).toBe('loose');
    expect(readsWhole(FITS)).toBe(true);
    expect(findReference({ ...base, offered: [plain, loose] })).toBeNull();
  });
});

describe('createSubtitleAligner', () => {
  const lines = film(3600, 7);
  const complete: Reference = { kind: 'track', id: 'fr', lines, growing: false };

  it('lines a file up against the reference once, and moves its lines onto the video', async () => {
    const outcomes: number[] = [];
    const aligner = createSubtitleAligner(testSlicing());
    aligner.outcomes(({ record }) => outcomes.push(record.ms));
    const url = 'https://subs.example/late.srt';
    aligner.request([{ url, lines: shifted(lines, -2.5) }], complete);
    expect(aligner.pending(url)).toBe(true);
    const record = await settled(aligner, url);
    expect(record).toMatchObject({ reference: 'track', referenceId: 'fr', final: true, runs: 1 });
    expect(record!.alignment.confidence).toBe('sure');
    expect(record!.alignment.offset).toBeCloseTo(2.5, 1);
    expect(syncedOf(record)).toBe('sure');
    expect(withSync(FITS, syncedOf(record))).toEqual({ ...FITS, synced: 'sure' });
    expect(outcomes).toHaveLength(1);
    // Asked again: nothing more to do.
    aligner.request([{ url, lines: shifted(lines, -2.5) }], complete);
    expect(aligner.pending(url)).toBe(false);
    // The reference file itself is never lined up against itself.
    aligner.request([{ url: 'https://subs.example/ref.srt', lines }], {
      kind: 'linked',
      id: 'https://subs.example/ref.srt',
      lines,
      growing: false,
    });
    expect(aligner.pending('https://subs.example/ref.srt')).toBe(false);
  });

  it('starts each run once the page has had its turn, not inside the call that asked for it', async () => {
    let looks = 0;
    const turns: Array<() => void> = [];
    const aligner = createSubtitleAligner({
      now: () => looks++,
      pause: () => new Promise<void>((resolve) => turns.push(resolve)),
      sliceMs: 8,
    });
    const url = 'https://subs.example/late.srt';
    aligner.request([{ url, lines: shifted(lines, -2.5) }], complete);
    await Promise.resolve();
    // Nothing worked out yet: the run waits for its turn.
    expect(looks).toBe(0);
    expect(turns).toHaveLength(1);
    expect(aligner.pending(url)).toBe(true);
    // Cleared while it waits (another stream): it never runs.
    aligner.reset();
    turns.shift()!();
    await Promise.resolve();
    expect(looks).toBe(0);
    expect(aligner.pending(url)).toBe(false);
    // Asked again, it runs once given its turn, and every turn after.
    aligner.request([{ url, lines: shifted(lines, -2.5) }], complete);
    const turning = setInterval(() => turns.splice(0).forEach((resolve) => resolve()), 0);
    try {
      const record = await settled(aligner, url);
      expect(record!.alignment.confidence).toBe('sure');
      expect(looks).toBeGreaterThan(0);
    } finally {
      clearInterval(turning);
    }
  });

  it('says a file for another video matches nothing, for good', async () => {
    const aligner = createSubtitleAligner(testSlicing());
    const url = 'https://subs.example/other.srt';
    aligner.request([{ url, lines: film(3600, 99) }], complete);
    const record = await settled(aligner, url);
    expect(record!.alignment.confidence).toBe('none');
    expect(syncedOf(record)).toBe('none');
  });

  it('lines files up again as a reference still arriving grows, a few times at most', async () => {
    const aligner = createSubtitleAligner(testSlicing());
    const url = 'https://subs.example/late.srt';
    const candidate = [{ url, lines: shifted(lines, -4) }];
    const upTo = (minutes: number): Reference => ({
      kind: 'track',
      id: 'fr',
      growing: true,
      lines: lines.filter((line) => line.end <= minutes * 60),
    });
    // Ten minutes in: not enough to start.
    aligner.request(candidate, upTo(10));
    expect(aligner.pending(url)).toBe(false);
    aligner.request(candidate, upTo(21));
    const first = await settled(aligner, url);
    expect(first!.stage).toBe(1);
    // Sure, against a third of the file: looked at again, as a later look may find it out a little.
    expect(first!.alignment.confidence).toBe('sure');
    expect(first!.alignment.coveredShare).toBeLessThan(0.5);
    expect(first!.final).toBe(false);
    // The same stage again: nothing to do.
    aligner.request(candidate, upTo(30));
    expect(aligner.pending(url)).toBe(false);
    aligner.request(candidate, upTo(41));
    const later = await settled(aligner, url);
    expect(later!.alignment.confidence).toBe('sure');
    expect(later!.alignment.offset).toBeCloseTo(4, 1);
    expect(later!.final).toBe(true);
    expect(later!.runs).toBe(2);
  });

  it('does not take a reference skipped through for a file for another video', async () => {
    const aligner = createSubtitleAligner(testSlicing());
    const url = 'https://subs.example/other.srt';
    // The first and last quarter of an hour only: a long stretch with no lines at all.
    const gappy: Reference = {
      kind: 'track',
      id: 'fr',
      growing: true,
      lines: lines.filter((line) => line.end < 900 || line.start > 2700),
    };
    aligner.request([{ url, lines: film(3600, 99) }], gappy);
    const record = await settled(aligner, url);
    if (record!.alignment.confidence === 'none') expect(record!.final).toBe(false);
    expect(syncedOf(record)).toBeUndefined();
  });

  it('forgets every answer for another stream', async () => {
    const aligner = createSubtitleAligner(testSlicing());
    const url = 'https://subs.example/late.srt';
    aligner.request([{ url, lines: shifted(lines, 1) }], complete);
    await settled(aligner, url);
    const heard = vi.fn();
    aligner.subscribe(heard);
    aligner.reset();
    expect(aligner.result(url)).toBeUndefined();
    expect(heard).toHaveBeenCalled();
  });
});

describe('isFinal', () => {
  const lines = film(3600, 5);
  const track = (growing: boolean, from = lines): Reference => ({
    kind: 'track',
    id: 'fr',
    growing,
    lines: from,
  });
  const answer = (confidence: 'sure' | 'unsure' | 'none', coveredShare = 1) => ({
    confidence,
    coveredShare,
  });

  it('stands for good against a reference that will not grow, whatever it says', () => {
    expect(isFinal(answer('sure'), track(false))).toBe(true);
    expect(isFinal(answer('unsure'), track(false))).toBe(true);
    expect(isFinal(answer('none'), track(false))).toBe(true);
    const linked: Reference = { kind: 'linked', id: 'x', growing: false, lines };
    expect(isFinal(answer('none'), linked)).toBe(true);
  });

  it('looks again at an answer against a reference still arriving, until it covers half the file', () => {
    expect(isFinal(answer('unsure'), track(true))).toBe(false);
    expect(isFinal(answer('sure', 0.3), track(true))).toBe(false);
    expect(isFinal(answer('sure', 0.6), track(true))).toBe(true);
    expect(isFinal(answer('none'), track(true))).toBe(true);
  });

  it('never says another video for good against a track with a stretch skipped', () => {
    const skipped = lines.filter((line) => line.end < 900 || line.start > 1800);
    expect(isFinal(answer('none'), track(true, skipped))).toBe(false);
    expect(isFinal(answer('none'), track(false, skipped))).toBe(false);
  });
});

describe('decideMove', () => {
  const lines = [
    { start: 10, end: 12 },
    { start: 3000, end: 3002 },
  ];
  const stay = { offset: 0, rate: 1 };
  const move = { offset: 2, rate: 1 };
  const base = {
    move,
    before: stay,
    after: move,
    lines,
    early: false,
    touched: false,
    lateMoves: 0,
  };

  it('moves lines before the first shows, whatever the move', () => {
    expect(decideMove({ ...base, early: true, after: { offset: 0.1, rate: 1 } })).toEqual({ move });
  });

  it('moves lines already showing only far enough, and twice a stream at most', () => {
    expect(decideMove(base)).toEqual({ move, late: true });
    expect(decideMove({ ...base, lateMoves: 1 })).toEqual({ move, late: true });
    expect(decideMove({ ...base, lateMoves: 2 })).toEqual({ move: null, left: 'late' });
    expect(decideMove({ ...base, after: { offset: 0.2, rate: 1 } })).toEqual({
      move: null,
      left: 'inStep',
    });
  });

  it('leaves lines whose timing the viewer set first', () => {
    expect(decideMove({ ...base, early: true, touched: true })).toEqual({
      move: null,
      left: 'yours',
    });
  });
});

describe('moving lines', () => {
  it('moves and stretches cues as lining them up found', () => {
    const cue = { start: 25, end: 50, lines: [[{ text: 'Made-up line' }]] };
    expect(moveCues([cue], { offset: 2, rate: 1 })).toEqual([{ ...cue, start: 27, end: 52 }]);
    expect(moveCues([cue], { offset: 0, rate: 25 / 24 })[0]).toMatchObject({ start: 24, end: 48 });
    // A line drawn at the top stays there; the cue itself is left as it was.
    const top = { ...cue, top: true };
    expect(moveCues([top], { offset: 1, rate: 1 })).toEqual([{ ...top, start: 26, end: 51 }]);
    expect(top.start).toBe(25);
  });

  it('measures how far a move takes lines from where they show, at the file’s ends', () => {
    const lines = [
      { start: 10, end: 12 },
      { start: 1000, end: 1002 },
    ];
    expect(moveSize({ offset: 0, rate: 1 }, { offset: 0.2, rate: 1 }, lines)).toBeCloseTo(0.2);
    expect(moveSize({ offset: 0, rate: 1 }, { offset: 0, rate: 1.001 }, lines)).toBeCloseTo(
      1002 - 1002 / 1.001,
    );
    // The file's seconds for one of the video's: a 25 fps file on a 23.976 video, divided by.
    const pal = 24000 / 1001 / 25;
    expect(moveSize({ offset: 0, rate: 1 }, { offset: 0, rate: pal }, lines)).toBeCloseTo(
      1002 / pal - 1002,
    );
  });

  it('keeps only lines with a start and an end for lining up', () => {
    expect(
      timingOf([
        { start: 1, end: 2 },
        { start: 3, end: Infinity },
        { start: 4, end: 4 },
        { start: NaN, end: 5 },
      ]),
    ).toEqual([{ start: 1, end: 2 }]);
  });
});

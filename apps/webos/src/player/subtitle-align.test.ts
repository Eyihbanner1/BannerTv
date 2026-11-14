import type { LineTiming, SubtitleFit } from '@bannertv/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createSubtitleAligner,
  decideMove,
  findReference,
  moveCues,
  moveSize,
  readableTrack,
  readsWhole,
  type Reference,
  referenceStage,
  referenceTrack,
  syncedOf,
  timingOf,
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

  it('counts how far a reference still arriving has come', () => {
    const stage = (minutes: number): number =>
      referenceStage({
        kind: 'track',
        id: 'fr',
        growing: true,
        lines: [
          { start: 0, end: 1 },
          { start: minutes * 60 - 1, end: minutes * 60 },
        ],
      });
    expect([stage(5), stage(12), stage(25), stage(60)]).toEqual([0, 1, 2, 3]);
    expect(referenceStage({ kind: 'linked', id: 'x', growing: false, lines: [] })).toBe(4);
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
    // Five minutes in: not enough to start.
    aligner.request(candidate, upTo(5));
    expect(aligner.pending(url)).toBe(false);
    aligner.request(candidate, upTo(11));
    const first = await settled(aligner, url);
    expect(first!.stage).toBe(1);
    // The same stage again: nothing to do.
    aligner.request(candidate, upTo(15));
    expect(aligner.pending(url)).toBe(false);
    aligner.request(candidate, upTo(41));
    const later = await settled(aligner, url);
    expect(later!.alignment.confidence).toBe('sure');
    expect(later!.alignment.offset).toBeCloseTo(4, 1);
    expect(later!.final).toBe(true);
    expect(later!.runs).toBeLessThanOrEqual(3);
  });

  it('does not take a reference skipped through for a file for another video', async () => {
    const aligner = createSubtitleAligner(testSlicing());
    const url = 'https://subs.example/other.srt';
    // The first and last ten minutes only: a long stretch with no lines at all.
    const gappy: Reference = {
      kind: 'track',
      id: 'fr',
      growing: true,
      lines: lines.filter((line) => line.end < 600 || line.start > 3000),
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

import { describe, expect, it } from 'vitest';
import { append, ascii, partsSource } from './fixtures/helpers';
import { type SyntheticLine, type SyntheticOptions, synthesize } from './fixtures/synthetic';
import { cueTimings, type MatroskaFile, openMatroska, readMatroskaCues } from './matroska';
import { readMatroskaLines } from './matroska-window';

const SRT = { number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' };

function lines(count: number, track = 2, step = 2500): SyntheticLine[] {
  return Array.from({ length: count }, (_, i) => ({
    track,
    time: 1000 + i * step + (i % 3) * 7,
    duration: 1200 + (i % 5) * 111,
    text: `Line ${i + 1} of a synthetic track.`,
  }));
}

function build(options: Partial<SyntheticOptions> & { lines: SyntheticLine[] }) {
  return synthesize({ length: 60000, tracks: [SRT], frameRate: 4, videoRate: 40000, ...options });
}

async function openBuilt(options: Partial<SyntheticOptions> & { lines: SyntheticLine[] }) {
  const { parts } = build(options);
  const source = partsSource(parts);
  return { source, opened: await openMatroska(source) };
}

async function fileOf(options: Partial<SyntheticOptions> & { lines: SyntheticLine[] }) {
  const { source, opened } = await openBuilt(options);
  if (!opened.ok) throw new Error(opened.reason);
  return { source, file: opened.file };
}

async function readAll(file: MatroskaFile, track = 2, options = {}) {
  const read = await readMatroskaCues(file, [track]);
  if (!read.ok) throw new Error(read.reason);
  const entries = read.cues.entries.get(track)!;
  return { entries, ...(await readMatroskaLines(file, track, entries, options)) };
}

function expected(list: readonly SyntheticLine[]) {
  return list.map((line) => ({
    start: line.time / 1000,
    end: (line.time + line.duration!) / 1000,
    lines: [[{ text: line.text }]],
  }));
}

describe('synthetic files', () => {
  it('reads a header-stripped text track, putting the stripped bytes back', async () => {
    const list = lines(12);
    const { file } = await fileOf({ tracks: [{ ...SRT, stripped: ascii('Line ') }], lines: list });
    expect(file.tracks[1]).toMatchObject({ compression: 'header-stripping' });
    expect(file.tracks[1]!.unreadable).toBeUndefined();
    const { cues } = await readAll(file);
    expect(cues).toEqual(expected(list));
  });

  it('finds Cues listed only in a second SeekHead that the first points to', async () => {
    const list = lines(8);
    const { file } = await fileOf({ lines: list, cuesInSecondSeekHead: true });
    expect(file.seekHeads).toBe(2);
    const { cues } = await readAll(file);
    expect(cues).toEqual(expected(list));
  });

  it('reads blocks the Cues point at inside their BlockGroup, as mkvmerge 5.9.0 to 6.3.0 wrote them', async () => {
    const list = lines(10);
    const { file } = await fileOf({ lines: list, cuesAtBlock: true });
    for (const options of [
      {},
      { mergeGap: 0, maxRead: 256 },
      { clusterHeads: 'always' as const },
    ]) {
      const { cues, stats } = await readAll(file, 2, options);
      // The Block alone has no BlockDuration: the line's length comes from CueDuration.
      expect(cues).toEqual(expected(list));
      expect(stats.problems).toEqual({});
    }
  });

  it('reads SimpleBlock lines, and gives a line nothing times an end at the next line or 4 s', async () => {
    const list = lines(6, 2, 9000);
    list[1]!.time = list[0]!.time + 1500;
    const { file } = await fileOf({ lines: list, blocks: 'simple', noCueDuration: true });
    const { cues, entries } = await readAll(file);
    expect(cueTimings(file, entries).every((timing) => timing.end === undefined)).toBe(true);
    expect(cues.map((cue) => [cue.start, cue.end])).toEqual(
      list.map((line, i) => [
        line.time / 1000,
        i === 0 ? list[1]!.time / 1000 : line.time / 1000 + 4,
      ]),
    );
  });

  it('refuses laced blocks for text', async () => {
    const { file } = await fileOf({ lines: lines(3), laced: true });
    const { cues, stats } = await readAll(file);
    expect(cues).toEqual([]);
    expect(stats.problems).toEqual({ laced: 3 });
  });

  it('gives timing but no text for cue points without a relative position', async () => {
    const list = lines(5);
    const { file, source } = await fileOf({ lines: list, noCueRelative: true });
    const before = source.reads.length;
    const { cues, results, entries } = await readAll(file);
    expect(cues).toEqual([]);
    expect(results.map((result) => result.problem)).toEqual(Array(5).fill('no-position'));
    expect(cueTimings(file, entries)).toEqual(
      expected(list).map(({ start, end }) => ({ start, end })),
    );
    // The Cues are read; no block is.
    expect(source.reads.length - before).toBe(1);
  });

  it('finds every block whatever size width each Cluster was written with', async () => {
    const list = lines(22);
    const { file } = await fileOf({ lines: list, clusterSizeWidths: [1, 2, 3, 4, 5, 6, 7, 8, -1] });
    const { cues, stats } = await readAll(file, 2, { mergeGap: 0, maxRead: 1024 });
    expect(cues).toEqual(expected(list));
    expect(stats.fallbacks).toBe(0);
    expect(stats.headReads).toBe(0);
  });

  it('trusts the block over the cue when the Cluster head shows they differ', async () => {
    const list = lines(4);
    const { file } = await fileOf({ lines: list, blockTimeShift: 40 });
    const { cues, stats } = await readAll(file, 2, { clusterHeads: 'always' });
    expect(stats.timeMismatches).toBe(4);
    expect(cues.map((cue) => cue.start)).toEqual(list.map((line) => (line.time + 40) / 1000));
  });

  it('keeps only the asked-for track of thirty, reading large Cues in chunks', async () => {
    const tracks = Array.from({ length: 30 }, (_, i) => ({ ...SRT, number: i + 2 }));
    const all: SyntheticLine[] = [];
    for (const track of tracks) append(all, lines(400, track.number, 140));
    const { file, source } = await fileOf({ tracks, lines: all, clusterLength: 2000 });
    const before = source.reads.length;
    const read = await readMatroskaCues(file, [7]);
    if (!read.ok) throw new Error(read.reason);
    // 12,000 cue points: more than the first read and one chunk after it.
    expect(read.cues.size).toBeGreaterThan(256 * 1024);
    expect(read.cues.size).toBeLessThan(320 * 1024 - 16);
    expect(source.reads.length - before).toBe(2);
    expect([...read.cues.entries.keys()]).toEqual([7]);
    expect(read.cues.entries.get(7)).toHaveLength(400);
    expect(read.cues.counts.size).toBe(31);
  });

  it('names picture and encrypted tracks, and does not offer to read them', async () => {
    const { file } = await fileOf({
      tracks: [SRT, { number: 3, codecId: 'S_HDMV/PGS' }, { ...SRT, number: 4, encrypted: true }],
      lines: lines(2),
    });
    expect(
      file.tracks
        .slice(1)
        .map(({ subtitle, unreadable, encrypted }) => ({ subtitle, unreadable, encrypted })),
    ).toEqual([
      { subtitle: 'text', unreadable: undefined, encrypted: false },
      { subtitle: 'picture', unreadable: 'not-text', encrypted: false },
      { subtitle: 'text', unreadable: 'encrypted', encrypted: true },
    ]);
  });

  it('takes WebM as Matroska', async () => {
    const { opened } = await openBuilt({ lines: lines(1), docType: 'webm' });
    expect(opened.ok).toBe(true);
  });

  it('turns away another DocType, a file with no Cues, and a value past 2^53', async () => {
    expect((await openBuilt({ lines: lines(1), docType: 'other' })).opened).toMatchObject({
      ok: false,
      reason: 'not-matroska',
    });
    expect((await openBuilt({ lines: lines(1), noCues: true })).opened).toMatchObject({
      ok: false,
      reason: 'no-cues',
    });
    const unseekable = await openBuilt({ lines: lines(1), noCues: true, segmentUnknownSize: true });
    expect(unseekable.opened).toMatchObject({ ok: false, reason: 'unseekable' });
    expect(unseekable.source.reads).toHaveLength(1);
    expect((await openBuilt({ lines: lines(1), hugeCuesPosition: true })).opened).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });
});

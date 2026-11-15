import { describe, expect, it } from 'vitest';
import { append, ascii, deflater, partsSource, utf8 } from './fixtures/helpers';
import { type SyntheticLine, type SyntheticOptions, synthesize } from './fixtures/synthetic';
import {
  cueTimings,
  engineInflate,
  type MatroskaFile,
  openMatroska,
  readMatroskaCues,
} from './matroska';
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
  it('reads FlagCommentary, and Cues that leave a track out', async () => {
    const { file } = await fileOf({
      tracks: [SRT, { number: 3, codecId: 'S_TEXT/UTF8', language: 'eng', commentary: true }],
      lines: [...lines(6), ...lines(6, 3)],
      uncuedTracks: [3],
    });
    expect(file.tracks.map((track) => track.commentary)).toEqual([false, false, true]);
    const read = await readMatroskaCues(file, [2, 3]);
    if (!read.ok) throw new Error(read.reason);
    expect(read.cues.entries.get(2)).toHaveLength(6);
    expect(read.cues.entries.get(3)).toEqual([]);
    expect(read.cues.counts.has(3)).toBe(false);
  });

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

  // A frame ending A1 C0 reads, two bytes before a BlockGroup (A0), as a Block of 64 bytes of
  // track 0xA0 & 0x7F = 32 that swallows the group; before a SimpleBlock (A3), of track 35.
  // A frame ending A1 reads, a byte before a group of 20 bytes (size 0x94), as a Block of
  // 32 bytes of track 20.
  it.each([
    { name: 'a BlockGroup of track 32', track: 32, tail: [0xa1, 0xc0], blocks: 'group' as const },
    { name: 'a SimpleBlock of track 35', track: 35, tail: [0xa1, 0xc0], blocks: 'simple' as const },
    { name: 'a 20-byte BlockGroup of track 20', track: 20, tail: [0xa1], blocks: 'group' as const },
  ])(
    'does not take the end of the frame before $name for the block',
    async ({ track, tail, blocks }) => {
      // Ten bytes of text make each group of track 20 exactly 20 bytes.
      const list = lines(40, track, 2500).map((line, i) => ({
        ...line,
        text: track === 20 ? `Line ${String(i).padStart(5, '0')}` : line.text,
      }));
      const { file } = await fileOf({
        tracks: [{ ...SRT, number: track }],
        lines: list,
        length: 110000,
        frameRate: 1,
        videoRate: 40000,
        blocks,
        noCueDuration: blocks === 'simple',
        videoTail: () => Uint8Array.from(tail),
      });
      const { cues, stats } = await readAll(file, track);
      expect(stats.problems).toEqual({});
      expect(cues.map((cue) => cue.lines)).toEqual(list.map((line) => [[{ text: line.text }]]));
      expect(cues.map((cue) => cue.start)).toEqual(list.map((line) => line.time / 1000));
      // Each line's place was not certain, so its Cluster's head was read.
      expect(stats.fallbacks).toBe(40);
    },
  );

  it('reads every line right after frames that end in random bytes, whatever the size width', async () => {
    let seed = 0x2545f491;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const list = lines(600, 32, 2500);
    const { file } = await fileOf({
      tracks: [{ ...SRT, number: 32 }],
      lines: list,
      length: 1510000,
      frameRate: 1,
      videoRate: 40000,
      clusterSizeWidths: [3, 8, 4, 6],
      videoTail: () => Uint8Array.from({ length: 16 }, () => Math.floor(random() * 256)),
    });
    const { cues, stats } = await readAll(file, 32);
    expect(stats.problems).toEqual({});
    expect(cues).toEqual(expected(list));
    // Some places were not certain and read the head; most were found without it.
    expect(stats.fallbacks).toBeGreaterThan(0);
    expect(stats.fallbacks).toBeLessThan(60);
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

describe('limits on what a file can make the reader hold', () => {
  const MB = 1024 * 1024;
  const ASS_HEADER = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV',
    'Style: Default,Arial,20,&H00FFFFFF,0,0,2,10,10,10',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  function assLines(count: number): SyntheticLine[] {
    return lines(count).map((line, i) => ({
      ...line,
      text: `${i},0,Default,,0,0,0,,Synthetic line ${i + 1}`,
    }));
  }

  it('stops inflating as soon as the bytes pass the limit, and joins what it keeps once', async () => {
    const inflate = engineInflate()!;
    const deflate = await deflater();
    // 32 KB that would make 32 MB.
    const bomb = deflate(new Uint8Array(32 * MB));
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(inflate(bomb, MB)).rejects.toThrow('too-large');
    const text = Uint8Array.from(
      Array.from({ length: 20000 }, (_, i) => `line ${i * 7919}`).join('\n'),
      (char) => char.charCodeAt(0),
    );
    expect(await inflate(deflate(text), text.length)).toEqual(text);
    await expect(inflate(deflate(text), text.length - 1)).rejects.toThrow('too-large');
  });

  it('reads an ASS track whose header and lines are zlib, but not a header that inflates past 1 MB', async () => {
    const deflate = await deflater();
    const ass = { number: 2, codecId: 'S_TEXT/ASS', language: 'eng' };
    const list = assLines(4);
    const { file } = await fileOf({
      tracks: [{ ...ass, codecPrivate: deflate(utf8(ASS_HEADER)), zlib: { scope: 3, deflate } }],
      lines: list,
    });
    expect(file.tracks[1]!.compression).toBe('zlib');
    expect(file.tracks[1]!.unreadable).toBeUndefined();
    const { cues, stats } = await readAll(file);
    expect(stats.problems).toEqual({});
    expect(cues.map((cue) => cue.lines.map((part) => part.map((run) => run.text)))).toEqual(
      list.map((_, i) => [[`Synthetic line ${i + 1}`]]),
    );

    const started = Date.now();
    const { file: bombed } = await fileOf({
      tracks: [{ ...ass, codecPrivate: deflate(new Uint8Array(32 * MB)), zlib: { scope: 2 } }],
      lines: assLines(1),
    });
    expect(bombed.tracks[1]).toMatchObject({ unreadable: 'compression' });
    // Inflating all 32 MB took 17 s here; stopping at the limit takes milliseconds.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('gives up on a line whose block inflates past 256 KB, and reads the others', async () => {
    const deflate = await deflater();
    const bomb = deflate(new Uint8Array(32 * MB));
    const list = lines(3);
    list[1]!.text = 'This line inflates too far';
    const { file } = await fileOf({
      tracks: [
        {
          ...SRT,
          zlib: {
            scope: 1,
            deflate: (bytes) => (bytes[0] === 0x54 ? bomb : deflate(bytes)),
          },
        },
      ],
      lines: list,
    });
    const { cues, results } = await readAll(file);
    expect(results.map((result) => result.problem)).toEqual([undefined, 'undecodable', undefined]);
    expect(cues).toEqual(expected([list[0]!, list[2]!]));
  });

  it('turns away Cues that hold more cue points than a track or the tracks asked for may keep', async () => {
    const tracks = [SRT, { ...SRT, number: 3 }];
    const all = [...lines(50, 2, 1000), ...lines(50, 3, 1000)];
    const { file } = await fileOf({ tracks, lines: all });
    expect(await readMatroskaCues(file, [2, 3], { maxTrackEntries: 49 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(await readMatroskaCues(file, [2, 3], { maxEntries: 99 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
    // One track of the two keeps within the total.
    expect(await readMatroskaCues(file, [2], { maxEntries: 99 })).toMatchObject({ ok: true });
    const read = await readMatroskaCues(file, [2, 3], { maxTrackEntries: 50, maxEntries: 100 });
    if (!read.ok) throw new Error(read.reason);
    expect(read.cues.entries.get(2)).toHaveLength(50);
    expect(read.cues.entries.get(3)).toHaveLength(50);
  });

  it('counts only the tracks the file has, whatever track numbers its Cues give', async () => {
    const { file } = await fileOf({ lines: lines(5), strayCueTracks: [77, 1000] });
    const read = await readMatroskaCues(file);
    if (!read.ok) throw new Error(read.reason);
    expect([...read.cues.counts.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(read.cues.entries.get(2)).toHaveLength(5);
  });
});

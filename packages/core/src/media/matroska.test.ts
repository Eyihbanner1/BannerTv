import { describe, expect, it } from 'vitest';
import { parseSubtitleText } from '../subtitles/parse';
import type { Cue } from '../subtitles/types';
import { fakeBytesSource, readFixture, readFixtureText } from './fixtures/helpers';
import {
  cueTimings,
  type MatroskaFile,
  openMatroska,
  type MatroskaOptions,
  readMatroskaCues,
} from './matroska';
import type { BlockReaderOptions } from './matroska-blocks';
import { readMatroskaLines } from './matroska-window';
import { bytesSource } from './source';

async function open(name: string, options?: MatroskaOptions): Promise<MatroskaFile> {
  const opened = await openMatroska(bytesSource(await readFixture(name)), options);
  if (!opened.ok) throw new Error(`could not open ${name}: ${opened.reason}`);
  return opened.file;
}

async function sourceCues(name: string): Promise<Cue[]> {
  return parseSubtitleText(await readFixtureText(`text/${name}`));
}

async function linesOf(file: MatroskaFile, track: number, options?: BlockReaderOptions) {
  const read = await readMatroskaCues(file, [track]);
  if (!read.ok) throw new Error(read.reason);
  const entries = read.cues.entries.get(track)!;
  return { entries, ...(await readMatroskaLines(file, track, entries, options)) };
}

/** Start and end of every line of a source file, as BannerTV's own parser reads it. */
function timesOf(cues: readonly Cue[]) {
  return cues.map((cue) => ({ start: cue.start, end: cue.end }));
}

describe('openMatroska on an mkvmerge file', () => {
  it('lists every track with its codec, languages, name and flags', async () => {
    const file = await open('mkvmerge.mkv');
    expect(file.timestampScale).toBe(1000000);
    expect(file.duration).toBeCloseTo(60, 1);
    expect(file.muxingApp).toMatch(/^libebml/);
    expect(file.writingApp).toMatch(/^mkvmerge/);
    expect(file.seekHeads).toBe(1);
    expect(file.tracks.map((track) => ({ ...track }))).toEqual([
      {
        number: 1,
        kind: 'video',
        codecId: 'V_MPEG4/ISO/AVC',
        language: 'und',
        languageIetf: 'und',
        forced: false,
        default: false,
        enabled: true,
        hearingImpaired: false,
        commentary: false,
        encrypted: false,
        unreadable: 'not-text',
        frameDuration: 100000000,
        frameRate: 10,
      },
      {
        number: 2,
        kind: 'subtitle',
        codecId: 'S_TEXT/UTF8',
        subtitle: 'text',
        textFormat: 'srt',
        language: 'eng',
        languageIetf: 'en',
        name: 'English',
        forced: false,
        default: true,
        enabled: true,
        hearingImpaired: false,
        commentary: false,
        encrypted: false,
      },
      {
        number: 3,
        kind: 'subtitle',
        codecId: 'S_TEXT/UTF8',
        subtitle: 'text',
        textFormat: 'srt',
        language: 'eng',
        languageIetf: 'en',
        name: 'Signs',
        forced: true,
        default: false,
        enabled: true,
        hearingImpaired: false,
        commentary: false,
        encrypted: false,
      },
      {
        number: 4,
        kind: 'subtitle',
        codecId: 'S_TEXT/ASS',
        subtitle: 'text',
        textFormat: 'ass',
        language: 'fre',
        languageIetf: 'fr-CA',
        name: 'Français',
        forced: false,
        default: false,
        enabled: true,
        hearingImpaired: false,
        commentary: false,
        encrypted: false,
      },
      {
        number: 5,
        kind: 'subtitle',
        codecId: 'S_TEXT/SSA',
        subtitle: 'text',
        textFormat: 'ssa',
        language: 'ger',
        languageIetf: 'de',
        forced: false,
        default: false,
        enabled: true,
        hearingImpaired: true,
        commentary: false,
        encrypted: false,
      },
      {
        number: 6,
        kind: 'subtitle',
        codecId: 'S_TEXT/WEBVTT',
        subtitle: 'text',
        textFormat: 'vtt',
        language: 'spa',
        languageIetf: 'es',
        forced: false,
        default: false,
        enabled: true,
        hearingImpaired: false,
        commentary: false,
        encrypted: false,
      },
    ]);
  });

  it('reads a small file whole in its first read', async () => {
    const bytes = await readFixture('mkvmerge.mkv');
    const source = fakeBytesSource(bytes);
    const opened = await openMatroska(source);
    expect(opened.ok).toBe(true);
    // 64 KB asked for, kept inside the file's size.
    expect(source.reads).toEqual([{ start: 0, length: bytes.length }]);
  });

  it('follows the SeekHead to Info and Tracks when they are past the first read', async () => {
    const source = fakeBytesSource(await readFixture('mkvmerge.mkv'));
    const opened = await openMatroska(source, { headRead: 1024 });
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.file.tracks).toHaveLength(6);
    // The head, then Info and Tracks, each read where the SeekHead says.
    expect(source.reads).toHaveLength(3);
    expect(source.reads[0]).toEqual({ start: 0, length: 1024 });
  });
});

describe('the Cues of an mkvmerge file', () => {
  it('index every line of every subtitle track, with its relative position and duration', async () => {
    const file = await open('mkvmerge.mkv');
    const read = await readMatroskaCues(file);
    if (!read.ok) throw new Error(read.reason);
    const { counts, entries } = read.cues;
    expect([...entries.keys()]).toEqual([2, 3, 4, 5, 6]);
    expect([2, 3, 4, 5, 6].map((track) => entries.get(track)!.length)).toEqual([20, 3, 14, 4, 4]);
    for (const track of [2, 3, 4, 5, 6]) {
      const count = counts.get(track)!;
      expect(count.relative).toBe(count.points);
      expect(count.duration).toBe(count.points);
    }
    // Video keyframes, every 2 s, are indexed too but not kept.
    expect(counts.get(1)!.points).toBe(30);
    expect(entries.has(1)).toBe(false);
  });

  it('keep only the tracks asked for', async () => {
    const file = await open('mkvmerge.mkv');
    const read = await readMatroskaCues(file, [3]);
    if (!read.ok) throw new Error(read.reason);
    expect([...read.cues.entries.keys()]).toEqual([3]);
    expect(read.cues.counts.size).toBe(6);
  });

  it('give every line its start and end without reading a block', async () => {
    const file = await open('mkvmerge.mkv');
    const read = await readMatroskaCues(file);
    if (!read.ok) throw new Error(read.reason);
    const timing = (track: number) => cueTimings(file, read.cues.entries.get(track)!);
    expect(timing(2)).toEqual(timesOf(await sourceCues('eng.srt')));
    expect(timing(3)).toEqual(timesOf(await sourceCues('signs.srt')));
    expect(timing(5)).toEqual(timesOf(await sourceCues('ger.ssa')));
    expect(timing(6)).toEqual(timesOf(await sourceCues('spa.vtt')));
    // The ASS script's vector drawing has a block and a cue point like any line.
    expect(timing(4)).toEqual([
      { start: 1, end: 3.5 },
      { start: 4.2, end: 6 },
      { start: 6.5, end: 8.75 },
      { start: 9, end: 11 },
      { start: 12, end: 14 },
      { start: 15, end: 17.5 },
      { start: 18, end: 20 },
      { start: 21, end: 23 },
      { start: 24, end: 26 },
      { start: 27, end: 29 },
      { start: 30, end: 32 },
      { start: 33, end: 35 },
      { start: 36, end: 38 },
      { start: 41, end: 43.5 },
    ]);
    expect(timing(2)[4]).toEqual({ start: 10.01, end: 12.345 });
  });
});

describe('lines read from an mkvmerge file', () => {
  it('are the SRT file it was made from, line for line', async () => {
    const file = await open('mkvmerge.mkv');
    const { cues, results } = await linesOf(file, 2);
    expect(cues).toEqual(await sourceCues('eng.srt'));
    expect(results.every((result) => result.cue)).toBe(true);
    expect(cues[0]).toEqual({ start: 0.5, end: 2.25, lines: [[{ text: 'The first line.' }]] });
    expect(cues[1]!.lines).toEqual([[{ text: 'Said in italics.', italic: true }]]);
    expect(cues[2]!.lines).toEqual([[{ text: 'Two lines,' }], [{ text: 'as one cue.' }]]);
    expect(cues[3]).toMatchObject({ top: true, lines: [[{ text: 'A line at the top.' }]] });
    expect(cues[4]!.lines).toEqual([[{ text: 'Café, naïve, ñandú — and 😀.' }]]);
    expect(cues[10]!.lines).toEqual([[{ text: 'Fish & chips.' }]]);
    expect(cues[15]!.lines).toEqual([[{ text: 'Χαίρετε, Привет, こんにちは' }]]);
  });

  it('are the forced track, line for line', async () => {
    const file = await open('mkvmerge.mkv');
    const { cues } = await linesOf(file, 3);
    expect(cues).toEqual(await sourceCues('signs.srt'));
    expect(cues[2]).toMatchObject({ start: 41, end: 43, top: true });
  });

  it('are the ASS script, styles and override tags read as a file of it is', async () => {
    const file = await open('mkvmerge.mkv');
    const { cues, results } = await linesOf(file, 4);
    expect(cues).toEqual(await sourceCues('fre.ass'));
    // The vector drawing has nothing to draw.
    expect(results.filter((result) => result.problem).map((result) => result.problem)).toEqual([
      'empty',
    ]);
    expect(cues.map((cue) => cue.lines)).toEqual([
      [[{ text: 'Bonjour, tout le monde.' }]],
      [[{ text: 'En italique par le style.', italic: true }]],
      [[{ text: 'En haut par le style.' }]],
      [[{ text: 'Première ligne' }], [{ text: 'seconde ligne' }]],
      [[{ text: 'Italique', italic: true }, { text: ' puis droit' }]],
      [[{ text: 'En haut par balise' }]],
      [[{ text: 'Gras', bold: true }, { text: ', puis ' }, { text: 'souligné', underline: true }]],
      [[{ text: 'Position ignorée' }]],
      [[{ text: 'Une virgule, deux, trois' }]],
      [[{ text: 'Espace dur' }]],
      [[{ text: 'Style remis à zéro', italic: true }]],
      [[{ text: 'Calque un' }]],
      [[{ text: 'La fin.' }]],
    ]);
    expect(cues.map((cue) => cue.top === true)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('are the SSA script, its legacy styles and alignments included', async () => {
    const file = await open('mkvmerge.mkv');
    const { cues } = await linesOf(file, 5);
    expect(cues).toEqual(await sourceCues('ger.ssa'));
    expect(cues.map((cue) => cue.top === true)).toEqual([false, true, false, true]);
    expect(cues[2]!.lines).toEqual([[{ text: 'Größe und Übung' }], [{ text: 'zweite Zeile' }]]);
  });

  it('are the WebVTT file, its line settings read from the BlockAdditions', async () => {
    const file = await open('mkvmerge.mkv');
    const { cues } = await linesOf(file, 6);
    expect(cues).toEqual(await sourceCues('spa.vtt'));
    expect(cues.map((cue) => cue.top === true)).toEqual([true, false, false, true]);
  });

  it('come with the same lines when every Cluster head is read first, at twice the requests', async () => {
    const file = await open('mkvmerge.mkv');
    const guessed = await linesOf(file, 2, { maxRead: 256, mergeGap: 0 });
    const exact = await linesOf(file, 2, { maxRead: 256, mergeGap: 0, clusterHeads: 'always' });
    expect(exact.cues).toEqual(guessed.cues);
    expect(guessed.stats.fallbacks).toBe(0);
    expect(guessed.stats.timeMismatches).toBe(0);
    expect(exact.stats.timeMismatches).toBe(0);
    expect(exact.stats.headReads).toBeGreaterThan(0);
    expect(exact.stats.requests).toBeGreaterThan(guessed.stats.requests);
  });

  it('read a whole small track in one request when its blocks sit close together', async () => {
    const file = await open('mkvmerge.mkv');
    const { stats } = await linesOf(file, 2);
    expect(stats.requests).toBe(1);
    expect(stats.lines).toBe(20);
  });
});

describe('lines read from an ffmpeg file', () => {
  it('lists its tracks, the ASS one forced and WebVTT as WebM writes it', async () => {
    const file = await open('ffmpeg.mkv');
    expect(file.writingApp).toMatch(/^Lavf/);
    expect(
      file.tracks.map(({ number, codecId, language, name, forced, textFormat }) => ({
        number,
        codecId,
        language,
        name,
        forced,
        textFormat,
      })),
    ).toEqual([
      {
        number: 1,
        codecId: 'V_MPEG4/ISO/AVC',
        language: 'und',
        name: undefined,
        forced: false,
        textFormat: undefined,
      },
      {
        number: 2,
        codecId: 'S_TEXT/UTF8',
        language: 'eng',
        name: 'English',
        forced: false,
        textFormat: 'srt',
      },
      {
        number: 3,
        codecId: 'S_TEXT/ASS',
        language: 'fre',
        name: undefined,
        forced: true,
        textFormat: 'ass',
      },
      {
        number: 4,
        codecId: 'D_WEBVTT/SUBTITLES',
        language: 'spa',
        name: undefined,
        forced: false,
        textFormat: 'webm-vtt',
      },
    ]);
  });

  it('are the files it was made from, line for line, past the CRC-32 its Clusters start with', async () => {
    const file = await open('ffmpeg.mkv');
    for (const [track, name] of [
      [2, 'eng.srt'],
      [3, 'fre.ass'],
      [4, 'spa.vtt'],
    ] as const) {
      const read = await readMatroskaCues(file, [track]);
      if (!read.ok) throw new Error(read.reason);
      const entries = read.cues.entries.get(track)!;
      const expected = await sourceCues(name);
      for (const options of [
        {},
        { maxRead: 128, mergeGap: 0 },
        { clusterHeads: 'always' as const },
      ]) {
        const { cues, stats } = await readMatroskaLines(file, track, entries, options);
        expect(cues).toEqual(expected);
        expect(stats.fallbacks).toBe(0);
        expect(stats.timeMismatches).toBe(0);
        expect(stats.rereads).toBe(0);
      }
      if (name !== 'fre.ass') expect(cueTimings(file, entries)).toEqual(timesOf(expected));
    }
  });
});

describe('compressed tracks', () => {
  it('reads zlib text where the engine can inflate it', async () => {
    const file = await open('zlib.mkv');
    const track = file.tracks.find((one) => one.number === 2)!;
    expect(track.compression).toBe('zlib');
    expect(track.unreadable).toBeUndefined();
    const { cues } = await linesOf(file, 2);
    expect(cues).toEqual(await sourceCues('eng.srt'));
  });

  it('marks zlib text unreadable where the engine has no DecompressionStream, timing still read', async () => {
    const file = await open('zlib.mkv', { inflate: null });
    const track = file.tracks.find((one) => one.number === 2)!;
    expect(track.unreadable).toBe('compression');
    const read = await readMatroskaCues(file, [2]);
    if (!read.ok) throw new Error(read.reason);
    expect(cueTimings(file, read.cues.entries.get(2)!)).toEqual(
      timesOf(await sourceCues('eng.srt')),
    );
  });
});

describe('a second SeekHead', () => {
  it('is followed from the first, and the lines read as usual', async () => {
    const file = await open('seekhead.mkv');
    expect(file.seekHeads).toBe(2);
    const { cues } = await linesOf(file, 2);
    expect(cues).toEqual(await sourceCues('eng.srt'));
  });
});

describe('files the reader turns away early', () => {
  it('takes a file that is not Matroska for what it is, from the first read', async () => {
    const source = fakeBytesSource(await readFixture('text/eng.srt'));
    const opened = await openMatroska(source);
    expect(opened).toMatchObject({ ok: false, reason: 'not-matroska' });
    expect(source.reads).toHaveLength(1);
  });

  it('turns away a live recording, which has no Cues, from the first read', async () => {
    const source = fakeBytesSource(await readFixture('live.mkv'));
    const opened = await openMatroska(source);
    expect(opened).toMatchObject({ ok: false, reason: 'unseekable' });
    expect(source.reads).toHaveLength(1);
  });

  it('turns away Cues from before 2013, video only and without relative positions, after their first read', async () => {
    const bytes = await readFixture('old-cues.mkv');
    const source = fakeBytesSource(bytes);
    const opened = await openMatroska(source, { headRead: 4096 });
    if (!opened.ok) throw new Error(opened.reason);
    const before = source.reads.length;
    const read = await readMatroskaCues(opened.file, undefined, { firstRead: 128 });
    expect(read).toEqual({ ok: false, reason: 'cues-video-only' });
    // One read of the Cues: the rest of them is never asked for.
    expect(source.reads.slice(before)).toEqual([{ start: opened.file.cuesPosition, length: 128 }]);
    // The head (4 KB, then Info and Tracks by the SeekHead) and that read.
    expect(source.bytes).toBeLessThan(16 * 1024);
  });

  it('turns away Cues that index only video, read whole', async () => {
    const file = await open('video-cues.mkv');
    expect(await readMatroskaCues(file)).toEqual({ ok: false, reason: 'cues-video-only' });
    expect(file.stats.requests).toBe(2);
  });
});

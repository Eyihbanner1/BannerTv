import { describe, expect, it } from 'vitest';
import { parseSubtitleText } from '../subtitles/parse';
import type { Cue } from '../subtitles/types';
import {
  fakeBytesSource,
  type FakeSource,
  partsSource,
  readFixture,
  readFixtureText,
} from './fixtures/helpers';
import { type SyntheticLine, synthesize } from './fixtures/synthetic';
import { type CueEntry, type MatroskaFile, openMatroska, readMatroskaCues } from './matroska';
import {
  createMatroskaWindow,
  type MatroskaWindowOptions,
  type WindowClock,
} from './matroska-window';
import type { ReadSignal } from './source';

/**
 * A two-hour film as a reader meets it on a debrid link: 5 Mbit/s of video
 * (as runs of zeros), a Cluster every 5 s, and an English track of 1,530
 * lines, one about every 4.8 s, with a second speaker 100 ms after every
 * fiftieth line, so two blocks sit side by side.
 */
const FILM_LENGTH = 2 * 3600 * 1000;

function filmLines(): SyntheticLine[] {
  const list: SyntheticLine[] = [];
  for (let i = 0; i < 1500; i++) {
    const time = 2000 + i * 4790 + ((i * 37) % 400);
    const text = `Line ${i + 1}: something a character says${i % 3 === 0 ? ', at a little more length than most' : ''}.`;
    list.push({ track: 2, time, duration: 1500 + (i % 7) * 300, text });
    if (i % 50 === 0)
      list.push({ track: 2, time: time + 100, duration: 1200, text: `Reply to line ${i + 1}.` });
  }
  return list;
}

const LINES = filmLines();
let film: ReturnType<typeof synthesize> | undefined;

function filmParts() {
  film ??= synthesize({
    length: FILM_LENGTH,
    tracks: [{ number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' }],
    lines: LINES,
    clusterLength: 5000,
    frameRate: 1,
    videoRate: 625000,
  });
  return film.parts;
}

async function openFilm(source: FakeSource) {
  const opened = await openMatroska(source);
  if (!opened.ok) throw new Error(opened.reason);
  const read = await readMatroskaCues(opened.file, [2]);
  if (!read.ok) throw new Error(read.reason);
  return { file: opened.file, entries: read.cues.entries.get(2)! };
}

function expectedCue(line: SyntheticLine): Cue {
  return {
    start: line.time / 1000,
    end: (line.time + line.duration!) / 1000,
    lines: [[{ text: line.text }]],
  };
}

/** The lines a window at `time` holds, as the film was written. */
function linesAround(time: number, behind = 5, ahead = 120): SyntheticLine[] {
  return LINES.filter(
    (line) =>
      line.time / 1000 < time + ahead && (line.time + line.duration!) / 1000 > time - behind,
  );
}

/** Reads for those lines: one each, but one for a line and the reply 100 ms after it. */
function readsFor(lines: readonly SyntheticLine[]): number {
  return lines.filter((line) => !line.text.startsWith('Reply')).length;
}

async function windowOn(options: MatroskaWindowOptions = {}) {
  const source = partsSource(filmParts());
  const { file, entries } = await openFilm(source);
  const headReads = source.reads.length;
  const headBytes = source.bytes;
  // The signal each read for lines was made with.
  const signals: ReadSignal[] = [];
  const read = file.source.read;
  file.source.read = (start, length, signal) => {
    if (signal) signals.push(signal);
    return read(start, length, signal);
  };
  const window = createMatroskaWindow(file, 2, entries, { clock: fakeClock(), ...options });
  return { source, file, entries, window, headReads, headBytes, signals };
}

/** A clock that moves only when told to, firing the timers due on the way in order. */
function fakeClock(): WindowClock & { advance(ms: number): void } {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      timers.set(++id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let due: number | undefined;
        for (const [key, timer] of timers) {
          if (timer.at <= until && (due === undefined || timer.at < timers.get(due)!.at)) due = key;
        }
        if (due === undefined) break;
        const timer = timers.get(due)!;
        timers.delete(due);
        now = timer.at;
        timer.callback();
      }
      now = until;
    },
  };
}

describe('a two-hour film', () => {
  it('gives its head and the whole track timing in three reads', async () => {
    const source = partsSource(filmParts());
    const { file, entries } = await openFilm(source);
    expect(file.duration).toBe(7200);
    expect(entries).toHaveLength(LINES.length);
    expect(source.reads).toHaveLength(3);
    expect(source.bytes).toBeLessThan(200 * 1024);
  });

  it('loads the first two minutes in one read a line, four at a time, a line and its reply in one', async () => {
    const { source, window, headReads } = await windowOn();
    window.update(0);
    await window.settled();
    const wanted = linesAround(0);
    expect(window.cues()).toEqual(wanted.map(expectedCue));
    expect(source.reads.length - headReads).toBe(readsFor(wanted));
    expect(source.peakInFlight).toBe(4);
    const stats = window.stats();
    expect(stats.requests).toBe(readsFor(wanted));
    expect(stats.peakInFlight).toBe(4);
    expect(stats.fallbacks).toBe(0);
    expect(stats.headReads).toBe(0);
    expect(stats.rereads).toBe(0);
  });

  it('keeps a minute or more ahead loaded through the whole film, each line read once', async () => {
    const { window } = await windowOn();
    let changes = 0;
    window.onChange(() => changes++);
    for (let time = 0; time <= 7200; time += 0.5) {
      window.update(time);
      await window.settled();
      if (time % 600 === 0) {
        const loaded = new Set(window.cues().map((cue) => cue.start));
        for (const line of linesAround(time, 0, 60))
          expect(loaded.has(line.time / 1000)).toBe(true);
      }
    }
    const stats = window.stats();
    expect(stats.lines).toBe(LINES.length);
    expect(stats.requests).toBe(readsFor(LINES));
    expect(stats.cached).toBeLessThanOrEqual(800);
    expect(stats.evicted).toBe(LINES.length - stats.cached);
    expect(stats.fallbacks + stats.headReads + stats.rereads + stats.failedReads).toBe(0);
    // About 600 bytes a line: under a megabyte for the film.
    expect(stats.bytes).toBeLessThan(1024 * 1024);
    expect(changes).toBeGreaterThan(0);
  });

  it('reads each Cluster head first, at twice the requests, when asked to', async () => {
    const { window } = await windowOn({ clusterHeads: 'always' });
    window.update(0);
    await window.settled();
    const wanted = linesAround(0);
    expect(window.cues()).toEqual(wanted.map(expectedCue));
    const stats = window.stats();
    expect(stats.headReads).toBe(new Set(wanted.map((line) => Math.floor(line.time / 5000))).size);
    expect(stats.requests).toBe(readsFor(wanted) + stats.headReads);
  });

  it('drops the reads not yet made after a seek, aborts those in flight, and loads the new window first', async () => {
    const { window, source, headReads, signals } = await windowOn();
    window.update(0);
    // Four reads are in flight; the seek comes before any lands.
    window.update(3600);
    expect(signals.slice(0, 4).map((signal) => signal.aborted)).toEqual([true, true, true, true]);
    await window.settled();
    const wanted = linesAround(3600);
    expect(source.reads.length - headReads).toBe(4 + readsFor(wanted));
    const cues = window.cues();
    expect(cues).toEqual(wanted.map(expectedCue));
    expect(window.stats()).toMatchObject({ aborted: 4, failedReads: 0, inFlight: 0 });
    expect(signals.slice(4).some((signal) => signal.aborted)).toBe(false);
  });

  it('keeps the reads in flight that a short rewind still wants', async () => {
    const { window, signals } = await windowOn();
    window.update(30);
    window.update(28);
    await window.settled();
    expect(signals.some((signal) => signal.aborted)).toBe(false);
    expect(window.cues()).toEqual(linesAround(28).map(expectedCue));
  });

  it('reads lines again after a rewind past what its bounded cache kept', async () => {
    const { window } = await windowOn({ maxLines: 40 });
    for (let time = 0; time <= 600; time += 1) {
      window.update(time);
      await window.settled();
    }
    expect(window.stats().cached).toBeLessThanOrEqual(40);
    expect(window.cues().some((cue) => cue.start < 100)).toBe(false);
    window.update(0);
    await window.settled();
    expect(window.cues().filter((cue) => cue.start < 120)).toEqual(linesAround(0).map(expectedCue));
    expect(window.stats().evicted).toBeGreaterThan(0);
  });

  it('tries a failed read again after 1 s, 2 s and 4 s, until the source answers', async () => {
    const source = partsSource(filmParts());
    const { file, entries } = await openFilm(source);
    // Every read past the first 2 MB (the lines after the first Cluster) is refused while down.
    let down = true;
    let refused = 0;
    const failing = {
      size: source.size,
      read(start: number, length: number) {
        if (start <= 2000000 || !down) return source.read(start, length);
        refused++;
        return Promise.reject(new Error('refused'));
      },
    };
    const clock = fakeClock();
    const window = createMatroskaWindow({ ...file, source: failing }, 2, entries, {
      ahead: 10,
      refill: 5,
      clock,
    });
    const wanted = linesAround(0, 5, 10);
    window.update(0);
    await window.settled();
    expect(refused).toBe(1);
    expect(window.stats()).toMatchObject({ failedReads: 1, waiting: 1 });
    // Ticks do not hurry it.
    for (let tick = 1; tick < 4; tick++) {
      clock.advance(250);
      window.update(tick / 4);
      await window.settled();
    }
    expect(refused).toBe(1);
    clock.advance(250);
    await window.settled();
    expect(refused).toBe(2);
    clock.advance(1999);
    await window.settled();
    expect(refused).toBe(2);
    clock.advance(1);
    await window.settled();
    expect(refused).toBe(3);
    down = false;
    clock.advance(4000);
    await window.settled();
    expect(refused).toBe(3);
    expect(window.cues()).toEqual(wanted.map(expectedCue));
    expect(window.stats()).toMatchObject({ failedReads: 3, waiting: 0 });
  });

  it('waits at most 30 s between tries, and tries again at once after a seek', async () => {
    const source = partsSource(filmParts());
    const { file, entries } = await openFilm(source);
    let down = true;
    let refused = 0;
    const failing = {
      size: source.size,
      read(start: number, length: number) {
        if (!down) return source.read(start, length);
        refused++;
        return Promise.reject(new Error('refused'));
      },
    };
    const clock = fakeClock();
    const window = createMatroskaWindow({ ...file, source: failing }, 2, entries, {
      ahead: 10,
      refill: 5,
      maxInFlight: 1,
      mergeGap: 1e9,
      maxRead: 1e9,
      clock,
    });
    window.update(1000);
    await window.settled();
    const waits: number[] = [];
    let last = 0;
    while (clock.now() < 200000) {
      clock.advance(500);
      await window.settled();
      if (refused !== waits.length + 1) {
        waits.push(clock.now() - last);
        last = clock.now();
      }
    }
    expect(waits.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    down = false;
    window.update(1000);
    window.update(980);
    await window.settled();
    expect(window.cues()).toEqual(linesAround(980, 5, 10).map(expectedCue));
  });

  it('aborts a read that takes more than 15 s, counts it failed, and frees its place', async () => {
    const source = partsSource(filmParts());
    const { file, entries } = await openFilm(source);
    let stalled = true;
    const signals: ReadSignal[] = [];
    const stalling = {
      size: source.size,
      read(start: number, length: number, signal?: ReadSignal) {
        if (signal) signals.push(signal);
        return stalled ? new Promise<Uint8Array>(() => undefined) : source.read(start, length);
      },
    };
    const clock = fakeClock();
    const window = createMatroskaWindow({ ...file, source: stalling }, 2, entries, { clock });
    window.update(0);
    await Promise.resolve();
    expect(window.stats()).toMatchObject({ inFlight: 4, timedOut: 0 });
    clock.advance(14999);
    expect(window.stats().inFlight).toBe(4);
    stalled = false;
    clock.advance(1);
    // The four that hung are aborted and their places taken by the reads queued behind them.
    expect(signals.slice(0, 4).map((signal) => signal.aborted)).toEqual([true, true, true, true]);
    expect(window.stats()).toMatchObject({ timedOut: 4, failedReads: 4 });
    await window.settled();
    clock.advance(1000);
    await window.settled();
    expect(window.cues()).toEqual(linesAround(0).map(expectedCue));
    expect(window.stats()).toMatchObject({ inFlight: 0, waiting: 0 });
  });

  it('keeps the lines up at the playhead through a stretch of twelve lines a second', async () => {
    const dense: SyntheticLine[] = [];
    for (let time = 10000; time < 900000; time += 4000) {
      if (time < 600000 || time > 700000)
        dense.push({ track: 2, time, duration: 2000, text: `Line at ${time}` });
    }
    for (let time = 600000; time < 690000; time += 83) {
      dense.push({ track: 2, time, duration: 400, text: `Syllable at ${time}` });
    }
    dense.sort((a, b) => a.time - b.time);
    const { parts } = synthesize({
      length: 900000,
      tracks: [{ number: 2, codecId: 'S_TEXT/UTF8', language: 'eng' }],
      lines: dense,
      clusterLength: 5000,
      frameRate: 1,
      videoRate: 625000,
    });
    const source = partsSource(parts);
    const { file, entries } = await openFilm(source);
    const window = createMatroskaWindow(file, 2, entries, { clock: fakeClock() });
    let missing = 0;
    let checks = 0;
    let most = 0;
    for (let time = 590; time < 700; time += 0.25) {
      window.update(time);
      await window.settled();
      most = Math.max(most, window.stats().cached);
      const shown = new Set(window.cues().map((cue) => cue.start));
      for (const line of dense) {
        if (line.time / 1000 <= time && (line.time + line.duration!) / 1000 > time) {
          checks++;
          if (!shown.has(line.time / 1000)) missing++;
        }
      }
    }
    expect(checks).toBeGreaterThan(1000);
    expect(missing).toBe(0);
    expect(most).toBeLessThanOrEqual(800);
    expect(window.stats().evicted).toBeGreaterThan(0);
  });

  it('stops reading once closed', async () => {
    const { window, source, headReads } = await windowOn();
    window.update(0);
    window.close();
    await window.settled();
    window.update(10);
    expect(source.reads.length - headReads).toBe(4);
    expect(window.cues()).toEqual([]);
  });

  it('keeps handing back the same array until a line is read or let go', async () => {
    const { window } = await windowOn();
    window.update(0);
    await window.settled();
    const first = window.cues();
    window.update(1);
    expect(window.cues()).toBe(first);
  });
});

describe('a window over an mkvmerge file', () => {
  async function open(): Promise<{ file: MatroskaFile; entries: CueEntry[]; source: FakeSource }> {
    const source = fakeBytesSource(await readFixture('mkvmerge.mkv'));
    const opened = await openMatroska(source);
    if (!opened.ok) throw new Error(opened.reason);
    const read = await readMatroskaCues(opened.file, [2]);
    if (!read.ok) throw new Error(read.reason);
    return { file: opened.file, entries: read.cues.entries.get(2)!, source };
  }

  it('holds the lines around the playhead, and the new ones after a seek', async () => {
    const { file, entries } = await open();
    const all = parseSubtitleText(await readFixtureText('text/eng.srt'));
    const window = createMatroskaWindow(file, 2, entries, {
      behind: 2,
      ahead: 10,
      refill: 5,
      mergeGap: 0,
      maxRead: 512,
    });
    window.update(0);
    await window.settled();
    expect(window.cues()).toEqual(all.filter((cue) => cue.start < 10));
    window.update(40);
    await window.settled();
    expect(window.cues()).toEqual(
      all.filter((cue) => cue.start < 10 || (cue.start < 50 && cue.end > 38)),
    );
    expect(window.timings).toHaveLength(20);
  });
});

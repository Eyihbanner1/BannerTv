import type { Cue, LineTiming, SubtitleAlignment, VideoLength } from '@bannertv/core';
import { profileSubtitles, videoFacts } from '@bannertv/core';
import { describe, expect, it, vi } from 'vitest';
import cases from '../../../../packages/core/src/subtitles/fixtures/agreement-cases.json';
import timings from '../../../../packages/core/src/subtitles/fixtures/agreement-rainmaker-timings.json';
import {
  AGREEMENT_DOWNLOADS,
  type AgreementOption,
  type AgreementStart,
  createAgreementRunner,
  type RunnerDecision,
} from './subtitle-agreement';
import { timingOf } from './subtitle-align';
import type { AgreementTrace } from './subtitle-trace';

// The Rainmaker episodes of the core fixture (packages/core/src/subtitles/fixtures/README.md),
// played through the runner with step B's real aligner: only ids, names and timings, and a few
// letters of the language's script as each line's text.

interface Case {
  tag: string;
  key: string;
  viewer: string;
  video: { filename: string | null; title: string | null };
  files: Array<{ id: string; lang: string; label?: string; releaseName?: string; lines: number }>;
  read: string[];
  ranked: string[];
  pairs: Array<[string, string, number, number, string]>;
  expected: { today: string; shown: string };
}

const caseOf = (tag: string) => (cases as unknown as Case[]).find((c) => c.tag === tag)!;

/** Letters of each language's own script, as a file's text: never a line of dialogue. */
const LETTERS: Readonly<Record<string, string>> = { ara: 'ا ب ت', heb: 'א ב ג', rus: 'а б в' };

/** The fixture's timings: `[gap from the previous end, duration, …]` in hundredths of a second. */
function decode(deltas: readonly number[], lang: string): Cue[] {
  const text = LETTERS[lang] ?? 'a b c';
  const cues: Cue[] = [];
  let t = 0;
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    const start = t + deltas[i]!;
    const end = start + deltas[i + 1]!;
    cues.push({ start: start / 100, end: end / 100, lines: [[{ text }]] });
    t = end;
  }
  return cues;
}

const urlOf = (id: string) => `https://subs.example/${id}.srt`;

interface Played {
  start: AgreementStart;
  /** Each file's cues, by link: none for a file the fixture did not read. */
  cues: Map<string, Cue[]>;
}

/** The case's files offered, the first two of the viewer's read by the planner already. */
function played(tag: string): Played {
  const c = caseOf(tag);
  const byId = (timings as Record<string, Record<string, number[]>>)[c.key]!;
  const langOf = new Map(c.files.map((file) => [file.id, file.lang]));
  const cues = new Map(
    Object.keys(byId).map((id) => [urlOf(id), decode(byId[id]!, langOf.get(id)!)]),
  );
  const option = (file: Case['files'][number]): AgreementOption => ({
    key: file.id,
    url: urlOf(file.id),
    lang: file.lang,
    label: file.label ?? file.id,
    releaseName: file.releaseName,
  });
  const files = c.files.map(option);
  const byKey = new Map(files.map((file) => [file.key, file]));
  const ends = Array.from(cues.values(), (list) => list[list.length - 1]!.end);
  const length: VideoLength = { seconds: Math.max(...ends) + 30, exact: false };
  const read = new Set(c.ranked.slice(0, 2).map(urlOf));
  return {
    cues,
    start: {
      video: videoFacts(c.video.filename ?? undefined, c.video.title ?? undefined),
      length,
      today: byKey.get(c.expected.today)!,
      ranked: c.ranked.map((id) => byKey.get(id)!),
      files,
      known: (url) => {
        if (!read.has(url)) return undefined;
        const list = cues.get(url)!;
        return { lines: timingOf(list), profile: profileSubtitles(list) };
      },
      canSwitch: () => true,
    },
  };
}

/** A loader that counts what it is asked, and answers in the order `order` gives. */
function loader(cues: Map<string, Cue[]>, { reverse = false } = {}) {
  const asked: string[] = [];
  let open = 0;
  let most = 0;
  const waiting: Array<() => void> = [];
  const flush = () => {
    const now = waiting.splice(0);
    (reverse ? now.reverse() : now).forEach((answer) => answer());
  };
  const load = (file: AgreementOption) =>
    new Promise<Cue[]>((resolve) => {
      asked.push(file.url);
      open++;
      most = Math.max(most, open);
      waiting.push(() => {
        open--;
        resolve(cues.get(file.url) ?? []);
      });
      // Answered together, a turn later: in the order asked, or the other way round.
      setTimeout(flush, 0);
    });
  return { load, asked, most: () => most };
}

const slicing = () => {
  let now = 0;
  return { now: () => now++, pause: () => Promise.resolve(), sliceMs: 1e9 };
};

async function decided(runner: ReturnType<typeof createAgreementRunner>) {
  await vi.waitFor(() => expect(runner.decision()).not.toBeNull(), { timeout: 20000 });
  return runner.decision()!;
}

describe('the runner of files that agree on the TV', () => {
  it('moves E6 onto the AMZN files, four downloads at a time, none read twice', async () => {
    const { start, cues } = played('RM-E6');
    const loads = loader(cues);
    const traces: AgreementTrace[] = [];
    let turns = 0;
    const runner = createAgreementRunner({
      load: loads.load,
      slicing: slicing(),
      turn: () => {
        turns++;
        return Promise.resolve();
      },
    });
    runner.traced((trace) => traces.push(trace));
    runner.start(start);
    expect(runner.state()).toEqual({ active: true, decision: null });
    const decision = await decided(runner);
    expect(decision).toMatchObject({
      state: 'moved',
      show: '13283587',
      showUrl: urlOf('13283587'),
      leader: { url: urlOf('13283717') },
    });
    const shown = decision as Extract<RunnerDecision, { leader: unknown }>;
    expect(shown.within[0]).toBe(urlOf('13283717'));
    expect(shown.within).not.toContain(urlOf('13283587'));
    expect(shown.leader.lines.length).toBe(cues.get(urlOf('13283717'))!.length);
    expect(shown.record).toMatchObject({
      reference: 'agreed',
      referenceId: urlOf('13283717'),
      final: true,
      agreed: { within: false, via: 'pair' },
      alignment: { rate: 1, confidence: 'sure' },
    });
    expect(shown.record!.alignment.offset).toBeCloseTo(-8.73, 1);
    expect(shown.trace).toMatchObject({
      state: 'moved',
      best: 9,
      second: 3,
      service: 'amzn',
      read: 28,
      aligned: 176,
    });
    expect((shown.trace as { offset: number }).offset).toBeCloseTo(-8.73, 1);
    // Each pair waits for step B's own runs, once.
    expect(turns).toBe(176);
    // The planner's two are not downloaded; nothing is downloaded twice, nor more than four at once.
    const known = caseOf('RM-E6').ranked.slice(0, 2).map(urlOf);
    expect(loads.asked.filter((url) => known.includes(url))).toEqual([]);
    expect(new Set(loads.asked).size).toBe(loads.asked.length);
    expect(loads.asked.length).toBeGreaterThanOrEqual(26);
    expect(loads.asked.length).toBeLessThanOrEqual(26 + AGREEMENT_DOWNLOADS);
    expect(loads.most()).toBeLessThanOrEqual(AGREEMENT_DOWNLOADS);
    // Diagnostics is told as it reads, and then what it decided.
    expect(traces[0]).toMatchObject({ state: 'reading' });
    expect(traces[traces.length - 1]).toEqual(shown.trace);
    expect(runner.state()).toEqual({ active: true, decision });
  }, 30000);

  it('decides the same whatever order the downloads end in', async () => {
    const { start, cues } = played('RM-E6');
    const runner = createAgreementRunner({
      load: loader(cues, { reverse: true }).load,
      slicing: slicing(),
    });
    runner.start(start);
    const decision = await decided(runner);
    expect(decision).toMatchObject({ state: 'moved', show: '13283587' });
    expect(decision.trace).toMatchObject({ read: 28, aligned: 176, best: 9, second: 3 });
  }, 30000);

  it('keeps E5, and decides again for another stream from what it read and lined up', async () => {
    const { start, cues } = played('RM-E5');
    const loads = loader(cues);
    let turns = 0;
    const runner = createAgreementRunner({
      load: loads.load,
      slicing: slicing(),
      turn: () => {
        turns++;
        return Promise.resolve();
      },
    });
    runner.start(start);
    const first = await decided(runner);
    expect(first).toMatchObject({ state: 'kept', show: '13260775', within: expect.any(Array) });
    expect(first.trace).toMatchObject({ state: 'kept', best: 7, second: 3, read: 12, aligned: 46 });
    // The file showing is the leader: nothing to hand over for it.
    expect((first as { record?: unknown }).record).toBeUndefined();
    const downloads = loads.asked.length;
    expect(turns).toBe(46);
    // The same start again changes nothing.
    runner.start({ ...start, canSwitch: () => false });
    expect(runner.decision()).toBe(first);
    // Another stream: decided afresh, with no download and nothing lined up again.
    runner.stop();
    expect(runner.state()).toEqual({ active: false, decision: null });
    runner.start({ ...start, files: [...start.files] });
    // All of it read and lined up already: decided at once.
    const again = runner.decision()!;
    expect(again).toMatchObject({ state: 'kept', show: '13260775' });
    expect(loads.asked.length).toBe(downloads);
    expect(turns).toBe(46);
    // Another video forgets them.
    runner.forget();
    runner.start(start);
    await decided(runner);
    expect(loads.asked.length).toBe(downloads * 2);
  }, 30000);

  it('does not try for a video that names no source, and downloads nothing', async () => {
    const { start, cues } = played('RM-E5');
    const loads = loader(cues);
    const runner = createAgreementRunner({ load: loads.load, slicing: slicing() });
    runner.start({ ...start, video: videoFacts('The.Rainmaker.S01E05.mkv') });
    const decision = await decided(runner);
    expect(decision).toEqual({
      state: 'not tried',
      trace: { state: 'not tried', why: 'no source' },
    });
    expect(loads.asked).toEqual([]);
    runner.start({ ...start, video: videoFacts('The.Rainmaker.S01E05.1080p.HDCAM.x264-GRP.mkv') });
    expect(await decided(runner)).toMatchObject({ trace: { why: 'recording' } });
    expect(loads.asked).toEqual([]);
  });

  it('counts a file that fails to download as one of no use, and stops when told', async () => {
    const { start, cues } = played('RM-E5');
    const failing = createAgreementRunner({
      load: () => Promise.reject(new Error('offline')),
      slicing: slicing(),
    });
    failing.start(start);
    const decision = await decided(failing);
    // Only the planner's two could be read, of the 20 tried: too few to agree on anything.
    expect(decision).toMatchObject({ state: 'none', why: 'under' });
    expect(decision.trace).toMatchObject({ state: 'none', read: 20 });
    const stopped = createAgreementRunner({ load: loader(cues).load, slicing: slicing() });
    const told: string[] = [];
    stopped.subscribe(() => told.push(stopped.state().active ? 'active' : 'idle'));
    stopped.start(start);
    stopped.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped.decision()).toBeNull();
    expect(told).toEqual(['active', 'idle']);
  });

  it('answers a case of the fixture as it was measured, switching only where it may', async () => {
    const c = caseOf('X1');
    const world = madeWorld(
      c.files.map((file) => ({ ...file, key: file.id })),
      fromTable(c.pairs),
    );
    const option = (file: Case['files'][number]): AgreementOption => ({
      key: file.id,
      url: urlOf(file.id),
      lang: file.lang,
      label: file.label ?? file.id,
      releaseName: file.releaseName,
    });
    const files = c.files.map(option);
    const byKey = new Map(files.map((file) => [file.key, file]));
    const start = (canSwitch: boolean): AgreementStart => ({
      video: videoFacts(c.video.filename ?? undefined, c.video.title ?? undefined),
      length: { seconds: LENGTH_S, exact: false },
      today: byKey.get(c.expected.today)!,
      ranked: c.ranked.map((id) => byKey.get(id)!),
      files,
      known: () => undefined,
      canSwitch: () => canSwitch,
    });
    const traces: AgreementTrace[] = [];
    const runner = createAgreementRunner({
      load: world.load,
      slicing: slicing(),
      align: world.align,
    });
    runner.traced((trace) => traces.push(trace));
    runner.start(start(true));
    const switched = await decided(runner);
    expect(switched).toMatchObject({
      state: 'switched',
      show: c.expected.shown,
      showUrl: urlOf(c.expected.shown),
      // The winner's leader is in another language: the file switched to is in step with it.
      leader: { url: urlOf('7726265') },
      record: { reference: 'agreed', agreed: { within: true, via: 'pair' } },
    });
    // The pairs the study asked for, in its order, each once.
    expect(world.asked).toEqual(c.pairs.map(([a, b]) => `${a}|${b}`));
    const place = files
      .filter((file) => file.lang === c.viewer)
      .findIndex((file) => file.key === c.expected.shown);
    expect(switched.trace).toMatchObject({
      state: 'switched',
      best: 6,
      second: 3,
      read: c.read.length,
      aligned: c.pairs.length,
      file: place + 1,
    });
    // Where no other file may take over, as measured: the file showing lines up with none of
    // the winner, so nothing is done.
    const kept = createAgreementRunner({
      load: world.load,
      slicing: slicing(),
      align: madeWorld(
        c.files.map((file) => ({ ...file, key: file.id })),
        fromTable(c.pairs),
      ).align,
    });
    kept.traced((trace) => traces.push(trace));
    kept.start(start(false));
    expect(await decided(kept)).toMatchObject({
      state: 'none',
      why: 'unmatched',
      trace: { why: { kind: 'unmatched', best: 6, second: 3 } },
    });
    // Diagnostics is never told a link.
    expect(traces.length).toBeGreaterThan(2);
    expect(JSON.stringify(traces)).not.toContain('://');
  });

  it('shifts the file showing by the winner’s timing where another may not take over', async () => {
    const WEB = 'Show.S01E01.1080p.WEB.h264';
    const AMZN = 'Show.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264';
    // The file showing 8 s out; the winner's leader and two more in step with it, one 0.2 s off.
    const made = [
      { key: 'a', lang: 'eng', label: `${WEB}-ETHEL.srt`, lines: 900, at: 8 },
      { key: 'n', lang: 'eng', label: `${AMZN}-NTb.srt`, lines: 900, at: 0 },
      { key: 'f', lang: 'fre', label: `${AMZN}-FLUX.srt`, lines: 900, at: 0 },
      { key: 'k', lang: 'eng', label: `${AMZN}-KiNGS.srt`, lines: 900, at: 0.2 },
    ];
    // The file showing is not sure against the leader.
    const unsure = new Set(['a|n', 'n|a']);
    const atOf = new Map(made.map((file) => [file.key, file.at]));
    const world = madeWorld(made, (candidate, reference) =>
      unsure.has(`${candidate}|${reference}`)
        ? { offset: 5, rate: 1, confidence: 'unsure' }
        : { offset: atOf.get(reference)! - atOf.get(candidate)!, rate: 1, confidence: 'sure' },
    );
    const files = made.map((file): AgreementOption => ({
      key: file.key,
      url: urlOf(file.key),
      lang: file.lang,
      label: file.label,
    }));
    const start = (canSwitch: boolean): AgreementStart => ({
      video: videoFacts(`${AMZN}-GRP.mkv`),
      length: { seconds: LENGTH_S, exact: false },
      today: files[0]!,
      ranked: files.filter((file) => file.lang === 'eng'),
      files,
      known: () => undefined,
      canSwitch: () => canSwitch,
    });
    const runner = createAgreementRunner({
      load: world.load,
      slicing: slicing(),
      align: world.align,
    });
    runner.start(start(false));
    const shifted = await decided(runner);
    expect(shifted).toMatchObject({
      state: 'shifted',
      show: 'a',
      leader: { url: urlOf('n') },
      record: {
        reference: 'agreed',
        referenceId: urlOf('n'),
        agreed: { within: false, via: 'group' },
        alignment: { rate: 1, confidence: 'sure' },
      },
    });
    const record = (shifted as { record: { alignment: { offset: number } } }).record;
    expect(record.alignment.offset).toBeCloseTo(-7.8, 6);
    expect(shifted.trace).toMatchObject({ state: 'shifted', best: 9, offset: -7.8 });
    // Where another may take over, the winner's file in the language the planner ranks best.
    runner.stop();
    runner.start(start(true));
    expect(await decided(runner)).toMatchObject({ state: 'switched', show: 'n' });
  });
});

/** Seconds of the made-up video. */
const LENGTH_S = 2700;

type Answer = { offset: number; rate: number; confidence: string };

/** The answers a case of the fixture holds, by candidate and reference. */
function fromTable(
  pairs: Case['pairs'],
): (candidate: string, reference: string) => Answer | undefined {
  const table = new Map(
    pairs.map(([a, b, offset, rate, confidence]) => [`${a}|${b}`, { offset, rate, confidence }]),
  );
  return (candidate, reference) => table.get(`${candidate}|${reference}`);
}

/**
 * Files of made-up lines, each its count of them spread over the video and told apart by its
 * first line's start, with text with no letters (so no script is judged); downloads that end
 * at uneven times; and an aligner that answers as `answer` says, failing on a pair it has no
 * answer for or one asked twice.
 */
function madeWorld(
  files: ReadonlyArray<{ key: string; lines: number }>,
  answer: (candidate: string, reference: string) => Answer | undefined,
) {
  const cuesOf = new Map<string, Cue[]>();
  const keyAt = new Map<number, string>();
  files.forEach((file, n) => {
    const first = 1 + n / 1000;
    keyAt.set(Math.round(first * 1000), file.key);
    const step = (LENGTH_S - 100) / file.lines;
    cuesOf.set(
      urlOf(file.key),
      Array.from({ length: file.lines }, (_, i) => ({
        start: first + i * step,
        end: first + i * step + 2,
        lines: [[{ text: '1 2 3' }]],
      })),
    );
  });
  const keyOf = (lines: readonly LineTiming[]) => keyAt.get(Math.round(lines[0]!.start * 1000))!;
  const asked: string[] = [];
  const align = (candidate: readonly LineTiming[], reference: readonly LineTiming[]) => {
    const pair = `${keyOf(candidate)}|${keyOf(reference)}`;
    const found = answer(keyOf(candidate), keyOf(reference));
    if (!found) throw new Error(`no answer for ${pair}`);
    if (asked.includes(pair)) throw new Error(`asked twice: ${pair}`);
    asked.push(pair);
    const alignment: SubtitleAlignment = {
      offset: found.offset,
      rate: found.rate,
      confidence: found.confidence as SubtitleAlignment['confidence'],
      score: 0,
      matched: 0,
      chance: 0,
      spread: 0,
      prominence: 0,
      windows: [],
      drift: 0,
      covered: 0,
      coveredShare: 1,
    };
    return Promise.resolve(alignment);
  };
  const load = (file: AgreementOption) =>
    new Promise<Cue[]>((resolve) =>
      setTimeout(
        () => resolve(cuesOf.get(file.url)!),
        (file.key.length % 5) * 3 + (file.key.charCodeAt(0) % 4),
      ),
    );
  return { load, align, asked };
}

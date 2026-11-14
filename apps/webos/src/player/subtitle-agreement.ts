import {
  type Agreement,
  type AgreementDecision,
  type AgreementLimits,
  type AgreementWhy,
  alignSubtitlesInSlices,
  createAgreement,
  type Cue,
  judgeSubtitleFit,
  languageKey,
  type LineTiming,
  type NameFacts,
  profileSubtitles,
  type Slicing,
  type SubtitleAlignment,
  type SubtitleProfile,
  type VideoLength,
} from '@bannertv/core';
import { mark } from '../platform/marks';
import {
  type AlignRecord,
  COMPLETE,
  MIN_REFERENCE_LINES,
  PAGE_SLICING,
  readsWhole,
  timingOf,
} from './subtitle-align';
import type { AgreementTrace } from './subtitle-trace';
import type { SubtitleOption } from './subtitles';

/*
 * Files that agree with each other (ADR 0003 item 9), run on the TV: the
 * decision (`createAgreement` in core) asks for files' lines and for files
 * lined up against each other, and this answers. Downloads go four at a
 * time, running ahead in the order the decision reads; the files the planner
 * read already are taken from it, not downloaded again; lining up runs one
 * pair at a time in slices, after step B's own aligner has done its work.
 * Lines and pairs are kept for the video, in memory only, so another stream
 * of it decides again from them. Nothing here is a link to Diagnostics: the
 * trace holds counts, scores and times.
 */

/** What the runner needs of a file: who it is, its names, and its link (never traced). */
export type AgreementOption = Pick<
  SubtitleOption,
  'key' | 'url' | 'lang' | 'label' | 'releaseName'
>;

/** What deciding for the stream playing needs. */
export interface AgreementStart {
  /** The video's facts (`videoFacts`). */
  video: NameFacts;
  /** The video's length, for judging a file read whole. */
  length: VideoLength;
  /** The file showing. */
  today: AgreementOption;
  /** The viewer's files in its language, best first, as the planner ranks them. */
  ranked: readonly AgreementOption[];
  /** Every file offered that may be read, in the list's order. */
  files: readonly AgreementOption[];
  /** A file the planner has read: its lines and what they say. */
  known: (url: string) => { lines: readonly LineTiming[]; profile: SubtitleProfile } | undefined;
  /** Whether another file may take over from the one showing now. */
  canSwitch: () => boolean;
}

/** What the files that agree decided, for the hook to hand over to step B. */
export type RunnerDecision =
  | {
      state: 'kept' | 'moved' | 'shifted' | 'switched';
      /** The winner's first file read: what the file shown is lined up against. */
      leader: { url: string; lines: readonly LineTiming[] };
      /** The offered key to show, and its link. */
      show: string;
      showUrl: string;
      /** The file shown against the leader; none when it is the leader. */
      record?: AlignRecord;
      /** Links of the files in step with the leader, the leader first. */
      within: readonly string[];
      trace: AgreementTrace;
    }
  | { state: 'none'; why: AgreementWhy['kind']; trace: AgreementTrace }
  | { state: 'not tried'; trace: AgreementTrace };

export interface AgreementRunnerOptions {
  /** Downloads and reads a file. */
  load: (file: AgreementOption) => Promise<Cue[]>;
  slicing?: Slicing;
  /** Milliseconds, for the time limit and Diagnostics. */
  now?: () => number;
  /** Resolves once step B's aligner has nothing waiting: its work goes first. */
  turn?: () => Promise<void>;
  limits?: Partial<AgreementLimits>;
  /** Lines one file up against another: step B's aligner, in slices (for tests, another). */
  align?: (
    candidate: readonly LineTiming[],
    reference: readonly LineTiming[],
    slicing: Slicing,
  ) => Promise<SubtitleAlignment>;
}

/** Where the runner stands: started for the stream playing, and what it decided. */
export interface RunnerState {
  active: boolean;
  decision: RunnerDecision | null;
}

/** Files downloaded at once. */
export const AGREEMENT_DOWNLOADS = 4;

export interface AgreementRunner {
  /**
   * Decides for these files, the file showing and the stream, unless it is
   * deciding or has decided for the same already: then only what it asks
   * along the way (`known`, `canSwitch`) is taken afresh.
   */
  start(input: AgreementStart): void;
  /** Stops deciding and forgets the decision: the lines and pairs read stay. */
  stop(): void;
  /** Stops, and forgets the lines and pairs read too: for another video. */
  forget(): void;
  decision(): RunnerDecision | null;
  /** A new object each time it changes, for useSyncExternalStore. */
  state(): RunnerState;
  subscribe(listener: () => void): () => void;
  /** Told of the progress and the decision, for Diagnostics. */
  traced(listener: (trace: AgreementTrace) => void): () => void;
}

interface Pair {
  alignment: SubtitleAlignment;
  /** Milliseconds of work it took, the pauses left out. */
  ms: number;
}

interface Run {
  input: AgreementStart;
  signature: string;
  agreement: Agreement;
  byKey: Map<string, AgreementOption>;
  startedAt: number;
  wider: boolean;
  traced: string;
}

/** A made answer's other fields, for a move worked out from the files' places (a shift). */
const MADE: SubtitleAlignment = {
  offset: 0,
  rate: 1,
  score: 0,
  matched: 0,
  chance: 0,
  spread: 0,
  prominence: 0,
  confidence: 'sure',
  windows: [],
  drift: 0,
  covered: 0,
  coveredShare: 1,
};

const pairKey = (candidate: string, reference: string) => `${candidate}\n${reference}`;

/** Lines a file read whole, and long enough, gives: null for one that is no use. */
function usableLines(
  file: AgreementOption,
  lines: readonly LineTiming[],
  profile: SubtitleProfile,
  length: VideoLength,
): readonly LineTiming[] | null {
  if (lines.length < MIN_REFERENCE_LINES) return null;
  return readsWhole(judgeSubtitleFit(profile, length, file.lang)) ? lines : null;
}

export function createAgreementRunner(options: AgreementRunnerOptions): AgreementRunner {
  const slicing = options.slicing ?? PAGE_SLICING;
  const now = options.now ?? (() => Date.now());
  const turn = options.turn ?? (() => Promise.resolve());
  const align =
    options.align ??
    ((candidate, reference, sliced) => alignSubtitlesInSlices(candidate, reference, sliced));
  // Kept for the video: each file's lines by link (null for one that is no use), each pair.
  const reads = new Map<string, readonly LineTiming[] | null>();
  const pairs = new Map<string, Pair>();
  const downloading = new Set<string>();
  // Which video the reads are for: a download that ends after `forget` keeps nothing.
  let video = 0;
  const listeners = new Set<() => void>();
  const tracers = new Set<(trace: AgreementTrace) => void>();
  let run: Run | null = null;
  let decided: RunnerDecision | null = null;
  let snapshot: RunnerState = { active: false, decision: null };
  // The run waiting for a download to end.
  let wake: (() => void) | null = null;
  const changed = () => {
    snapshot = { active: run !== null, decision: decided };
    listeners.forEach((listener) => listener());
  };
  const tell = (trace: AgreementTrace) => tracers.forEach((listener) => listener(trace));
  const poke = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  /** Answers the files wanted next that are known, and downloads more, four at most at once. */
  function feed(current: Run): void {
    for (const key of current.agreement.wanted()) {
      const file = current.byKey.get(key)!;
      if (!reads.has(file.url)) {
        const known = current.input.known(file.url);
        if (known) {
          reads.set(file.url, usableLines(file, known.lines, known.profile, current.input.length));
        }
      }
      if (reads.has(file.url)) {
        current.agreement.read(key, reads.get(file.url)?.length ?? null);
        continue;
      }
      if (downloading.has(file.url) || downloading.size >= AGREEMENT_DOWNLOADS) continue;
      downloading.add(file.url);
      const { length } = current.input;
      const forVideo = video;
      options
        .load(file)
        .then(
          (cues) => {
            if (forVideo !== video) return;
            const lines = timingOf(cues);
            reads.set(
              file.url,
              usableLines(file, lines, profileSubtitles(cues, file.label), length),
            );
          },
          () => {
            if (forVideo === video) reads.set(file.url, null);
          },
        )
        .then(() => {
          downloading.delete(file.url);
          poke();
        });
    }
  }

  /** One file lined up against another, kept for the video. */
  async function alignPair(candidate: string, reference: string): Promise<Pair> {
    let paused = 0;
    const started = slicing.now();
    const alignment = await align(reads.get(candidate)!, reads.get(reference)!, {
      ...slicing,
      pause: async () => {
        const before = slicing.now();
        await slicing.pause();
        paused += slicing.now() - before;
      },
    });
    const pair = { alignment, ms: Math.max(0, slicing.now() - started - paused) };
    pairs.set(pairKey(candidate, reference), pair);
    return pair;
  }

  /** A pair as lined up, or the other way round turned about. */
  function oriented(candidate: string, reference: string): Pair | null {
    const ran = pairs.get(pairKey(candidate, reference));
    if (ran) return ran;
    const back = pairs.get(pairKey(reference, candidate));
    if (!back) return null;
    const { alignment } = back;
    const turned: SubtitleAlignment = {
      ...alignment,
      offset: -alignment.offset * alignment.rate,
      rate: 1 / alignment.rate,
      windows: [],
    };
    delete turned.split;
    return { alignment: turned, ms: back.ms };
  }

  /** The record handed to step B for the file shown, against the leader. */
  function recordOf(
    made: Extract<AgreementDecision, { leader: string }>,
    showUrl: string,
    leaderUrl: string,
  ): AlignRecord {
    const pair = oriented(showUrl, leaderUrl);
    const alignment =
      made.state === 'moved' && pair
        ? pair.alignment
        : { ...(made.state === 'shifted' || !pair ? MADE : pair.alignment), offset: made.offset };
    return {
      alignment: { ...alignment, rate: 1, confidence: 'sure' },
      reference: 'agreed',
      referenceId: leaderUrl,
      stage: COMPLETE,
      runs: 1,
      ms: pair?.ms ?? 0,
      final: true,
      agreed: {
        within: made.state === 'kept' || made.state === 'switched',
        via: made.state === 'shifted' ? 'group' : 'pair',
      },
    };
  }

  function finish(current: Run, made: AgreementDecision): void {
    if (!current.wider) mark('sub:agreed:first');
    mark('sub:agreed:done');
    const ms = Math.max(0, now() - current.startedAt);
    if (made.state === 'not tried') {
      decided = { state: 'not tried', trace: { state: 'not tried', why: made.why } };
    } else if (made.state === 'none') {
      const { read, aligned } = made;
      decided = {
        state: 'none',
        why: made.why.kind,
        trace: { state: 'none', why: made.why, read, aligned, ms },
      };
    } else {
      const urlOf = (key: string) => current.byKey.get(key)!.url;
      const leaderUrl = urlOf(made.leader);
      const showUrl = urlOf(made.show);
      const language = languageKey(current.input.today.lang);
      const place =
        current.input.files
          .filter((file) => languageKey(file.lang) === language)
          .findIndex((file) => file.key === made.show) + 1;
      const trace: AgreementTrace = {
        state: made.state,
        best: made.best,
        second: made.second,
        ...(made.service ? { service: made.service } : {}),
        read: made.read,
        aligned: made.aligned,
        ms,
        ...(made.state === 'moved' || made.state === 'shifted' ? { offset: made.offset } : {}),
        ...(made.state === 'switched' ? { file: place } : {}),
      };
      decided = {
        state: made.state,
        leader: { url: leaderUrl, lines: reads.get(leaderUrl) ?? [] },
        show: made.show,
        showUrl,
        ...(showUrl === leaderUrl ? {} : { record: recordOf(made, showUrl, leaderUrl) }),
        within: made.within.map(urlOf),
        trace,
      };
    }
    tell(decided.trace);
    changed();
  }

  /** What the run has done so far, told as it changes. */
  function progress(current: Run): void {
    if (current.agreement.stage() === 2 && !current.wider) {
      current.wider = true;
      mark('sub:agreed:first');
      mark('sub:agreed:wider');
    }
    const { read, aligned } = current.agreement.counts();
    const said = `${read}|${aligned}`;
    if (said === current.traced) return;
    current.traced = said;
    tell({ state: 'reading', read, aligned });
  }

  async function pump(current: Run): Promise<void> {
    for (;;) {
      if (run !== current) return;
      const step = current.agreement.next();
      if (step.kind === 'done') {
        finish(current, step.decision);
        return;
      }
      progress(current);
      // Downloads run ahead while files are lined up.
      feed(current);
      if (step.kind === 'read') {
        // Until a download ends, the one needed next or one ahead of it, unless it was known.
        if (!reads.has(current.byKey.get(step.key)!.url)) {
          await new Promise<void>((resume) => (wake = resume));
        }
        continue;
      }
      const candidate = current.byKey.get(step.candidate)!.url;
      const reference = current.byKey.get(step.reference)!.url;
      let pair = pairs.get(pairKey(candidate, reference));
      if (!pair) {
        await turn();
        if (run !== current) return;
        pair = await alignPair(candidate, reference);
        if (run !== current) return;
      }
      current.agreement.aligned(step.candidate, step.reference, pair.alignment);
    }
  }

  function stop(): void {
    const had = run !== null || decided !== null;
    run = null;
    decided = null;
    poke();
    if (had) changed();
  }

  return {
    start(input) {
      const { source, service, edition } = input.video;
      const signature = [
        `${source ?? ''}|${service ?? ''}|${edition ?? ''}`,
        input.today.key,
        ...input.files.map((file) => file.key),
      ].join('\n');
      if (run && run.signature === signature) {
        run.input = input;
        return;
      }
      const hadDecision = decided !== null;
      decided = null;
      const byKey = new Map(input.files.map((file) => [file.key, file] as const));
      byKey.set(input.today.key, input.today);
      const current: Run = {
        input,
        signature,
        byKey,
        startedAt: now(),
        wider: false,
        traced: '',
        agreement: createAgreement({
          video: input.video,
          language: input.today.lang,
          today: input.today.key,
          ranked: input.ranked.map((file) => file.key),
          files: Array.from(byKey.values(), (file) => ({
            key: file.key,
            lang: file.lang,
            label: file.label,
            releaseName: file.releaseName,
          })),
          limits: options.limits,
          now,
          canSwitch: () => current.input.canSwitch(),
        }),
      };
      const wasActive = run !== null;
      run = current;
      poke();
      mark('sub:agreed:start');
      if (hadDecision || !wasActive) changed();
      void pump(current);
    },
    stop,
    forget() {
      stop();
      video++;
      reads.clear();
      pairs.clear();
    },
    decision: () => decided,
    state: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    traced(listener) {
      tracers.add(listener);
      return () => {
        tracers.delete(listener);
      };
    },
  };
}

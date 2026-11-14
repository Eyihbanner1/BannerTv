/*
 * Files that agree (ADR 0003 item 9): the last way to line a subtitle file
 * up against the video, for when nothing known to fit it is there or can
 * still come (no stream track, no file linked by the video's hash, none named
 * for its release). Most files offered for a video were timed by a few
 * releases; files that line up with each other for sure, at rate 1 and
 * within 0.5 s, were timed alike. Each group of them is scored by what the
 * names say of the video's own source and streaming service, and only a
 * clear winner, confirmed by a wider read, moves the file showing.
 *
 * This is the decision alone, worked out a step at a time so the order of
 * work is fixed and testable: `next()` asks for a file's lines, or for one
 * file lined up against another, or gives the decision. The caller downloads
 * and lines up (in slices, on a TV), and answers with `read()` and
 * `aligned()`. Files join the groups strictly in the order read, whichever
 * download ends first, so the answer is the same however they arrive.
 * No I/O and no timers: a clock is passed in for the time limit.
 */

import { readNameTags, releaseEdition, type StreamingService } from '../streams/release';
import type { AlignConfidence } from './align';
import { languageKey } from './languages';
import { releaseFeatures, type SourceFamily } from './versions';

/** What a release name says that the decision weighs. */
export interface NameFacts {
  source?: SourceFamily;
  service?: StreamingService;
  /** An edition that changes the cut (`releaseEdition`). */
  edition?: string;
  group?: string;
}

function factsOf(name: string | undefined): NameFacts {
  if (!name) return {};
  const found = releaseFeatures(name);
  const facts: NameFacts = {};
  if (found.source) facts.source = found.source;
  if (found.service) facts.service = found.service;
  if (found.group) facts.group = found.group;
  const edition = releaseEdition(name);
  if (edition) facts.edition = edition;
  return facts;
}

/** The video's facts: its file name first, the stream's title filling what that leaves out. */
export function videoFacts(filename?: string, title?: string): NameFacts {
  return { ...factsOf(title), ...factsOf(filename) };
}

/** A file's facts: its own name first, the second release name its addon sends filling the rest. */
export function fileFacts(name?: string, releaseName?: string): NameFacts {
  return { ...factsOf(releaseName), ...factsOf(name) };
}

/**
 * Who made a file, so a release counts once however many languages it was
 * uploaded in: its group, else its release name with brackets, language and
 * hearing tags and separators taken out.
 */
export function groupKeyOf(
  file: { label?: string; releaseName?: string },
  facts: NameFacts = fileFacts(file.label, file.releaseName),
): string {
  if (facts.group) return `g:${facts.group}`;
  const name = (file.label ?? file.releaseName ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const release = readNameTags(`${name.replace(/[ ._-]+$/, '')}.srt`)
    .release.toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return `r:${release || (file.releaseName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

/** Copies made in the cinema: each timed its own way, and never moved this way. */
const RECORDINGS: readonly string[] = ['cam', 'ts', 'tc', 'scr'];

/**
 * What a file's names count for, for a video: null for a file of another
 * source (never read); 3 for one naming the video's streaming service; 0
 * for one naming another service; 1 for one of the video's source, or
 * naming a service; 0 for one naming neither.
 */
export function weightOf(video: NameFacts, file: NameFacts): number | null {
  if (file.source && file.source !== video.source) return null;
  if (video.service && file.service === video.service) return 3;
  if (video.service && file.service && file.service !== video.service) return 0;
  if ((file.source && file.source === video.source) || file.service) return 1;
  return 0;
}

/** Usable files read first, at most, and the downloads tried for them before deciding on fewer. */
export const FIRST_READ_FILES = 12;
export const FIRST_READ_TRIES = 20;
/** Lines a file needs to be lined up: as a reference does. */
export const AGREEMENT_MIN_LINES = 40;

/** When the decision gives up: safety limits well above anything measured. */
export interface AgreementLimits {
  /** Milliseconds from the start. */
  ms: number;
  /** Files read in all. */
  files: number;
  /** Files lined up against another in all. */
  aligned: number;
}
export const AGREEMENT_LIMITS: Readonly<AgreementLimits> = {
  ms: 120_000,
  files: 100,
  aligned: 1000,
};

/** Two files whose timing agrees: sure, at rate 1, this close (seconds). */
const LINK_S = 0.5;
/** With a video naming no service, every other group with support must be this close to the winner. */
const APART_S = 1.5;
/** The winner's score must be at least this, and this many times the next. */
const MIN_SCORE = 3;
const MARGIN = 1.5;

/** One file offered, as the decision sees it. */
export interface AgreementFile {
  /** Who it is among the files offered. */
  key: string;
  lang: string;
  label?: string;
  releaseName?: string;
}

export interface AgreementInput {
  /** The video's facts (`videoFacts`). */
  video: NameFacts;
  /** The language the viewer wants. */
  language: string;
  /** The file showing. */
  today: string;
  /** The viewer's files in that language, best first, as the planner ranks them. */
  ranked: readonly string[];
  /** Every file offered that may be read, in the list's order. */
  files: readonly AgreementFile[];
  limits?: Partial<AgreementLimits>;
  /** Milliseconds, for the time limit. */
  now?: () => number;
  /** Whether another file may take over from the one showing now; asked once, at the end. */
  canSwitch?: () => boolean;
  /** For tests: false tries showing a file of the winner before moving the one showing. */
  moveFirst?: boolean;
}

/** What lining one file up against another found. */
export interface PairAnswer {
  offset: number;
  rate: number;
  confidence: AlignConfidence;
}

/** Why nothing changed. */
export type AgreementWhy =
  /** The best group scores under MIN_SCORE. */
  | { kind: 'under'; best: number }
  /** The next is too close to it. */
  | { kind: 'close'; best: number; second: number }
  /** With a video naming no service: another group with support has no sure pair with the winner. */
  | { kind: 'unlinked'; score: number }
  /** ...or lines up with it at another rate, or further than APART_S. */
  | { kind: 'apart'; score: number; offset: number; rate: number }
  /** The file showing lines up with the winner at another rate: the drift checks' work. */
  | { kind: 'rate' }
  /** The video names an edition no file of the winner names. */
  | { kind: 'edition'; edition: string }
  /** Reading the rest of the files gave another winner, or none. */
  | { kind: 'wider'; best: number; second: number }
  /** A winner, but the file showing lines up with none of it, and none of it can show instead. */
  | { kind: 'unmatched'; best: number; second: number }
  | { kind: 'gave up'; after: 'time' | 'files' | 'aligned' };

/** Files read and lined up so far. */
export interface AgreementCounts {
  read: number;
  aligned: number;
}

export type AgreementDecision =
  | ({
      /**
       * kept: the file showing is in step with the winner already; moved: by
       * its own pair with the winner's first file; shifted: by its place
       * against the winner's files; switched: one of them shows instead.
       */
      state: 'kept' | 'moved' | 'shifted' | 'switched';
      /** The winner's first file read: what the file shown is lined up against. */
      leader: string;
      /** The file to show. */
      show: string;
      /** Seconds the file shown moves onto the leader's timing (in step: under LINK_S). */
      offset: number;
      /** Files in step with the leader, by a direct pair: the leader first. */
      within: string[];
      best: number;
      second: number;
      /** The video's streaming service, which scored the winner. */
      service?: StreamingService;
      /** The rest of the files were read and agreed. */
      wider: boolean;
    } & AgreementCounts)
  | ({ state: 'none'; why: AgreementWhy } & AgreementCounts)
  | ({ state: 'not tried'; why: 'recording' | 'no source' } & AgreementCounts);

export type AgreementStep =
  /** The file's lines are needed now: answer with `read()`. */
  | { kind: 'read'; key: string }
  /** Line `candidate` up against `reference`: answer with `aligned()`. */
  | { kind: 'align'; candidate: string; reference: string }
  | { kind: 'done'; decision: AgreementDecision };

export interface Agreement {
  next(): AgreementStep;
  /** The files to be read next, in order, as far as is known now: downloads may run ahead. */
  wanted(): string[];
  /** A file's timed lines, or null when it could not be read or is no use (`AGREEMENT_MIN_LINES`). */
  read(key: string, lines: number | null): void;
  aligned(candidate: string, reference: string, answer: PairAnswer): void;
  /** Files read and lined up so far. */
  counts(): AgreementCounts;
  /** 1 while the first files are read, 2 once the wider read has begun. */
  stage(): 1 | 2;
}

interface Relation {
  offset: number;
  rate: number;
}

const rate1 = (rate: number) => Math.abs(rate - 1) < 1e-6;
const isLink = (pair: PairAnswer | null) =>
  !!pair && pair.confidence === 'sure' && rate1(pair.rate) && Math.abs(pair.offset) <= LINK_S;

/** The most common rate (to 5 decimals, the first seen on a tie), and the upper middle offset at it. */
function middleOf(pairs: ReadonlyArray<readonly [number, number]>): Relation | null {
  if (pairs.length === 0) return null;
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const [, rate] of pairs) {
    const key = rate.toFixed(5);
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = order[0]!;
  for (const key of order) if (counts.get(key)! > counts.get(best)!) best = key;
  const offsets = pairs
    .filter(([, rate]) => rate.toFixed(5) === best)
    .map(([offset]) => offset)
    .sort((a, b) => a - b);
  return { offset: offsets[offsets.length >> 1]!, rate: Number(best) };
}

/**
 * The decision for one stream, step by step. Stage 1 reads up to
 * FIRST_READ_FILES usable files: the viewer's two best, then files naming
 * the video's service, the viewer's other files, other languages' files of
 * the video's source, the rest. Each file read is lined up against the first
 * two files of each group so far and joins the one it agrees with most, or
 * starts its own. When a winner would change what shows, stage 2 reads every
 * other file that counts (weight above 0) and must find the same winner.
 */
export function createAgreement(input: AgreementInput): Agreement {
  const limits: AgreementLimits = { ...AGREEMENT_LIMITS, ...input.limits };
  const now = input.now ?? (() => 0);
  const startedAt = now();
  const { video } = input;
  const language = languageKey(input.language);

  // Each file once, in the list's order, with what its names say.
  const files: AgreementFile[] = [];
  const index = new Map<string, number>();
  const facts = new Map<string, NameFacts>();
  const weight = new Map<string, number | null>();
  const groupKey = new Map<string, string>();
  for (const file of input.files) {
    if (index.has(file.key)) continue;
    index.set(file.key, files.length);
    files.push(file);
    const found = fileFacts(file.label, file.releaseName);
    facts.set(file.key, found);
    weight.set(file.key, weightOf(video, found));
    groupKey.set(file.key, groupKeyOf(file, found));
  }
  const ownLanguage = (key: string) => languageKey(files[index.get(key)!]!.lang) === language;
  const placeOf = (key: string) => index.get(key) ?? Infinity;

  // The viewer's two best, the file showing among them, read first in the list's order.
  const firstTwo = new Set(
    [input.today].concat(input.ranked.filter((key) => key !== input.today)).slice(0, 2),
  );
  const tierOf = (file: AgreementFile): number => {
    if (firstTwo.has(file.key)) return 0;
    if (weight.get(file.key) === null) return 9;
    const own = facts.get(file.key)!;
    if (video.service && own.service === video.service) return 1;
    if (languageKey(file.lang) === language) return 2;
    if (own.source && own.source === video.source) return 3;
    return 4;
  };
  const stage1Order = files
    .map((file, at) => ({ file, at, tier: tierOf(file) }))
    .filter((entry) => entry.tier < 9)
    .sort((a, b) => a.tier - b.tier || a.at - b.at)
    .map((entry) => entry.file.key);

  const answers = new Map<string, boolean>();
  /** Files taken in turn so far, usable or not: the wider read leaves them out. */
  const seen = new Set<string>();
  const pairs = new Map<string, PairAnswer>();
  const pairKey = (candidate: string, reference: string) => `${candidate}\n${reference}`;
  /** A file lined up against another, as run or the other way round turned about. */
  const pairOf = (candidate: string, reference: string): PairAnswer | null => {
    const ran = pairs.get(pairKey(candidate, reference));
    if (ran) return ran;
    const back = pairs.get(pairKey(reference, candidate));
    if (!back) return null;
    return { offset: -back.offset * back.rate, rate: 1 / back.rate, confidence: back.confidence };
  };

  // The groups in the order made, never merged: a file joining is lined up against their first two.
  const groups: string[][] = [];
  let joining: string | null = null;
  let stage: 1 | 2 = 1;
  let order = stage1Order;
  let cursor = 0;
  let tried = 0;
  let usable = 0;
  let read = 0;
  let alignedCount = 0;
  let decision: AgreementDecision | null = null;
  // Stage 1's winner, kept as it stood: the wider read only confirms it.
  let winner: { members: string[]; best: number; second: number; keep: boolean } | null = null;

  const counts = (): AgreementCounts => ({ read, aligned: alignedCount });
  const finish = (made: AgreementDecision): AgreementStep => {
    decision = made;
    return { kind: 'done', decision: made };
  };
  const none = (why: AgreementWhy) => finish({ state: 'none', why, ...counts() });

  /** Group A against group B: B's files lined up against A's, the most common answer. */
  const relation = (a: readonly string[], b: readonly string[]): Relation | null => {
    const found: Array<readonly [number, number]> = [];
    for (const x of a) {
      for (const y of b) {
        const pair = pairOf(y, x);
        if (pair && pair.confidence === 'sure') found.push([pair.offset, pair.rate]);
      }
    }
    return middleOf(found);
  };
  /** Where these files show against a group's: none apart when one is in it. */
  const distance = (a: readonly string[], b: readonly string[]): Relation | null => {
    if (a.some((key) => b.indexOf(key) !== -1)) return { offset: 0, rate: 1 };
    const found: Array<readonly [number, number]> = [];
    for (const x of a) {
      for (const y of b) {
        const pair = pairOf(x, y);
        if (pair && pair.confidence === 'sure') found.push([pair.offset, pair.rate]);
      }
    }
    return middleOf(found);
  };

  /** The groups, those whose timing agrees merged (the later into the earlier), largest first. */
  const merged = (): string[][] => {
    const out = groups.map((group) => group.slice());
    let changed = true;
    while (changed) {
      changed = false;
      search: for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const between = relation(out[i]!, out[j]!);
          if (between && rate1(between.rate) && Math.abs(between.offset) <= LINK_S) {
            out[i] = out[i]!.concat(out[j]!);
            out.splice(j, 1);
            changed = true;
            break search;
          }
        }
      }
    }
    // Largest first, keeping the order of ties: Chromium 68's sort is not stable.
    return out
      .map((group, at) => ({ group, at }))
      .sort((a, b) => b.group.length - a.group.length || a.at - b.at)
      .map((entry) => entry.group);
  };

  /** Each group's score: the best weight of each release in it, added up. */
  const scoreOf = (group: readonly string[]): number => {
    const best = new Map<string, number>();
    for (const key of group) {
      const w = weight.get(key);
      if (w === null || w === undefined) continue;
      const release = groupKey.get(key)!;
      best.set(release, Math.max(best.get(release) ?? -Infinity, w));
    }
    let score = 0;
    best.forEach((w) => (score += w));
    return score;
  };

  type Judged =
    | { ok: true; best: number; scores: number[]; second: number }
    | { ok: false; why: AgreementWhy; best: number; second: number };
  /** The winner of these groups, or why there is none. */
  const judge = (groupsNow: readonly string[][]): Judged => {
    const scores = groupsNow.map(scoreOf);
    let best = -1;
    scores.forEach((score, at) => {
      if (best < 0 || score > scores[best]!) best = at;
    });
    let second = 0;
    scores.forEach((score, at) => {
      if (at !== best) second = Math.max(second, score);
    });
    const top = best < 0 ? 0 : scores[best]!;
    const fail = (why: AgreementWhy): Judged => ({ ok: false, why, best: top, second });
    if (best < 0 || top < MIN_SCORE) return fail({ kind: 'under', best: top });
    if (top < MARGIN * second || top === second) return fail({ kind: 'close', best: top, second });
    if (!video.service) {
      // Every other group with support must line up with the winner: for sure at all...
      for (let at = 0; at < scores.length; at++) {
        if (at === best || scores[at]! < 1) continue;
        if (!relation(groupsNow[best]!, groupsNow[at]!)) {
          return fail({ kind: 'unlinked', score: scores[at]! });
        }
      }
      // ...and at rate 1, close to it: another release's timing may be the video's.
      for (let at = 0; at < scores.length; at++) {
        if (at === best || scores[at]! < 1) continue;
        const between = relation(groupsNow[best]!, groupsNow[at]!)!;
        if (!rate1(between.rate) || Math.abs(between.offset) > APART_S) {
          return fail({ kind: 'apart', score: scores[at]!, ...between });
        }
      }
    }
    return { ok: true, best, scores, second };
  };

  /** Stage 1 is over: decide, then read wider or show. */
  const afterFirst = (): AgreementStep | null => {
    const groupsNow = merged();
    const judged = judge(groupsNow);
    if (!judged.ok) return none(judged.why);
    const members = groupsNow[judged.best]!;
    const today = input.today;
    const inIt = members.indexOf(today) !== -1;
    const near = inIt ? null : distance([today], members);
    if (near && !rate1(near.rate)) return none({ kind: 'rate' });
    if (video.edition && !members.some((key) => facts.get(key)!.edition === video.edition)) {
      return none({ kind: 'edition', edition: video.edition });
    }
    const keep = inIt || (!!near && Math.abs(near.offset) <= LINK_S);
    winner = { members, best: judged.scores[judged.best]!, second: judged.second, keep };
    if (keep) return show();
    // The wider read: every other file that counts, those of the video's source naming no service
    // first, then the rest, each in the list's order.
    const first = (key: string) => {
      const own = facts.get(key)!;
      return own.source === video.source && !own.service ? 0 : 1;
    };
    order = files
      .map((file) => file.key)
      .filter((key) => !seen.has(key) && (weight.get(key) ?? 0) > 0)
      .sort((a, b) => first(a) - first(b) || placeOf(a) - placeOf(b));
    cursor = 0;
    stage = 2;
    return null;
  };

  /** Stage 2 is over: the same winner, or nothing. */
  const afterWider = (): AgreementStep => {
    const groupsNow = merged();
    const judged = judge(groupsNow);
    const shares =
      judged.ok && groupsNow[judged.best]!.some((key) => winner!.members.indexOf(key) !== -1);
    if (!judged.ok || !shares) {
      const best = judged.ok ? judged.scores[judged.best]! : judged.best;
      return none({ kind: 'wider', best, second: judged.second });
    }
    return show();
  };

  /** What shows: the file showing moved, another of the winner's, or the file showing shifted. */
  const show = (): AgreementStep => {
    const { members, best, second, keep } = winner!;
    const today = input.today;
    const leader = members[0]!;
    const within = [leader].concat(members.slice(1).filter((key) => isLink(pairOf(key, leader))));
    const base = {
      leader,
      within,
      best,
      second,
      wider: stage === 2,
      ...(video.service ? { service: video.service } : {}),
      ...counts(),
    };
    const direct = today === leader ? null : pairOf(today, leader);
    if (keep) {
      // In step already: by its own pair with the leader when sure, else by its place in the group.
      const offset =
        today === leader
          ? 0
          : direct && direct.confidence === 'sure'
            ? direct.offset
            : (distance([today], members)?.offset ?? 0);
      return finish({ state: 'kept', show: today, offset, ...base });
    }
    const movable = !!direct && direct.confidence === 'sure' && rate1(direct.rate);
    const moved = () => finish({ state: 'moved', show: today, offset: direct!.offset, ...base });
    if (movable && input.moveFirst !== false) return moved();
    const ranking = input.ranked;
    const candidates = within
      .filter((key) => ownLanguage(key) && ranking.indexOf(key) !== -1)
      .sort((a, b) => ranking.indexOf(a) - ranking.indexOf(b));
    if (candidates.length > 0 && (input.canSwitch ? input.canSwitch() : true)) {
      const target = candidates[0]!;
      const pair = target === leader ? null : pairOf(target, leader);
      return finish({ state: 'switched', show: target, offset: pair ? pair.offset : 0, ...base });
    }
    if (movable) return moved();
    const shift = distance([today], within);
    if (shift && rate1(shift.rate)) {
      return finish({ state: 'shifted', show: today, offset: shift.offset, ...base });
    }
    return none({ kind: 'unmatched', best, second });
  };

  /** The group a file joins, once it has been lined up against each group's first two. */
  const join = (key: string): AgreementStep | null => {
    for (const group of groups) {
      for (const anchor of group.slice(0, 2)) {
        if (pairOf(key, anchor)) continue;
        if (alignedCount >= limits.aligned) return none({ kind: 'gave up', after: 'aligned' });
        return { kind: 'align', candidate: key, reference: anchor };
      }
    }
    let best = -1;
    let most = 0;
    groups.forEach((group, at) => {
      const links = group.slice(0, 2).filter((anchor) => isLink(pairOf(key, anchor))).length;
      if (links > most) {
        best = at;
        most = links;
      }
    });
    if (best < 0) groups.push([key]);
    else groups[best]!.push(key);
    joining = null;
    return null;
  };

  const step = (): AgreementStep => {
    if (decision) return { kind: 'done', decision };
    if (video.source && RECORDINGS.indexOf(video.source) !== -1) {
      return finish({ state: 'not tried', why: 'recording', ...counts() });
    }
    if (!video.source) return finish({ state: 'not tried', why: 'no source', ...counts() });
    for (;;) {
      if (now() - startedAt >= limits.ms) return none({ kind: 'gave up', after: 'time' });
      if (joining !== null) {
        const wait = join(joining);
        if (wait) return wait;
        continue;
      }
      const full = stage === 1 && (usable >= FIRST_READ_FILES || tried >= FIRST_READ_TRIES);
      if (full || cursor >= order.length) {
        if (stage === 2) return afterWider();
        const next = afterFirst();
        if (next) return next;
        continue;
      }
      const key = order[cursor]!;
      const answer = answers.get(key);
      if (answer === undefined) {
        if (read >= limits.files) return none({ kind: 'gave up', after: 'files' });
        return { kind: 'read', key };
      }
      cursor++;
      read++;
      seen.add(key);
      if (stage === 1) tried++;
      if (!answer) continue;
      if (stage === 1) usable++;
      joining = key;
    }
  };

  return {
    next: step,
    wanted() {
      if (decision || !video.source || RECORDINGS.indexOf(video.source) !== -1) return [];
      const out: string[] = [];
      let triedSoFar = tried;
      let usableSoFar = usable;
      let readSoFar = read;
      for (let at = cursor; at < order.length; at++) {
        if (stage === 1 && (usableSoFar >= FIRST_READ_FILES || triedSoFar >= FIRST_READ_TRIES)) {
          break;
        }
        if (readSoFar >= limits.files) break;
        const key = order[at]!;
        const answer = answers.get(key);
        triedSoFar++;
        readSoFar++;
        if (answer === false) continue;
        usableSoFar++;
        if (answer === undefined) out.push(key);
      }
      return out;
    },
    read(key, lines) {
      if (answers.has(key)) return;
      answers.set(key, lines !== null && lines >= AGREEMENT_MIN_LINES);
    },
    aligned(candidate, reference, answer) {
      const at = pairKey(candidate, reference);
      if (pairs.has(at)) return;
      pairs.set(at, { offset: answer.offset, rate: answer.rate, confidence: answer.confidence });
      alignedCount++;
    },
    counts,
    stage: () => stage,
  };
}

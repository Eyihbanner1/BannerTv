import { createStore, type Store } from '@bannertv/core';
import { redact } from './redact';

/**
 * The phone's record of what went wrong lately, and the report Settings > Send a report and the
 * crash screen share (runtime/crash-catcher.ts catches the problems). The last few problems are
 * kept in the phone's own storage, so a crash that closes the app is still there when it starts
 * again. Every message and stack line goes through the redactor (redact.ts) as it is caught and
 * again as the report is written, and screens are kept by their route's name only. Pure, so it
 * is unit-tested.
 */

/** Where the problems are kept, in the phone's own storage. */
export const CRASH_LOG_KEY = 'bannertv.phone.problems';
/** Problems kept, newest first. */
export const KEEP_PROBLEMS = 5;
/** Screen changes kept, oldest first. */
export const KEEP_SCREENS = 20;

const MESSAGE_MAX = 300;
const STACK_LINES = 8;
/** The report gives the newest problem all its kept frames, and older ones fewer. */
const OLDER_STACK_LINES = 4;
const LINE_MAX = 160;
const SCREENS_MAX = 500;
/** Text longer than this is cut before it is redacted, which is slow on long text. */
const READ_MAX = 2000;
const REPORT_MAX = 10_000;
/** The same problem caught twice this close together (by two handlers) is kept once. */
const SAME_PROBLEM_MS = 2000;

/**
 * How the problem was caught: a crash closes the app (ErrorUtils, fatal), an error does not, a
 * promise was rejected with nothing to handle it, and a screen failed to draw (the crash screen).
 */
export type ProblemKind = 'crash' | 'error' | 'promise' | 'screen';

const KINDS: readonly ProblemKind[] = ['crash', 'error', 'promise', 'screen'];

const KIND_WORDS: Record<ProblemKind, string> = {
  crash: 'Crash',
  error: 'Error',
  promise: 'Unhandled promise',
  screen: 'Screen error',
};

/** A screen shown, by its route, and when. */
export interface ScreenVisit {
  path: string;
  at: number;
}

/** What the app runs. */
export interface Build {
  /** The app's version, as Settings shows it. */
  version: string;
  /** The over-the-air update running (expo-updates' updateId), or null for the built-in code. */
  updateId: string | null;
}

export interface Problem extends Build {
  at: number;
  kind: ProblemKind;
  /** The error's name and message, redacted. */
  message: string;
  /** The first lines of its stack, redacted. */
  stack: string[];
  /** The screen it happened on. */
  screen: string;
  /** The screens before it, oldest first. */
  screens: ScreenVisit[];
}

/** Cuts text to `max` characters, and a word cut in two goes whole: it may be part of a key. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.search(/\s\S*$/);
  return `${space > 0 ? cut.slice(0, space) : ''}…`;
}

function clean(text: string, max: number): string {
  return clip(redact(clip(text, READ_MAX)), max);
}

/**
 * A screen's path as the report keeps it: route names only (`/settings`, `/title`). Anything
 * else in a part (an id, a link that opened the app) becomes `…`, and the query goes.
 */
export function screenPath(path: string): string {
  const parts = (path.split(/[?#]/)[0] ?? '').split('/').filter(Boolean);
  const kept: string[] = [];
  for (const part of parts.slice(0, 4)) {
    // After a part that is not a route's name, nothing more is a route's name either.
    if (!/^[a-z][a-z-]{0,31}$/.test(part)) {
      kept.push('…');
      break;
    }
    kept.push(part);
  }
  return `/${kept.join('/')}`;
}

/** The trail with `path` shown at `at`: the last KEEP_SCREENS changes of screen. */
export function addVisit(trail: readonly ScreenVisit[], path: string, at: number): ScreenVisit[] {
  const safe = screenPath(path);
  if (trail[trail.length - 1]?.path === safe) return [...trail];
  return [...trail, { path: safe, at }].slice(-KEEP_SCREENS);
}

function messageOf(error: unknown): string {
  if (
    error instanceof Error ||
    (typeof error === 'object' && error !== null && 'message' in error)
  ) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    const label = typeof name === 'string' && name ? name : 'Error';
    const text = typeof message === 'string' ? message : '';
    return text ? `${label}: ${text}` : label;
  }
  if (typeof error === 'string') return error || 'Error';
  if (error === undefined || error === null) return `Error: ${String(error)}`;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The stack's frames, without the first line that repeats the message. */
function stackOf(error: unknown): string[] {
  const stack =
    typeof error === 'object' && error !== null ? (error as { stack?: unknown }).stack : '';
  if (typeof stack !== 'string' || !stack) return [];
  const lines = stack
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const firstFrame = lines.findIndex((line) => line.startsWith('at '));
  return lines
    .slice(firstFrame === -1 ? 1 : firstFrame, (firstFrame === -1 ? 1 : firstFrame) + STACK_LINES)
    .map((line) => clean(line, LINE_MAX));
}

/** What the app knew when it caught `error`. */
export interface Caught extends Build {
  at: number;
  screen: string;
  screens: readonly ScreenVisit[];
}

/** The problem `error` is, redacted and cut short, with where and when it happened. */
export function problemFrom(error: unknown, kind: ProblemKind, caught: Caught): Problem {
  return {
    at: caught.at,
    kind,
    message: clean(messageOf(error), MESSAGE_MAX),
    stack: stackOf(error),
    version: caught.version,
    updateId: caught.updateId,
    screen: screenPath(caught.screen),
    screens: caught.screens.slice(-KEEP_SCREENS).map((visit) => ({
      path: screenPath(visit.path),
      at: visit.at,
    })),
  };
}

function sameProblem(a: Problem, b: Problem): boolean {
  return (
    a.message === b.message &&
    a.stack.join('\n') === b.stack.join('\n') &&
    Math.abs(a.at - b.at) < SAME_PROBLEM_MS
  );
}

/** The problems with `problem` first, the last KEEP_PROBLEMS of them. */
export function addProblem(problems: readonly Problem[], problem: Problem): Problem[] {
  if (problems[0] && sameProblem(problems[0], problem)) return [...problems];
  return [problem, ...problems].slice(0, KEEP_PROBLEMS);
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function readVisit(value: unknown): ScreenVisit | null {
  const visit = value as Partial<ScreenVisit> | null;
  return visit && isText(visit.path) && isTime(visit.at)
    ? { path: visit.path, at: visit.at }
    : null;
}

function readProblem(value: unknown): Problem | null {
  const p = value as Partial<Problem> | null;
  if (!p || !isTime(p.at) || !KINDS.includes(p.kind as ProblemKind) || !isText(p.message)) {
    return null;
  }
  return {
    at: p.at,
    kind: p.kind as ProblemKind,
    message: p.message,
    stack: Array.isArray(p.stack) ? p.stack.filter(isText) : [],
    version: isText(p.version) ? p.version : '',
    updateId: isText(p.updateId) ? p.updateId : null,
    screen: isText(p.screen) ? p.screen : '/',
    screens: Array.isArray(p.screens)
      ? p.screens.map(readVisit).filter((visit): visit is ScreenVisit => visit !== null)
      : [],
  };
}

/** The kept problems; anything unreadable is left out. */
export function readProblems(raw: string | null): Problem[] {
  if (!raw) return [];
  try {
    const kept = (JSON.parse(raw) as { problems?: unknown }).problems;
    if (!Array.isArray(kept)) return [];
    return kept
      .map(readProblem)
      .filter((problem): problem is Problem => problem !== null)
      .slice(0, KEEP_PROBLEMS);
  } catch {
    return [];
  }
}

/** The part of Web Storage the log needs. */
export interface ProblemStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The problems, read from `storage` and written back there as each one is added. */
export function problemStore(storage: ProblemStorage): Store<Problem[]> {
  let initial: Problem[] = [];
  try {
    initial = readProblems(storage.getItem(CRASH_LOG_KEY));
  } catch {
    // Without storage the log starts empty and lasts until the app closes.
  }
  const store = createStore<Problem[]>(initial);
  store.subscribe(() => {
    try {
      storage.setItem(CRASH_LOG_KEY, JSON.stringify({ problems: store.get() }));
    } catch {
      // Then this problem is lost with the app.
    }
  });
  return store;
}

/**
 * What the crash screen does with a screen that failed to draw. Before the first screen of an
 * over-the-air update has shown, it hands the error on as a crash, so expo-updates can go back
 * to the update before it (ADR 0007): drawing anything would count as the update's first screen
 * and keep it. The built-in code has nothing to go back to, and a later failure nothing to undo,
 * so both show the crash screen.
 */
export function crashScreenStep(at: {
  firstScreenShown: boolean;
  updateLaunch: boolean;
}): 'show' | 'handOver' {
  return !at.firstScreenShown && at.updateLaunch ? 'handOver' : 'show';
}

/** An update's id, which is a UUID; anything else is not printed. */
function updateIdOf(id: string | null): string | null {
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

function buildLine(build: Build, takesUpdates: boolean): string {
  const version = clip(build.version.replace(/[^\w.+-]/g, ''), 24) || 'unknown';
  const update = updateIdOf(build.updateId);
  if (update) return `${version}, update ${update}`;
  return takesUpdates ? `${version}, built-in code` : `${version}, built-in code, takes no updates`;
}

function timeOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function clockOf(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

function screensLine(screens: readonly ScreenVisit[]): string {
  if (screens.length === 0) return 'none yet';
  const line = screens
    .slice(-KEEP_SCREENS)
    .map((visit) => `${screenPath(visit.path)} ${clockOf(visit.at)}`)
    .join(', ');
  // The latest screens matter most, so a line too long loses its oldest.
  return line.length <= SCREENS_MAX ? line : `…${line.slice(line.length - SCREENS_MAX)}`;
}

/** The phone, as "Android 14 (API 34), Google Pixel 8", from React Native's Platform. */
export function phoneLine(platform: {
  os: string;
  version?: string | number;
  release?: string;
  maker?: string;
  model?: string;
}): string {
  const plain = (text: string | undefined) => clip((text ?? '').replace(/[^\w .()-]/g, ''), 40);
  const name = platform.os === 'android' ? 'Android' : plain(platform.os) || 'unknown';
  const release = plain(platform.release);
  const api = platform.os === 'android' && platform.version !== undefined;
  const system = [
    name,
    release,
    api ? `(API ${plain(String(platform.version))})` : plain(String(platform.version ?? '')),
  ]
    .filter(Boolean)
    .join(' ');
  const maker = plain(platform.maker);
  const model = plain(platform.model);
  const device = model.toLowerCase().startsWith(maker.toLowerCase())
    ? model
    : [maker, model].filter(Boolean).join(' ');
  return device ? `${system}, ${device}` : system;
}

export interface ReportInput {
  now: number;
  build: Build;
  /** This build takes over-the-air updates. */
  takesUpdates: boolean;
  /** The phone, from phoneLine(). */
  phone: string;
  /** The screen on show. */
  screen: string;
  /** This run's screens, oldest first. */
  screens: readonly ScreenVisit[];
  /** The kept problems, newest first. */
  problems: readonly Problem[];
}

/**
 * The report as plain text, short enough for a message: the app and phone, this run's screens,
 * and each kept problem with its screens. With no problems it still has the basics.
 */
export function reportText(input: ReportInput): string {
  const lines = [
    'BannerTV phone report',
    `Made: ${timeOf(input.now)}`,
    `App: ${buildLine(input.build, input.takesUpdates)}`,
    `Phone: ${input.phone}`,
    `Screen: ${screenPath(input.screen)}`,
    `Recent screens: ${screensLine(input.screens)}`,
    '',
  ];
  const problems = input.problems.slice(0, KEEP_PROBLEMS);
  if (problems.length === 0) lines.push('No problems recorded.');
  else
    lines.push(problems.length === 1 ? '1 problem:' : `${problems.length} problems, newest first:`);
  problems.forEach((problem, index) => {
    lines.push('');
    lines.push(
      `${index + 1}. ${KIND_WORDS[problem.kind]} on ${screenPath(problem.screen)}, ${timeOf(problem.at)}`,
    );
    const build = buildLine(problem, input.takesUpdates);
    if (build !== buildLine(input.build, input.takesUpdates)) lines.push(`App: ${build}`);
    // Redacted again: the kept text may come from an older version of the redactor.
    lines.push(clean(problem.message, MESSAGE_MAX));
    const frames = problem.stack.slice(0, index === 0 ? STACK_LINES : OLDER_STACK_LINES);
    for (const frame of frames) lines.push(`  ${clean(frame, LINE_MAX)}`);
    lines.push(`Screens: ${screensLine(problem.screens)}`);
  });
  return clip(lines.join('\n'), REPORT_MAX);
}

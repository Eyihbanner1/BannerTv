/**
 * Which update the loader starts, as plain data kept in localStorage (STATE_KEY)
 * and changed only by the functions here, none of which touches the page. The
 * rules, in short:
 *
 * - A newly installed .ipk (another build id) starts from its own code, and
 *   nothing stored under an earlier .ipk is ever started again.
 * - An update downloaded while the app runs starts the next time the app
 *   starts (`next`), never in the middle of a run.
 * - An update that starts MAX_TRIES times in a row without the app saying the
 *   start went well is put aside for good, and the .ipk's own code runs.
 * - Only something published after both this .ipk's build and everything
 *   taken before (`floor`) is ever taken, by the Worker's clock, never the TV's.
 */
import type { FileEntry, UpdateInfo } from './contract';

/** Starts of one update in a row that may end before the app says it went well. */
export const MAX_TRIES = 2;
/** How many failed updates are remembered, so none is downloaded again. */
export const MAX_BAD = 10;

export interface ShellState {
  v: 1;
  /** The build id of the .ipk this state belongs to. */
  build: string;
  /** The newest publish time taken: nothing at or before it is taken again. */
  floor: string | null;
  /** The update to start, or null for the .ipk's own code. */
  current: UpdateInfo | null;
  /** What starts instead at the next start, once downloaded. */
  next: UpdateInfo | 'built-in' | null;
  /** Starts of `current` since it last started well. */
  tries: number;
  /** The update last put aside, for Settings to say so. */
  failed: UpdateInfo | null;
  /** Ids of updates put aside, newest last. */
  bad: string[];
}

export function freshState(build: string): ShellState {
  return { v: 1, build, floor: null, current: null, next: null, tries: 0, failed: null, bad: [] };
}

const time = (iso: string | null | undefined): number => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
};

function isInfo(value: unknown): value is UpdateInfo {
  const info = value as UpdateInfo | null;
  return (
    !!info &&
    typeof info === 'object' &&
    typeof info.id === 'string' &&
    Number.isFinite(time(info.createdAt)) &&
    typeof info.version === 'string' &&
    (info.commit === null || typeof info.commit === 'string')
  );
}

const infoOrNull = (value: unknown): UpdateInfo | null =>
  isInfo(value)
    ? { id: value.id, createdAt: value.createdAt, version: value.version, commit: value.commit }
    : null;

/**
 * The stored state, or a fresh one when there is none, it is out of form, or
 * it belongs to another .ipk. Never throws.
 */
export function readState(text: string | null, build: string): ShellState {
  let value: Partial<ShellState> | null;
  try {
    value = text ? (JSON.parse(text) as Partial<ShellState>) : null;
  } catch {
    value = null;
  }
  if (!value || typeof value !== 'object' || value.v !== 1 || value.build !== build) {
    return freshState(build);
  }
  const floor = Number.isFinite(time(value.floor)) ? (value.floor as string) : null;
  const tries =
    typeof value.tries === 'number' && value.tries >= 0 && value.tries <= MAX_TRIES
      ? Math.floor(value.tries)
      : MAX_TRIES;
  const bad = Array.isArray(value.bad)
    ? value.bad.filter((id): id is string => typeof id === 'string').slice(-MAX_BAD)
    : [];
  return {
    v: 1,
    build,
    floor,
    current: infoOrNull(value.current),
    next: value.next === 'built-in' ? 'built-in' : infoOrNull(value.next),
    tries,
    failed: infoOrNull(value.failed),
    bad,
  };
}

/** Puts `update` aside: it never starts again on this .ipk. */
export function markBad(state: ShellState, update: UpdateInfo): ShellState {
  const bad = state.bad
    .filter((id) => id !== update.id)
    .concat(update.id)
    .slice(-MAX_BAD);
  return {
    ...state,
    current: state.current?.id === update.id ? null : state.current,
    next: state.next !== 'built-in' && state.next?.id === update.id ? null : state.next,
    tries: state.current?.id === update.id ? 0 : state.tries,
    failed: update,
    bad,
  };
}

/**
 * The start of the app: what was waiting becomes what runs, an update that
 * has already failed to start too often is put aside, and a start of an
 * update is counted. `run` is the update to start, or null for the .ipk's own
 * code.
 */
export function boot(stored: ShellState): { state: ShellState; run: UpdateInfo | null } {
  let state: ShellState = { ...stored, bad: stored.bad.slice() };
  if (state.next === 'built-in') state = { ...state, current: null, next: null, tries: 0 };
  else if (state.next) state = { ...state, current: state.next, next: null, tries: 0 };
  const current = state.current;
  if (current && state.bad.indexOf(current.id) !== -1)
    state = { ...state, current: null, tries: 0 };
  else if (current && state.tries >= MAX_TRIES) state = markBad(state, current);
  if (state.current) state = { ...state, tries: state.tries + 1 };
  return { state, run: state.current };
}

/** The start went well: the update running keeps its place. */
export function markGood(state: ShellState): ShellState {
  return state.tries === 0 ? state : { ...state, tries: 0 };
}

/**
 * Whether something published at `createdAt` is newer than both the .ipk
 * (built at `builtAt`) and anything taken already. Times from the TV's clock
 * never come in: both are the build machine's and the Worker's.
 */
export function isNewer(state: ShellState, createdAt: string, builtAt: string): boolean {
  const at = time(createdAt);
  if (!Number.isFinite(at)) return false;
  const floor = time(state.floor);
  const built = time(builtAt);
  return (!Number.isFinite(floor) || at > floor) && (!Number.isFinite(built) || at > built);
}

/** An update is downloaded and stored: it starts next time. */
export function takeUpdate(state: ShellState, update: UpdateInfo): ShellState {
  return { ...state, floor: update.createdAt, next: update };
}

/**
 * The Worker sends the TV back to the .ipk's own code (a roll back, or an
 * update with exactly the .ipk's files): the next start runs it, when anything
 * else would run.
 */
export function takeBuiltIn(state: ShellState, createdAt: string): ShellState {
  return { ...state, floor: createdAt, next: state.current ? 'built-in' : null };
}

/** Whether every file an update names is the .ipk's own, so it would change nothing. */
export function sameAsBuiltIn(
  files: Record<string, FileEntry>,
  builtIn: Record<string, FileEntry>,
): boolean {
  return Object.keys(files).every((path) => builtIn[path]?.sha256 === files[path]!.sha256);
}

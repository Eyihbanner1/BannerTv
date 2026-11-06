import { clampToWindow, type Container, type LiveWindow, type StreamFacts } from '@bannertv/core';

/**
 * Where a jump really lands. On the TV's own player a skip on Dune's 22 GB
 * MKV lands one to six seconds short, most likely because the decoder starts
 * from the keyframe before the target, and Skip recap lands about four
 * seconds early. After each jump the session reads where the picture landed,
 * and this module decides what to do about a miss. Which way works best has
 * to be measured on the TV, so a tester switch picks one. From the web
 * inspector:
 *
 *   localStorage.setItem('bannertv.landing', 'again');
 *   location.reload();
 *
 * 'measure' only keeps the log, 'again' jumps once more after a miss, and
 * 'learn' allows for the stream's usual miss on every later jump. Anything
 * missing or unreadable is the default, and
 * `localStorage.removeItem('bannertv.landing')` goes back to it. The last
 * landings are kept for the inspector as `window.bannertvLandings`.
 */
export type LandingMode = 'measure' | 'again' | 'learn';

export const LANDING_MODES: readonly LandingMode[] = ['measure', 'again', 'learn'];

/**
 * 'learn' ships until the TV round says otherwise. It never adds a second
 * jump, so the viewer never waits for a second picture, and the big files
 * that miss are where a jump is slowest already. Where jumps land well it
 * learns next to nothing and changes nothing, and where they miss its
 * allowance is capped and drawn back by every landing, so it cannot do much
 * harm. Its first jump on each stream still lands as today: that is the case
 * 'again' would mend, and Skip recap is often the first jump of an episode.
 */
export const LANDING_DEFAULT: LandingMode = 'learn';

export const LANDING_KEY = 'bannertv.landing';

/** A jump that lands more than this far from where the viewer asked has missed. */
export const LANDING_SLACK_S = 1;

/** The most 'learn' allows for, so a run of odd landings cannot send jumps far off. */
export const LEARN_CAP_S = 8;

/**
 * A learnt gap smaller than this is the clock's own tick, as the reading
 * comes a moment after the picture starts, not a keyframe: jumps are left
 * alone. Learning goes on, so a gap that grows is still allowed for.
 */
export const LEARN_FROM_S = 0.5;

/** Each landing counts for at least a share of one in this many, so the gap follows a file whose keyframes change. */
const LEARN_OVER = 4;

/**
 * A landing this far off is no keyframe: the clock was misread, or the TV
 * refused the jump. It is logged, and nothing is learnt or corrected from it.
 */
export const WILD_MISS_S = 30;

/**
 * How long after `seeked` a paused jump is read. No clock moves on to say
 * where the picture is, and webOS can read the target at once and the real
 * position a moment later, as its start does (engines/native.ts).
 */
export const LANDING_SETTLE_MS = 1500;

/** A reading this close to where the element was sent is the target read back, not yet a landing. */
const AT_AIM_S = 0.01;

/** How many landings the log keeps. */
export const LANDINGS_KEPT = 30;

/** Reads the stored switch, keeping the default when it is missing or not a mode. */
export function parseLandingMode(raw: string | null): LandingMode {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return LANDING_MODES.indexOf(value as LandingMode) >= 0
    ? (value as LandingMode)
    : LANDING_DEFAULT;
}

/** Read once as each player session is made, so a change takes effect on the next video opened. */
export function readLandingMode(): LandingMode {
  try {
    return parseLandingMode(localStorage.getItem(LANDING_KEY));
  } catch {
    // Storage blocked or missing: the default.
    return LANDING_DEFAULT;
  }
}

/** Where a jump may go. */
export interface LandingBounds {
  /** The video's length in seconds; Infinity while unknown. */
  duration: number;
  /** On a broadcast, the part a rewind may land in, up to live. */
  window: Pick<LiveWindow, 'start' | 'live'> | null;
}

/** Keeps a place to the video: never past its last second nor live, never before 0 nor what a broadcast keeps. */
export function within(bounds: LandingBounds, place: number): number {
  const kept = bounds.window ? clampToWindow(bounds.window, place) : place;
  return Math.max(0, Math.min(kept, bounds.duration - 1));
}

/**
 * Where to send the element for a jump to `wanted` from `from`, allowing for
 * `gap`, the seconds this stream's jumps usually fall short. The allowance
 * never turns a jump round: a jump forward that it would send behind where
 * it started goes where the viewer asked.
 */
export function aimFor(wanted: number, gap: number, from: number, bounds: LandingBounds): number {
  if (!(Math.abs(gap) >= LEARN_FROM_S)) return wanted;
  const aimed = within(bounds, wanted + gap);
  if ((wanted - from) * (aimed - from) < 0) return wanted;
  return aimed;
}

/** What 'learn' keeps of a stream's landings. */
export interface LearntGap {
  /** Seconds a jump is sent past its target: positive where jumps fall short. */
  seconds: number;
  /** How many landings it rests on, up to a few. */
  landings: number;
}

export const NOTHING_LEARNT: LearntGap = { seconds: 0, landings: 0 };

/**
 * Takes one landing into the gap, as a running average. Each landing is
 * measured against where the element was sent, not where the viewer asked,
 * and short is short whichever way the viewer jumped. So a jump that lands
 * well is evidence too: one that lands on its aim shows no allowance is
 * needed, and the gap decays toward it. Misses the same way build the gap
 * up, misses the other way cancel them out, and it never passes the cap.
 */
export function learnFrom(gap: LearntGap, aimed: number, landed: number): LearntGap {
  const short = aimed - landed;
  if (!(Math.abs(short) <= WILD_MISS_S)) return gap;
  const landings = Math.min(gap.landings + 1, LEARN_OVER);
  const seconds = gap.seconds + (short - gap.seconds) / landings;
  return { seconds: Math.max(-LEARN_CAP_S, Math.min(LEARN_CAP_S, seconds)), landings };
}

/**
 * Where 'again' sends a second jump after a miss: further by the miss than
 * the first was sent. None when the first landed well, when the miss is too
 * wild to be a keyframe, or when the bounds leave the second nowhere new to
 * go, as at the very end or at live.
 */
export function againFor(
  wanted: number,
  aimed: number,
  landed: number,
  bounds: LandingBounds,
): number | undefined {
  const miss = landed - wanted;
  if (!(Math.abs(miss) > LANDING_SLACK_S) || Math.abs(miss) > WILD_MISS_S) return undefined;
  const second = within(bounds, aimed - miss);
  return Math.abs(second - aimed) > LANDING_SLACK_S ? second : undefined;
}

/**
 * What a clock reading after a jump's `seeked` says. `final` is the paused
 * jump's reading once it has had its moment. 'unsure': it still reads exactly
 * where it was sent, which may be the TV repeating the target.
 */
export type LandingReading = 'wait' | 'landed' | 'unsure';

export function judgeReading(reading: number, aimed: number, final: boolean): LandingReading {
  if (!(reading >= 0) || !isFinite(reading)) return 'wait';
  // webOS reads 0 for a moment after a resume: no place, unless the jump was to the start.
  if (reading === 0 && aimed > LANDING_SLACK_S) return 'wait';
  // Playing, the clock moves on from a real landing; until it does, it may be the target read back.
  if (Math.abs(reading - aimed) < AT_AIM_S) return final ? 'unsure' : 'wait';
  return 'landed';
}

/** One jump of the viewer's and where it landed, for the TV round. Seconds, to the hundredth. */
export interface Landing {
  /** When it was read, by the TV's clock. */
  time: string;
  engine: string | null;
  /** From the stream's facts. Nothing of its address is kept: no link, no file name. */
  container: Container | null;
  /** From the addon's listing, so the files of one round can be told apart. */
  sizeGb: number | null;
  mode: LandingMode;
  /** The video was paused when the jump was made. */
  paused: boolean;
  /** Where the viewer asked to go, kept to the video. */
  wanted: number;
  /** Where the element was sent. */
  aimed: number;
  /** Where the clock read once the jump had finished. */
  landed: number;
  /** `landed` less `wanted`: negative is short. */
  miss: number;
  /** False when a paused jump still read exactly its aim, which may only be the TV repeating it. */
  sure: boolean;
  /** 'again' jumped once more. */
  corrected: boolean;
  secondAimed: number | null;
  /** Null when the second jump never landed: the viewer jumped again first, or left. */
  secondLanded: number | null;
  secondMiss: number | null;
  /** The gap 'learn' allows for after this landing. It is kept in every mode, and only used in 'learn'. */
  learnt: number;
  /** Milliseconds from the jump to its `seeked` event, to the reading taken, and to the second jump's reading. */
  seekedMs: number;
  readMs: number;
  secondReadMs: number | null;
}

/** What the log says of a stream. */
export interface LandingStream {
  engine: string | null;
  container: Container | null;
  sizeGb: number | null;
}

export function landingStream(
  engine: string | null,
  facts: StreamFacts | undefined,
): LandingStream {
  const size = facts?.sizeBytes;
  return {
    engine,
    container: facts?.container ?? null,
    sizeGb: size !== undefined && size > 0 ? Math.round(size / 1e8) / 10 : null,
  };
}

const hundredths = (seconds: number) => Math.round(seconds * 100) / 100;

const signed = (seconds: number) => `${seconds > 0 ? '+' : ''}${seconds.toFixed(2)}`;

/** One line for the console. */
export function describeLanding(landing: Landing): string {
  const stream = [landing.engine ?? 'no engine', landing.container ?? 'unknown container'];
  if (landing.sizeGb !== null) stream.push(`${landing.sizeGb} GB`);
  const first =
    `wanted ${landing.wanted.toFixed(2)} aimed ${landing.aimed.toFixed(2)} ` +
    `landed ${landing.landed.toFixed(2)} miss ${signed(landing.miss)}`;
  const parts = [
    `${stream.join(' ')}, ${landing.mode}, ${landing.paused ? 'paused' : 'playing'}: ${first}`,
  ];
  if (!landing.sure) parts.push('unsure: still read its aim while paused');
  if (landing.corrected) {
    parts.push(
      landing.secondLanded === null || landing.secondMiss === null
        ? `again aimed ${landing.secondAimed?.toFixed(2)}, never landed`
        : `again aimed ${landing.secondAimed?.toFixed(2)} landed ${landing.secondLanded.toFixed(2)} ` +
            `miss ${signed(landing.secondMiss)} read after ${landing.secondReadMs} ms`,
    );
  }
  parts.push(`learnt ${landing.learnt.toFixed(2)}`);
  parts.push(`seeked after ${landing.seekedMs} ms, read after ${landing.readMs} ms`);
  return parts.join('; ');
}

declare global {
  interface Window {
    /** The last landings, newest last, for the TV round (player/landing.ts). */
    bannertvLandings?: Landing[];
  }
}

const log: Landing[] = [];

/** Puts the log where the web inspector reads it, before the first jump too. */
export function showLandings(): void {
  if (typeof window !== 'undefined') window.bannertvLandings = log;
}

/** Keeps a landing, the newest last, and prints it once on one line. */
export function logLanding(landing: Landing): void {
  log.push(landing);
  if (log.length > LANDINGS_KEPT) log.splice(0, log.length - LANDINGS_KEPT);
  showLandings();
  console.info(`[BannerTV landing] ${describeLanding(landing)}`);
}

export function recentLandings(): readonly Landing[] {
  return log;
}

/** Empties the log, as `bannertvLandings.length = 0` does from the inspector. */
export function clearLandings(): void {
  log.length = 0;
}

/** A jump of the viewer's being watched until its landing is read. */
interface Watched {
  wanted: number;
  aimed: number;
  paused: boolean;
  stream: LandingStream;
  /** When the element was sent, and when it said it had finished. */
  at: number;
  seekedAt?: number;
  /** The viewer's jump that this second one makes up for, logged once the second lands. */
  first?: Landing;
}

/** Watches one stream's jumps: where each lands, what it teaches, and whether to jump again. */
export interface LandingWatch {
  readonly mode: LandingMode;
  /** Where to send the element for a viewer's jump to `wanted` from `from`. */
  aim(wanted: number, from: number, bounds: LandingBounds): number;
  /** The viewer jumped: this jump is watched, and one still to land is let go. */
  jumped(jump: { wanted: number; aimed: number; paused: boolean; stream: LandingStream }): void;
  /** The element finished a jump. True for the watched jump's first. */
  seeked(): boolean;
  /**
   * A clock reading after the jump. Returns where 'again' sends a second
   * jump, when one is due; the caller only moves the element there.
   */
  read(reading: number, final: boolean, bounds: LandingBounds): number | undefined;
  /** A new stream, or the end of this one: nothing learnt, nothing watched. */
  reset(): void;
  /** The gap allowed for now, in seconds. */
  learnt(): number;
}

export function createLandingWatch(
  mode: LandingMode,
  now: () => number = Date.now,
  keep: (landing: Landing) => void = logLanding,
): LandingWatch {
  let gap = NOTHING_LEARNT;
  let watched: Watched | null = null;

  /** A second jump still to land is kept as far as it got; a first jump still to land is not checked. */
  function letGo() {
    if (watched?.first) keep(watched.first);
    watched = null;
  }

  return {
    mode,

    aim(wanted, from, bounds) {
      return mode === 'learn' ? aimFor(wanted, gap.seconds, from, bounds) : wanted;
    },

    jumped(jump) {
      letGo();
      watched = { ...jump, at: now() };
    },

    seeked() {
      if (!watched || watched.seekedAt !== undefined) return false;
      watched.seekedAt = now();
      return true;
    },

    read(reading, final, bounds) {
      const jump = watched;
      if (!jump || jump.seekedAt === undefined) return undefined;
      const judged = judgeReading(reading, jump.aimed, final);
      if (judged === 'wait') return undefined;
      watched = null;
      const at = now();
      if (jump.first) {
        // The second jump is never corrected again: the viewer's jump is logged with where it ended up.
        keep({
          ...jump.first,
          secondLanded: hundredths(reading),
          secondMiss: hundredths(reading - jump.wanted),
          secondReadMs: at - jump.at,
        });
        return undefined;
      }
      const sure = judged === 'landed';
      if (sure) gap = learnFrom(gap, jump.aimed, reading);
      const landing: Landing = {
        time: new Date(at).toISOString(),
        ...jump.stream,
        mode,
        paused: jump.paused,
        wanted: hundredths(jump.wanted),
        aimed: hundredths(jump.aimed),
        landed: hundredths(reading),
        miss: hundredths(reading - jump.wanted),
        sure,
        corrected: false,
        secondAimed: null,
        secondLanded: null,
        secondMiss: null,
        learnt: hundredths(gap.seconds),
        seekedMs: jump.seekedAt - jump.at,
        readMs: at - jump.at,
        secondReadMs: null,
      };
      const second =
        sure && mode === 'again' ? againFor(jump.wanted, jump.aimed, reading, bounds) : undefined;
      if (second === undefined) {
        keep(landing);
        return undefined;
      }
      watched = {
        ...jump,
        aimed: second,
        at,
        seekedAt: undefined,
        first: { ...landing, corrected: true, secondAimed: hundredths(second) },
      };
      return second;
    },

    reset() {
      letGo();
      gap = NOTHING_LEARNT;
    },

    learnt: () => gap.seconds,
  };
}

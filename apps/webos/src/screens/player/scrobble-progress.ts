import { isMuchShorter } from '@bannertv/core';
import type { SessionState } from '../../player/session';

type Played = Pick<SessionState, 'status' | 'entry' | 'position' | 'duration' | 'clip'>;

const NO_PLAY: Played = { status: 'idle', entry: null, position: 0, duration: 0, clip: false };

/** A special (season 0) can be a short extra of a long series, and plays whole. */
export function isSpecial(videoId: string): boolean {
  return /:0:\d+$/.test(videoId);
}

/**
 * Whether the file playing is a clip of the title rather than the title (a
 * sample, a trailer, a "not ready yet"): the player has judged it one, or its
 * length says so before the player has, by the player's own rule: only
 * against a running time the title's page gives, and never for a special.
 */
export function isClip(
  state: Played,
  knownRuntimeSeconds: number | undefined,
  videoId: string,
): boolean {
  if (state.clip) return true;
  return (
    !isSpecial(videoId) &&
    knownRuntimeSeconds !== undefined &&
    isMuchShorter(state.duration, knownRuntimeSeconds)
  );
}

/**
 * How far through the title a file that is the title is, in percent: against
 * its own length, or, when it gives none, against the title's running time
 * (or a guess at it), as its saved progress is.
 */
export function percent(state: Played, runtimeSeconds: number): number {
  const length = state.duration > 0 ? state.duration : runtimeSeconds;
  return length > 0 ? (state.position / length) * 100 : 0;
}

/** The title's running times, read when a play is noted or told. */
export interface Runtimes {
  /** The title's running time, or a guess at it, in seconds. */
  runtimeSeconds: number;
  /** The running time the title's page gives, if it gives one. */
  knownRuntimeSeconds: number | undefined;
}

/** What one video tells Trakt, as it plays. */
export interface ScrobblePlace {
  /** Notes, at every change, how far a real file of the video has got. */
  see(state: Played, runtimes: Runtimes): void;
  /** Whether the file playing now is a clip. */
  clip(state: Played, runtimes: Runtimes): boolean;
  /**
   * The percent to tell Trakt now. While a clip plays, the place the last
   * real file reached, so a pause or a close in the clip does not replace it
   * with the clip's 1%; nothing at all when no real file played.
   */
  now(state: Played, runtimes: Runtimes): number | undefined;
  /** The percent to stop at when the file ends: 100, but never for a clip. */
  end(state: Played, runtimes: Runtimes): number | undefined;
}

/** A place a file reached, with the length the file gave, to judge it again by. */
interface Reached {
  percent: number;
  duration: number;
}

/** Earlier files' places kept, newest last. */
const KEPT = 8;

export function createScrobblePlace(videoId: string): ScrobblePlace {
  /** Places earlier files of this video reached. */
  const earlier: Reached[] = [];
  /** This file, and the place it has reached while it passed for the title. */
  let file: SessionState['entry'] | undefined;
  let reached: Reached | undefined;
  let played = false;
  let wasClip = false;
  const clip = (state: Played, runtimes: Runtimes) =>
    isClip(state, runtimes.knownRuntimeSeconds, videoId);
  // A place kept from before the title's running time was known is judged
  // again by it: the newest one that was not a clip counts.
  const lastReal = (places: readonly Reached[], runtimes: Runtimes) => {
    for (let index = places.length - 1; index >= 0; index--) {
      const place = places[index]!;
      if (
        !isClip({ ...NO_PLAY, duration: place.duration }, runtimes.knownRuntimeSeconds, videoId)
      ) {
        return place.percent;
      }
    }
    return undefined;
  };
  const place: ScrobblePlace = {
    see(state, runtimes) {
      if (state.entry !== file) {
        // Another file: what the last one reached is kept if it was the title.
        if (reached && !wasClip) earlier.push(reached);
        if (earlier.length > KEPT) earlier.shift();
        file = state.entry;
        reached = undefined;
        played = false;
        wasClip = false;
      }
      // A file opened again (a retry of the same link) starts over too.
      if (state.status === 'loading' || state.status === 'idle') played = false;
      if (state.status === 'playing') played = true;
      if (clip(state, runtimes)) {
        // Found out late (its running time came after it started): nothing it
        // reached counts.
        wasClip = true;
        reached = undefined;
        return;
      }
      // Once this file has played, or shows its own length: one opening shows
      // none, beside the place it opened at, which is the last file's.
      const underWay =
        state.status === 'playing' || state.status === 'paused' || state.status === 'buffering';
      if (underWay && !wasClip && (played || state.duration > 0)) {
        reached = { percent: percent(state, runtimes.runtimeSeconds), duration: state.duration };
      }
    },
    clip,
    now(state, runtimes) {
      // The last real file's place, as measured by that file: the one last
      // seen, this one reopening (Try again) or the one before another opens.
      const lastSeenCounts = reached !== undefined && !wasClip;
      const kept = () => lastReal(lastSeenCounts ? earlier.concat(reached!) : earlier, runtimes);
      // A clip: never its own place.
      if (clip(state, runtimes)) return kept();
      // A file still opening, with no length of its own yet, is where the
      // last one was: not its place against the title's running time.
      const opening = state.duration === 0 && (state.entry !== file || !played);
      return (opening ? kept() : undefined) ?? percent(state, runtimes.runtimeSeconds);
    },
    end(state, runtimes) {
      return clip(state, runtimes) ? place.now(state, runtimes) : 100;
    },
  };
  return place;
}

/** What this player has told Trakt of the video so far. */
export type Sent = 'none' | 'playing' | 'paused' | 'stopped';

/** A call to make to Trakt. */
export interface ScrobbleCall {
  action: 'start' | 'pause' | 'stop';
  percent: number;
}

interface Told {
  sent: Sent;
  call?: ScrobbleCall;
}

function told(sent: Sent, action: ScrobbleCall['action'], percent: number | undefined): Told {
  return percent === undefined ? { sent } : { sent, call: { action, percent } };
}

/**
 * What a change of status tells Trakt: start when a real file plays, pause
 * when it is paused, stop at its end. A clip starts nothing; a pause with no
 * real place to send still counts as one, so the next real file starts.
 */
export function onStatus(
  sent: Sent,
  state: Played,
  place: ScrobblePlace,
  runtimes: Runtimes,
): Told {
  if (sent === 'stopped') return { sent };
  if (state.status === 'playing' && sent !== 'playing') {
    if (place.clip(state, runtimes)) return { sent };
    return told('playing', 'start', place.now(state, runtimes) ?? 0);
  }
  if (state.status === 'paused' && sent === 'playing') {
    return told('paused', 'pause', place.now(state, runtimes));
  }
  if (state.status === 'ended' && sent !== 'none') {
    return told('stopped', 'stop', place.end(state, runtimes));
  }
  return { sent };
}

/** What closing the player, or another episode replacing it, tells Trakt. */
export function onClose(sent: Sent, state: Played, place: ScrobblePlace, runtimes: Runtimes): Told {
  if (sent === 'none' || sent === 'stopped') return { sent };
  return told('stopped', 'stop', place.now(state, runtimes));
}

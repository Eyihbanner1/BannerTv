import { isMuchShorter } from '@bannertv/core';
import type { SessionState } from '../../player/session';

type Played = Pick<SessionState, 'status' | 'entry' | 'position' | 'duration' | 'clip' | 'live'>;

const NO_PLAY: Played = {
  status: 'idle',
  entry: null,
  position: 0,
  duration: 0,
  clip: false,
  live: false,
};

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
  /**
   * Notes, at every change, how far a real file of the video has got;
   * carryOn is where the player would open the next file now.
   */
  see(state: Played, runtimes: Runtimes, carryOn?: number): void;
  /**
   * Whether the file playing now is a clip: by its length, or, while it shows
   * none, by what its link was when it was opened before.
   */
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
  position: number;
  duration: number;
  entry: SessionState['entry'];
  /** Only moved to, before the file played or gave a length. */
  moved: boolean;
}

/** Earlier files' places kept, newest last. */
const KEPT = 8;

/**
 * How near a file must open to a kept place to be opening at it: the
 * session opens the next file where the last one was, read from the same
 * clock, and a viewer's move is never this small.
 */
const SAME_PLACE_S = 2;

export function createScrobblePlace(videoId: string): ScrobblePlace {
  /** Places earlier files of this video reached. */
  const earlier: Reached[] = [];
  /** This file, and the place it has reached while it passed for the title. */
  let file: SessionState['entry'] | undefined;
  let reached: Reached | undefined;
  /** Whether this opening of the file has played, or got past opening at all. */
  let played = false;
  let begun = false;
  /** Where this opening started, to tell when the viewer moves it. */
  let openedAt: number | undefined;
  /**
   * A place with no length an earlier opening reached: kept once another file
   * opens there. The same link opened again only holds it on.
   */
  let movedTo: Reached | undefined;
  let wasClip = false;
  /**
   * This link has been a clip, or a broadcast, and has shown no other length
   * since: opened again (Try again, the live edge), it is one until it does,
   * or until the viewer moves it and the player takes the move. The length it
   * last showed is judged again once the running time comes.
   */
  let linkWasClip = false;
  let linkWasLive = false;
  let linkLength = 0;
  /** A clip by what the player shows of it now. */
  const judged = (state: Played, runtimes: Runtimes) =>
    isClip(state, runtimes.knownRuntimeSeconds, videoId);
  const linkIsClip = (runtimes: Runtimes) =>
    linkWasClip ||
    (linkLength > 0 &&
      isClip({ ...NO_PLAY, duration: linkLength }, runtimes.knownRuntimeSeconds, videoId));
  /** A clip by what its link was, while it shows no length of its own. */
  const remembered = (state: Played, runtimes: Runtimes) =>
    !state.live && state.duration === 0 && state.entry === file && linkIsClip(runtimes);
  const clip = (state: Played, runtimes: Runtimes) =>
    judged(state, runtimes) || remembered(state, runtimes);
  // As percent() measures it, by the title's running time as it is now when
  // the file gave no length.
  const measure = (place: Reached, runtimes: Runtimes) =>
    percent(
      {
        ...NO_PLAY,
        position: place.duration > 0 ? Math.min(place.position, place.duration) : place.position,
        duration: place.duration,
      },
      runtimes.runtimeSeconds,
    );
  // A place kept from before the title's running time was known is judged
  // again by it: the newest one that was not a clip counts.
  const lastReal = (runtimes: Runtimes) => {
    const places = reached && !wasClip ? earlier.concat(reached) : earlier;
    for (let index = places.length - 1; index >= 0; index--) {
      const place = places[index]!;
      if (
        !isClip({ ...NO_PLAY, duration: place.duration }, runtimes.knownRuntimeSeconds, videoId)
      ) {
        return place;
      }
    }
    return undefined;
  };
  const keep = (place: Reached) => {
    earlier.push(place);
    if (earlier.length > KEPT) earlier.shift();
  };
  // Places this link reached before it showed a length: the clip's own clock,
  // now that it shows it is one.
  const forgetUnmeasured = (entry: SessionState['entry']) => {
    for (let index = earlier.length - 1; index >= 0; index--) {
      if (earlier[index]!.duration === 0 && earlier[index]!.entry === entry) {
        earlier.splice(index, 1);
      }
    }
    if (movedTo?.entry === entry) movedTo = undefined;
  };
  // What the file reached is kept, if it was the title, and it starts over.
  // A place with no length to judge it by counts once another file opens
  // there: the session opens it where a real file got to, or a move it took
  // leads, but where a clip's clock is never. Until then a place held from
  // before stands, unless this opening reached a newer one.
  const startOver = () => {
    const held = movedTo;
    movedTo = undefined;
    if (reached && !wasClip) {
      if (reached.duration === 0) movedTo = reached;
      else keep(reached);
    } else if (!wasClip) movedTo = held;
    reached = undefined;
    played = false;
    begun = false;
    openedAt = undefined;
    wasClip = false;
  };
  const place: ScrobblePlace = {
    see(state, runtimes, carryOn) {
      const opening = state.status === 'loading' || state.status === 'idle';
      let again = false;
      if (state.entry !== file) {
        startOver();
        file = state.entry;
        linkWasClip = false;
        linkWasLive = false;
        linkLength = 0;
      } else if (opening && begun) {
        // The same link opened again (Try again, a broadcast's live edge, or
        // Play before its first picture): like another file, but a clip stays
        // one while it opens, and a place with no length is only held on.
        if (wasClip) linkWasClip = true;
        startOver();
        again = true;
      }
      if (openedAt === undefined) {
        openedAt = state.position;
        if (!again) {
          if (movedTo && Math.abs(movedTo.position - state.position) <= SAME_PLACE_S) {
            keep(movedTo);
          }
          movedTo = undefined;
        }
      }
      if (!opening) begun = true;
      if (state.status === 'playing') played = true;
      if (state.live) {
        // A broadcast's clock is no place in the title, nor any place it was
        // only moved to.
        begun = true;
        linkWasLive = true;
        reached = undefined;
        forgetUnmeasured(state.entry);
        return;
      }
      if (state.duration > 0) {
        linkLength = state.duration;
        linkWasLive = false;
        if (!judged(state, runtimes)) linkWasClip = false;
      }
      if (judged(state, runtimes)) {
        // Found out late (its running time came after it started, or its
        // length after it played): nothing this link reached before it showed
        // a length counts, nor anything it reaches now.
        wasClip = true;
        reached = undefined;
        forgetUnmeasured(state.entry);
        return;
      }
      // Once this file has played, or shows its own length, a place inside
      // it; or, with no length, once the viewer moved it from where it opened
      // and the player took the move (it opens the next file there).
      const underWay =
        state.status === 'playing' ||
        state.status === 'paused' ||
        state.status === 'buffering' ||
        (state.duration > 0 && (state.status === 'loading' || state.status === 'failed'));
      // A move the player took counts whatever the status, even while the
      // file still opens.
      const moved =
        state.status !== 'idle' &&
        !wasClip &&
        state.duration === 0 &&
        !played &&
        !linkWasLive &&
        carryOn !== undefined &&
        Math.abs(carryOn - state.position) <= SAME_PLACE_S &&
        Math.abs(state.position - (openedAt ?? state.position)) > SAME_PLACE_S;
      if (moved) {
        // The player took it: this is the title now, whatever the link was.
        linkWasClip = false;
        linkLength = 0;
      }
      if (remembered(state, runtimes)) {
        // Still a clip by what its link was, maybe only now its running time
        // came: nothing it reached with no length counts.
        reached = undefined;
        forgetUnmeasured(state.entry);
        return;
      }
      if ((!underWay && !moved) || wasClip) return;
      const inside = state.duration === 0 || played || state.position <= state.duration;
      if (inside && (played || state.duration > 0 || moved)) {
        reached = {
          position: state.position,
          duration: state.duration,
          entry: state.entry,
          moved: !played && state.duration === 0,
        };
      } else if (reached?.moved) reached = undefined;
    },
    clip,
    now(state, runtimes) {
      const last = lastReal(runtimes);
      const kept = last && measure(last, runtimes);
      // A clip: never its own place, but the last real file's, or nothing.
      if (clip(state, runtimes)) return kept;
      const opening = state.duration === 0 && (state.entry !== file || !played);
      if (!opening) return percent(state, runtimes.runtimeSeconds);
      // A file still opening, with no length of its own yet, is at the place
      // it opens at. A broadcast opened again is at its own clock: the last
      // real file's place, or nothing.
      if (state.entry === file && linkWasLive) return kept;
      // Opening where the last real file got to, it is there by that file's
      // measure, not by the title's running time.
      if (last && Math.abs(last.position - state.position) <= SAME_PLACE_S) return kept;
      return percent(state, runtimes.runtimeSeconds);
    },
    end(state, runtimes) {
      return clip(state, runtimes) ? place.now(state, runtimes) : 100;
    },
  };
  return place;
}

/**
 * What this player has told Trakt of the video so far. 'unsent' is a pause
 * with no real place to send: Trakt still has the last start, so the next
 * real place is sent as a pause, and the next real file starts afresh.
 */
export type Sent = 'none' | 'playing' | 'unsent' | 'paused' | 'stopped';

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
 * real place to send waits for one, and the next real file starts.
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
  if (state.status === 'paused' && (sent === 'playing' || sent === 'unsent')) {
    const percent = place.now(state, runtimes);
    return percent === undefined ? { sent: 'unsent' } : told('paused', 'pause', percent);
  }
  if (state.status === 'ended' && sent !== 'none') {
    return told('stopped', 'stop', place.end(state, runtimes));
  }
  return { sent };
}

/** What seeing a state tells Trakt, and whether the file is now taken for a clip. */
export interface Seen extends Told {
  clip: boolean;
}

/**
 * What seeing a state tells Trakt besides a change of status: a file found to
 * be the title while it plays (its length came), or found to be a clip, is
 * told as a change of status would tell it. Never of a broadcast.
 */
export function onSeen(
  sent: Sent,
  wasClip: boolean,
  state: Played,
  place: ScrobblePlace,
  runtimes: Runtimes,
): Seen {
  const clip = place.clip(state, runtimes);
  if (clip === wasClip || state.live) return { sent, clip };
  return { ...onStatus(sent, state, place, runtimes), clip };
}

/** What closing the player, or another episode replacing it, tells Trakt. */
export function onClose(sent: Sent, state: Played, place: ScrobblePlace, runtimes: Runtimes): Told {
  if (sent === 'none' || sent === 'stopped') return { sent };
  return told('stopped', 'stop', place.now(state, runtimes));
}

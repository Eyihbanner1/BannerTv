import {
  addSleepTime,
  nextSleepCheck,
  type SleepChoice,
  sleepPhase,
  type SleepTimer,
  startSleep,
  stopsBeforeNext,
} from '@bannertv/core';
import type { PlaybackSession, SessionState } from '@tv/player/session';
import { keepSleepTimer, leaveSleepTimer, SLEEP_OFF, sleepTimerFor } from '@tv/player/sleep';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sleepHold } from './sleep-hold';

/** A minutes timer is read again at least this often, as on the TV. */
const SLEEP_TICK_MS = 30 * 1000;

export interface PlayerSleep {
  timer: SleepTimer;
  /** It stops at this end, instead of the next episode starting. */
  sleepsHere: boolean;
  /** Its last minute, until let go; the player shows it only over the picture alone. */
  warning: boolean;
  /** Paused by it, under its dark screen. */
  asleep: boolean;
  /** Starts a timer, or turns it off. Picking minutes again starts them again. */
  choose: (choice: SleepChoice) => void;
  /** The warning's 15 minutes more. */
  add: () => void;
  /** Lets the warning go, leaving the timer as it is. */
  dismissWarning: () => void;
  /** The end the timer stops at: pause under the dark screen. */
  fallAsleep: () => void;
  /** Off the dark screen; the player decides whether it plays on. */
  wake: () => void;
  /** The player goes on to another episode of this title, which keeps the timer. */
  carryOn: () => void;
}

/**
 * The TV's sleep timer, for the phone's player (apps/webos/src/player/sleep.ts and core's
 * sleep.ts; the TV's PlayerScreen keeps the same state). Minutes pause the video wherever it is,
 * playing or paused; the end of what plays, or minutes that would run out early in the next
 * episode, stop at this end. It lasts into the next episode of the title and goes with
 * anywhere else. `onAsleep` closes what is open over the picture as the timer pauses it.
 */
export function useSleepTimer(
  metaId: string,
  session: PlaybackSession | null,
  state: SessionState,
  offersNext: boolean,
  /** The dark screen can't be seen: picture-in-picture. */
  unseen: boolean,
  onAsleep: () => void,
): PlayerSleep {
  const [timer, setTimer] = useState(() => sleepTimerFor(metaId));
  // The time it is read at, moved on as it nears a change.
  const [now, setNow] = useState(() => Date.now());
  const [warningGone, setWarningGone] = useState(false);
  const [asleep, setAsleep] = useState(false);

  const ended = state.status === 'ended';
  const phase = sleepPhase(timer, now, {
    remainingS: state.duration > 0 ? state.duration - state.position : Infinity,
    ended,
    live: state.live,
    rate: state.rate,
  });
  const sleepsHere =
    stopsBeforeNext(timer, now) && !state.live && (offersNext || timer.choice === 'end');
  const fallAsleep = () => {
    setAsleep(true);
    setTimer(SLEEP_OFF);
    onAsleep();
  };
  // Minutes pause the video wherever it is; the end waits for the player's end decision.
  if (phase === 'due' && timer.choice !== 'end' && !asleep) fallAsleep();

  // Kept for the next episode's player, and read again as it nears its warning and its end.
  useEffect(() => keepSleepTimer(metaId, timer), [metaId, timer]);
  const carriesOn = useRef(false);
  useEffect(
    () => () => {
      // Gone anywhere but on with this title, the player leaves no timer behind.
      if (!carriesOn.current) leaveSleepTimer(metaId, { name: 'home' });
    },
    [metaId],
  );
  useEffect(() => {
    const wait = nextSleepCheck(timer, now);
    if (wait === null) return;
    const tick = setTimeout(() => setNow(Date.now()), Math.min(wait, SLEEP_TICK_MS));
    return () => clearTimeout(tick);
  }, [timer, now]);
  // Again if a stream starts playing under the dark screen, except where it can't be seen
  // (sleep-hold.ts).
  const playingNow = state.status === 'playing';
  const stopped = useRef(false);
  useEffect(() => {
    if (!asleep) {
      stopped.current = false;
      return;
    }
    const hold = sleepHold({ playing: playingNow, stopped: stopped.current, unseen });
    if (hold === 'wait') stopped.current = true;
    else if (hold === 'wake') setAsleep(false);
    else session?.pause();
  }, [asleep, session, playingNow, unseen]);

  const choose = useCallback((choice: SleepChoice) => {
    const at = Date.now();
    setTimer(startSleep(choice, at));
    setNow(at);
    setWarningGone(false);
  }, []);
  const add = () => {
    const at = Date.now();
    setTimer(addSleepTime(timer, at));
    setNow(at);
    setWarningGone(false);
  };
  const dismissWarning = useCallback(() => setWarningGone(true), []);
  const wake = useCallback(() => setAsleep(false), []);
  const carryOn = useCallback(() => {
    carriesOn.current = true;
  }, []);

  return {
    timer,
    sleepsHere,
    warning: phase === 'warning' && !warningGone,
    asleep,
    choose,
    add,
    dismissWarning,
    fallAsleep,
    wake,
    carryOn,
  };
}

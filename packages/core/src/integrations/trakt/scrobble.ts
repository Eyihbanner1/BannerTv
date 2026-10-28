import type { TraktAccount } from './account';
import type { TraktTarget } from './ids';

/**
 * Tells Trakt what the player is doing with one film or episode. Each call
 * takes how far through it playback is, in percent (0 to 100). Calls never
 * reject: a request that fails is dropped, and the next one carries the
 * position (docs/adr/0004, item 11).
 */
export interface Scrobbler {
  /** Playback started, or resumed after a pause or a seek. */
  start(percent: number): Promise<void>;
  pause(percent: number): Promise<void>;
  /** Playback ended: the viewer left, the video ended, or the next episode began. */
  stop(percent: number): Promise<void>;
}

type Phase = 'new' | 'playing' | 'paused' | 'stopped';

const noop = () => undefined;

/**
 * A scrobbler for one playback. Nothing is sent for a title Trakt cannot
 * identify (`target` undefined) or while the profile is signed out.
 */
export function createScrobbler(options: {
  account: Pick<TraktAccount, 'get' | 'call'>;
  target: TraktTarget | undefined;
}): Scrobbler {
  const { account, target } = options;
  let phase: Phase = 'new';
  // One request at a time, so Trakt hears a start before the stop that follows it.
  let queue: Promise<void> = Promise.resolve();

  function scrobble(action: 'start' | 'pause' | 'stop', percent: number): Promise<void> {
    if (!target || !Number.isFinite(percent)) return Promise.resolve();
    if (action === 'pause' && phase !== 'playing') return Promise.resolve();
    if (action === 'stop' && (phase === 'new' || phase === 'stopped')) return Promise.resolve();
    phase = action === 'start' ? 'playing' : action === 'pause' ? 'paused' : 'stopped';
    if (account.get().status === 'signedOut') return Promise.resolve();
    const progress = Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100;
    const body = { ...target, progress };
    queue = queue.then(() => account.call('POST', `/scrobble/${action}`, body)).then(noop, noop);
    return queue;
  }

  return {
    start: (percent) => scrobble('start', percent),
    pause: (percent) => scrobble('pause', percent),
    stop: (percent) => scrobble('stop', percent),
  };
}

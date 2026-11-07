import { describe, expect, it } from 'vitest';
import type { SessionState, SessionStatus } from '../../player/session';
import {
  createScrobblePlace,
  isClip,
  isSpecial,
  onClose,
  onSeen,
  onStatus,
  percent,
  type ScrobbleCall,
  type Sent,
} from './scrobble-progress';

const EPISODE_S = 47 * 60;
const EPISODE = 'tt0944947:1:3';

type Entry = SessionState['entry'];
const REAL = { name: 'The episode' } as unknown as Entry;
const OTHER = { name: 'Another release' } as unknown as Entry;
const CLIP = { name: 'A 30 second clip' } as unknown as Entry;

type Played = ReturnType<typeof played>;

/** A state of a stream the player takes for a live broadcast. */
function live(position: number, status: SessionStatus = 'playing', entry: Entry = OTHER): Played {
  return { ...played(position, 0, status, false, entry), live: true };
}

function played(
  position: number,
  duration: number,
  status: SessionStatus = 'playing',
  clip = false,
  entry: Entry = clip ? CLIP : REAL,
) {
  return { status, entry, position, duration, clip, live: false };
}

describe('isClip', () => {
  it('takes a 30 second file of a 47 minute episode for a clip, before the player judges it', () => {
    expect(isClip(played(30, 30), EPISODE_S, EPISODE)).toBe(true);
  });

  it('takes a file the player judged a clip for one, whatever is known of its length', () => {
    expect(isClip(played(10, 0, 'playing', true), undefined, EPISODE)).toBe(true);
  });

  it('takes a short episode, or a short file of a short title, for the title', () => {
    expect(isClip(played(0, 21 * 60), EPISODE_S, EPISODE)).toBe(false);
    expect(isClip(played(0, 4 * 60), 15 * 60, EPISODE)).toBe(false);
  });

  it('never guesses: without a running time from the title, its length makes nothing a clip', () => {
    expect(isClip(played(30, 30), undefined, EPISODE)).toBe(false);
  });

  it('never takes a special for a clip by its length, however long the series runs', () => {
    expect(isSpecial('tt0944947:0:12')).toBe(true);
    expect(isSpecial('tmdb:1399:0:1')).toBe(true);
    expect(isSpecial('tt0944947:10:1')).toBe(false);
    expect(isSpecial('tt0944947')).toBe(false);
    expect(isClip(played(0, 3 * 60), EPISODE_S, 'tt0944947:0:12')).toBe(false);
  });

  it('needs a length from the file', () => {
    expect(isClip(played(30, 0), EPISODE_S, EPISODE)).toBe(false);
  });
});

describe('percent', () => {
  it('measures a file against its own length', () => {
    expect(percent(played(30 * 60, 60 * 60), EPISODE_S)).toBe(50);
  });

  it('measures a file that gives no length against the running time, or the guess at it', () => {
    expect(percent(played(EPISODE_S / 4, 0), EPISODE_S)).toBe(25);
  });

  it('is 0 with no length at all', () => {
    expect(percent(played(10, 0), 0)).toBe(0);
  });
});

describe('createScrobblePlace', () => {
  const known = { runtimeSeconds: EPISODE_S, knownRuntimeSeconds: EPISODE_S };
  const guessed = { runtimeSeconds: 3600, knownRuntimeSeconds: undefined };
  const episode = () => createScrobblePlace(EPISODE);

  it('tells Trakt how far a real file has got', () => {
    const scrobble = episode();
    const now = played(20 * 60, 40 * 60);
    scrobble.see(now, known);
    expect(scrobble.clip(now, known)).toBe(false);
    expect(scrobble.now(now, known)).toBe(50);
  });

  it('keeps the real place while a clip picked after it opens, plays, is paused or ends', () => {
    const scrobble = episode();
    scrobble.see(played(20 * 60, 45 * 60), known);
    // Sources: the clip opens where the episode was, with the episode's length still showing.
    scrobble.see(played(20 * 60, 45 * 60, 'loading', false, CLIP), known);
    for (const clip of [
      played(5, 30, 'playing', false, CLIP),
      played(12, 30, 'playing', true),
      played(12, 30, 'paused', true),
      played(30, 30, 'failed', true),
    ]) {
      scrobble.see(clip, known);
      expect(scrobble.clip(clip, known)).toBe(true);
      expect(scrobble.now(clip, known)).toBeCloseTo((20 / 45) * 100);
    }
  });

  it('keeps the real place when the clip opens paused, before its length is known', () => {
    const scrobble = episode();
    scrobble.see(played(31.5, 600), known);
    scrobble.see(played(31.5, 600, 'paused'), known);
    // Picked while paused: it opens paused, at the episode's place, with no length yet.
    scrobble.see(played(31.5, 0, 'loading', false, CLIP), known);
    const opening = played(31.5, 0, 'paused', false, CLIP);
    scrobble.see(opening, known);
    const judged = played(31.5, 40, 'paused', true);
    scrobble.see(judged, known);
    expect(scrobble.now(judged, known)).toBeCloseTo(5.25);
  });

  it('forgets what a clip reached when its running time comes after it started', () => {
    const scrobble = episode();
    scrobble.see(played(20 * 60, 45 * 60), known);
    scrobble.see(played(0, 0, 'loading', false, CLIP), guessed);
    // No running time yet: the 30 second file passes for the episode.
    scrobble.see(played(25, 30, 'playing', false, CLIP), guessed);
    expect(scrobble.now(played(25, 30, 'playing', false, CLIP), guessed)).toBeCloseTo(83.3, 1);
    // The title's page says 47 minutes: it was a clip all along.
    const ended = played(30, 30, 'ended', false, CLIP);
    scrobble.see(ended, known);
    expect(scrobble.clip(ended, known)).toBe(true);
    expect(scrobble.now(ended, known)).toBeCloseTo((20 / 45) * 100);
    // Nor once another clip is picked after it.
    const next = played(5, 30, 'paused', true, OTHER);
    scrobble.see(next, known);
    expect(scrobble.now(next, known)).toBeCloseTo((20 / 45) * 100);
  });

  it('keeps the place of the real file auto-play moves on to from a clip', () => {
    const scrobble = episode();
    // A 40 s "not ready yet" clip, then the episode in its place: each file
    // opens with no length until it gives its own.
    scrobble.see(played(1200, 0, 'loading', false, CLIP), known);
    scrobble.see(played(1200, 40, 'loading', false, CLIP), known);
    scrobble.see(played(1200, 0, 'loading', false, OTHER), known);
    // A file of unknown length plays as the title.
    const unknown = played(1300, 0, 'playing', false, OTHER);
    scrobble.see(unknown, known);
    expect(scrobble.clip(unknown, known)).toBe(false);
    scrobble.see(played(1692, 2820, 'playing', false, OTHER), known);
    // Then a clip picked in Sources: paused in it, Trakt keeps 60%.
    scrobble.see(played(1692, 0, 'loading', false, REAL), known);
    const picked = { ...played(1692, 40, 'paused', true), entry: REAL };
    scrobble.see(picked, known);
    expect(scrobble.now(picked, known)).toBeCloseTo(60);
  });

  it('drops a place a clip reached before the running time was known, once it is', () => {
    const scrobble = episode();
    const guessed = { runtimeSeconds: 3600, knownRuntimeSeconds: undefined };
    scrobble.see(played(0, 0, 'loading', false, CLIP), guessed);
    scrobble.see(played(25, 30, 'playing', false, CLIP), guessed);
    // Another clip picked before the page's running time comes.
    scrobble.see(played(25, 30, 'loading', false, OTHER), guessed);
    const judged = { ...played(10, 30, 'paused', true), entry: OTHER };
    scrobble.see(judged, known);
    expect(scrobble.now(judged, known)).toBeUndefined();
  });

  it('measures a pause or close while the next file opens by the file that was playing', () => {
    const scrobble = episode();
    // A 70 minute file of a title whose page says 45: 40 minutes in is 57%.
    scrobble.see(played(2400, 4200), known);
    // Another release opens there, with no length until it gives its own.
    const opening = played(2400, 0, 'loading', false, OTHER);
    scrobble.see(opening, known);
    expect(scrobble.now(opening, known)).toBeCloseTo(57.14);
    expect(scrobble.now(played(2400, 0, 'paused', false, OTHER), known)).toBeCloseTo(57.14);
    // Once it gives its length, its own place.
    const own = played(2400, 4000, 'playing', false, OTHER);
    scrobble.see(own, known);
    expect(scrobble.now(own, known)).toBe(60);
  });

  it('keeps a file’s own place while Try again opens it again', () => {
    const scrobble = episode();
    scrobble.see(played(1428, 2820), known);
    // Another release picked in Sources plays to 91%, then fails.
    scrobble.see(played(1428, 0, 'loading', false, OTHER), known);
    scrobble.see(played(2628, 2880, 'playing', false, OTHER), known);
    scrobble.see(played(2628, 2880, 'failed', false, OTHER), known);
    // Try again: the same release opens again there, with no length yet.
    const reopening = played(2628, 0, 'loading', false, OTHER);
    scrobble.see(reopening, known);
    expect(scrobble.now(reopening, known)).toBeCloseTo(91.25);
  });

  it('measures the first file, opening at a saved place, against the running time', () => {
    const scrobble = episode();
    const opening = played(EPISODE_S / 2, 0, 'loading');
    scrobble.see(opening, known);
    expect(scrobble.now(opening, known)).toBe(50);
  });

  it('measures a file of unknown length that plays against the running time', () => {
    const scrobble = episode();
    scrobble.see(played(2400, 4200), known);
    scrobble.see(played(2400, 0, 'loading', false, OTHER), known);
    const unknown = played(EPISODE_S / 2, 0, 'playing', false, OTHER);
    scrobble.see(unknown, known);
    expect(scrobble.now(unknown, known)).toBe(50);
  });

  it('tells Trakt nothing for a clip when no real file played', () => {
    const scrobble = episode();
    const clip = played(30, 30, 'paused', true);
    scrobble.see(clip, known);
    expect(scrobble.now(clip, known)).toBeUndefined();
  });

  it('follows a real file picked after a clip, and keeps it through the next clip', () => {
    const scrobble = episode();
    scrobble.see(played(10, 30, 'playing', true), known);
    const real = played(9 * 60, 45 * 60, 'playing', false, OTHER);
    scrobble.see(real, known);
    expect(scrobble.now(real, known)).toBe(20);
    expect(scrobble.now(played(5, 30, 'paused', true), known)).toBe(20);
    scrobble.see(played(5, 30, 'paused', true), known);
    expect(scrobble.now(played(5, 30, 'paused', true), known)).toBe(20);
  });

  it('learns nothing from a file opening, until it plays or gives its own length', () => {
    const scrobble = episode();
    const clip = played(3, 30, 'paused', true);
    // Opened paused at the last file's place, with no length yet.
    scrobble.see(played(10 * 60, 0, 'loading'), known);
    scrobble.see(played(10 * 60, 0, 'paused'), known);
    expect(scrobble.now(clip, known)).toBeUndefined();
    // Its own length in: paused at 20 of 40 minutes (moved there, say).
    scrobble.see(played(20 * 60, 40 * 60, 'paused'), known);
    expect(scrobble.now(clip, known)).toBe(50);
  });

  it('keeps the real place when two clips come before the running time does', () => {
    const scrobble = episode();
    const guessed = { runtimeSeconds: 3600, knownRuntimeSeconds: undefined };
    scrobble.see(played(1410, 2820, 'playing', false, REAL), guessed);
    // A 4 minute sample passes for the title while the page's running time is not in.
    scrobble.see(played(1410, 0, 'loading', false, CLIP), guessed);
    scrobble.see(played(1440, 240, 'playing', false, CLIP), guessed);
    scrobble.see(played(1440, 0, 'loading', false, OTHER), guessed);
    // The running time comes, and the next sample is judged a clip.
    const judged = { ...played(1450, 240, 'paused', true), entry: OTHER };
    scrobble.see(judged, known);
    expect(scrobble.now(judged, known)).toBeCloseTo(50);
  });

  it('ends at 100, but a clip found out by its end only at the last real place, or nothing', () => {
    const scrobble = episode();
    const guessed = { runtimeSeconds: 3600, knownRuntimeSeconds: undefined };
    expect(scrobble.end(played(45 * 60, 45 * 60, 'ended'), known)).toBe(100);
    scrobble.see(played(0, 0, 'loading', false, CLIP), guessed);
    scrobble.see(played(29, 30, 'playing', false, CLIP), guessed);
    expect(scrobble.end(played(30, 30, 'ended', false, CLIP), known)).toBeUndefined();
    const after = createScrobblePlace(EPISODE);
    after.see(played(9 * 60, 45 * 60), known);
    after.see(played(9 * 60, 0, 'loading', false, CLIP), guessed);
    after.see(played(29, 30, 'playing', false, CLIP), guessed);
    expect(after.end(played(30, 30, 'ended', false, CLIP), known)).toBe(20);
  });

  it('takes a short file for the title when the page gives no running time', () => {
    const scrobble = episode();
    const short = played(30, 30, 'ended');
    expect(scrobble.clip(short, guessed)).toBe(false);
    expect(scrobble.now(short, guessed)).toBe(100);
  });

  it('takes a short special for the special, unless the player judged it a clip', () => {
    const scrobble = createScrobblePlace('tt0944947:0:4');
    const special = played(3 * 60, 3 * 60, 'ended');
    expect(scrobble.clip(special, known)).toBe(false);
    expect(scrobble.now(special, known)).toBe(100);
    expect(scrobble.clip(played(10, 30, 'playing', true), known)).toBe(true);
  });
});

describe('onStatus and onClose', () => {
  const known = { runtimeSeconds: EPISODE_S, knownRuntimeSeconds: EPISODE_S };
  const guessed = { runtimeSeconds: 3600, knownRuntimeSeconds: undefined };

  /**
   * Feeds states through a place as the hook does, and lists what Trakt is
   * told. A step's third value is where the player would open the next file
   * (by default where this one is: it took every move).
   */
  function trakt(steps: [Played, typeof known | typeof guessed, number?][], close = true) {
    const scrobble = createScrobblePlace(EPISODE);
    const calls: ScrobbleCall[] = [];
    let sent: Sent = 'none';
    let last: { state: Played; runtimes: typeof known | typeof guessed } | undefined;
    let wasClip = false;
    for (const [state, runtimes, carryOn = state.position] of steps) {
      // As the hook: on every state, then when the status changes, never of a broadcast.
      scrobble.see(state, runtimes, carryOn);
      const seen = onSeen(sent, wasClip, state, scrobble, runtimes);
      wasClip = seen.clip;
      sent = seen.sent;
      if (seen.call) calls.push(seen.call);
      if (!state.live && (last?.state.status !== state.status || last.state.live !== state.live)) {
        const next = onStatus(sent, state, scrobble, runtimes);
        sent = next.sent;
        if (next.call) calls.push(next.call);
      }
      last = { state, runtimes };
    }
    if (close && last && !last.state.live) {
      const next = onClose(sent, last.state, scrobble, last.runtimes);
      if (next.call) calls.push(next.call);
    }
    return calls.map((call) => `${call.action}(${Math.round(call.percent)})`);
  }

  it('tells Trakt an ordinary play: start, pause, stop at the end', () => {
    expect(
      trakt([
        [played(0, 0, 'loading'), known],
        [played(0, 2820, 'playing'), known],
        [played(1410, 2820, 'paused'), known],
        [played(1410, 2820, 'playing'), known],
        [played(2820, 2820, 'ended'), known],
      ]),
    ).toEqual(['start(0)', 'pause(50)', 'start(50)', 'stop(100)']);
  });

  it('stops where a play got to when the player closes', () => {
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(705, 2820, 'buffering'), known],
      ]),
    ).toEqual(['start(0)', 'stop(25)']);
  });

  it('starts nothing for a clip, and sends the episode’s place from a pause or close in it', () => {
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(1410, 2820, 'playing'), known],
        [played(1410, 0, 'loading', false, CLIP), known],
        [played(1410, 40, 'playing', true), known],
        [played(1415, 40, 'paused', true), known],
        [played(1415, 40, 'playing', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(50)', 'stop(50)']);
  });

  it('starts the real file after a pause in a clip found out late, with nothing to send', () => {
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), guessed],
        [played(5, 30, 'playing', false, CLIP), guessed],
        // The page's running time comes: it was a clip.
        [played(10, 30, 'paused', false, CLIP), known],
        [played(10, 0, 'loading', false, OTHER), known],
        [played(10, 2820, 'playing', false, OTHER), known],
      ]),
    ).toEqual(['start(17)', 'start(0)', 'stop(0)']);
  });

  it('keeps the episode’s place when Try again brings back a clip of the same link', () => {
    const real = [
      [played(0, 2820, 'playing'), known],
      [played(1410, 2820, 'playing'), known],
      [played(1410, 2820, 'failed'), known],
      // Try again: the same link opens again there, and serves a 10 s placeholder.
      [played(1410, 0, 'loading'), known],
    ] satisfies [Played, typeof known][];
    expect(
      trakt([
        ...real,
        [played(0, 10, 'loading', true, REAL), known],
        [played(2, 10, 'playing', true, REAL), known],
        [played(2, 10, 'paused', true, REAL), known],
      ]),
    ).toEqual(['start(0)', 'pause(50)', 'stop(50)']);
    // Auto-play with nothing left to move on to: the placeholder fails.
    expect(trakt([...real, [played(1, 10, 'failed'), known]])).toEqual(['start(0)', 'stop(50)']);
  });

  it('sends nothing of a clip found out late while Try again opens it again', () => {
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), guessed],
        [played(0, 240, 'playing', false, CLIP), guessed],
        [played(200, 240, 'playing', false, CLIP), guessed],
        [played(200, 240, 'failed', false, CLIP), guessed],
        // The page's running time comes: it was a clip. Try again opens it at its own clock.
        [played(200, 240, 'failed', false, CLIP), known],
        [played(200, 0, 'loading', false, CLIP), known],
        [played(200, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
  });

  it('keeps a clip found out late one through every Try again, and when its running time comes late', () => {
    const clip = [
      [played(0, 0, 'loading', false, CLIP), guessed],
      [played(0, 240, 'playing', false, CLIP), guessed],
      [played(200, 240, 'playing', false, CLIP), guessed],
    ] satisfies [Played, typeof known | typeof guessed][];
    // The running time comes; Try again fails before the link shows a length; Try again.
    expect(
      trakt([
        ...clip,
        [played(200, 240, 'failed', false, CLIP), known],
        [played(200, 0, 'loading', false, CLIP), known],
        [played(200, 0, 'failed', false, CLIP), known],
        [played(200, 0, 'loading', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
    // Try again first; the running time comes while it opens, and Pause is pressed.
    expect(
      trakt([
        ...clip,
        [played(200, 240, 'failed', false, CLIP), guessed],
        [played(200, 0, 'loading', false, CLIP), guessed],
        [played(200, 0, 'loading', false, CLIP), known],
        [played(200, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
  });

  it('follows the viewer moving a file of unknown length before its first picture', () => {
    // Try again, paused before the picture, rewound to 10%.
    expect(
      trakt([
        [played(0, 0, 'playing'), known],
        [played(2540, 0, 'playing'), known],
        [played(2540, 0, 'failed'), known],
        [played(2540, 0, 'loading'), known],
        [played(2540, 0, 'paused'), known],
        [played(282, 0, 'paused'), known],
      ]),
    ).toEqual(['start(0)', 'pause(90)', 'stop(10)']);
    // Another quality, opened paused and moved on to 85%.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(900, 2820, 'playing'), known],
        [played(900, 2820, 'paused'), known],
        [played(900, 0, 'loading', false, OTHER), known],
        [played(900, 0, 'paused', false, OTHER), known],
        [played(2400, 0, 'paused', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'pause(32)', 'stop(85)']);
  });

  it('keeps a move before the first picture to that opening alone', () => {
    // Quality while paused opens a clip; the viewer moves it before its length shows.
    // Its length then shows it a clip, and the player moves on to another release.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(2100, 2820, 'playing'), known],
        [played(2100, 2820, 'paused'), known],
        [played(2100, 0, 'loading', false, CLIP), known],
        [played(2100, 0, 'paused', false, CLIP), known],
        [played(2400, 0, 'paused', false, CLIP), known],
        [played(2100, 0, 'loading', false, OTHER), known],
        [played(2100, 0, 'paused', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'pause(74)', 'stop(74)']);
    // A clip found out late, opened again, paused and skipped before its
    // picture: a skip the player does not take (it opens the next file where
    // this one opened) leaves nothing to send.
    const reopened: Parameters<typeof trakt>[0] = [
      [played(0, 0, 'loading', false, CLIP), guessed],
      [played(0, 240, 'playing', false, CLIP), guessed],
      [played(200, 240, 'playing', false, CLIP), guessed],
      [played(200, 240, 'failed', false, CLIP), known],
      [played(200, 0, 'loading', false, CLIP), known],
      [played(200, 0, 'paused', false, CLIP), known],
    ];
    expect(trakt([...reopened, [played(230, 0, 'paused', false, CLIP), known, 200]])).toEqual([
      'start(0)',
    ]);
    // One it takes is where the player now is, as it saves it: paused there.
    expect(trakt([...reopened, [played(230, 0, 'paused', false, CLIP), known]])).toEqual([
      'start(0)',
      'pause(8)',
      'stop(8)',
    ]);
  });

  it('never takes a broadcast’s clock for the episode’s place', () => {
    const before = [
      [played(0, 2820, 'playing'), known],
      [played(1128, 2820, 'playing'), known],
      [played(1128, 2820, 'failed'), known],
      // Another release turns out to be live, and plays at its live edge.
      [played(1128, 0, 'loading', false, OTHER), known],
      [live(2400), known],
      [live(2460), known],
    ] satisfies [Played, typeof known][];
    // It fails; Try again opens it again, and the player closes while it does.
    expect(
      trakt([
        ...before,
        [live(2460, 'failed'), known],
        [played(0, 0, 'loading', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'stop(40)']);
    // A clip picked after it.
    expect(
      trakt([
        ...before,
        [played(0, 0, 'loading', false, CLIP), known],
        [played(5, 40, 'playing', true), known],
        [played(5, 40, 'paused', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(40)', 'stop(40)']);
    // Another real release picked after it opens at the start, as the player
    // opens one after a broadcast: that is where it is.
    expect(
      trakt([...before, [played(0, 0, 'loading'), known], [played(0, 0, 'paused'), known]]),
    ).toEqual(['start(0)', 'pause(0)', 'stop(0)']);
    // Found live while it still opens, and opened again at its live edge:
    // a Pause before the picture keeps the episode's place.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(1128, 2820, 'playing'), known],
        [played(1128, 0, 'loading', false, OTHER), known],
        [live(0, 'loading'), known],
        [played(0, 0, 'loading', false, OTHER), known],
        [played(0, 0, 'paused', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'pause(40)', 'stop(40)']);
  });

  it('measures a file opening where the viewer moved one of unknown length, as the player opens it', () => {
    const moved = [
      [played(0, 2820, 'playing'), known],
      [played(1410, 2820, 'playing'), known],
      [played(1410, 2820, 'paused'), known],
      // Another quality, of unknown length, opened paused and moved to 85%.
      [played(1410, 0, 'loading', false, OTHER), known],
      [played(1410, 0, 'paused', false, OTHER), known],
      [played(2400, 0, 'paused', false, OTHER), known],
    ] satisfies [Played, typeof known][];
    // Play: the same file goes on from there; Back before its picture.
    expect(trakt([...moved, [played(2400, 0, 'loading', false, OTHER), known]])).toEqual([
      'start(0)',
      'pause(50)',
      'stop(85)',
    ]);
    // Another quality, opened at the moved place.
    expect(
      trakt([
        ...moved,
        [played(2400, 0, 'loading', false, CLIP), known],
        [played(2400, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)', 'pause(50)', 'stop(85)']);
    // A move the player did not take (no length to move by yet): the next
    // file opens where the first was, and is there by its measure.
    expect(
      trakt([
        ...moved,
        [played(1410, 0, 'loading', false, CLIP), known],
        [played(1410, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)', 'pause(50)', 'stop(50)']);
  });

  it('keeps a move the player took in a file of unknown length, for a clip opened after it', () => {
    const moved = [
      [played(0, 2820, 'playing'), known],
      [played(600, 2820, 'playing'), known],
      [played(600, 2820, 'paused'), known],
      // Another release, of unknown length, opened paused and skipped to 64%.
      [played(600, 0, 'loading', false, OTHER), known],
      [played(600, 0, 'paused', false, OTHER), known],
      [played(1800, 0, 'paused', false, OTHER), known],
    ] satisfies [Played, typeof known][];
    // A clip opens where the player took the move.
    expect(
      trakt([
        ...moved,
        [played(1800, 0, 'loading', false, CLIP), known],
        [played(1800, 40, 'paused', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(21)', 'stop(64)']);
    // The player did not take it: the clip opens where the release was opened.
    expect(
      trakt([
        ...moved,
        [played(600, 0, 'loading', false, CLIP), known],
        [played(600, 40, 'paused', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(21)', 'stop(21)']);
  });

  it('keeps no move the player did not take, even once Play is pressed', () => {
    // No length to move by yet: the player still opens the next file at 60%.
    expect(
      trakt([
        [played(1700, 2820, 'playing'), known],
        [played(1705, 2820, 'playing'), known],
        [played(1705, 2820, 'paused'), known],
        [played(1705, 0, 'loading', false, OTHER), known],
        [played(1705, 0, 'paused', false, OTHER), known],
        [played(2305, 0, 'paused', false, OTHER), known, 1705],
        [played(2305, 0, 'loading', false, OTHER), known, 1705],
        [played(2305, 0, 'paused', false, OTHER), known, 1705],
        [played(1705, 0, 'loading', false, CLIP), known],
        [played(1705, 60, 'paused', true), known],
      ]),
    ).toEqual(['start(60)', 'pause(60)', 'stop(60)']);
  });

  it('measures a kept place no further than its own end', () => {
    const guess = { runtimeSeconds: 6120, knownRuntimeSeconds: undefined };
    expect(
      trakt([
        [played(0, 7035, 'playing'), guess],
        [played(30, 7035, 'playing'), guess],
        [played(30, 7035, 'paused'), guess],
        // A 28 s "not ready yet" file, opened paused 2 s past its end.
        [played(30, 0, 'loading', false, OTHER), guess],
        [played(30, 28, 'paused', false, OTHER), guess],
        [played(30, 0, 'loading', false, CLIP), guess],
        [played(30, 0, 'paused', false, CLIP), guess],
      ]),
    ).toEqual(['start(0)', 'pause(0)', 'stop(0)']);
  });

  it('forgets a move in a file that turns out to be a clip', () => {
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(2100, 2820, 'playing'), known],
        [played(2100, 2820, 'paused'), known],
        // A clip picked while paused, moved before its length shows, then Play.
        [played(2100, 0, 'loading', false, CLIP), known],
        [played(2100, 0, 'paused', false, CLIP), known],
        [played(2400, 0, 'paused', false, CLIP), known],
        [played(2400, 0, 'loading', false, CLIP), known],
        [played(2400, 40, 'loading', true), known],
        [played(5, 40, 'paused', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(74)', 'stop(74)']);
  });

  it('keeps no place for a file opened past its own end', () => {
    const guess = { runtimeSeconds: 7200, knownRuntimeSeconds: undefined };
    expect(
      trakt([
        [played(2880, 6900, 'playing'), guess],
        [played(2900, 6900, 'playing'), guess],
        [played(2900, 6900, 'paused'), guess],
        // A 2 minute "not ready yet" file, opened paused where the film was.
        [played(2900, 0, 'loading', false, OTHER), guess],
        [played(2900, 120, 'paused', false, OTHER), guess],
        // Another release opens there, and the player closes before it shows a length.
        [played(2900, 0, 'loading', false, CLIP), guess],
        [played(2900, 0, 'paused', false, CLIP), guess],
      ]),
    ).toEqual(['start(42)', 'pause(42)', 'stop(42)']);
  });

  it('measures a kept place of unknown length by the running time once it comes', () => {
    const guess = { runtimeSeconds: 6000, knownRuntimeSeconds: undefined };
    const page = { runtimeSeconds: 7200, knownRuntimeSeconds: 7200 };
    expect(
      trakt([
        [played(4800, 0, 'playing'), guess],
        [played(4900, 0, 'playing'), guess],
        [played(4900, 0, 'paused'), guess],
        [played(4900, 0, 'loading', false, OTHER), guess],
        [played(4900, 0, 'paused', false, OTHER), page],
      ]),
    ).toEqual(['start(80)', 'pause(82)', 'stop(68)']);
  });

  it('forgets what a link reached before its length showed it a clip, on any opening', () => {
    // A 174 s clip whose length the player reads late: 30 s in, it fails;
    // Try again opens it there, and this time its length shows at once.
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), known],
        [played(0, 0, 'playing', false, CLIP), known],
        [played(30, 0, 'playing', false, CLIP), known],
        [played(30, 0, 'failed', false, CLIP), known],
        [played(30, 0, 'loading', false, CLIP), known],
        [played(30, 174, 'loading', true), known],
        [played(30, 174, 'playing', true), known],
        [played(31, 174, 'paused', true), known],
      ]),
    ).toEqual(['start(0)']);
  });

  it('starts nothing for a link known to be a clip, opened again with no length yet', () => {
    // A 60 s clip picked by hand plays to its end; Try again opens it again,
    // and the player reads its length only once it plays.
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), known],
        [played(0, 60, 'loading', true), known],
        [played(0, 60, 'playing', true), known],
        [played(60, 60, 'failed', true), known],
        [played(0, 0, 'loading', false, CLIP), known],
        [played(0, 0, 'playing', false, CLIP), known],
        [played(10, 0, 'playing', false, CLIP), known],
        [played(10, 60, 'playing', true), known],
        [played(11, 60, 'paused', true), known],
      ]),
    ).toEqual([]);
    // Nor stops it at 100, or at its own clock, if it ends before its length
    // shows, after a real file.
    expect(
      trakt([
        [played(600, 2820, 'playing'), known],
        [played(610, 2820, 'paused'), known],
        [played(610, 0, 'loading', false, CLIP), known],
        [played(610, 40, 'paused', true), known],
        [played(640, 40, 'failed', true), known],
        [played(610, 0, 'loading', false, CLIP), known],
        [played(610, 0, 'playing', false, CLIP), known],
        [played(700, 0, 'playing', false, CLIP), known],
        [played(700, 0, 'ended', false, CLIP), known],
      ]),
    ).toEqual(['start(21)', 'pause(22)', 'stop(22)']);
  });

  it('measures a file that showed its own length by it, while it fails and opens again', () => {
    // The page gives no running time. A 60 s file plays to 50 s; another
    // release, 2799 s long, opens there, fails before its picture, and Try
    // again opens it again: it is 50 s into its own 2799, not 83% in.
    const steps: Parameters<typeof trakt>[0] = [
      [played(0, 60, 'playing'), guessed],
      [played(50, 60, 'playing'), guessed],
      [played(50, 0, 'loading', false, OTHER), guessed],
      [played(50, 2799, 'loading', false, OTHER), guessed],
      [played(50, 2799, 'failed', false, OTHER), guessed],
    ];
    expect(trakt([...steps, [played(50, 0, 'loading', false, OTHER), guessed]])).toEqual([
      'start(0)',
      'stop(2)',
    ]);
    // Or another release picked after it opens there.
    expect(trakt([...steps, [played(50, 0, 'loading', false, CLIP), guessed]])).toEqual([
      'start(0)',
      'stop(2)',
    ]);
  });

  it('keeps no clock of a clip whose length shows only as the player moves on from it', () => {
    // A 180 s clip with no length plays to 130 s; its length shows, and in
    // the same moment auto-play moves on, opening the next file where the
    // clip opened. The next clips fail too: there is nothing to send.
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), known],
        [played(0, 0, 'playing', false, CLIP), known],
        [played(130, 0, 'playing', false, CLIP), known],
        [played(0, 0, 'loading', false, OTHER), known],
        [played(0, 40, 'loading', true, OTHER), known],
        [played(0, 0, 'loading', false, REAL), known],
        [played(0, 40, 'failed', true, REAL), known],
      ]),
    ).toEqual(['start(0)']);
    // A real file of unknown length is kept where the next file opens.
    expect(
      trakt([
        [played(0, 0, 'loading', false, OTHER), known],
        [played(0, 0, 'playing', false, OTHER), known],
        [played(1410, 0, 'playing', false, OTHER), known],
        [played(1410, 0, 'loading', false, CLIP), known],
        [played(1410, 40, 'failed', true), known],
      ]),
    ).toEqual(['start(0)', 'stop(50)']);
  });

  it('follows a move the player took in a link that was a clip, now with no length', () => {
    // A 40 s clip picked in Sources fails; Try again later brings the
    // episode, whose length the player cannot read. Paused before its
    // picture, the viewer moves it to 1500 s, and the player takes it.
    const steps: Parameters<typeof trakt>[0] = [
      [played(600, 2820, 'playing'), known],
      [played(610, 2820, 'paused'), known],
      [played(610, 0, 'loading', false, CLIP), known],
      [played(610, 40, 'paused', true), known],
      [played(610, 40, 'playing', true), known],
      [played(640, 40, 'failed', true), known],
      [played(610, 0, 'loading', false, CLIP), known],
      [played(610, 0, 'paused', false, CLIP), known],
      [played(1500, 0, 'paused', false, CLIP), known],
    ];
    expect(trakt(steps)).toEqual(['start(21)', 'pause(22)', 'stop(53)']);
    // A clip picked after it, opening there, keeps that place.
    expect(
      trakt([
        ...steps,
        [played(1500, 0, 'loading', false, OTHER), known],
        [played(1500, 40, 'playing', true, OTHER), known],
        [played(1510, 40, 'paused', true, OTHER), known],
      ]),
    ).toEqual(['start(21)', 'pause(22)', 'stop(53)']);
  });

  it('keeps nothing of a link taken for a clip only once the running time comes', () => {
    // A 240 s file plays as the title while the page gives no running time;
    // Try again opens it with no length, and the page's 47 minutes come while
    // it plays: it was a clip, and its clock is no place in the episode.
    expect(
      trakt([
        [played(0, 240, 'playing', false, CLIP), guessed],
        [played(100, 240, 'playing', false, CLIP), guessed],
        [played(100, 240, 'failed', false, CLIP), guessed],
        [played(100, 0, 'loading', false, CLIP), guessed],
        [played(101, 0, 'playing', false, CLIP), guessed],
        [played(160, 0, 'playing', false, CLIP), guessed],
        [played(160, 0, 'failed', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
    expect(
      trakt([
        [played(0, 240, 'playing', false, CLIP), guessed],
        [played(100, 240, 'failed', false, CLIP), guessed],
        [played(100, 0, 'loading', false, CLIP), guessed],
        [played(160, 0, 'playing', false, CLIP), guessed],
        [played(200, 0, 'playing', false, CLIP), known],
        [played(200, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
  });

  it('starts the title once a link taken for a clip shows the title’s length as it plays', () => {
    // A 60 s clip picked by hand ends; Try again brings the episode, whose
    // length the player reads only after its first picture.
    const steps: Parameters<typeof trakt>[0] = [
      [played(0, 60, 'loading', true), known],
      [played(0, 60, 'playing', true), known],
      [played(60, 60, 'failed', true), known],
      [played(0, 0, 'loading', false, CLIP), known],
      [played(0, 0, 'playing', false, CLIP), known],
      [played(21, 0, 'playing', false, CLIP), known],
      [played(28, 2820, 'playing', false, CLIP), known],
    ];
    expect(trakt([...steps, [played(2820, 2820, 'ended', false, CLIP), known]])).toEqual([
      'start(1)',
      'stop(100)',
    ]);
    expect(trakt([...steps, [played(2541, 2820, 'playing', false, CLIP), known]])).toEqual([
      'start(1)',
      'stop(90)',
    ]);
  });

  it('holds a move through Play before the first picture, for the next file to keep', () => {
    // The episode, paused at 300 s; Quality opens another release paused,
    // with no length, and the viewer moves it to 1200 s, which the player
    // takes. Play; it plays, then its length shows it a clip, and in the same
    // moment the player moves on to a clip it opens at 300 s.
    const steps: Parameters<typeof trakt>[0] = [
      [played(0, 2820, 'playing'), known],
      [played(300, 2820, 'paused'), known],
      [played(300, 0, 'loading', false, OTHER), known],
      [played(300, 0, 'paused', false, OTHER), known],
      [played(1200, 0, 'paused', false, OTHER), known],
      [played(1200, 0, 'loading', false, OTHER), known],
      [played(1200, 0, 'playing', false, OTHER), known],
      [played(1210, 0, 'playing', false, OTHER), known],
    ];
    expect(
      trakt([
        ...steps,
        [played(300, 0, 'loading', false, CLIP), known, 300],
        [played(300, 40, 'failed', true), known, 300],
      ]),
    ).toEqual(['start(0)', 'pause(11)', 'start(43)', 'stop(11)']);
    // Another release opening where it got to keeps that place.
    expect(
      trakt([
        ...steps,
        [played(1210, 0, 'loading', false, REAL), known],
        [played(1210, 0, 'paused', false, REAL), known],
      ]),
    ).toEqual(['start(0)', 'pause(11)', 'start(43)', 'pause(43)', 'stop(43)']);
  });

  it('forgets, once the running time shows a link a clip, what it reached with no length before', () => {
    // A file of unknown length plays to 50 s and another release opens
    // there, then fails; the first is picked again, shows 240 s, fails, and
    // Try again opens it with no length. The page's 47 minutes then come.
    expect(
      trakt([
        [played(0, 0, 'loading', false, CLIP), guessed],
        [played(0, 0, 'playing', false, CLIP), guessed],
        [played(50, 0, 'playing', false, CLIP), guessed],
        [played(50, 0, 'loading', false, OTHER), guessed],
        [played(50, 0, 'failed', false, OTHER), guessed],
        [played(50, 0, 'loading', false, CLIP), guessed],
        [played(50, 240, 'loading', false, CLIP), guessed],
        [played(50, 240, 'failed', false, CLIP), guessed],
        [played(50, 0, 'loading', false, CLIP), guessed],
        [played(50, 0, 'playing', false, CLIP), guessed],
        [played(80, 0, 'playing', false, CLIP), known],
        [played(80, 0, 'paused', false, CLIP), known],
      ]),
    ).toEqual(['start(0)']);
    // Nor holds such a place for the next file, while Try again opens it.
    expect(
      trakt([
        [played(0, 240, 'playing', false, CLIP), guessed],
        [played(100, 240, 'failed', false, CLIP), guessed],
        [played(100, 0, 'loading', false, CLIP), guessed],
        [played(160, 0, 'playing', false, CLIP), guessed],
        [played(160, 0, 'failed', false, CLIP), guessed],
        [played(160, 0, 'loading', false, CLIP), guessed],
        [played(160, 0, 'loading', false, CLIP), known],
        [played(160, 0, 'loading', false, OTHER), known],
        [played(160, 40, 'loading', true, OTHER), known],
      ]),
    ).toEqual(['start(0)']);
  });

  it('carries a move held through Play to the next file, when that one opens there', () => {
    // As above, but Sources opens a clip at the move before the release plays.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(300, 2820, 'paused'), known],
        [played(300, 0, 'loading', false, OTHER), known],
        [played(300, 0, 'paused', false, OTHER), known],
        [played(1200, 0, 'paused', false, OTHER), known],
        [played(1200, 0, 'loading', false, OTHER), known],
        [played(1200, 0, 'loading', false, CLIP), known],
        [played(1200, 40, 'loading', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(11)', 'stop(43)']);
  });

  it('keeps a move the player takes while the next file still opens', () => {
    // Paused at 602 s, Quality opens another release paused, with no length;
    // Play, and a skip the player takes lands while it still opens. It fails,
    // and the player moves on to a clip it opens at 1202 s.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(602, 2820, 'paused'), known],
        [played(602, 0, 'loading', false, OTHER), known],
        [played(602, 0, 'paused', false, OTHER), known],
        [played(602, 0, 'loading', false, OTHER), known],
        [played(1202, 0, 'loading', false, OTHER), known],
        [played(1202, 0, 'failed', false, OTHER), known],
        [played(1202, 0, 'loading', false, CLIP), known],
        [played(1202, 40, 'failed', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(21)', 'stop(43)']);
    // One it does not take is not kept.
    expect(
      trakt([
        [played(0, 2820, 'playing'), known],
        [played(602, 2820, 'paused'), known],
        [played(602, 0, 'loading', false, OTHER), known],
        [played(1202, 0, 'loading', false, OTHER), known, 602],
        [played(1202, 0, 'failed', false, OTHER), known, 602],
        [played(602, 0, 'loading', false, CLIP), known],
        [played(602, 40, 'failed', true), known],
      ]),
    ).toEqual(['start(0)', 'pause(21)', 'stop(21)']);
  });

  it('sends the next real place as a pause, after a pause in a clip with nothing to send', () => {
    // A 120 s file plays as the title until the page's 47 minutes come; the
    // viewer pauses it and plays on, then picks the episode in Sources and
    // pauses it before its first picture.
    expect(
      trakt([
        [played(0, 120, 'playing', false, CLIP), guessed],
        [played(30, 120, 'playing', false, CLIP), known],
        [played(32, 120, 'paused', false, CLIP), known],
        [played(32, 120, 'playing', false, CLIP), known],
        [played(0, 0, 'loading', false, REAL), known],
        [played(0, 0, 'paused', false, REAL), known],
      ]),
    ).toEqual(['start(0)', 'pause(0)', 'stop(0)']);
    // Or once it plays, a fresh start.
    expect(
      trakt([
        [played(0, 120, 'playing', false, CLIP), guessed],
        [played(30, 120, 'playing', false, CLIP), known],
        [played(32, 120, 'paused', false, CLIP), known],
        [played(0, 0, 'loading', false, REAL), known],
        [played(0, 2820, 'playing', false, REAL), known],
        [played(60, 2820, 'playing', false, REAL), known],
      ]),
    ).toEqual(['start(0)', 'start(0)', 'stop(2)']);
  });

  it('takes no move for a skip back to where Try again opened a clip, after Play', () => {
    // The episode's 3000 s file at 1505 s; Sources opens a 44 s clip there,
    // the viewer pauses, it fails. Try again opens it with no length yet;
    // the viewer pauses, skips back 10 s, presses Play and Pause, then skips
    // forward 10 s and 20 minutes. With no length the player takes none.
    expect(
      trakt([
        [played(1500, 3000, 'playing'), known],
        [played(1505, 3000, 'playing'), known],
        [played(1505, 0, 'loading', false, CLIP), known],
        [played(1505, 44, 'paused', true), known],
        [played(44, 44, 'failed', true), known],
        [played(1505, 0, 'loading', false, CLIP), known],
        [played(1505, 0, 'paused', false, CLIP), known],
        [played(1495, 0, 'paused', false, CLIP), known, 1505],
        [played(1495, 0, 'loading', false, CLIP), known, 1505],
        [played(1495, 0, 'paused', false, CLIP), known, 1505],
        [played(1505, 0, 'paused', false, CLIP), known, 1505],
        [played(2705, 0, 'paused', false, CLIP), known, 1505],
      ]),
    ).toEqual(['start(50)', 'pause(50)', 'stop(50)']);
  });

  it('keeps a place a file reached by its own length when another player takes it over', () => {
    // Paused at 1000 s, Quality opens another release paused; it shows
    // 2900 s and the viewer moves it to 1600 s. Its stream player gives up
    // before the first picture and the TV's own takes over, with no length
    // yet; then Sources opens a clip at 1600 s.
    const steps: Parameters<typeof trakt>[0] = [
      [played(0, 3000, 'playing'), known],
      [played(1000, 3000, 'playing'), known],
      [played(1000, 3000, 'paused'), known],
      [played(1000, 0, 'loading', false, OTHER), known],
      [played(1000, 0, 'paused', false, OTHER), known],
      [played(1000, 2900, 'paused', false, OTHER), known],
      [played(1600, 2900, 'paused', false, OTHER), known],
      [played(1600, 0, 'paused', false, OTHER), known],
    ];
    const clip: Parameters<typeof trakt>[0] = [
      [played(1600, 0, 'loading', false, CLIP), known, 1600],
      [played(1600, 44, 'loading', true), known, 1600],
    ];
    expect(trakt([...steps, ...clip])).toEqual(['start(0)', 'pause(33)', 'stop(55)']);
    // As well when the viewer skips 10 s, which the TV's player cannot take yet.
    expect(
      trakt([...steps, [played(1610, 0, 'paused', false, OTHER), known, 1600], ...clip]),
    ).toEqual(['start(0)', 'pause(33)', 'stop(55)']);
    // A move it took with no length stands while the player would still open
    // the next file there.
    expect(
      trakt([
        ...steps.slice(0, 5),
        [played(1600, 0, 'paused', false, OTHER), known],
        [played(1610, 0, 'paused', false, OTHER), known, 1600],
        ...clip,
      ]),
    ).toEqual(['start(0)', 'pause(33)', 'stop(57)']);
  });

  it('keeps a real place of unknown length when Try again finds the link now a clip', () => {
    // The episode's file gives no length; it plays to 991 s and fails. Try
    // again finds a 20 s clip behind the same link, which the viewer pauses.
    const steps: Parameters<typeof trakt>[0] = [
      [played(0, 0, 'playing'), known],
      [played(991, 0, 'playing'), known],
      [played(991, 0, 'failed'), known],
      [played(991, 0, 'loading'), known],
      [played(991, 20, 'loading'), known],
      [played(5, 20, 'playing'), known],
      [played(5, 20, 'paused'), known],
    ];
    expect(trakt(steps)).toEqual(['start(0)', 'pause(35)', 'stop(35)']);
    // It ends as a clip; Try again opens it once more, or Sources opens
    // another release where the file got to.
    const ended: Parameters<typeof trakt>[0] = [
      ...steps,
      [played(20, 20, 'failed', true, REAL), known, 991],
    ];
    expect(trakt([...ended, [played(991, 0, 'loading'), known]])).toEqual([
      'start(0)',
      'pause(35)',
      'stop(35)',
    ]);
    expect(
      trakt([
        ...ended,
        [played(991, 0, 'loading', false, OTHER), known],
        [played(991, 0, 'paused', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'pause(35)', 'stop(35)']);
  });

  it('forgets only what a clip’s own clock could have reached, when its length goes', () => {
    // The file gives no length and plays to 150 s, or 991 s, and fails. Try
    // again: the player judges the link a clip, by a length of 40 s the page
    // sees or not, and the TV's player then takes it over with no length.
    const steps = (to: number, length: number): Parameters<typeof trakt>[0] => {
      const judged: Parameters<typeof trakt>[0] = [
        [played(to, length, 'loading', true, REAL), known],
      ];
      return [
        [played(0, 0, 'playing'), known],
        [played(to, 0, 'playing'), known],
        [played(to, 0, 'failed'), known],
        [played(to, 0, 'loading'), known],
        ...(length > 0 ? judged : []),
        [played(5, 0, 'paused', true, REAL), known, to],
      ];
    };
    expect(trakt(steps(150, 40))).toEqual(['start(0)', 'pause(5)', 'stop(5)']);
    // Unseen, it is at most 5 minutes: 150 s may be its clock, 991 s not.
    expect(trakt(steps(150, 0))).toEqual(['start(0)']);
    expect(trakt(steps(991, 0))).toEqual(['start(0)', 'pause(35)', 'stop(35)']);
  });

  it('measures a close while Try again opens a file by that file, not the one before it', () => {
    // No running time: a 101 s file plays to 90 s and fails; Try another
    // opens a file of unknown length there, which plays half a second and
    // fails. The viewer goes back while Try again opens it.
    expect(
      trakt([
        [played(0, 101, 'playing', false, CLIP), guessed],
        [played(90, 101, 'playing', false, CLIP), guessed],
        [played(90, 101, 'failed', false, CLIP), guessed],
        [played(90, 0, 'loading', false, OTHER), guessed],
        [played(90, 0, 'playing', false, OTHER), guessed],
        [played(90.5, 0, 'playing', false, OTHER), guessed],
        [played(90.5, 0, 'failed', false, OTHER), guessed],
        [played(90.5, 0, 'loading', false, OTHER), guessed],
      ]),
    ).toEqual(['start(0)', 'stop(3)']);
    // The same with the page's running time, after a 2700 s file.
    expect(
      trakt([
        [played(0, 2700, 'playing'), known],
        [played(1000, 2700, 'playing'), known],
        [played(1000, 2700, 'failed'), known],
        [played(1000, 0, 'loading', false, OTHER), known],
        [played(1000.5, 0, 'playing', false, OTHER), known],
        [played(1000.5, 0, 'failed', false, OTHER), known],
        [played(1000.5, 0, 'loading', false, OTHER), known],
      ]),
    ).toEqual(['start(0)', 'stop(35)']);
  });

  it('never stops a clip that ends at 100%', () => {
    expect(
      trakt(
        [
          [played(0, 0, 'loading', false, CLIP), guessed],
          [played(5, 30, 'playing', false, CLIP), guessed],
          [played(30, 30, 'ended', false, CLIP), known],
        ],
        false,
      ),
    ).toEqual(['start(17)']);
  });

  it('tells Trakt nothing more once stopped, or before anything played', () => {
    const scrobble = createScrobblePlace(EPISODE);
    expect(onStatus('stopped', played(10, 2820, 'playing'), scrobble, known)).toEqual({
      sent: 'stopped',
    });
    expect(onClose('none', played(10, 2820, 'paused'), scrobble, known)).toEqual({ sent: 'none' });
  });
});

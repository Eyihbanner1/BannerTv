import type { StreamEntry } from './types';

/** One stream the player opened that did not play, newest last. */
export interface PlayAttempt {
  /** The stream's key within its finder: the same stream opened twice is one stream tried. */
  key: string;
  entry: StreamEntry;
  /** Why it stopped: the player's error kind ('network', 'format', 'decode', 'clip', 'other'). */
  kind: string;
  /** The player's detail, never a link: 'stream-helper-unreachable' and the like. */
  detail?: string;
}

/** Why Play has nothing more to try, from what the addons sent and what was tried. */
export type PlayProblem =
  /** No installed addon finds streams (the demo addon aside). */
  | { kind: 'no-stream-addon' }
  /** Stream addons are installed, but every one of them is switched off, so none was asked. */
  | { kind: 'stream-addons-off' }
  /**
   * Stream addons are switched on, but none of them finds streams for this
   * kind of title. `someOff`: others are installed but switched off, so they
   * were not asked.
   */
  | { kind: 'no-addon-for-title'; someOff: boolean }
  /** Every addon asked failed to answer. */
  | { kind: 'addons-down'; count: number }
  /** The addons answered, with no streams. */
  | { kind: 'no-streams' }
  /** Streams that play were found, but each failed in the last few minutes. */
  | { kind: 'failed-recently'; count: number }
  /**
   * Mostly torrents, which need a debrid service: `addon` sent the most of
   * them (empty when it has no name), `count` of them.
   */
  | { kind: 'torrents'; addon: string; count: number }
  /** Only streams that need request headers this player can't send. */
  | { kind: 'needs-helper'; count: number }
  /** Only links that open in a browser or YouTube. */
  | { kind: 'web-only'; count: number }
  /** A stream needed the stream helper, and the helper didn't answer. */
  | { kind: 'helper-off'; tried: number }
  /** Every stream tried was a debrid link the service hasn't downloaded yet. */
  | { kind: 'uncached'; tried: number }
  /** Streams were tried and none played; `last` is why the last one stopped. */
  | { kind: 'tried'; tried: number; last: string };

export interface ProblemInput {
  /** True when no stream could even be started; false once the player gave up on what it tried. */
  nothing: boolean;
  /** The addons asked for this video's streams, in the order of `addonRank`. */
  asked: ReadonlyArray<{ manifest: { name: string } }>;
  /** How many of them could not answer. */
  failedAddons: number;
  /** Every stream the addons sent. */
  entries: readonly StreamEntry[];
  /** What auto-play could still try. */
  candidates: readonly StreamEntry[];
  /** The streams opened since anything last played, oldest first. */
  attempts: readonly PlayAttempt[];
  /**
   * The installed addons that find streams (the demo addon aside): whether
   * any is switched on, and whether any is switched off, which is never asked.
   */
  streamAddons: { on: boolean; off: boolean };
}

export interface ProblemExplained {
  problem: PlayProblem;
  /**
   * After streams were tried: torrents the addons also sent, which a debrid
   * service would make playable, from the addon that sent the most.
   */
  torrentsToo?: { addon: string; count: number };
}

const HELPER_DETAIL = 'stream-helper-';

/** The addon that sent the most of these streams, and how many it sent. Ties go to the first addon. */
function topAddon(
  entries: readonly StreamEntry[],
  asked: ProblemInput['asked'],
): { addon: string; count: number } | undefined {
  const counts: number[] = [];
  for (const entry of entries) counts[entry.addonRank] = (counts[entry.addonRank] ?? 0) + 1;
  let best = -1;
  for (let rank = 0; rank < counts.length; rank++) {
    if (counts[rank] !== undefined && (best < 0 || counts[rank]! > counts[best]!)) best = rank;
  }
  if (best < 0) return undefined;
  const name = asked[best]?.manifest.name;
  return { addon: name && name.trim() !== '' ? name : '', count: counts[best]! };
}

function unavailable(entries: readonly StreamEntry[], reason: 'torrent' | 'proxy-headers') {
  return entries.filter((entry) => {
    const action = entry.assessment.action;
    return action.kind === 'unavailable' && action.reason === reason;
  });
}

/** Why there was nothing to start: no addon, no answer, no streams, or only streams that can't play here. */
function explainNothing(input: ProblemInput): PlayProblem {
  const { asked, entries } = input;
  if (asked.length === 0) {
    const { on, off } = input.streamAddons;
    if (on) return { kind: 'no-addon-for-title', someOff: off };
    return off ? { kind: 'stream-addons-off' } : { kind: 'no-stream-addon' };
  }
  if (entries.length === 0) {
    return input.failedAddons >= asked.length && input.failedAddons > 0
      ? { kind: 'addons-down', count: input.failedAddons }
      : { kind: 'no-streams' };
  }
  const playable = entries.filter((entry) => entry.assessment.action.kind === 'play');
  if (playable.length > 0) return { kind: 'failed-recently', count: playable.length };
  const torrents = unavailable(entries, 'torrent');
  const headers = unavailable(entries, 'proxy-headers');
  const web = entries.length - torrents.length - headers.length;
  if (torrents.length > 0 && torrents.length >= headers.length && torrents.length >= web) {
    const top = topAddon(torrents, asked);
    return { kind: 'torrents', addon: top?.addon ?? '', count: top?.count ?? torrents.length };
  }
  if (headers.length > 0 && headers.length >= web) {
    return { kind: 'needs-helper', count: headers.length };
  }
  return { kind: 'web-only', count: web };
}

/** Why what was tried did not play: the helper, uncached links, or the last stream's own error. */
function explainFailed(input: ProblemInput): PlayProblem {
  const keys: string[] = [];
  for (const attempt of input.attempts) {
    if (keys.indexOf(attempt.key) < 0) keys.push(attempt.key);
  }
  const tried = Math.max(1, keys.length);
  const attempts = input.attempts;
  const last = attempts[attempts.length - 1];
  if (attempts.some((a) => (a.detail ?? '').indexOf(HELPER_DETAIL) === 0)) {
    return { kind: 'helper-off', tried };
  }
  if (attempts.length > 0 && attempts.every((a) => a.entry.facts.cached === false)) {
    return { kind: 'uncached', tried };
  }
  return { kind: 'tried', tried, last: last?.kind ?? 'other' };
}

/**
 * Why Play stopped, in terms the viewer can act on: which addon to set up,
 * what to turn on, or how many streams were tried. Pure, so the TV and the
 * phone say the same.
 */
export function explainProblem(input: ProblemInput): ProblemExplained {
  if (input.nothing) return { problem: explainNothing(input) };
  const problem = explainFailed(input);
  const torrents = unavailable(input.entries, 'torrent');
  const top = torrents.length > 0 ? topAddon(torrents, input.asked) : undefined;
  return top ? { problem, torrentsToo: top } : { problem };
}

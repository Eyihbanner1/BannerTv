import {
  clearlyBetter,
  judgeSubtitleFits,
  languageKey,
  rankReason,
  rankSubtitles,
  type SubtitleFit,
  type SubtitleProfile,
  type VideoLength,
} from '@bannertv/core';

/** What picking a subtitle file needs to know of it. */
export interface PickableSubtitle {
  /** Who the file is among those offered for the video. */
  key: string;
  url: string;
  lang: string;
  /** The release name the addon sent, if any. */
  label?: string;
}

/** The video playing, as its release name says: the file name first, then the title. */
export interface PlayingRelease {
  filename?: string;
  title?: string;
}

/** What is known of the files on offer, for picking one. */
export interface PickContext {
  /** The video playing, whose release name the files' are matched against. */
  video: PlayingRelease;
  /** Whether the file could not be read. */
  broken: (url: string) => boolean;
  /** What the checks found of the file, in the language it is picked in, once it has been read. */
  fit: (url: string) => SubtitleFit | undefined;
  /** The key of the version the viewer picked by hand for this release, if any. */
  remembered?: string;
  /** Files for the hard of hearing are wanted: the viewer picked one by hand for this title. */
  hearing: boolean;
}

/** The files offered in a language, in the order given. */
export function filesIn<T extends PickableSubtitle>(offered: readonly T[], language: string): T[] {
  const key = languageKey(language);
  return offered.filter((option) => languageKey(option.lang) === key);
}

/**
 * The files in a language, best first (`rankSubtitles`): the version picked
 * by hand for this release, one whose release name matches the video, then
 * the best fit, in the order given where nothing tells them apart. Files
 * that could not be read are left out, and so are those that failed their
 * checks badly (in another script, or signs only), unless picked by hand.
 */
export function rankedFiles<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  context: PickContext,
): T[] {
  const working = filesIn(offered, language).filter(
    (option) =>
      !context.broken(option.url) &&
      (option.key === context.remembered || !context.fit(option.url)?.unfit),
  );
  return rankSubtitles(working, {
    video: context.video,
    fit: (option) => context.fit(option.url),
    remembered: (option) => option.key === context.remembered,
    hearing: context.hearing,
  });
}

/**
 * The file to show in a language: the best of rankedFiles. Undefined when
 * every file in it failed, or failed its checks badly, or there is none.
 */
export function pickSubtitleFile<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  context: PickContext,
): T | undefined {
  return rankedFiles(offered, language, context)[0];
}

/**
 * When nothing better is left in a language: a file that failed its checks
 * (signs only is better than nothing), then one that could not be read.
 */
export function lastResort<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  context: Pick<PickContext, 'broken'>,
): T | undefined {
  const files = filesIn(offered, language);
  return files.find((option) => !context.broken(option.url)) ?? files[0];
}

/**
 * Each file read in a language judged against the video, by link: on its
 * own, and against the others for a drift only they can show.
 */
export function fitsIn(
  offered: readonly PickableSubtitle[],
  language: string,
  profile: (url: string) => SubtitleProfile | undefined,
  video: VideoLength,
): Map<string, SubtitleFit> {
  const seen = new Set<string>();
  const files: Array<{ id: string; profile: SubtitleProfile }> = [];
  for (const option of filesIn(offered, language)) {
    const read = profile(option.url);
    if (!read || seen.has(option.url)) continue;
    seen.add(option.url);
    files.push({ id: option.url, profile: read });
  }
  return judgeSubtitleFits(files, video, language);
}

/** Files read for their checks, besides the one showing, in each language of a video. */
export const MAX_EXTRA_CHECKS = 3;
/** The files looked at before the first is shown: the best placed few. */
const CANDIDATES = 1 + MAX_EXTRA_CHECKS;

/** Where the automatic choice stands, for planning it again as files are read. */
export interface PlanInput<T extends PickableSubtitle> extends PickContext {
  offered: readonly T[];
  /** The language wanted. */
  language: string;
  /** Whether the file is being read now. */
  reading: (url: string) => boolean;
  /** The key of the file chosen automatically now, if any. */
  current?: string;
  /** Its lines are held back while the first few files are checked. */
  holding: boolean;
  /** The hold has lasted long enough: the first file read a while ago. */
  timeUp: boolean;
  /**
   * The player is still learning how long the video is, as it does in its
   * first moments: the hold waits for that too, as the files' lengths are
   * judged against it.
   */
  lengthPending?: boolean;
  /** How many more files may be read for their checks in this language. */
  readsLeft: number;
  /** How many more times the file showing may give way to one that fits clearly better. */
  switchesLeft: number;
}

export interface SubtitlePlan<T> {
  /** The file to choose, undefined when the language has none. */
  pick?: T;
  /** Files to read now for their checks. */
  read: T[];
  /** Keep the lines back: the first few files are still being checked. */
  hold: boolean;
  /** The pick takes over from the file showing because it fits clearly better. */
  switched: boolean;
}

/**
 * Once lines show: the file showing stays, unless a file read since ranks
 * above it and fits clearly better, and switches are left. Files to read are
 * read only while switches are left, as only a switch could follow.
 */
function keepOrSwitch<T extends PickableSubtitle>(
  ranked: readonly T[],
  current: T,
  toRead: T[],
  input: PlanInput<T>,
): SubtitlePlan<T> {
  const switches = input.switchesLeft > 0;
  const best = ranked.find((option) => input.fit(option.url) !== undefined);
  if (
    switches &&
    best !== undefined &&
    best !== current &&
    ranked.indexOf(best) < ranked.indexOf(current) &&
    clearlyBetter(input.fit(best.url), input.fit(current.url), input.hearing)
  ) {
    return { pick: best, read: toRead, hold: false, switched: true };
  }
  return { pick: current, read: switches ? toRead : [], hold: false, switched: false };
}

/**
 * The automatic choice of a file in a language, planned again each time
 * something is learnt: which file to choose, which to read for their checks,
 * and whether to hold the lines back meanwhile.
 *
 * - A version picked by hand for this release, or one whose release name
 *   matches the video, is chosen at once, and no other is read. Another
 *   made for the release as well (two addons' copies, or CD1 and CD2) takes
 *   over from it only as below: read, clearly better, and while switches
 *   are left. So two such files are not swapped back and forth as each is
 *   read.
 * - Otherwise the best placed few are read, and the lines held back until
 *   they have been and the video's length is known (or `timeUp`); then the
 *   best of those read is chosen.
 * - Once lines show, a file read later takes over only when it fits clearly
 *   better and switches are left; a choice that failed, or failed its
 *   checks badly, gives way to the next best.
 */
export function planSubtitlePick<T extends PickableSubtitle>(input: PlanInput<T>): SubtitlePlan<T> {
  const ranked = rankedFiles(input.offered, input.language, input);
  if (ranked.length === 0) {
    return {
      pick: lastResort(input.offered, input.language, input),
      read: [],
      hold: false,
      switched: false,
    };
  }
  const isRead = (option: T) => input.fit(option.url) !== undefined;
  const reasonOf = (option: T) =>
    rankReason(option, { video: input.video, remembered: (o) => o.key === input.remembered });
  const top = ranked[0]!;
  const current = ranked.find((option) => option.key === input.current);
  const reason = reasonOf(top);
  if (reason < 2) {
    if (!current || reasonOf(current) !== reason) {
      return { pick: top, read: [], hold: false, switched: false };
    }
    // Others of the same standing, best first; those placed above the one showing may be read.
    const peers = ranked.filter((option) => reasonOf(option) === reason);
    const above = peers.slice(0, peers.indexOf(current));
    const toRead = above
      .filter((option) => !isRead(option) && !input.reading(option.url))
      .slice(0, Math.max(0, input.readsLeft));
    return keepOrSwitch(peers, current, toRead, input);
  }
  const candidates = ranked.slice(0, CANDIDATES);
  const toRead = candidates
    .filter((option) => !isRead(option) && !input.reading(option.url))
    .slice(0, Math.max(0, input.readsLeft));
  const known = ranked.filter(isRead);

  if (input.holding) {
    const busy =
      toRead.length > 0 ||
      candidates.some((option) => input.reading(option.url)) ||
      !!input.lengthPending;
    if (busy && !input.timeUp) {
      return { pick: current ?? top, read: toRead, hold: true, switched: false };
    }
    return { pick: known[0] ?? top, read: toRead, hold: false, switched: false };
  }

  if (!current) return { pick: known[0] ?? top, read: toRead, hold: false, switched: false };
  return keepOrSwitch(ranked, current, toRead, input);
}

import {
  clearlyBetter,
  fileReleaseMatch,
  fileTier,
  judgeSubtitleFits,
  languageKey,
  linkedToVideo,
  madeForRelease,
  type MatchedFile,
  otherEpisode,
  rankReason,
  rankSubtitles,
  type SubtitleFit,
  type SubtitleProfile,
  type VideoLength,
  type VideoRelease,
} from '@bannertv/core';
import type { PickReason } from './subtitle-trace';

/**
 * What picking a subtitle file needs to know of it: who it is, and its names
 * and what its addon says of it (found by the video's hash, the episode).
 */
export interface PickableSubtitle extends MatchedFile {
  /** Who the file is among those offered for the video. */
  key: string;
  url: string;
  lang: string;
}

/**
 * The video playing, as its release name says (the file name first, then the
 * title), and the season and episode playing, as its id says.
 */
export type PlayingRelease = VideoRelease;

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
 * by hand for this release, one made for the release (named for it with the
 * group confirming it, or found by the video's hash with no name saying
 * otherwise), then the best fit, in the order given where nothing tells them
 * apart. Files that could not be read are left out, and so are those that
 * failed their checks badly (in another script, or signs only) or are for
 * another episode, unless picked by hand.
 */
export function rankedFiles<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  context: PickContext,
): T[] {
  const working = filesIn(offered, language).filter(
    (option) =>
      !context.broken(option.url) &&
      (option.key === context.remembered ||
        (!context.fit(option.url)?.unfit && !otherEpisode(option, context.video))),
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
 * but is in the language's script (signs only is better than nothing), then
 * one in another script, then one that could not be read. Never one for
 * another episode: its lines are never this one's.
 */
export function lastResort<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  context: Pick<PickContext, 'broken' | 'fit' | 'video'>,
): T | undefined {
  const files = filesIn(offered, language).filter((option) => !otherEpisode(option, context.video));
  const readable = files.filter((option) => !context.broken(option.url));
  return (
    readable.find((option) => context.fit(option.url)?.script !== 'wrong') ??
    readable[0] ??
    files[0]
  );
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

/** Files read for their checks, besides the one showing, in each language of a stream. */
export const MAX_EXTRA_CHECKS = 3;
/**
 * Files read at once, and the first files in the list always read, even
 * where files read for another stream of the video fit: the stream's own
 * file and the one the addon lists first (which may match the video's hash).
 */
const FIRST_READS = 2;

/** Where the automatic choice stands, for planning it again as files are read. */
export interface PlanInput<T extends PickableSubtitle> extends PickContext {
  offered: readonly T[];
  /** The language wanted. */
  language: string;
  /** Whether the file is being read now. */
  reading: (url: string) => boolean;
  /**
   * Whether the file has been read for longer than the hold lasts: a slow
   * download. The hold no longer waits for it, and it no longer counts among
   * the files read at once, so the next in the list is read meanwhile.
   */
  slow?: (url: string) => boolean;
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
  /**
   * A reference to line the files up against is there, or on its way (a
   * stream track whose lines are coming, a file linked to the video or named
   * for its release being read): a file not made for the release may be
   * lined up, and so count as one, so the hold waits for that too.
   */
  syncing?: boolean;
  /** Whether the file has been read and waits to be lined up against the reference. */
  aligning?: (url: string) => boolean;
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
 * Once the hold is over: the file showing stays, unless a file read since
 * ranks above it and fits clearly better, and switches are left. A file not
 * read yet (a slow download) shows no line, so it gives way at once to the
 * best file read, and that is not counted as a switch. Files to read are
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
  if (best !== undefined && input.fit(current.url) === undefined) {
    return { pick: best, read: switches ? toRead : [], hold: false, switched: false };
  }
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
 * - A version picked by hand for this release, or one made for the release
 *   (named for it with the group confirming it, or found by the video's hash
 *   with no name saying otherwise: `madeForRelease`), is chosen at once, and
 *   no other is read while it reads whole and plain (or for the hard of
 *   hearing, as wanted), nor, for
 *   one made for the release, while it is on its way and not yet a slow
 *   download. A loose match on the episode and resolution alone is not
 *   enough: such a file is read and held like any other, and only goes
 *   before another that fits as well. A file named as one disc of two
 *   (CD1) covers only part of the video until it is read. The
 *   first two in the list are read beside the version picked by hand, for
 *   their checks only, when its lines run on past the video's end, line
 *   after line (`runsOn`): a drift only files agreeing on an end can show
 *   (judgeSubtitleFits). Another made for the release as well (two addons'
 *   copies, CD1 and CD2, or a plain copy beside one for the hard of
 *   hearing) takes over from it only as below: once read, and clearly
 *   better while switches are left, or at once while the one chosen has not
 *   been read. So two such files are not swapped back and forth as each is
 *   read. A file made for the release that reads as drifting, part of the
 *   video or another cut is judged like any other.
 * - Otherwise files are read in the list's order, two at a time: the first
 *   two always, more only while none read fits as it is (nothing would beat
 *   it), and the lines held back until they have been read and the video's
 *   length is known (or `timeUp`); then the best of those read is chosen.
 *   A slow download is not waited for, and the next file is read meanwhile.
 * - Once the hold is over, a choice not read yet (a slow download, chosen
 *   as nothing else had been read) gives way at once to the best file read:
 *   none of its lines show, so it is not counted as a switch. Once lines
 *   show, a file read later takes over only when it fits clearly better and
 *   switches are left; a choice that failed, or failed its checks badly,
 *   gives way to the next best.
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
  const unread = (option: T) => !isRead(option) && !input.reading(option.url);
  const tierOf = (option: T) => fileTier(option, input.fit(option.url), input.video, input.hearing);
  const reasonOf = (option: T) =>
    rankReason(option, {
      video: input.video,
      remembered: (o) => o.key === input.remembered,
      fit: (o) => input.fit(o.url),
      hearing: input.hearing,
    });
  const top = ranked[0]!;
  const current = ranked.find((option) => option.key === input.current);
  const reason = reasonOf(top);
  // In the list's order, not by what reading others found: files read for another stream of
  // the video must not keep this stream's own file and the addon's first from being read.
  const placed = new Set<T>(ranked);
  const inOrder = filesIn(input.offered, input.language).filter((option) => placed.has(option));
  if (reason === 0 && current === top) {
    // The version picked by hand stays whatever is read. Its lines running on past the video's
    // end, line after line, may be a drift that only other files agreeing on an end can show:
    // the first two in the list are read for that, as they were when it was picked.
    const fit = input.fit(current.url);
    const runsOn =
      !input.lengthPending &&
      fit?.unfit === false &&
      fit.length === 'fits' &&
      fit.drift === undefined &&
      fit.runsOn === true;
    const toRead = runsOn
      ? inOrder
          .filter((option) => option !== current)
          .slice(0, FIRST_READS)
          .filter(unread)
          .slice(0, Math.max(0, input.readsLeft))
      : [];
    return { pick: current, read: toRead, hold: false, switched: false };
  }
  const aligningNow = (option: T) => !!input.aligning?.(option.url);
  if (reason < 2) {
    // Made for the release, by the video's hash or its name, or lined up against a reference,
    // whatever reading it found.
    const peerOf = (option: T) =>
      reasonOf(option) === reason || (reason === 1 && madeForRelease(option, input.video));
    // With a reference on its way, the lines wait (within the hold) while the one chosen is
    // read: none of them can show before, and it may yet give way to a file lined up.
    const waitFor = (option: T) =>
      !!input.syncing &&
      input.holding &&
      !input.timeUp &&
      !isRead(option) &&
      !input.slow?.(option.url);
    if (!current || !peerOf(current)) {
      return { pick: top, read: [], hold: waitFor(top), switched: false };
    }
    // Others of the same standing, best first. Those placed above the one showing may be read;
    // all of them once it has read as less than whole and plain (or as wanted for the hard of
    // hearing), as a copy placed below it, not read yet, may be; and while it is a slow
    // download, as the first of them read shows at once (keepOrSwitch).
    const peers = ranked.filter(peerOf);
    const lessThanWhole = isRead(current) && tierOf(current) > 0;
    const others = lessThanWhole || (!isRead(current) && !!input.slow?.(current.url));
    const pool = others
      ? peers.filter((option) => option !== current)
      : peers.slice(0, peers.indexOf(current));
    // With a reference, a file not made for the release may be lined up and so count as one:
    // while the one showing reads as less than whole and plain, the rest are read too, in the
    // list's order.
    const toSync =
      input.syncing && lessThanWhole
        ? inOrder.filter((option) => option !== current && pool.indexOf(option) === -1)
        : [];
    const toRead = pool.concat(toSync).filter(unread).slice(0, Math.max(0, input.readsLeft));
    if (input.holding && input.syncing) {
      // No line has shown yet: the best read shows, and that is no switch. The hold waits for
      // the one chosen to be read, and then, where it reads as less than whole and plain, for
      // the rest to be read and lined up.
      const busy =
        waitFor(current) ||
        (!!input.syncing &&
          lessThanWhole &&
          !input.timeUp &&
          (toRead.length > 0 ||
            inOrder.some(
              (option) =>
                option !== current &&
                ((input.reading(option.url) && !input.slow?.(option.url)) || aligningNow(option)),
            )));
      const best = peers.find(isRead) ?? current;
      return { pick: busy ? current : best, read: toRead, hold: busy, switched: false };
    }
    return keepOrSwitch(peers, current, toRead, input);
  }
  const first = inOrder.slice(0, FIRST_READS);
  // A file read that fits as it is ranks first: nothing beyond the first two could beat it.
  const enough = isRead(top) && tierOf(top) === 0;
  // A slow download neither holds the lines back nor keeps the next file from being read.
  const readingNow = inOrder.filter(
    (option) => input.reading(option.url) && !input.slow?.(option.url),
  ).length;
  const toRead = inOrder
    .filter((option) => unread(option) && (!enough || first.indexOf(option) !== -1))
    .slice(0, Math.max(0, Math.min(input.readsLeft, FIRST_READS - readingNow)));
  const known = ranked.filter(isRead);

  if (input.holding) {
    // A file read and waiting to be lined up may yet count as made for the release.
    const busy =
      toRead.length > 0 || readingNow > 0 || !!input.lengthPending || inOrder.some(aligningNow);
    if (busy && !input.timeUp) {
      return { pick: current ?? top, read: toRead, hold: true, switched: false };
    }
    return { pick: known[0] ?? top, read: toRead, hold: false, switched: false };
  }

  if (!current) return { pick: known[0] ?? top, read: toRead, hold: false, switched: false };
  return keepOrSwitch(ranked, current, toRead, input);
}

/**
 * Why the file chosen automatically is the one showing, for Diagnostics:
 * picked by hand for the release; found by the video's hash with no name
 * saying otherwise, or named for the release with the group confirming it
 * (made for the release, while it does not read as fitting badly), or lined
 * up against a reference for sure; a better fit than another in the list; named
 * for the release loosely, with no group to confirm it, among files that fit
 * as well; or nothing told it apart, and the list's order chose.
 */
export function pickReason<T extends PickableSubtitle>(
  pick: T,
  offered: readonly T[],
  language: string,
  context: PickContext,
): PickReason {
  if (pick.key === context.remembered) return 'by hand';
  const reason = rankReason(pick, {
    video: context.video,
    remembered: () => false,
    fit: (option) => context.fit(option.url),
    hearing: context.hearing,
  });
  if (reason === 1) {
    if (linkedToVideo(pick, context.video)) return 'linked to your video';
    return madeForRelease(pick, context.video) ? 'same release name' : 'synced to your video';
  }
  const tierOf = (option: T) =>
    fileTier(option, context.fit(option.url), context.video, context.hearing);
  const tier = tierOf(pick);
  const others = rankedFiles(offered, language, context).filter((option) => option !== pick);
  if (others.some((option) => tierOf(option) > tier)) return 'best fit';
  return fileReleaseMatch(pick, context.video) === 'loose'
    ? 'same release name, no group'
    : 'list order';
}

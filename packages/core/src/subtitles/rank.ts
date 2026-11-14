import type { SubtitleFit } from './fit';
import {
  discPart,
  fileReleaseMatch,
  hearingName,
  linkedToVideo,
  madeForRelease,
  type MatchedFile,
  otherEpisode,
  type VideoRelease,
} from './versions';

/*
 * The order to try the subtitle files of one language in: the version the
 * viewer picked by hand for this release first, then one made for the
 * release (named for it with the group confirming it, or found by the
 * video's hash with no name saying otherwise) or lined up against a
 * reference known to fit the video, then the files that fit the video best,
 * and the addon's own order where nothing tells them apart.
 */

/** Where a file not read yet sits among the tiers below. */
export const UNREAD_TIER = 1.5;
/** Covers only part of the video, or runs well past its end. */
const PART_TIER = 4;
/** In another script, signs only, or for another episode. */
const UNFIT_TIER = 5;

/**
 * How well a file fits the video, lower first: 0 fits as it is; 1 fits but
 * is for the hard of hearing when plain lines are wanted (or the other way
 * round); 2 and 3 the same with a frame-rate drift to fix; 4 covers only
 * part of the video or runs well past its end; 5 is in another script or
 * signs only. A file not read yet sits between 1 and 2: it may fit, but a
 * file known to fit as it is beats it. A file lined up against a reference
 * has its drift fixed with it ('sure'); one whose timing matched nothing in
 * the reference's ('none') sits with files covering part of the video:
 * after every file that fits, before one passed over.
 */
export function fitTier(fit: SubtitleFit | undefined, hearingWanted: boolean): number {
  if (!fit) return UNREAD_TIER;
  if (fit.unfit) return UNFIT_TIER;
  if (fit.length === 'short' || fit.length === 'long' || fit.synced === 'none') return PART_TIER;
  const other = fit.hearing !== hearingWanted ? 1 : 0;
  return fit.drift && fit.synced !== 'sure' ? 2 + other : other;
}

/**
 * A file's tier (`fitTier`) with what its names and its addon say before it
 * is read: one for another episode or another season is unfit whatever
 * reading finds; one named as a disc of a release split in two ("CD1")
 * covers only part of the video until it is read against the video's
 * length, so it never wins over a whole file.
 */
export function fileTier(
  file: MatchedFile,
  fit: SubtitleFit | undefined,
  video: VideoRelease,
  hearingWanted: boolean,
): number {
  if (otherEpisode(file, video)) return UNFIT_TIER;
  const tier = fitTier(fit, hearingWanted);
  if (tier < PART_TIER && fit?.length === undefined && discPart(file, video) !== undefined) {
    return PART_TIER;
  }
  return tier;
}

export interface RankOptions<T> {
  /** The video playing, as its release name and its id say. */
  video: VideoRelease;
  /** What the checks found of the file, once it has been read. */
  fit: (item: T) => SubtitleFit | undefined;
  /** The version the viewer picked by hand for this release. */
  remembered?: (item: T) => boolean;
  /** Files for the hard of hearing are wanted: the viewer picked one by hand for this title. */
  hearing: boolean;
}

/**
 * What rankReason needs: the video and the version picked by hand, and the
 * checks' findings when known. Without `fit` a match always counts.
 */
export type ReasonOptions<T> = Pick<RankOptions<T>, 'video' | 'remembered'> &
  Partial<Pick<RankOptions<T>, 'fit' | 'hearing'>>;

/**
 * Why a file ranks where it does, best first: picked before, made for the
 * release (`madeForRelease`: named for it with the group confirming it, or
 * found by the video's hash with no name saying otherwise) or lined up
 * against a reference known to fit the video ('sure': in step once moved),
 * then neither. Being made for the release is a strong hint, not proof, so
 * it counts only while the file is not read yet
 * or reads whole: once read (or named) as drifting, covering only part,
 * running long, failing its checks or for another episode, the file ranks
 * by its fit like any other. The version picked by hand stays first whatever
 * its checks found.
 */
export function rankReason<T extends MatchedFile>(item: T, options: ReasonOptions<T>): 0 | 1 | 2 {
  if (options.remembered?.(item)) return 0;
  if (!madeForRelease(item, options.video) && options.fit?.(item)?.synced !== 'sure') return 2;
  // A file not read yet sits below 2 (UNREAD_TIER), so its match still counts.
  const tier = fileTier(item, options.fit?.(item), options.video, options.hearing ?? false);
  return tier >= 2 ? 2 : 1;
}

/**
 * How strongly a file is said to be for the release, best first, among
 * files of the same reason and tier: found by the video's hash and named for
 * the release; named for it (the same name, or the group confirming it);
 * found by the hash, its names saying nothing against it; a loose match on
 * the episode, resolution or source alone, or a hash match whose names say
 * another release; none. OpenSubtitles marks every file linked to the hash,
 * some made for other releases, so its mark alone counts for less than a
 * name that says the release.
 */
function standing(file: MatchedFile, video: VideoRelease): number {
  const match = fileReleaseMatch(file, video);
  const named = match === 'exact' || match === 'group';
  if (named) return file.hashMatch ? 0 : 1;
  if (linkedToVideo(file, video)) return 2;
  return match === 'loose' || file.hashMatch ? 3 : 4;
}

/**
 * The files best first: by reason, then tier, then how strongly each is said
 * to be for the release, then, of files not read yet, one whose name says
 * it is for the hard of hearing after one that does not (unless those are
 * wanted). Ties keep the order given, with the position as the tie-break:
 * Chromium 68's sort is not stable.
 */
export function rankSubtitles<T extends MatchedFile>(
  items: readonly T[],
  options: RankOptions<T>,
): T[] {
  return items
    .map((item, index) => {
      const fit = options.fit(item);
      return {
        item,
        index,
        reason: rankReason(item, options),
        tier: fileTier(item, fit, options.video, options.hearing),
        standing: standing(item, options.video),
        hearing: !fit && hearingName(item.label) !== options.hearing ? 1 : 0,
      };
    })
    .sort(
      (a, b) =>
        a.reason - b.reason ||
        a.tier - b.tier ||
        a.standing - b.standing ||
        a.hearing - b.hearing ||
        a.index - b.index,
    )
    .map((entry) => entry.item);
}

/**
 * Whether a file read later is clearly better than the one showing, so an
 * automatic choice may switch to it: both read, and it fits a whole step
 * better (no drift to fix, or plain lines in place of ones for the hard of
 * hearing, or the whole film).
 */
export function clearlyBetter(
  next: SubtitleFit | undefined,
  current: SubtitleFit | undefined,
  hearingWanted: boolean,
): boolean {
  if (!next || !current) return false;
  return fitTier(next, hearingWanted) < fitTier(current, hearingWanted);
}

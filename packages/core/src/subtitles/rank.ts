import type { SubtitleFit } from './fit';
import { releaseMatch } from './versions';

/*
 * The order to try the subtitle files of one language in: the version the
 * viewer picked by hand for this release first, then one whose release name
 * matches the video, then the files that fit the video best, and the
 * addon's own order where nothing tells them apart (it may already reflect
 * a match on the video's hash).
 */

/** Where a file not read yet sits among the tiers below. */
export const UNREAD_TIER = 1.5;

/**
 * How well a file fits the video, lower first: 0 fits as it is; 1 fits but
 * is for the hard of hearing when plain lines are wanted (or the other way
 * round); 2 and 3 the same with a frame-rate drift to fix; 4 covers only
 * part of the video or runs well past its end; 5 is in another script or
 * signs only. A file not read yet sits between 1 and 2: it may fit, but a
 * file known to fit as it is beats it.
 */
export function fitTier(fit: SubtitleFit | undefined, hearingWanted: boolean): number {
  if (!fit) return UNREAD_TIER;
  if (fit.unfit) return 5;
  if (fit.length === 'short' || fit.length === 'long') return 4;
  const other = fit.hearing !== hearingWanted ? 1 : 0;
  return fit.drift ? 2 + other : other;
}

export interface RankOptions<T> {
  /** The video playing, as its release name says. */
  video: { filename?: string; title?: string };
  /** What the checks found of the file, once it has been read. */
  fit: (item: T) => SubtitleFit | undefined;
  /** The version the viewer picked by hand for this release. */
  remembered?: (item: T) => boolean;
  /** Files for the hard of hearing are wanted: the viewer picked one by hand for this title. */
  hearing: boolean;
}

/** Why a file ranks where it does, best first: picked before, matching the release, then neither. */
export function rankReason<T extends { label?: string }>(
  item: T,
  options: Pick<RankOptions<T>, 'video' | 'remembered'>,
): 0 | 1 | 2 {
  if (options.remembered?.(item)) return 0;
  return releaseMatch(item.label, options.video) ? 1 : 2;
}

/**
 * The files best first. Ties keep the order given, with the position as the
 * tie-break: Chromium 68's sort is not stable.
 */
export function rankSubtitles<T extends { label?: string }>(
  items: readonly T[],
  options: RankOptions<T>,
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      reason: rankReason(item, options),
      tier: fitTier(options.fit(item), options.hearing),
    }))
    .sort((a, b) => a.reason - b.reason || a.tier - b.tier || a.index - b.index)
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

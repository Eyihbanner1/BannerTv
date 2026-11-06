import { languageKey, releaseMatch } from '@bannertv/core';

/** What picking a subtitle file needs to know of it. */
export interface PickableSubtitle {
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

/**
 * The file to show in a language, among those that have not failed: one
 * whose release name matches the video playing first, since a file made for
 * another release (another cut, or another frame rate) drifts out of step
 * with the sound; otherwise the first in the order given. Undefined when every
 * file in the language has failed, or there is none.
 */
export function pickSubtitleFile<T extends PickableSubtitle>(
  offered: readonly T[],
  language: string,
  broken: ReadonlySet<string>,
  video: PlayingRelease,
): T | undefined {
  const key = languageKey(language);
  const working = offered.filter((o) => languageKey(o.lang) === key && !broken.has(o.url));
  return working.find((o) => releaseMatch(o.label, video)) ?? working[0];
}

/** Whether the file's release name matches the video playing. */
export function matchesRelease(option: PickableSubtitle, video: PlayingRelease): boolean {
  return releaseMatch(option.label, video);
}

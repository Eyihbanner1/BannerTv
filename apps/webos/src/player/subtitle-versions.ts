import {
  groupByLanguage,
  keepOrder,
  type LanguageGroup,
  languageName,
  releaseMatch,
  type StreamEntry,
} from '@bannertv/core';
import type { SubtitleChoice, Subtitles, SubtitleStatus } from '../screens/player/use-subtitles';
import { streamTitle } from './describe';
import type { PlayingRelease } from './subtitle-pick';

/*
 * What the audio and subtitles sheet shows of the subtitles, worked out with
 * no React and no words of its own, so the TV's sheet and the phone's panel
 * group, number and describe versions alike.
 */

/** A subtitle file or one of the stream's own tracks, as one version of its language. */
export interface SubtitleVersion {
  choice: NonNullable<SubtitleChoice>;
  lang: string;
  source: string;
  /** The release name an addon sent, or a track's own name where it says more than its language. */
  release?: string;
}

/** Who a version is among the others: `file:<key>` or `track:<id>`. */
export const versionId = (choice: NonNullable<SubtitleChoice>): string =>
  choice.kind === 'file' ? `file:${choice.key}` : `track:${choice.id}`;

/** Whether two choices are the same version; Off is never a version. */
export const sameChoice = (a: SubtitleChoice, b: SubtitleChoice): boolean =>
  a !== null && b !== null && versionId(a) === versionId(b);

/** The drift row's choices, by the name of their focus key and words. */
export const DRIFT_CHOICES = [
  { name: 'none', drift: null, label: 'player.driftNone' },
  { name: 'ahead', drift: 'ahead', label: 'player.driftAhead' },
  { name: 'behind', drift: 'behind', label: 'player.driftBehind' },
] as const;

/** The language of the subtitles showing, for a chip or a tab; none when off. */
export function subtitlesValue(
  subtitles: Pick<Subtitles, 'choice' | 'tracks' | 'options'>,
): string | undefined {
  const { choice } = subtitles;
  if (!choice) return undefined;
  if (choice.kind === 'track') {
    const track = subtitles.tracks.find((candidate) => candidate.id === choice.id);
    return (track?.lang && languageName(track.lang)) || track?.label || undefined;
  }
  const option = subtitles.options.find((candidate) => candidate.key === choice.key);
  return option ? languageName(option.lang) || undefined : undefined;
}

/** Puts items in the order first seen under a scope. See createOrderMemory. */
export type OrderMemory = <T>(scope: string, items: readonly T[], id: (item: T) => string) => T[];

/**
 * Puts items in the order first seen under a scope (the languages, each
 * language's versions): those shown keep their places, new ones go after.
 * The same items give the same order, so drawing twice lands on it again.
 * Keep one for as long as the sheet is open.
 */
export function createOrderMemory(): OrderMemory {
  const seen = new Map<string, string[]>();
  return <T>(scope: string, items: readonly T[], id: (item: T) => string): T[] => {
    const byId = new Map(items.map((item) => [id(item), item]));
    const order = keepOrder(seen.get(scope) ?? [], Array.from(byId.keys()));
    seen.set(scope, order);
    return order.map((key) => byId.get(key)!);
  };
}

/**
 * Every version, the stream's own tracks first: they are always in step. A
 * track's own name counts as its release name only when it says more than its
 * language. `inTheStream` names the tracks' source ("In the stream").
 */
export function subtitleVersions(
  subtitles: Pick<Subtitles, 'tracks' | 'options'>,
  inTheStream: string,
): SubtitleVersion[] {
  return [
    ...subtitles.tracks.map((track) => ({
      choice: { kind: 'track', id: track.id } as const,
      lang: track.lang,
      source: inTheStream,
      release:
        track.label && track.label.toLowerCase() !== languageName(track.lang).toLowerCase()
          ? track.label
          : undefined,
    })),
    ...subtitles.options.map((option) => ({
      choice: { kind: 'file', key: option.key } as const,
      lang: option.lang,
      source: option.source,
      release: option.label,
    })),
  ];
}

/**
 * The versions by language, the language last chosen first, each language's
 * stream tracks before its files (even one listed after the files), and every
 * row where `order` first put it.
 */
export function versionGroups(
  versions: readonly SubtitleVersion[],
  firstLanguage: string | null,
  order: OrderMemory,
): Array<LanguageGroup<SubtitleVersion>> {
  const inOrder = (
    group: LanguageGroup<SubtitleVersion>,
    kind: SubtitleVersion['choice']['kind'],
  ) =>
    order(
      `${group.key}|${kind}`,
      group.items.filter((item) => item.choice.kind === kind),
      (item) => versionId(item.choice),
    );
  return order(
    '',
    groupByLanguage(versions, firstLanguage).map((group): LanguageGroup<SubtitleVersion> => ({
      ...group,
      items: inOrder(group, 'track').concat(inOrder(group, 'file')),
    })),
    (group) => group.key,
  );
}

/** The release playing, as versions are matched against it. */
export function playingRelease(entry: StreamEntry | null): PlayingRelease {
  return entry ? { filename: entry.stream.behaviorHints.filename, title: streamTitle(entry) } : {};
}

/**
 * What a version's row says of it: still loading its first line, could not be
 * read (the one chosen) or was passed over for that reason (another), or that
 * its release name looks made for the video playing. In that order.
 */
export type VersionNote = 'loading' | 'failed' | 'skipped' | 'matches';

/** Each note's words, as keys in the strings. */
export const VERSION_NOTES: Readonly<Record<VersionNote, string>> = {
  loading: 'player.versionLoading',
  failed: 'player.versionFailed',
  skipped: 'player.versionSkipped',
  matches: 'player.matchesVideo',
};

export function versionNote(
  version: SubtitleVersion,
  selected: boolean,
  status: SubtitleStatus | undefined,
  video: PlayingRelease,
): VersionNote | undefined {
  if (status === 'loading') return 'loading';
  if (status === 'failed') return selected ? 'failed' : 'skipped';
  return releaseMatch(version.release, video) ? 'matches' : undefined;
}

/** The version a language starts with when it is picked: its first that has not failed. */
export function languageFirstPick(
  group: LanguageGroup<SubtitleVersion>,
  statusOf: Subtitles['statusOf'],
): SubtitleVersion {
  return group.items.find((item) => statusOf(item.choice) !== 'failed') ?? group.items[0]!;
}

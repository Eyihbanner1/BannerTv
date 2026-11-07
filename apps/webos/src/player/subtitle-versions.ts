import {
  groupByLanguage,
  keepOrder,
  type LanguageGroup,
  languageName,
  rankSubtitles,
  releaseMatch,
  type StreamEntry,
  type SubtitleFit,
} from '@bannertv/core';
import type {
  SubtitleCheck,
  SubtitleChoice,
  Subtitles,
  SubtitleStatus,
} from '../screens/player/use-subtitles';
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
  /** A stream track of forced lines only (signs, the foreign-language scenes). */
  forced?: boolean;
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
      ...(track.forced ? { forced: true } : {}),
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
 * read (the one chosen) or was passed over for that reason (another); else
 * what reading it found (its text in another script, signs only, part of the
 * video, longer than it), that its drift was fixed by itself, that its
 * release name looks made for the video playing, and that it is for the hard
 * of hearing.
 */
export type VersionNote =
  | 'loading'
  | 'failed'
  | 'skipped'
  | 'otherScript'
  | 'signs'
  | 'short'
  | 'long'
  | 'driftFixed'
  | 'matches'
  | 'hearing';

/** Each note's words, as keys in the strings. */
export const VERSION_NOTES: Readonly<Record<VersionNote, string>> = {
  loading: 'player.versionLoading',
  failed: 'player.versionFailed',
  skipped: 'player.versionSkipped',
  otherScript: 'player.versionOtherScript',
  signs: 'player.versionSigns',
  short: 'player.versionShort',
  long: 'player.versionLong',
  driftFixed: 'player.versionDriftFixed',
  matches: 'player.matchesVideo',
  hearing: 'player.versionHearing',
};

const PROBLEM_NOTES: Readonly<Record<NonNullable<SubtitleCheck['problem']>, VersionNote>> = {
  script: 'otherScript',
  signs: 'signs',
  short: 'short',
  long: 'long',
};

/** A row has room for this many notes beside its release name. */
const MAX_NOTES = 2;

/**
 * The notes on a version's row, most telling first, at most two: loading or
 * a failure alone; else what reading it found, then a drift fixed by itself,
 * a release name that matches, and lines for the hard of hearing.
 */
export function versionNotes(
  version: SubtitleVersion,
  selected: boolean,
  status: SubtitleStatus | undefined,
  video: PlayingRelease,
  check?: SubtitleCheck,
): VersionNote[] {
  if (status === 'loading') return ['loading'];
  if (status === 'failed') return [selected ? 'failed' : 'skipped'];
  const notes: VersionNote[] = [];
  if (check?.problem) notes.push(PROBLEM_NOTES[check.problem]);
  if (check?.autoDrift) notes.push('driftFixed');
  if (releaseMatch(version.release, video)) notes.push('matches');
  if (check?.hearing) notes.push('hearing');
  return notes.slice(0, MAX_NOTES);
}

/**
 * A version's row detail: its notes, said in words, then its release name.
 * The notes first, on the TV and the phone alike: a long release name is
 * cut at the end, and why a row is dimmed must stay in sight.
 */
export function versionDetail(said: readonly string[], release?: string): string | undefined {
  return said.concat(release ? [release] : []).join(' · ') || undefined;
}

/** Whether a version was passed over for what reading it found: another script, or signs only. */
export function isUnfit(check: SubtitleCheck | undefined): boolean {
  return check?.problem === 'script' || check?.problem === 'signs';
}

/** What a row says reading a file found, as the checks' findings, for ranking it. */
function fitOfCheck(check: SubtitleCheck | undefined): SubtitleFit | undefined {
  if (!check) return undefined;
  const { problem } = check;
  const fit: SubtitleFit = {
    script: problem === 'script' ? 'wrong' : 'right',
    signs: problem === 'signs',
    hearing: check.hearing,
    length: problem === 'short' || problem === 'long' ? problem : 'fits',
    unfit: isUnfit(check),
  };
  if (check.drift) fit.drift = check.drift;
  return fit;
}

/**
 * The version a language starts with when it is picked, as the automatic
 * choice would rank them, of those that have not failed: the version picked
 * by hand for the release; the stream's own track (always in step), unless it
 * holds forced lines only; then the files, one made for the release first,
 * then the best fit, in the list's order where nothing tells them apart (so
 * a file known to cover only part falls below one not read yet). One passed
 * over for its checks, or a forced track, only when nothing else is left;
 * else its first that has not failed, else its first. The player then reads
 * the language's files and may move to a better one.
 */
export function languageFirstPick(
  group: LanguageGroup<SubtitleVersion>,
  subtitles: Pick<Subtitles, 'statusOf' | 'checkOf' | 'isRemembered' | 'wantsHearing'>,
  video: PlayingRelease,
): SubtitleVersion {
  const working = group.items.filter((item) => subtitles.statusOf(item.choice) !== 'failed');
  const remembered = working.find((item) => subtitles.isRemembered(item.choice));
  if (remembered) return remembered;
  const track = working.find((item) => item.choice.kind === 'track' && !item.forced);
  if (track) return track;
  const files = working.filter(
    (item) => item.choice.kind === 'file' && !isUnfit(subtitles.checkOf(item.choice)),
  );
  const [best] = rankSubtitles(
    files.map((item) => ({ item, label: item.release })),
    {
      video,
      fit: ({ item }) => fitOfCheck(subtitles.checkOf(item.choice)),
      hearing: subtitles.wantsHearing(),
    },
  );
  return best?.item ?? working[0] ?? group.items[0]!;
}

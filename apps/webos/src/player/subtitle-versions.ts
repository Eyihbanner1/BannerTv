import {
  fileReleaseMatch,
  groupByLanguage,
  keepOrder,
  type LanguageGroup,
  languageName,
  linkedToVideo,
  rankSubtitles,
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
  /** A second release name the addon sent, for matching only: never shown. */
  releaseName?: string;
  /** The addon found the file by the video's hash. */
  hashMatch?: boolean;
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
      ...(option.releaseName !== undefined && { releaseName: option.releaseName }),
      ...(option.hashMatch && { hashMatch: true }),
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

/**
 * An episode's video id, `{metaId}:{season}:{episode}`, for an IMDb or TMDB
 * meta id. Other ids say nothing of a season: Kitsu's "kitsu:1376:5" is
 * episode 5 of anime 1376, and the names are left to say which.
 */
const EPISODE_ID = /^(?:tt\d+|tmdb:\d+):(\d{1,4}):(\d{1,5})$/;

/**
 * The release playing, as versions are matched against it: its file name and
 * title, and the season and episode its video's id gives ("tt0944947:1:2",
 * "tmdb:1399:1:2").
 */
export function playingRelease(entry: StreamEntry | null, videoId?: string): PlayingRelease {
  if (!entry) return {};
  const release: PlayingRelease = {
    filename: entry.stream.behaviorHints.filename,
    title: streamTitle(entry),
  };
  const episode = videoId ? EPISODE_ID.exec(videoId) : null;
  if (episode) {
    release.season = Number(episode[1]);
    release.episode = Number(episode[2]);
  }
  return release;
}

/**
 * What a version's row says of it: still loading its first line, could not be
 * read (the one chosen) or was passed over for that reason (another); else
 * what reading it found (its text in another script, signs only, part of the
 * video, longer than it) or its names or its addon say (another episode),
 * that its drift was fixed by itself, that its addon found it by the video's
 * hash with no name saying otherwise (linked to it) or its release name is
 * the same as the video's with enough to confirm it (a guess), and that it
 * is for the hard of hearing.
 */
export type VersionNote =
  | 'loading'
  | 'failed'
  | 'skipped'
  | 'otherScript'
  | 'signs'
  | 'otherEpisode'
  | 'short'
  | 'long'
  | 'driftFixed'
  | 'linked'
  | 'sameRelease'
  | 'hearing';

/** Each note's words, as keys in the strings. */
export const VERSION_NOTES: Readonly<Record<VersionNote, string>> = {
  loading: 'player.versionLoading',
  failed: 'player.versionFailed',
  skipped: 'player.versionSkipped',
  otherScript: 'player.versionOtherScript',
  signs: 'player.versionSigns',
  otherEpisode: 'player.versionOtherEpisode',
  short: 'player.versionShort',
  long: 'player.versionLong',
  driftFixed: 'player.versionDriftFixed',
  linked: 'player.versionLinked',
  sameRelease: 'player.versionSameRelease',
  hearing: 'player.versionHearing',
};

const PROBLEM_NOTES: Readonly<Record<NonNullable<SubtitleCheck['problem']>, VersionNote>> = {
  script: 'otherScript',
  signs: 'signs',
  episode: 'otherEpisode',
  short: 'short',
  long: 'long',
};

/** A row has room for this many notes beside its release name. */
const MAX_NOTES = 2;

/**
 * The notes on a version's row, most telling first, at most two: loading or
 * a failure alone; else what reading it found, then a drift fixed by itself,
 * linked to the video by its hash (`linkedToVideo`) or else the same release
 * by a strong match of the names (the same name, or the group confirming it:
 * a loose match, another group's file as often as not, says nothing), and
 * lines for the hard of hearing.
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
  const file = {
    label: version.release,
    releaseName: version.releaseName,
    hashMatch: version.hashMatch,
  };
  const match = fileReleaseMatch(file, video);
  if (linkedToVideo(file, video)) notes.push('linked');
  else if (match === 'exact' || match === 'group') notes.push('sameRelease');
  if (check?.hearing) notes.push('hearing');
  return notes.slice(0, MAX_NOTES);
}

/**
 * A version's row detail: its notes, said in words, then its release name,
 * without a subtitle file's extension (OpenSubtitles names its files). The
 * notes first, on the TV and the phone alike: a long release name is cut at
 * the end, and why a row is dimmed must stay in sight.
 */
export function versionDetail(said: readonly string[], release?: string): string | undefined {
  const name = release?.replace(/\.(?:srt|vtt|ass|ssa|sub)$/i, '');
  return said.concat(name ? [name] : []).join(' · ') || undefined;
}

/**
 * Whether a version is passed over for what reading it found or its name
 * says: another script, signs only, or another episode.
 */
export function isUnfit(check: SubtitleCheck | undefined): boolean {
  return check?.problem === 'script' || check?.problem === 'signs' || check?.problem === 'episode';
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
    files.map((item) => ({
      item,
      label: item.release,
      releaseName: item.releaseName,
      hashMatch: item.hashMatch,
    })),
    {
      video,
      fit: ({ item }) => fitOfCheck(subtitles.checkOf(item.choice)),
      hearing: subtitles.wantsHearing(),
    },
  );
  return best?.item ?? working[0] ?? group.items[0]!;
}

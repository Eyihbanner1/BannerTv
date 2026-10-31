import { languageKey, languageName } from '@bannertv/core';
import type { EngineTrack } from './engines/types';

/**
 * A channel count as boxes print it: 2 is "2.0", 6 is "5.1", 8 is "7.1".
 * HLS gives "6", or "16/JOC" for Atmos, which says nothing of the bed.
 */
export function channelName(count: number | string | null | undefined): string | undefined {
  const value = typeof count === 'string' ? Number(count.split('/')[0]) : count;
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  if (value === 1) return '1.0';
  if (value === 2) return '2.0';
  if (value === 6) return '5.1';
  if (value === 8) return '7.1';
  return undefined;
}

/** MP4's object-type names for codecs that have their own ("mp4a.a6" is E-AC-3). */
const MP4_OBJECT_TYPES: Record<string, string> = {
  'mp4a.a5': 'ac-3',
  'mp4a.a6': 'ec-3',
  'mp4a.a9': 'dtsc',
  'mp4a.ac': 'dtsc',
  'mp4a.b2': 'dtsx',
  'mp4a.69': 'mp3',
  'mp4a.6b': 'mp3',
  'mp4a.40.34': 'mp3',
};

/**
 * A codec's family, as Shaka groups audio tracks: AAC in its profiles
 * (mp4a.40.2, .5, .29, or none given) and MPEG-2's (mp4a.66 to .68) is "aac", and any other
 * codec is named before its profile ("ac-4.02.01.01" is "ac-4").
 */
export function codecFamily(codec: string): string {
  const trimmed = codec.trim().toLowerCase();
  const named = MP4_OBJECT_TYPES[trimmed];
  if (named) return named;
  if (/^mp4a(\.40(\.\d+)?|\.6[678])?$/.test(trimmed)) return 'aac';
  return trimmed.split('.')[0]!;
}

/** A codec string ("mp4a.40.2", "ec-3") as the format name boxes print; undefined when unknown. */
export function formatName(codecs: string | null | undefined, atmos = false): string | undefined {
  if (!codecs) return atmos ? 'Atmos' : undefined;
  // A variant's codecs list the video too: only the audio one matters.
  for (const raw of codecs.split(',')) {
    const codec = codecFamily(raw);
    if (atmos && (codec === 'ec-3' || codec === 'ac-4' || codec.startsWith('mlpa'))) return 'Atmos';
    if (codec === 'ec-3' || codec === 'eac3') return 'DD+';
    if (codec === 'ac-3' || codec === 'ac3') return 'DD';
    if (codec === 'ac-4') return 'AC-4';
    if (codec === 'mp3') return 'MP3';
    if (codec === 'aac') return 'AAC';
    if (codec === 'opus') return 'Opus';
    if (codec === 'flac') return 'FLAC';
    if (codec.startsWith('dts')) return 'DTS';
    if (codec.startsWith('mlpa')) return 'TrueHD';
  }
  return atmos ? 'Atmos' : undefined;
}

/**
 * Whether the track is a commentary, by the stream's own mark or, unless
 * names are not to be trusted, by its name ("No commentary" is not one).
 */
export function isCommentary(track: EngineTrack, byName = true): boolean {
  if (track.commentary === true) return true;
  if (!byName) return false;
  return (
    /commentar|kommentar/i.test(track.label) &&
    // "Without the director's commentary", "Non-commentary", "Kein Kommentar",
    // but not a film's own name: "No Country for Old Men commentary" is one.
    !/\b(no|non|without|ohne|kein\w*)[\s-]+((the|a|director'?s?|directors'|audio)[\s-]+)*(audio)?(commentar|kommentar)/i.test(
      track.label,
    )
  );
}

/**
 * The language's name, or the track's own name when it has no language, or
 * "Unknown language" when it has neither.
 */
export function audioLanguage(track: EngineTrack): string {
  return (track.lang && languageName(track.lang)) || track.label || languageName('und');
}

/** "English 5.1": what an audio row's tab says is on. */
export function audioSummary(track: EngineTrack): string {
  const language = audioLanguage(track);
  return track.channels ? `${language} ${track.channels}` : language;
}

/**
 * The second part of an audio row: "DD+ 5.1", then the track's own name
 * where it says more than its language ("Director's commentary").
 */
export function audioDetail(track: EngineTrack): string | undefined {
  const sound = [track.format, track.channels].filter(Boolean).join(' ');
  const language = audioLanguage(track).toLowerCase();
  const name = track.label.trim();
  const says = name && name.toLowerCase() !== language && name !== track.lang ? name : '';
  return [sound, says].filter(Boolean).join(' · ') || undefined;
}

/**
 * The track to play in the language wanted: the one playing if it is in that
 * language and not a commentary, otherwise the first that is not a
 * commentary; when all of them are, the one playing, or the first.
 * byName: false where a name saying "commentary" is the main sound, as on
 * sport, so only the stream's own mark counts.
 */
export function pickAudio(
  tracks: readonly EngineTrack[],
  wanted: string,
  byName = true,
): EngineTrack | undefined {
  const key = languageKey(wanted);
  const matching = tracks.filter((track) => track.lang && languageKey(track.lang) === key);
  const active = matching.find((track) => track.active);
  const main = matching.filter((track) => !isCommentary(track, byName));
  if (active && (main.length === 0 || main.includes(active))) return active;
  return main[0] ?? matching[0];
}

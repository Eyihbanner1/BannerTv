import { languageKey, type StreamEntry } from '@bannertv/core';
import { trackMemory } from './library';
import { preferences, setPreference } from './preferences';

/**
 * Audio and subtitle languages (ADR 0004, item 7): what was chosen for this
 * title before, otherwise the profile's own (Settings > Languages and
 * picture). A choice in the player is kept for the title, and becomes the
 * profile's own too only when "Use player choices for every title" is on.
 * `metaId` is undefined for Lab streams, which remember nothing per title.
 */
export function wantedAudio(metaId: string | undefined): string | null {
  const choice = metaId === undefined ? undefined : trackMemory.get(metaId);
  return choice?.audio ?? preferences.get().audioLanguage;
}

/** A language as ISO 639-1 where it has one ("eng" and "en-GB" are "en"). */
function baseLanguage(code: string): string {
  return languageKey(code).split('-')[0]!;
}

/**
 * The audio languages heard now, for "only when the audio isn't in that
 * language": the playing track's, else the languages the stream names. Empty
 * when neither says.
 */
export function heardLanguages(
  audio: ReadonlyArray<{ lang: string; active: boolean }>,
  entry: Pick<StreamEntry, 'facts'> | null,
): string[] {
  const active = audio.find((track) => track.active);
  if (active?.lang && active.lang !== 'und') return [active.lang];
  return entry ? entry.facts.languages.filter((code) => code !== 'multi') : [];
}

/**
 * The subtitles to start with. With the profile's "only when the audio isn't
 * in that language", none while the audio heard is in it or no one says which
 * language it is: a stream that names none is most often in the film's own.
 */
export function wantedSubtitle(
  metaId: string | undefined,
  heard: readonly string[] = [],
): string | null {
  const choice = metaId === undefined ? undefined : trackMemory.get(metaId);
  if (choice && choice.subtitle !== undefined) return choice.subtitle;
  const { subtitleLanguage, subtitleWhen } = preferences.get();
  if (subtitleLanguage === null || subtitleWhen === 'always') return subtitleLanguage;
  const own = baseLanguage(subtitleLanguage);
  const foreign = heard.length > 0 && !heard.some((code) => baseLanguage(code) === own);
  return foreign ? subtitleLanguage : null;
}

export function chooseAudioLanguage(metaId: string | undefined, language: string): void {
  if (preferences.get().learnLanguages) setPreference('audioLanguage', language);
  if (metaId !== undefined) void trackMemory.rememberAudio(metaId, language);
}

export function chooseSubtitleLanguage(metaId: string | undefined, language: string | null): void {
  if (preferences.get().learnLanguages) setPreference('subtitleLanguage', language);
  if (metaId !== undefined) void trackMemory.rememberSubtitle(metaId, language);
}

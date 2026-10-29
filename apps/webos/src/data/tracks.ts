import { trackMemory } from './library';
import { preferences, setPreference } from './preferences';

/**
 * Audio and subtitle languages (ADR 0004, item 7): what was chosen for this
 * title before, otherwise what was chosen last anywhere. A choice is kept
 * for the title and becomes the profile's default for new titles too.
 * `metaId` is undefined for Lab streams, which remember nothing per title.
 */
export function wantedAudio(metaId: string | undefined): string | null {
  const choice = metaId === undefined ? undefined : trackMemory.get(metaId);
  return choice?.audio ?? preferences.get().audioLanguage;
}

export function wantedSubtitle(metaId: string | undefined): string | null {
  const choice = metaId === undefined ? undefined : trackMemory.get(metaId);
  return choice && choice.subtitle !== undefined
    ? choice.subtitle
    : preferences.get().subtitleLanguage;
}

export function chooseAudioLanguage(metaId: string | undefined, language: string): void {
  setPreference('audioLanguage', language);
  if (metaId !== undefined) void trackMemory.rememberAudio(metaId, language);
}

export function chooseSubtitleLanguage(metaId: string | undefined, language: string | null): void {
  setPreference('subtitleLanguage', language);
  if (metaId !== undefined) void trackMemory.rememberSubtitle(metaId, language);
}

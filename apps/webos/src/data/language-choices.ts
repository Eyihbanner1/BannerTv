import { languageKey } from '@bannertv/core';
import type { MaxResolution } from './preferences';

/**
 * The languages Settings > Languages and picture offers for audio and
 * subtitles, the most watched in BannerTV's markets first.
 */
export const LANGUAGE_CHOICES: readonly string[] = [
  'en',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'nl',
  'pl',
  'sv',
  'da',
  'no',
  'fi',
  'tr',
  'ru',
  'ar',
  'hi',
  'ja',
  'ko',
  'zh',
];

/** The highest picture choices, 'any' for as high as the screen shows. */
export const PICTURE_CHOICES: ReadonlyArray<MaxResolution | 'any'> = [
  'any',
  '2160p',
  '1080p',
  '720p',
];

/** "eng", "en-GB" and "English" as "en", to tick the right line. Null stays null. */
export function baseLanguage(code: string | null): string | null {
  return code ? languageKey(code).split('-')[0]! : null;
}

/** The languages to offer, with the one set now added when the list lacks it. */
export function languageChoices(current: string | null): string[] {
  const codes = LANGUAGE_CHOICES.slice();
  const own = baseLanguage(current);
  if (own && codes.indexOf(own) < 0) codes.push(own);
  return codes;
}

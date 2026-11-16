import { languageKey } from '../../subtitles/languages';

/**
 * SubDL's language codes: ISO 639-1 in upper case ("EN", "FR"), with its own
 * for Brazilian Portuguese (BR_PT) and Traditional Chinese (ZH_BG), and codes
 * of two languages joined (BG_EN) for files that hold both.
 */

/** SubDL's code for one of ours, or undefined when SubDL has none: that language is not asked. */
export function subdlCodeFor(wanted: string): string | undefined {
  const key = languageKey(wanted);
  if (key === 'pt-br') return 'BR_PT';
  if (key === 'zh-hant') return 'ZH_BG';
  if (key === 'zh-hans' || key === 'zh') return 'ZH';
  // SubDL has one Spanish.
  if (key === 'es-419') return 'ES';
  return /^[a-z]{2}$/.test(key) ? key.toUpperCase() : undefined;
}

/** Our language key for SubDL's code; undefined for a file of two languages, which is dropped. */
export function languageOfSubdl(code: string): string | undefined {
  const upper = code.trim().toUpperCase();
  if (upper === '') return undefined;
  if (upper === 'BR_PT') return 'pt-br';
  if (upper === 'ZH_BG') return 'zh-hant';
  if (upper.indexOf('_') !== -1) return undefined;
  return languageKey(upper.toLowerCase());
}

// SubDL's one code asked for these of ours, by what its files are read as.
const ASKED_AS: Readonly<Record<string, string>> = { es: 'es-419', zh: 'zh-hans' };

/**
 * The language a SubDL file is listed in for a viewer who wanted `wanted`:
 * SubDL's one Spanish, asked for Latin American Spanish, is listed as that,
 * and its Chinese, asked for simplified Chinese, likewise, unless the plain
 * language was wanted too. Otherwise the file's own.
 */
export function subdlFileLanguage(lang: string, wanted: readonly string[]): string {
  const asked = ASKED_AS[lang];
  if (asked === undefined) return lang;
  const keys = wanted.map(languageKey);
  return keys.indexOf(asked) !== -1 && keys.indexOf(lang) === -1 ? asked : lang;
}

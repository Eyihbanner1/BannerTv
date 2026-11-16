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
 * The language a SubDL file is listed in for a viewer who wanted `wanted`,
 * in the order asked: SubDL's one Spanish is listed as the first of Latin
 * American Spanish and plain Spanish wanted, and its Chinese as the first of
 * simplified and plain Chinese, so the title's own choice, asked first, is
 * the one its files show in. Otherwise the file's own.
 */
export function subdlFileLanguage(lang: string, wanted: readonly string[]): string {
  const asked = ASKED_AS[lang];
  if (asked === undefined) return lang;
  for (const one of wanted) {
    const key = languageKey(one);
    if (key === asked || key === lang) return key;
  }
  return lang;
}

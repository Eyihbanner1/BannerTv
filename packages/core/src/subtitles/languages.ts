/**
 * Language codes as addons send them (ISO 639-2/B "fre", 639-2/T "fra",
 * 639-1 "fr", OpenSubtitles' own "pob" or "zht", sometimes an English name),
 * turned into one comparable key and an English name. Chromium 68 has no
 * Intl.DisplayNames, so the table ships with the app.
 */

interface Language {
  key: string;
  name: string;
}

/**
 * [key, English name, other codes and names...]. The key and the lower-cased
 * name match without being listed again. A row may reuse an earlier key under
 * its own name: "zhe" is its own subtitle flavour but groups with Chinese.
 */
const LANGUAGES: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ['en', 'English', 'eng'],
  ['fr', 'French', 'fre', 'fra', 'français', 'francais'],
  ['de', 'German', 'ger', 'deu', 'deutsch'],
  ['es', 'Spanish', 'spa', 'spn', 'sp', 'español', 'espanol', 'castilian', 'spanish (eu)'],
  ['es-419', 'Spanish (Latin America)', 'spl', 'ea', 'spanish (la)', 'latin american spanish'],
  ['pt', 'Portuguese', 'por', 'português', 'portugues'],
  [
    'pt-br',
    'Portuguese (Brazil)',
    'pob',
    'pb',
    'brazilian',
    'brazilian portuguese',
    'portuguese (brazilian)',
  ],
  ['it', 'Italian', 'ita', 'italiano'],
  ['nl', 'Dutch', 'dut', 'nld', 'nederlands', 'flemish'],
  ['sv', 'Swedish', 'swe', 'svenska'],
  ['no', 'Norwegian', 'nor', 'nb', 'nob', 'nn', 'nno', 'norsk', 'bokmål', 'nynorsk'],
  ['da', 'Danish', 'dan', 'dansk'],
  ['fi', 'Finnish', 'fin', 'suomi'],
  ['is', 'Icelandic', 'ice', 'isl'],
  ['pl', 'Polish', 'pol', 'polski'],
  ['cs', 'Czech', 'cze', 'ces', 'čeština'],
  ['sk', 'Slovak', 'slo', 'slk'],
  ['hu', 'Hungarian', 'hun', 'magyar'],
  ['ro', 'Romanian', 'rum', 'ron', 'mo', 'mol', 'moldavian', 'română'],
  ['bg', 'Bulgarian', 'bul'],
  ['el', 'Greek', 'gre', 'ell'],
  ['tr', 'Turkish', 'tur', 'türkçe'],
  ['ru', 'Russian', 'rus', 'русский'],
  ['uk', 'Ukrainian', 'ukr'],
  ['be', 'Belarusian', 'bel'],
  // scc and scr are the withdrawn 639-2/B codes OpenSubtitles still uses.
  ['sr', 'Serbian', 'srp', 'scc'],
  ['hr', 'Croatian', 'hrv', 'scr'],
  ['bs', 'Bosnian', 'bos'],
  ['sl', 'Slovenian', 'slv', 'slovene'],
  ['mk', 'Macedonian', 'mac', 'mkd'],
  ['sq', 'Albanian', 'alb', 'sqi'],
  ['et', 'Estonian', 'est'],
  ['lv', 'Latvian', 'lav'],
  ['lt', 'Lithuanian', 'lit'],
  ['ar', 'Arabic', 'ara'],
  ['fa', 'Persian', 'per', 'fas', 'pes', 'farsi'],
  ['he', 'Hebrew', 'heb', 'iw'],
  ['hi', 'Hindi', 'hin'],
  ['bn', 'Bengali', 'ben', 'bangla'],
  ['ta', 'Tamil', 'tam'],
  ['te', 'Telugu', 'tel'],
  ['ml', 'Malayalam', 'mal'],
  ['kn', 'Kannada', 'kan'],
  ['mr', 'Marathi', 'mar'],
  ['ur', 'Urdu', 'urd'],
  ['th', 'Thai', 'tha'],
  ['vi', 'Vietnamese', 'vie'],
  ['id', 'Indonesian', 'ind', 'in'],
  ['ms', 'Malay', 'may', 'msa', 'zsm'],
  ['tl', 'Filipino', 'tgl', 'fil', 'tagalog'],
  ['zh', 'Chinese', 'chi', 'zho'],
  ['zh-hans', 'Chinese (Simplified)', 'zhs', 'chs', 'simplified chinese'],
  ['zh-hant', 'Chinese (Traditional)', 'zht', 'cht', 'traditional chinese'],
  ['zh', 'Chinese (bilingual)', 'zhe', 'ze', 'chinese bilingual'],
  ['ja', 'Japanese', 'jpn', '日本語'],
  ['ko', 'Korean', 'kor', '한국어'],
  ['ca', 'Catalan', 'cat', 'català'],
  ['eu', 'Basque', 'baq', 'eus'],
  ['gl', 'Galician', 'glg'],
  ['cy', 'Welsh', 'wel', 'cym'],
  ['ga', 'Irish', 'gle'],
  ['gd', 'Scottish Gaelic', 'gla', 'gaelic'],
  ['eo', 'Esperanto', 'epo'],
  ['ku', 'Kurdish', 'kur', 'ckb', 'kmr'],
  ['hy', 'Armenian', 'arm', 'hye'],
  ['ka', 'Georgian', 'geo', 'kat'],
  ['az', 'Azerbaijani', 'aze'],
  ['kk', 'Kazakh', 'kaz'],
  ['uz', 'Uzbek', 'uzb'],
  ['mn', 'Mongolian', 'mon'],
  ['km', 'Khmer', 'khm'],
  ['lo', 'Lao', 'lao'],
  ['my', 'Burmese', 'bur', 'mya'],
  ['ne', 'Nepali', 'nep'],
  ['si', 'Sinhala', 'sin', 'sinhalese'],
  ['sw', 'Swahili', 'swa'],
  ['af', 'Afrikaans', 'afr'],
  ['am', 'Amharic', 'amh'],
  ['so', 'Somali', 'som'],
  ['la', 'Latin', 'lat'],
  ['yi', 'Yiddish', 'yid', 'ji'],
  ['und', 'Unknown language', 'unk', '', 'unknown'],
];

const LATIN_AMERICA = '419 mx ar co cl pe ve ec gt cu bo do hn py sv ni cr pa uy pr'.split(' ');

/** Region and script subtags that make a different subtitle language, by base key. */
const VARIANTS = new Map<string, Map<string, string>>([
  ['pt', new Map([['br', 'pt-br']])],
  ['es', new Map(LATIN_AMERICA.map((region): [string, string] => [region, 'es-419']))],
  [
    'zh',
    new Map([
      ['hans', 'zh-hans'],
      ['cn', 'zh-hans'],
      ['sg', 'zh-hans'],
      ['hant', 'zh-hant'],
      ['tw', 'zh-hant'],
      ['hk', 'zh-hant'],
      ['mo', 'zh-hant'],
    ]),
  ],
]);

const TABLE = new Map<string, Language>();
for (const [key, name, ...codes] of LANGUAGES) {
  const language = { key, name };
  for (const code of [key, name.toLowerCase(), ...codes]) {
    if (!TABLE.has(code)) TABLE.set(code, language);
  }
}

function lookup(code: string): Language | undefined {
  const normalized = code.trim().toLowerCase().replace(/_/g, '-');
  const exact = TABLE.get(normalized);
  if (exact) return exact;
  // "en-GB", "pt-BR", "zh-Hant-TW", "por-br": the base language, unless a
  // subtag names a variant that gets its own subtitles.
  const [base, ...subtags] = normalized.split('-');
  const language = TABLE.get(base!);
  if (!language) return undefined;
  const variants = VARIANTS.get(language.key);
  for (const subtag of subtags) {
    const variant = variants?.get(subtag);
    if (variant !== undefined) return TABLE.get(variant);
  }
  return language;
}

/** One key per language: the ISO 639-1 code where there is one ("en", "pt-br"), else the lower-cased input. */
export function languageKey(code: string): string {
  return lookup(code)?.key ?? code.trim().toLowerCase();
}

/** "English", "Portuguese (Brazil)"; an unknown code comes back as it was given. */
export function languageName(code: string): string {
  return lookup(code)?.name ?? code.trim();
}

export interface LanguageGroup<T> {
  /** languageKey of the group. */
  key: string;
  /** English name of the language. */
  name: string;
  /** In the order given. */
  items: T[];
}

const UNKNOWN = 'und';

/**
 * Groups subtitles (or audio tracks) by language for the player's menu: the
 * preferred language first, then by English name, unknown languages last.
 */
export function groupByLanguage<T extends { lang: string }>(
  items: readonly T[],
  preferred: string | null,
): Array<LanguageGroup<T>> {
  const groups = new Map<string, LanguageGroup<T>>();
  for (const item of items) {
    const key = languageKey(item.lang);
    let group = groups.get(key);
    if (!group) {
      // The key's own name, so a group of "zhe" and "chi" reads "Chinese".
      group = { key, name: TABLE.get(key)?.name ?? languageName(item.lang), items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  const first = preferred === null ? undefined : languageKey(preferred);
  const rank = (group: LanguageGroup<T>) =>
    group.key === UNKNOWN ? 2 : group.key === first ? 0 : 1;
  const byName = (a: LanguageGroup<T>, b: LanguageGroup<T>) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
  return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || byName(a, b));
}

import { describe, expect, it } from 'vitest';
import { groupByLanguage, type LanguageGroup, languageKey, languageName } from './languages';

describe('languageKey and languageName', () => {
  it('give every ISO form of a language the same key and English name', () => {
    for (const code of ['fr', 'fre', 'fra', 'FR', ' Fre ', 'French', 'french', 'Français']) {
      expect(languageKey(code), code).toBe('fr');
      expect(languageName(code), code).toBe('French');
    }
    expect([languageKey('ger'), languageKey('deu'), languageKey('de')]).toEqual(['de', 'de', 'de']);
    expect([languageKey('gre'), languageKey('ell')]).toEqual(['el', 'el']);
    expect([languageKey('chi'), languageKey('zho')]).toEqual(['zh', 'zh']);
    expect([languageKey('per'), languageKey('fas'), languageKey('pes')]).toEqual([
      'fa',
      'fa',
      'fa',
    ]);
    expect([languageKey('tl'), languageKey('tgl'), languageKey('fil')]).toEqual(['tl', 'tl', 'tl']);
    expect(languageName('fil')).toBe('Filipino');
  });

  it('knows every language of the subtitle menu', () => {
    const table: Array<[string, string, string]> = [
      ['eng', 'en', 'English'],
      ['spa', 'es', 'Spanish'],
      ['por', 'pt', 'Portuguese'],
      ['ita', 'it', 'Italian'],
      ['dut', 'nl', 'Dutch'],
      ['swe', 'sv', 'Swedish'],
      ['dan', 'da', 'Danish'],
      ['fin', 'fi', 'Finnish'],
      ['ice', 'is', 'Icelandic'],
      ['pol', 'pl', 'Polish'],
      ['cze', 'cs', 'Czech'],
      ['slo', 'sk', 'Slovak'],
      ['hun', 'hu', 'Hungarian'],
      ['rum', 'ro', 'Romanian'],
      ['bul', 'bg', 'Bulgarian'],
      ['tur', 'tr', 'Turkish'],
      ['rus', 'ru', 'Russian'],
      ['ukr', 'uk', 'Ukrainian'],
      ['bel', 'be', 'Belarusian'],
      ['srp', 'sr', 'Serbian'],
      ['scc', 'sr', 'Serbian'],
      ['hrv', 'hr', 'Croatian'],
      ['bos', 'bs', 'Bosnian'],
      ['slv', 'sl', 'Slovenian'],
      ['mac', 'mk', 'Macedonian'],
      ['alb', 'sq', 'Albanian'],
      ['est', 'et', 'Estonian'],
      ['lav', 'lv', 'Latvian'],
      ['lit', 'lt', 'Lithuanian'],
      ['ara', 'ar', 'Arabic'],
      ['heb', 'he', 'Hebrew'],
      ['hin', 'hi', 'Hindi'],
      ['ben', 'bn', 'Bengali'],
      ['tam', 'ta', 'Tamil'],
      ['tel', 'te', 'Telugu'],
      ['mal', 'ml', 'Malayalam'],
      ['kan', 'kn', 'Kannada'],
      ['mar', 'mr', 'Marathi'],
      ['urd', 'ur', 'Urdu'],
      ['tha', 'th', 'Thai'],
      ['vie', 'vi', 'Vietnamese'],
      ['ind', 'id', 'Indonesian'],
      ['may', 'ms', 'Malay'],
      ['jpn', 'ja', 'Japanese'],
      ['kor', 'ko', 'Korean'],
      ['cat', 'ca', 'Catalan'],
      ['baq', 'eu', 'Basque'],
      ['glg', 'gl', 'Galician'],
      ['wel', 'cy', 'Welsh'],
      ['gle', 'ga', 'Irish'],
      ['gla', 'gd', 'Scottish Gaelic'],
      ['epo', 'eo', 'Esperanto'],
      ['kur', 'ku', 'Kurdish'],
      ['arm', 'hy', 'Armenian'],
      ['geo', 'ka', 'Georgian'],
      ['aze', 'az', 'Azerbaijani'],
      ['kaz', 'kk', 'Kazakh'],
      ['uzb', 'uz', 'Uzbek'],
      ['mon', 'mn', 'Mongolian'],
      ['khm', 'km', 'Khmer'],
      ['lao', 'lo', 'Lao'],
      ['bur', 'my', 'Burmese'],
      ['nep', 'ne', 'Nepali'],
      ['sin', 'si', 'Sinhala'],
      ['swa', 'sw', 'Swahili'],
      ['afr', 'af', 'Afrikaans'],
      ['amh', 'am', 'Amharic'],
      ['som', 'so', 'Somali'],
      ['lat', 'la', 'Latin'],
    ];
    for (const [code, key, name] of table) {
      expect([languageKey(code), languageName(code)], code).toEqual([key, name]);
      expect([languageKey(key), languageName(key)], key).toEqual([key, name]);
      expect(languageKey(name), name).toBe(key);
    }
  });

  it('folds the Norwegian written forms into one language', () => {
    for (const code of ['no', 'nor', 'nob', 'nb', 'nno', 'nn', 'nb-NO']) {
      expect(languageKey(code), code).toBe('no');
    }
    expect(languageName('nob')).toBe('Norwegian');
  });

  it('keeps Brazilian Portuguese and Latin American Spanish apart', () => {
    for (const code of ['pob', 'pt-br', 'pt-BR', 'pt_BR', 'por-br', 'PB', 'Portuguese (Brazil)']) {
      expect(languageKey(code), code).toBe('pt-br');
    }
    expect(languageName('pob')).toBe('Portuguese (Brazil)');
    expect([languageKey('pt-PT'), languageKey('pt_pt')]).toEqual(['pt', 'pt']);

    for (const code of ['spl', 'es-419', 'es-MX', 'es_AR', 'spa-419', 'ea']) {
      expect(languageKey(code), code).toBe('es-419');
    }
    expect(languageName('es-MX')).toBe('Spanish (Latin America)');
    expect([languageKey('es-ES'), languageKey('spn')]).toEqual(['es', 'es']);
  });

  it("reads OpenSubtitles' Chinese variants and the usual script and region tags", () => {
    expect([languageKey('zht'), languageName('zht')]).toEqual(['zh-hant', 'Chinese (Traditional)']);
    expect([languageKey('zhs'), languageKey('chs')]).toEqual(['zh-hans', 'zh-hans']);
    expect(languageName('chs')).toBe('Chinese (Simplified)');
    expect([languageKey('zhe'), languageName('zhe')]).toEqual(['zh', 'Chinese (bilingual)']);
    expect([languageKey('zh-TW'), languageKey('zh-Hant-HK'), languageKey('chi-tw')]).toEqual([
      'zh-hant',
      'zh-hant',
      'zh-hant',
    ]);
    expect([languageKey('zh-CN'), languageKey('zh_Hans'), languageKey('zh-SG')]).toEqual([
      'zh-hans',
      'zh-hans',
      'zh-hans',
    ]);
    expect(languageName('zh')).toBe('Chinese');
  });

  it('reduces other region variants to the language', () => {
    expect([languageKey('en-GB'), languageKey('en_US'), languageKey('eng-us')]).toEqual([
      'en',
      'en',
      'en',
    ]);
    expect(languageName('en-GB')).toBe('English');
    expect(languageKey('fr-CA')).toBe('fr');
  });

  it('calls undetermined, unknown and empty codes "Unknown language"', () => {
    for (const code of ['und', 'UNK', '', '  ', 'unknown']) {
      expect([languageKey(code), languageName(code)], code).toEqual(['und', 'Unknown language']);
    }
  });

  it('returns codes it does not know trimmed, lower-cased for the key and as given for the name', () => {
    expect(languageKey(' XYZ ')).toBe('xyz');
    expect(languageName(' XYZ ')).toBe('XYZ');
    expect(languageName('xyz')).toBe('xyz');
    expect(languageKey('Klingon')).toBe('klingon');
    expect(languageKey('constructor')).toBe('constructor');
    expect(languageKey('es-constructor')).toBe('es');
  });
});

describe('groupByLanguage', () => {
  const subtitles = [
    { id: 1, lang: 'fre' },
    { id: 2, lang: 'eng' },
    { id: 3, lang: 'und' },
    { id: 4, lang: 'ger' },
    { id: 5, lang: 'en' },
    { id: 6, lang: 'pob' },
    { id: 7, lang: 'XYZ' },
    { id: 8, lang: 'fra' },
    { id: 9, lang: '' },
    { id: 10, lang: 'por' },
  ];
  const summary = (groups: Array<LanguageGroup<{ id: number; lang: string }>>) =>
    groups.map((group) => [group.key, group.name, group.items.map((item) => item.id)]);

  it('puts the preferred language first, then by English name, unknown last', () => {
    expect(summary(groupByLanguage(subtitles, 'fr'))).toEqual([
      ['fr', 'French', [1, 8]],
      ['en', 'English', [2, 5]],
      ['de', 'German', [4]],
      ['pt', 'Portuguese', [10]],
      ['pt-br', 'Portuguese (Brazil)', [6]],
      ['xyz', 'XYZ', [7]],
      ['und', 'Unknown language', [3, 9]],
    ]);
  });

  it('matches the preference in any code form and works without one', () => {
    expect(groupByLanguage(subtitles, 'Portuguese (Brazil)')[0]?.key).toBe('pt-br');
    expect(groupByLanguage(subtitles, 'deu')[0]?.key).toBe('de');
    expect(groupByLanguage(subtitles, null).map((group) => group.key)).toEqual([
      'en',
      'fr',
      'de',
      'pt',
      'pt-br',
      'xyz',
      'und',
    ]);
    // A preference with no subtitles, or an unknown one, changes nothing.
    expect(groupByLanguage(subtitles, 'jpn')[0]?.key).toBe('en');
    expect(groupByLanguage(subtitles, '')[0]?.key).toBe('en');
  });

  it("names a group after its language, not after its first item's variant", () => {
    const groups = groupByLanguage([{ lang: 'zhe' }, { lang: 'chi' }, { lang: 'zht' }], null);
    expect(groups.map((group) => [group.key, group.name, group.items.length])).toEqual([
      ['zh', 'Chinese', 2],
      ['zh-hant', 'Chinese (Traditional)', 1],
    ]);
  });

  it('returns no groups for no items', () => {
    expect(groupByLanguage([], 'en')).toEqual([]);
  });
});

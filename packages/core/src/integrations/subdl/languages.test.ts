import { describe, expect, it } from 'vitest';
import { languageOfSubdl, subdlCodeFor, subdlFileLanguage } from './languages';

describe('languageOfSubdl', () => {
  it("reads SubDL's codes as our keys", () => {
    expect(languageOfSubdl('EN')).toBe('en');
    expect(languageOfSubdl(' fr ')).toBe('fr');
    expect(languageOfSubdl('BR_PT')).toBe('pt-br');
    expect(languageOfSubdl('ZH_BG')).toBe('zh-hant');
    expect(languageOfSubdl('KL')).toBe('kl');
  });

  it('drops files of two languages', () => {
    for (const code of ['BG_EN', 'NL_EN', 'EN_DE', 'HU_EN'])
      expect(languageOfSubdl(code)).toBeUndefined();
    expect(languageOfSubdl('')).toBeUndefined();
  });
});

describe('subdlCodeFor', () => {
  it("gives SubDL's code for ours", () => {
    expect(subdlCodeFor('en')).toBe('EN');
    expect(subdlCodeFor('eng')).toBe('EN');
    expect(subdlCodeFor('en-GB')).toBe('EN');
    expect(subdlCodeFor('pt-br')).toBe('BR_PT');
    expect(subdlCodeFor('pob')).toBe('BR_PT');
    expect(subdlCodeFor('zh-hant')).toBe('ZH_BG');
    expect(subdlCodeFor('zh-hans')).toBe('ZH');
    expect(subdlCodeFor('zh')).toBe('ZH');
    expect(subdlCodeFor('es-419')).toBe('ES');
    expect(subdlCodeFor('fre')).toBe('FR');
  });

  it('gives none for a language with no ISO 639-1 code', () => {
    expect(subdlCodeFor('haw')).toBeUndefined();
    expect(subdlCodeFor('und')).toBeUndefined();
  });
});

describe('subdlFileLanguage', () => {
  it('lists Spanish and Chinese files as the variety asked first', () => {
    expect(subdlFileLanguage('es', ['es-419'])).toBe('es-419');
    expect(subdlFileLanguage('es', ['spa', 'es-419'])).toBe('es');
    // The title's choice comes first, and is the language showing.
    expect(subdlFileLanguage('es', ['es-419', 'es'])).toBe('es-419');
    expect(subdlFileLanguage('es', ['en', 'es-419', 'spa'])).toBe('es-419');
    expect(subdlFileLanguage('zh', ['zh-hans', 'zh'])).toBe('zh-hans');
    expect(subdlFileLanguage('zh', ['zh', 'zh-hans'])).toBe('zh');
    expect(subdlFileLanguage('zh', ['zh-hans'])).toBe('zh-hans');
    expect(subdlFileLanguage('zh', ['zh'])).toBe('zh');
    expect(subdlFileLanguage('zh-hant', ['zh-hans'])).toBe('zh-hant');
    expect(subdlFileLanguage('en', ['es-419'])).toBe('en');
  });
});

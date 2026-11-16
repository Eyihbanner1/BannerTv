import { describe, expect, it } from 'vitest';
import { languageOfSubdl, subdlCodeFor } from './languages';

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

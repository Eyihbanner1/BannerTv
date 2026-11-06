import { describe, expect, it } from 'vitest';
import { understand } from './understand';
import { vocabulary } from './vocabulary';
import { distance, keyOf, stem, wordsOf } from './words';

const ids = (text: string) => understand(text).intents.map((intent) => intent.id);

describe('words', () => {
  it('folds case, accents, hyphens and punctuation', () => {
    expect(wordsOf('  Stand-Up  Comédie! ')).toEqual(['stand', 'up', 'comedie']);
    expect(wordsOf("Kids' films & 'TV'")).toEqual(['kids', 'films', 'and', 'tv']);
    expect(wordsOf("the '90s")).toEqual(['the', '90s']);
    expect(wordsOf('   ')).toEqual([]);
  });

  it('reads singular and plural as one word', () => {
    for (const [a, b] of [
      ['comedies', 'comedy'],
      ['movies', 'movie'],
      ['documentaries', 'documentary'],
      ['witches', 'witch'],
      ['zombies', 'zombie'],
      ['kids', 'kid'],
      ['docs', 'doc'],
    ]) {
      expect(stem(a!), `${a} ${b}`).toBe(stem(b!));
    }
    expect(stem('series')).toBe('series');
    expect(stem('news')).toBe('news');
    expect(stem('glass')).toBe('glass');
  });

  it('makes "stand up", "stand-up" and "standup" one key', () => {
    const key = keyOf(['standup']);
    expect(keyOf(wordsOf('stand-up'))).toBe(key);
    expect(keyOf(wordsOf('stand up'))).toBe(key);
  });

  it('counts a swap of neighbours as one typo and stops early', () => {
    expect(distance('horror', 'horror', 1)).toBe(0);
    expect(distance('horor', 'horror', 1)).toBe(1);
    expect(distance('hrorro', 'horror', 2)).toBe(2);
    expect(distance('ab', 'ba', 1)).toBe(1);
    expect(distance('comedy', 'drama', 1)).toBe(2);
    expect(distance('a', 'abcdef', 2)).toBe(3);
  });
});

describe('understand', () => {
  it('reads genres and their everyday words', () => {
    expect(ids('comedy')).toEqual(['comedy']);
    expect(ids('Comedies')).toEqual(['comedy']);
    expect(ids('scary')).toEqual(['horror']);
    expect(ids('sci-fi')).toEqual(['scifi']);
    expect(ids('scifi')).toEqual(['scifi']);
    expect(ids('science fiction')).toEqual(['scifi']);
    expect(ids('docs')).toEqual(['documentary']);
    expect(ids('reality')).toEqual(['reality']);
    expect(ids('cartoons')).toEqual(['animation']);
  });

  it('reads stand-up however it is written', () => {
    for (const text of ['stand-up', 'standup', 'Stand Up', 'stand up comedy', 'standup comedy']) {
      expect(ids(text), text).toEqual(['standup']);
    }
    expect(understand('stand-up').intents[0]).toMatchObject({
      kind: 'mood',
      label: 'Stand-up comedy',
      genres: ['Comedy'],
      tmdb: { keywords: [9716, 356038, 362573] },
    });
  });

  it('takes types from the words, and drops words that say nothing', () => {
    const horror = understand('scary movies');
    expect(horror.intents.map((intent) => intent.id)).toEqual(['horror']);
    expect(horror.types).toEqual(['movie']);
    expect(understand('the best comedy tv shows').types).toEqual(['series']);
    expect(understand('comedy').types).toBeNull();
    expect(ids('show me some funny films')).toEqual(['comedy']);
  });

  it('forgives a typo in longer words, never in short ones', () => {
    expect(ids('horor')).toEqual(['horror']);
    expect(understand('horor').intents[0]?.typo).toBe(true);
    expect(ids('documentries')).toEqual(['documentary']);
    expect(ids('comdey')).toEqual(['comedy']);
    expect(ids('thriler films')).toEqual(['thriller']);
    // Four letters or fewer must be exact: "wat" is not War, "lov" not Love.
    expect(ids('wat')).toEqual([]);
    expect(ids('lov')).toEqual([]);
  });

  it('understands nothing unless every word is understood', () => {
    // Titles, not genres.
    for (const text of [
      'star wars',
      'stand up guys',
      'family guy',
      'modern family',
      'true detective',
      'world war z',
      'love actually',
      'breaking bad',
      'the witcher',
      'black mirror',
      'new girl',
      'shows like friends',
      'top gun',
    ]) {
      expect(ids(text), text).toEqual([]);
    }
  });

  it('reads years and decades, and keeps years apart for titles', () => {
    expect(understand('2024 films').intents[0]).toMatchObject({ kind: 'year', year: 2024 });
    expect(understand('90s action').intents.map((intent) => intent.id)).toEqual([
      'decade-1990',
      'action',
    ]);
    expect(ids('the nineties')).toEqual(['decade-1990']);
    expect(ids('1980s')).toEqual(['decade-1980']);
    expect(ids('00s')).toEqual(['decade-2000']);
    const dune = understand('Dune 2021');
    expect(dune.intents).toEqual([]);
    expect(dune.years).toEqual([2021]);
    expect(dune.titleWords).toEqual(['dune']);
  });

  it('reads kids words, moods and languages', () => {
    expect(ids('for kids')).toEqual(['family']);
    expect(ids('kids films')).toEqual(['family']);
    expect(ids('true crime')).toEqual(['truecrime']);
    expect(ids('k-drama')).toEqual(['korean']);
    expect(ids('bollywood')).toEqual(['bollywood']);
    expect(ids('new')).toEqual(['new']);
    expect(ids('horror comedy')).toEqual(['horror']);
    expect(ids('romcoms')).toEqual(['romcom']);
  });

  it('reads the genres and catalog names an installed addon brings', () => {
    const phrases = [
      { kind: 'genre', text: 'Mecha' },
      { kind: 'catalog', text: 'Anime Trending', sourceKey: '2-anime-trending' },
    ] as const;
    expect(understand('mecha', phrases).intents[0]).toMatchObject({
      kind: 'genre',
      label: 'Mecha',
      genres: ['Mecha'],
    });
    expect(understand('anime trending', phrases).intents[0]).toMatchObject({
      kind: 'catalog',
      sourceKey: '2-anime-trending',
    });
    // The bundled list keeps its own phrases.
    expect(understand('anime', phrases).intents[0]?.id).toBe('anime');
  });

  it('has a phrase list of about 300 phrases with stable, unique ids', () => {
    const entries = vocabulary();
    const phrases = entries.reduce((sum, entry) => sum + entry.phrases.length, 0);
    expect(phrases).toBeGreaterThan(250);
    expect(phrases).toBeLessThan(400);
    const seen = new Set<string>();
    for (const entry of entries) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(entry.id), entry.id).toBe(false);
      seen.add(entry.id);
    }
    // No phrase means two things.
    const owner = new Map<string, string>();
    for (const entry of entries) {
      for (const phrase of entry.phrases) {
        const key = keyOf(wordsOf(phrase));
        expect(owner.get(key) ?? entry.id, `${phrase} in ${entry.id} and ${owner.get(key)}`).toBe(
          entry.id,
        );
        owner.set(key, entry.id);
      }
    }
  });
});

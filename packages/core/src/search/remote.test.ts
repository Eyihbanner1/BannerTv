import { describe, expect, it } from 'vitest';
import { namesTitle, personFor, planRemote, type RemotePerson } from './remote';
import { understand } from './understand';

const plan = (text: string, kids?: 'U' | 'PG' | '12') =>
  planRemote(understand(text), kids ? { kids } : {});

describe('planRemote', () => {
  it('answers stand-up with the keywords TMDB tags specials by, for films and series', () => {
    const rows = plan('stand-up');
    expect(rows.map((row) => row.key)).toEqual(['tmdb-movie-standup', 'tmdb-series-standup']);
    expect(rows[0]).toMatchObject({
      type: 'movie',
      what: 'Stand-up comedy',
      inline: 'stand-up comedy',
      newest: false,
      kids: false,
      filter: { type: 'movie', keywords: [9716, 356038, 362573] },
    });
    // The keywords say it: the Comedy genre would drop specials not tagged Comedy.
    expect(rows[0]!.filter.genres).toBeUndefined();
    expect(plan('stand up specials series').map((row) => row.type)).toEqual(['series']);
  });

  it('puts what the words mean together into one row a type', () => {
    const [films] = plan('90s korean horror films');
    expect(plan('90s korean horror films')).toHaveLength(1);
    expect(films).toMatchObject({
      what: 'Korean horror',
      inline: 'Korean horror',
      decade: 1990,
      filter: { type: 'movie', genres: [27], language: 'ko', from: 1990, to: 1999 },
    });
    expect(plan('comedy 2024 films')[0]).toMatchObject({
      what: 'Comedy',
      year: 2024,
      filter: { genres: [35], from: 2024, to: 2024 },
    });
    expect(plan('new horror films')[0]).toMatchObject({
      inline: 'horror',
      newest: true,
      filter: { genres: [27], newest: true },
    });
    expect(plan('romcom')).toEqual([]);
    expect(plan('horror comedy')).toEqual([]);
    expect(plan('comedy horror')[0]!.filter.genres).toEqual([35, 27]);
  });

  it('answers languages, countries and decades, which no catalog filters by', () => {
    expect(plan('korean').map((row) => row.filter)).toEqual([
      { type: 'movie', language: 'ko' },
      { type: 'series', language: 'ko' },
    ]);
    expect(plan('bollywood films')[0]!.filter).toEqual({
      type: 'movie',
      language: 'hi',
      country: 'IN',
    });
    expect(plan('nollywood')[0]!.filter.country).toBe('NG');
    const [eighties] = plan('80s films');
    expect(eighties).toMatchObject({ decade: 1980, filter: { from: 1980, to: 1989 } });
    expect(eighties!.what).toBeUndefined();
  });

  it('leaves a genre or a year alone to the catalogs', () => {
    expect(plan('comedy')).toEqual([]);
    expect(plan('scary films')).toEqual([]);
    expect(plan('2024')).toEqual([]);
    expect(plan('new')).toEqual([]);
    expect(plan('family films')).toEqual([]);
    expect(plan('dune')).toEqual([]);
    expect(plan('')).toEqual([]);
  });

  it('asks nothing TMDB cannot say: a genre it has no id for, two keyword moods, a series-only genre in films', () => {
    expect(plan('biography 90s')).toEqual([]);
    expect(plan('heist anime')).toEqual([]);
    expect(plan('reality 90s').map((row) => row.type)).toEqual(['series']);
    expect(plan('reality films 90s')).toEqual([]);
    // Two times or two languages: no one row is both.
    expect(plan('80s 90s action')).toEqual([]);
    expect(plan('korean japanese')).toEqual([]);
  });

  it('reads one meaning said twice as one thing, not two', () => {
    expect(plan('music and musicals')).toEqual(plan('music'));
  });

  it('gives a kids profile family titles within its rating for every understood search', () => {
    const rows = plan('comedy', 'PG');
    expect(rows.map((row) => row.filter)).toEqual([
      { type: 'movie', genres: [35], anyGenres: [10751], certification: 'PG' },
      { type: 'series', genres: [35], anyGenres: [10751, 10762], certification: 'PG' },
    ]);
    expect(rows.every((row) => row.kids)).toBe(true);
    // Family is asked once, as any of the family genres.
    expect(plan('kids films', 'U')[0]!.filter).toEqual({
      type: 'movie',
      anyGenres: [10751],
      certification: 'U',
    });
    expect(plan('dune', 'U')).toEqual([]);
    // A genre not for children: no title of its row could be shown.
    expect(plan('scary', 'PG')).toEqual([]);
    expect(plan('horror films', '12')).toEqual([]);
  });
});

describe('personFor', () => {
  const people: RemotePerson[] = [
    { id: 31, name: 'Tom Hanks', department: 'Acting', knownFor: ['Forrest Gump'] },
    { id: 2, name: 'Tom Hardy', knownFor: [] },
  ];

  it('finds the person the words name, as typed or a typo away', () => {
    expect(personFor('tom hanks', people)?.id).toBe(31);
    expect(personFor('Tom  Hanks!', people)?.id).toBe(31);
    expect(personFor('tom hamks', people)?.id).toBe(31);
    expect(personFor('tom hardy', people)?.id).toBe(2);
    expect(personFor('Zendaya', [{ id: 5, name: 'Zendaya', knownFor: [] }])?.id).toBe(5);
  });

  it('needs more than a first name, or a near miss of one word', () => {
    expect(personFor('tom', people)).toBeUndefined();
    expect(personFor('hanks', people)).toBeUndefined();
    expect(personFor('zendayo', [{ id: 5, name: 'Zendaya', knownFor: [] }])).toBeUndefined();
    expect(personFor('forrest gump', people)).toBeUndefined();
    expect(personFor('', people)).toBeUndefined();
  });

  it('leaves a name that is also a title TMDB found to the title', () => {
    const titles = [{ name: 'Tom Hardy' }];
    expect(personFor('tom hardy', people, titles)).toBeUndefined();
    expect(personFor('tom hanks', people, titles)?.id).toBe(31);
  });
});

describe('namesTitle', () => {
  it('matches the words to a title however they are typed', () => {
    const titles = [{ name: 'Something Like Summer' }, { name: 'Stan & Ollie' }];
    expect(namesTitle('something like summer', titles)).toBe(true);
    expect(namesTitle('Stan and Ollie!', titles)).toBe(true);
    expect(namesTitle('something like', titles)).toBe(false);
    expect(namesTitle('', titles)).toBe(false);
  });
});

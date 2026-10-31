import { describe, expect, it } from 'vitest';
import { HttpError } from '../../http';
import { MAX_CAST, readDetails, readFoundId, readSeason } from './details';
import findMovie from './fixtures/find-movie.json';
import findTv from './fixtures/find-tv.json';
import movie from './fixtures/movie.json';
import season from './fixtures/season.json';
import tv from './fixtures/tv.json';

// The fixtures are TMDB v3 answers cut down to a few entries per list:
// The Dark Knight (a 12A film) and Bluey (a series rated U).

function logo(file_path: string, iso_639_1: string | null, vote_average: number, vote_count = 1) {
  return {
    aspect_ratio: 4,
    height: 300,
    iso_639_1,
    file_path,
    vote_average,
    vote_count,
    width: 1200,
  };
}

function backdrop(
  file_path: string,
  iso_639_1: string | null,
  vote_average: number,
  vote_count = 1,
) {
  return {
    aspect_ratio: 1.778,
    height: 1080,
    iso_639_1,
    file_path,
    vote_average,
    vote_count,
    width: 1920,
  };
}

function release(certification: string, type: number) {
  return {
    certification,
    descriptors: [],
    iso_639_1: '',
    note: '',
    release_date: '2010-01-01T00:00:00.000Z',
    type,
  };
}

const filmWith = (fields: Record<string, unknown>) =>
  readDetails('movie', 155, { ...movie, ...fields });
const seriesWith = (fields: Record<string, unknown>) =>
  readDetails('tv', 82728, { ...tv, ...fields });

describe('readFoundId', () => {
  it('takes the first film for a film and the first series for a series', () => {
    expect(readFoundId('movie', findMovie)).toBe(155);
    expect(readFoundId('tv', findMovie)).toBeUndefined();
    expect(readFoundId('tv', findTv)).toBe(82728);
    expect(readFoundId('movie', findTv)).toBeUndefined();
  });

  it('passes over results without a usable id', () => {
    const answer = { movie_results: [null, { id: '155' }, { id: 0 }, { id: 1.5 }, { id: 272 }] };
    expect(readFoundId('movie', answer)).toBe(272);
    expect(readFoundId('movie', { movie_results: 'none' })).toBeUndefined();
  });

  it('throws on an answer that is not an object', () => {
    expect(() => readFoundId('movie', null)).toThrow(HttpError);
    expect(() => readFoundId('movie', [])).toThrow(HttpError);
  });
});

describe('readDetails', () => {
  it('reads a film with its images, credits and release dates', () => {
    expect(readDetails('movie', 155, movie)).toEqual({
      tmdbId: 155,
      kind: 'movie',
      // The better rated SVG and the logo with no language lose to this PNG.
      logoPath: '/fPDlaSJtuubPOvfOHGu6JkPdUdC.png',
      // The best rated backdrop without text, over a better one with text and backdrop_path.
      backdropPath: '/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg',
      cast: [
        {
          name: 'Christian Bale',
          character: 'Bruce Wayne',
          profilePath: '/7Pxez9J8fuPd2Mn9kex13YALrCQ.jpg',
        },
        {
          name: 'Heath Ledger',
          character: 'Joker',
          profilePath: '/5Y9HnYYa9jF4NunY9lSgJGjSe8E.jpg',
        },
        {
          name: 'Aaron Eckhart',
          character: 'Harvey Dent',
          profilePath: '/u5JjnRMr9zKEVvOP7k3F6gdcwT6.jpg',
        },
        {
          name: 'Michael Caine',
          character: 'Alfred',
          profilePath: '/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg',
        },
        {
          name: 'Maggie Gyllenhaal',
          character: 'Rachel',
          profilePath: '/vOFrDeYXILnj747dOleaNh4jK3l.jpg',
        },
        {
          name: 'Gary Oldman',
          character: 'Gordon',
          profilePath: '/2v9FVVBUrrkW2m3QOcYkuhq9A6o.jpg',
        },
        {
          name: 'Morgan Freeman',
          character: 'Lucius Fox',
          profilePath: '/jPsLqiYGSofU4s6BjrxnefMfabb.jpg',
        },
        {
          name: 'Nestor Carbonell',
          character: 'Mayor',
          profilePath: '/zmBOlJfJ5qxEOu1QWz4Tv1Fcu9F.jpg',
        },
        { name: 'Monique Gabriela Curnen', character: 'Ramirez' },
        { name: 'Ron Dean', character: 'Wuertz', profilePath: '/bqJdFV2VDOzSg8OgtwUfd9EpvCm.jpg' },
        { name: 'Chin Han', character: 'Lau', profilePath: '/nZ2qXQYoWffOoNA4ZkhZV9OxnXN.jpg' },
        {
          name: 'Eric Roberts',
          character: 'Salvatore Maroni',
          profilePath: '/n9BrbWUJ1d2dbcrLyHZSvzgOO8o.jpg',
        },
      ],
      // The UK cinema release's 12A, as the rating kids profiles compare.
      certificate: '12',
      network: 'DC Comics',
      tagline: 'Welcome to a world without rules.',
    });
  });

  it('reads a series with its images, aggregate credits and content ratings', () => {
    expect(readDetails('tv', 82728, tv)).toEqual({
      tmdbId: 82728,
      kind: 'tv',
      logoPath: '/wBhxvwV6QSkJNVAMcVpYBSIL2qh.png',
      backdropPath: '/4vJiAWIDBEmvBNjmmQwHqKyGRTR.jpg',
      cast: [
        {
          name: 'Dave McCormack',
          character: 'Bandit Heeler (voice)',
          profilePath: '/n0VOvM5e3HZ3fS6hVxo3UQpgMvh.jpg',
        },
        {
          name: 'Melanie Zanetti',
          character: 'Chilli Heeler (voice)',
          profilePath: '/tZMfVBVMXeYcZd2jDvX8u57HzMN.jpg',
        },
        { name: 'Brad Elliott', character: 'Uncle Stripe (voice)' },
        { name: 'Uncredited Voice' },
      ],
      certificate: 'U',
      network: 'ABC Kids',
      seasons: [0, 1, 2, 3],
    });
  });

  it('throws on an answer that is not an object', () => {
    expect(() => readDetails('movie', 155, 'Not found')).toThrow(HttpError);
  });

  describe('logo', () => {
    it('takes English logos only', () => {
      const logos = [
        logo('/none.png', null, 9),
        logo('/french.png', 'fr', 9),
        logo('/en.png', 'en', 1),
      ];
      expect(filmWith({ images: { logos } }).logoPath).toBe('/en.png');
      expect(filmWith({ images: { logos: logos.slice(0, 2) } }).logoPath).toBeUndefined();
    });

    it('takes a PNG over a better rated SVG, and an SVG when there is no PNG', () => {
      const logos = [
        logo('/best.svg', 'en', 9),
        logo('/good.png', 'en', 5),
        logo('/poor.png', 'en', 2),
      ];
      expect(filmWith({ images: { logos } }).logoPath).toBe('/good.png');
      expect(filmWith({ images: { logos: logos.slice(0, 1) } }).logoPath).toBe('/best.svg');
    });

    it('settles equal ratings by the vote count, then by TMDB order', () => {
      const counted = [logo('/few.png', 'en', 5, 2), logo('/many.png', 'en', 5, 9)];
      expect(filmWith({ images: { logos: counted } }).logoPath).toBe('/many.png');
      const level = [logo('/first.png', 'en', 5, 2), logo('/second.png', 'en', 5, 2)];
      expect(filmWith({ images: { logos: level } }).logoPath).toBe('/first.png');
    });

    it('passes over logos without a usable path', () => {
      const logos = [
        logo('https://example.com/a.png', 'en', 9),
        logo('', 'en', 9),
        { iso_639_1: 'en', vote_average: 9 },
        logo('/ok.png', 'en', 1),
      ];
      expect(filmWith({ images: { logos } }).logoPath).toBe('/ok.png');
    });
  });

  describe('backdrop', () => {
    it('takes the best rated backdrop without text', () => {
      const backdrops = [
        backdrop('/titled.jpg', 'en', 9),
        backdrop('/plain.jpg', null, 4),
        backdrop('/plainer.jpg', null, 6, 1),
        backdrop('/plainest.jpg', null, 6, 3),
      ];
      expect(filmWith({ images: { backdrops } }).backdropPath).toBe('/plainest.jpg');
    });

    it("falls back to the title's main backdrop, then to none", () => {
      const backdrops = [backdrop('/titled.jpg', 'en', 9)];
      expect(filmWith({ images: { backdrops } }).backdropPath).toBe(movie.backdrop_path);
      expect(filmWith({ images: {}, backdrop_path: null }).backdropPath).toBeUndefined();
    });
  });

  describe('certificate', () => {
    const film = (results: unknown[]) => filmWith({ release_dates: { results } }).certificate;

    it("prefers a film's cinema release, then any release with a certificate", () => {
      const gb = (...releases: unknown[]) => ({ iso_3166_1: 'GB', release_dates: releases });
      expect(film([gb(release('15', 5), release('PG', 3))])).toBe('PG');
      expect(film([gb(release('', 3), release('', 1), release('15', 4))])).toBe('15');
    });

    it("keeps the strictest of the country's ratings beside the one it shows", () => {
      const strictest = (results: unknown[]) =>
        filmWith({ release_dates: { results } }).strictestCertificate;
      const gb = (...releases: unknown[]) => ({ iso_3166_1: 'GB', release_dates: releases });
      const us = { iso_3166_1: 'US', release_dates: [release('R', 3)] };
      // A PG at the cinema and a 15 on disc: Details shows PG, kids go by 15.
      const both = [gb(release('15', 5), release('PG', 3)), us];
      expect(filmWith({ release_dates: { results: both } }).certificate).toBe('PG');
      expect(strictest(both)).toBe('15');
      // One rating, or the strictest shown first: nothing more to keep.
      expect(strictest([gb(release('PG', 3))])).toBeUndefined();
      expect(strictest([gb(release('15', 3), release('PG', 5))])).toBeUndefined();
      // Another country's stricter rating is not the UK's.
      expect(strictest([gb(release('PG', 3)), us])).toBeUndefined();
      const series = seriesWith({
        content_ratings: {
          results: [
            { descriptors: [], iso_3166_1: 'US', rating: 'TV-Y7' },
            { descriptors: [], iso_3166_1: 'US', rating: 'TV-14' },
          ],
        },
      });
      expect(series.certificate).toBe('PG');
      expect(series.strictestCertificate).toBe('15');
    });

    it('reads 12A as 12', () => {
      expect(film([{ iso_3166_1: 'GB', release_dates: [release('12A', 3)] }])).toBe('12');
    });

    it('asks the UK before the US, whatever order TMDB lists them in', () => {
      const us = { iso_3166_1: 'US', release_dates: [release('R', 3)] };
      const gb = { iso_3166_1: 'GB', release_dates: [release('12A', 3)] };
      expect(film([us, gb])).toBe('12');
      expect(film([us])).toBe('15');
      // A UK certificate that is not a rating, and a US film rated PG-13.
      const tbc = { iso_3166_1: 'GB', release_dates: [release('TBC', 3)] };
      expect(film([tbc, { iso_3166_1: 'US', release_dates: [release('PG-13', 3)] }])).toBe('12');
    });

    it('has none when neither country rates the title', () => {
      expect(film([{ iso_3166_1: 'DE', release_dates: [release('16', 3)] }])).toBeUndefined();
      expect(film([{ iso_3166_1: 'US', release_dates: [release('NR', 3)] }])).toBeUndefined();
      expect(filmWith({ release_dates: undefined }).certificate).toBeUndefined();
    });

    it("reads a series' UK rating, else its US one", () => {
      const series = (results: unknown[]) =>
        seriesWith({ content_ratings: { results } }).certificate;
      const us = { descriptors: [], iso_3166_1: 'US', rating: 'TV-PG' };
      expect(series([us, { descriptors: [], iso_3166_1: 'GB', rating: '15' }])).toBe('15');
      expect(series([us, { descriptors: [], iso_3166_1: 'GB', rating: '' }])).toBe('PG');
      expect(series([{ descriptors: [], iso_3166_1: 'AU', rating: 'G' }])).toBeUndefined();
    });
  });

  describe('cast', () => {
    it('keeps the first 12 in billing order', () => {
      const cast = movie.credits.cast.slice().reverse();
      const read = filmWith({ credits: { cast } }).cast;
      expect(read).toHaveLength(MAX_CAST);
      expect(read.map((person) => person.name)).toEqual(
        movie.credits.cast.slice(0, MAX_CAST).map((person) => person.name),
      );
    });

    it('keeps TMDB order for equal billing and drops people without a name', () => {
      const cast = [
        { name: 'Unbilled', character: 'Extra' },
        { name: 'Second', order: 1 },
        { name: '  ', order: 0 },
        { name: 'First', order: 0 },
        { name: 'Also first', order: 0, character: '', profile_path: 'no-slash.jpg' },
      ];
      expect(filmWith({ credits: { cast } }).cast).toEqual([
        { name: 'First' },
        { name: 'Also first' },
        { name: 'Second' },
        { name: 'Unbilled', character: 'Extra' },
      ]);
    });

    it("takes a series' main role from its aggregate credits", () => {
      const cast = [{ name: 'A', roles: [{ character: 'Main' }, { character: 'Other' }] }];
      expect(seriesWith({ aggregate_credits: { cast } }).cast).toEqual([
        { name: 'A', character: 'Main' },
      ]);
      // A series' cast comes from aggregate_credits only.
      expect(seriesWith({ credits: movie.credits, aggregate_credits: undefined }).cast).toEqual([]);
    });
  });

  it("names a film's first production company and a series' first network", () => {
    expect(filmWith({ production_companies: [{ name: '' }, { name: 'Syncopy' }] }).network).toBe(
      'Syncopy',
    );
    expect(filmWith({ production_companies: [] }).network).toBeUndefined();
    expect(seriesWith({ networks: [{ id: 4, name: 'BBC One' }] }).network).toBe('BBC One');
  });

  it('lists the seasons TMDB has, once each and lowest first, for series only', () => {
    const seasons = [{ season_number: 2 }, { season_number: 1 }, { season_number: 2 }, {}];
    expect(seriesWith({ seasons }).seasons).toEqual([1, 2]);
    expect(seriesWith({ seasons: [] }).seasons).toBeUndefined();
    expect(filmWith({ seasons }).seasons).toBeUndefined();
  });
});

describe('readSeason', () => {
  it('reads episodes by number with what each has', () => {
    expect(readSeason(season)).toEqual({
      1: {
        name: 'Magic Xylophone',
        overview: 'Bluey and Bingo fight over a magic xylophone that can freeze their dad.',
        stillPath: '/tIxl4RsQ8dKI2aw4HvDgiqY4V8q.jpg',
      },
      2: {
        name: 'Hospital',
        overview:
          'Bluey and Dad play hospital. Dad is the patient and he has some very odd ailments.',
        stillPath: '/oTSxJ0n7ZxA6Uw5kHUe4D3XchW1.jpg',
      },
      3: { name: 'Keepy Uppy' },
    });
  });

  it('drops episodes without a number or anything to add, and repeats', () => {
    const episodes = [
      null,
      { name: 'No number' },
      { episode_number: -1, name: 'Negative' },
      { episode_number: 4, name: '', overview: ' ', still_path: null },
      { episode_number: 5, name: 'Daddy Robot' },
      { episode_number: 5, name: 'Again' },
    ];
    expect(readSeason({ episodes })).toEqual({ 5: { name: 'Daddy Robot' } });
    expect(readSeason({})).toEqual({});
    expect(() => readSeason(null)).toThrow(HttpError);
  });
});

/**
 * films.json is the one list of demo films: the Worker builds the addon's
 * answers from it, and the media scripts encode and draw what it names. This
 * checks it, so a mistake fails the tests rather than showing on a TV.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILMS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'films.json');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(film, message) {
  throw new Error(`films.json, ${film?.slug ?? 'a film'}: ${message}`);
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
}

/** Throws on the first problem; returns the films otherwise. */
export function checkFilms(data) {
  const films = data?.films;
  if (!Array.isArray(films) || films.length === 0) throw new Error('films.json has no films');
  const slugs = new Set();
  for (const film of films) {
    if (typeof film.slug !== 'string' || !SLUG.test(film.slug))
      fail(film, 'slug must be kebab-case');
    if (slugs.has(film.slug)) fail(film, 'slug is used twice');
    slugs.add(film.slug);
    if (typeof film.name !== 'string' || !film.name.trim()) fail(film, 'name is missing');
    if (!strings(film.logoLines) || film.logoLines.length > 2)
      fail(film, 'logoLines needs 1 or 2 lines');
    if (!Number.isInteger(film.year) || film.year < 1990) fail(film, 'year is wrong');
    if (!Number.isInteger(film.durationSeconds) || film.durationSeconds <= 0) {
      fail(film, 'durationSeconds must be a whole number of seconds');
    }
    if (!strings(film.genres) || film.genres.length === 0) fail(film, 'genres are missing');
    if (!strings(film.director) || film.director.length === 0) fail(film, 'director is missing');
    if (!Array.isArray(film.cast) || !film.cast.every((name) => typeof name === 'string')) {
      fail(film, 'cast must be a list');
    }
    // The hero clamps the description to three lines and Details to six.
    if (typeof film.description !== 'string' || film.description.length < 40) {
      fail(film, 'description is missing');
    }
    if (film.description.length > 260) fail(film, 'description is too long for the hero');
    if (typeof film.credit !== 'string' || !film.credit.trim())
      fail(film, 'credit line is missing');
    const licence = film.licence;
    if (!licence || !/^CC BY(-SA)? \d\.\d$/.test(licence.name ?? '')) {
      fail(film, 'licence must be CC BY or CC BY-SA (no NC or ND)');
    }
    if (!isHttps(licence.url) || !licence.url.includes('creativecommons.org/licenses/')) {
      fail(film, 'licence url must be the Creative Commons deed');
    }
    if (!isHttps(film.website)) fail(film, 'website must be https');
    const source = film.source;
    if (!source || !Number.isInteger(source.fps) || source.fps < 23 || source.fps > 30) {
      fail(film, 'source.fps must be the film frame rate');
    }
    if (!Array.isArray(source.urls) || source.urls.length === 0 || !source.urls.every(isHttps)) {
      fail(film, 'source.urls must be https addresses');
    }
    if (!Number.isInteger(film.media) || film.media < 1) fail(film, 'media must be 1 or more');
    const art = film.art;
    if (!art) fail(film, 'art is missing');
    for (const key of ['background', 'poster']) {
      const at = art[key];
      if (at !== null && (typeof at !== 'number' || at < 0 || at >= film.durationSeconds)) {
        fail(film, `art.${key} must be null or a time in the film, in seconds`);
      }
    }
    if (typeof art.posterFocus !== 'number' || art.posterFocus < 0 || art.posterFocus > 1) {
      fail(film, 'art.posterFocus must be between 0 (left) and 1 (right)');
    }
  }
  return films;
}

export function loadFilms(file = FILMS_FILE) {
  return checkFilms(JSON.parse(readFileSync(file, 'utf8')));
}

/** Where a film's files live under public/, relative to the site root. */
export function mediaPath(film) {
  return `media/${film.slug}/v${film.media}`;
}

/** Artwork is not versioned: it is small, and cached for a day only. */
export function artPath(film) {
  return `art/${film.slug}`;
}

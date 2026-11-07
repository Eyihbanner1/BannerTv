import { describeStream, type StreamEntry } from '@bannertv/core';
import { parseStream } from '@bannertv/protocol';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import {
  filterButtonLabel,
  filterChoices,
  filteredStatus,
  filterKey,
  filterStreams,
  MAX_LANGUAGES,
  NO_FILTER,
  readFilterKey,
  readStreamFilter,
  resolutionGroup,
  shownStreams,
} from './stream-filter';

const t = i18next.getFixedT('en');

beforeAll(async () => {
  await i18next.init({
    resources: { en: { translation: en } },
    lng: 'en',
    interpolation: { escapeValue: false },
  });
});

let made = 0;

/** A stream as an addon would send it, read as the finder reads it. */
function entry(description: string, addonId = 'torrentio', addonRank = 0): StreamEntry {
  const stream = parseStream({
    url: `https://media.example.com/${made}.mkv`,
    name: 'Test',
    description,
  })!;
  return {
    stream,
    addonId,
    addonRank,
    rank: made++,
    facts: describeStream(stream),
    assessment: { action: { kind: 'play' }, warnings: [] },
  };
}

const titles = (entries: readonly StreamEntry[]) =>
  entries.map((e) => e.stream.description?.split('\n')[0]);

describe('resolutionGroup', () => {
  it('puts 576p and below in SD, 1440p with 1080p, and leaves an unknown size out', () => {
    expect(resolutionGroup('2160p')).toBe('2160p');
    expect(resolutionGroup('1440p')).toBe('1080p');
    expect(resolutionGroup('1080p')).toBe('1080p');
    expect(resolutionGroup('720p')).toBe('720p');
    expect(resolutionGroup('576p')).toBe('sd');
    expect(resolutionGroup('480p')).toBe('sd');
    expect(resolutionGroup('360p')).toBe('sd');
    expect(resolutionGroup(undefined)).toBeUndefined();
  });
});

describe('filterStreams', () => {
  const list = [
    entry('Film 2160p REMUX\n⚡ Cached'),
    entry('Film 1080p WEB-DL\n⚡ Cached'),
    entry('Film 1080p BluRay 🇪🇸'),
    entry('Film 720p WEBRip', 'comet', 1),
    entry('Film 480p DVDRip 🇫🇷', 'comet', 1),
    entry('Film WEB-DL'),
    entry('Film 1080p MULTi 🇫🇷'),
  ];

  it('keeps the order given, and everything with no filter', () => {
    expect(filterStreams(list, NO_FILTER)).toEqual(list);
    expect(titles(filterStreams(list, { resolution: '1080p' }))).toEqual([
      'Film 1080p WEB-DL',
      'Film 1080p BluRay 🇪🇸',
      'Film 1080p MULTi 🇫🇷',
    ]);
  });

  it('passes no size filter with an unknown size', () => {
    for (const resolution of ['2160p', '1080p', '720p', 'sd'] as const) {
      expect(titles(filterStreams(list, { resolution }))).not.toContain('Film WEB-DL');
    }
    expect(titles(filterStreams(list, { resolution: 'sd' }))).toEqual(['Film 480p DVDRip 🇫🇷']);
  });

  it('counts only a stream that says it is cached', () => {
    expect(titles(filterStreams(list, { cached: true }))).toEqual([
      'Film 2160p REMUX',
      'Film 1080p WEB-DL',
    ]);
  });

  it('keeps one addon', () => {
    expect(titles(filterStreams(list, { addonId: 'comet' }))).toEqual([
      'Film 720p WEBRip',
      'Film 480p DVDRip 🇫🇷',
    ]);
  });

  it('takes a stream that names no language, or says MULTi, as English', () => {
    expect(titles(filterStreams(list, { language: 'en' }))).toEqual([
      'Film 2160p REMUX',
      'Film 1080p WEB-DL',
      'Film 720p WEBRip',
      'Film WEB-DL',
      'Film 1080p MULTi 🇫🇷',
    ]);
    expect(titles(filterStreams(list, { language: 'es' }))).toEqual(['Film 1080p BluRay 🇪🇸']);
    expect(titles(filterStreams(list, { language: 'fr' }))).toEqual([
      'Film 480p DVDRip 🇫🇷',
      'Film 1080p MULTi 🇫🇷',
    ]);
  });

  it('needs every part of the filter at once', () => {
    expect(titles(filterStreams(list, { resolution: '1080p', cached: true }))).toEqual([
      'Film 1080p WEB-DL',
    ]);
    expect(filterStreams(list, { resolution: '2160p', addonId: 'comet' })).toEqual([]);
  });
});

describe('shownStreams', () => {
  const list = [entry('Film 1080p WEB-DL'), entry('Film 720p WEBRip')];

  it('shows every stream, and says so, when the filter matches none', () => {
    expect(shownStreams(list, { resolution: '2160p' })).toEqual({ entries: list, missed: true });
    expect(shownStreams([], { resolution: '2160p' })).toEqual({ entries: [], missed: false });
    expect(shownStreams(list, NO_FILTER)).toEqual({ entries: list, missed: false });
    expect(shownStreams(list, { resolution: '720p' })).toEqual({
      entries: [list[1]],
      missed: false,
    });
  });

  it('keeps the streams asked for in their places, which alone are not a match', () => {
    const playing = list[0]!;
    expect(shownStreams(list, { resolution: '720p' }, (e) => e === playing).entries).toEqual(list);
    expect(shownStreams(list, { resolution: '2160p' }, (e) => e === playing)).toEqual({
      entries: list,
      missed: true,
    });
  });
});

describe('filterChoices', () => {
  it('offers only what the streams have, with counts, and addons by name in the collection’s order', () => {
    const list = [
      entry('Film 1080p\n⚡ Cached', 'comet', 1),
      entry('Film 2160p 🇪🇸'),
      entry('Film 1080p 🇪🇸 🇫🇷', 'comet', 1),
      entry('Film 1440p'),
    ];
    const choices = filterChoices(list, new Map([['torrentio', 'Torrentio']]));
    expect(choices.resolutions).toEqual([
      { value: '2160p', count: 1 },
      { value: '1080p', count: 3 },
    ]);
    expect(choices.cached).toBe(1);
    expect(choices.addons).toEqual([
      { id: 'torrentio', name: 'Torrentio', count: 2 },
      { id: 'comet', name: 'comet', count: 2 },
    ]);
    expect(choices.languages).toEqual([
      { code: 'es', count: 2 },
      { code: 'en', count: 2 },
      { code: 'fr', count: 1 },
    ]);
  });

  it('offers no language when none is named, and at most the most common ones', () => {
    expect(filterChoices([entry('Film 1080p'), entry('Film 720p')]).languages).toEqual([]);
    const flags = ['🇪🇸', '🇫🇷', '🇩🇪', '🇮🇹', '🇵🇹', '🇷🇺', '🇯🇵', '🇰🇷', '🇳🇱', '🇵🇱'];
    const list = flags.map((flag) => entry(`Film 1080p ${flag}`));
    list.push(entry('Film 1080p 🇵🇱'));
    const languages = filterChoices(list).languages;
    expect(languages).toHaveLength(MAX_LANGUAGES);
    expect(languages[0]).toEqual({ code: 'pl', count: 2 });
    // English, which no stream has here, is not offered.
    expect(languages.map((l) => l.code)).not.toContain('en');
  });

  it('still offers what the filter has now, at nought', () => {
    const choices = filterChoices([entry('Film 1080p')], new Map(), {
      resolution: 'sd',
      addonId: 'gone',
      language: 'es',
    });
    expect(choices.resolutions).toEqual([
      { value: '1080p', count: 1 },
      { value: 'sd', count: 0 },
    ]);
    expect(choices.addons[1]).toEqual({ id: 'gone', name: 'gone', count: 0 });
    expect(choices.languages).toEqual([{ code: 'es', count: 0 }]);
  });
});

describe('stored filters', () => {
  it('reads each field on its own, so one bad value never loses the rest', () => {
    expect(
      readStreamFilter({ resolution: '1080p', cached: 'yes', addonId: 'comet', language: 'eng' }),
    ).toEqual({ resolution: '1080p', addonId: 'comet' });
    expect(readStreamFilter({ resolution: '4k', cached: true, language: 'es' })).toEqual({
      cached: true,
      language: 'es',
    });
    expect(readStreamFilter(null)).toBe(NO_FILTER);
    expect(readStreamFilter([1])).toBe(NO_FILTER);
    expect(readStreamFilter({ addonId: ' ' })).toBe(NO_FILTER);
  });

  it('writes one key for one filter, whatever order its fields came in', () => {
    expect(filterKey(NO_FILTER)).toBe('{}');
    expect(filterKey({ language: 'es', resolution: '720p' })).toBe(
      filterKey({ resolution: '720p', language: 'es' }),
    );
    expect(readFilterKey(filterKey({ resolution: '720p', cached: true }))).toEqual({
      resolution: '720p',
      cached: true,
    });
    expect(readFilterKey('{')).toBe(NO_FILTER);
    expect(readFilterKey(3)).toBe(NO_FILTER);
  });
});

describe('the words', () => {
  const names = new Map([['torrentio', 'Torrentio']]);

  it('says on the button what is on', () => {
    expect(filterButtonLabel(t, NO_FILTER, names)).toBe('Filter: none');
    expect(filterButtonLabel(t, { resolution: '1080p', cached: true }, names)).toBe(
      'Filter: 1080p, cached',
    );
    expect(
      filterButtonLabel(t, { resolution: '2160p', addonId: 'torrentio', language: 'es' }, names),
    ).toBe('Filter: 4K, Torrentio, Spanish');
    expect(filterButtonLabel(t, { resolution: 'sd' }, names)).toBe('Filter: SD');
  });

  it('counts the streams shown of all of them', () => {
    const list = [entry('Film 1080p'), entry('Film 720p'), entry('Film 480p')];
    const settled = { pending: 0, failed: [] };
    expect(filteredStatus(t, settled, shownStreams(list, { resolution: '720p' }), 3)).toBe(
      '1 of 3 streams',
    );
    expect(filteredStatus(t, settled, shownStreams(list, NO_FILTER), 3)).toBe('3 streams');
    expect(filteredStatus(t, settled, shownStreams(list, { resolution: '2160p' }), 3)).toBe(
      'No stream matches the filter, so all are shown.',
    );
    expect(
      filteredStatus(t, { pending: 1, failed: [] }, shownStreams(list, { resolution: '720p' }), 3),
    ).toBe('Asking 1 addon…');
  });
});

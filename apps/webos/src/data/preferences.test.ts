import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, readPreferences } from './preferences';

describe('readPreferences', () => {
  it('starts from the defaults', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('not json')).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences('[1,2]')).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps every valid value and replaces only the bad ones', () => {
    const prefs = readPreferences(
      JSON.stringify({
        streamChoice: 'fast',
        probing: 'sometimes',
        allStreamsOrder: 'addon',
        audioLanguage: 'fre',
        subtitleLanguage: null,
        subtitleStyle: { size: 'huge', colour: 'pink', background: 'box' },
        tmdb: 'yes',
        stillWatching: 'no',
      }),
    );
    expect(prefs).toEqual({
      streamChoice: 'fast',
      probing: 'auto',
      allStreamsOrder: 'addon',
      streamFilter: {},
      audioLanguage: 'fre',
      subtitleLanguage: null,
      subtitleStyle: { size: 'huge', colour: 'white', background: 'box', position: 'bottom' },
      tmdb: true,
      stillWatching: true,
    });
  });

  it('keeps TMDB turned off', () => {
    expect(readPreferences(JSON.stringify({ tmdb: false })).tmdb).toBe(false);
  });

  it('keeps "Still watching?" turned off', () => {
    expect(readPreferences(JSON.stringify({ stillWatching: false })).stillWatching).toBe(false);
  });

  it('keeps the stream filter part by part, and none when it is not one', () => {
    const read = (streamFilter: unknown) =>
      readPreferences(JSON.stringify({ streamFilter, tmdb: false }));
    expect(read({ resolution: '1080p', cached: true, language: 'Spanish' })).toMatchObject({
      streamFilter: { resolution: '1080p', cached: true },
      tmdb: false,
    });
    expect(read('1080p').streamFilter).toEqual({});
    expect(read({ addonId: 'org.example' }).streamFilter).toEqual({ addonId: 'org.example' });
  });

  it('treats an empty language as not chosen', () => {
    expect(readPreferences(JSON.stringify({ subtitleLanguage: '  ' })).subtitleLanguage).toBe(null);
  });
});

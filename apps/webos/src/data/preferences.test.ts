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
      }),
    );
    expect(prefs).toEqual({
      streamChoice: 'fast',
      probing: 'auto',
      allStreamsOrder: 'addon',
      audioLanguage: 'fre',
      subtitleLanguage: null,
      subtitleStyle: { size: 'huge', colour: 'white', background: 'box', position: 'bottom' },
      tmdb: true,
    });
  });

  it('keeps TMDB turned off', () => {
    expect(readPreferences(JSON.stringify({ tmdb: false })).tmdb).toBe(false);
  });

  it('treats an empty language as not chosen', () => {
    expect(readPreferences(JSON.stringify({ subtitleLanguage: '  ' })).subtitleLanguage).toBe(null);
  });
});

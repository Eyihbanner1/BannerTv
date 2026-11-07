import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackMemory } from './library';
import { preferences, setPreference } from './preferences';
import {
  chooseAudioLanguage,
  chooseSubtitleLanguage,
  heardLanguages,
  wantedAudio,
  wantedSubtitle,
} from './tracks';

afterEach(() => {
  setPreference('audioLanguage', null);
  setPreference('subtitleLanguage', null);
  setPreference('subtitleWhen', 'always');
  setPreference('learnLanguages', false);
});

describe('languages chosen in the player', () => {
  it("stay with the title, and leave the profile's own alone", async () => {
    setPreference('subtitleLanguage', 'en');
    chooseSubtitleLanguage('tt-foreign', 'fr');
    chooseAudioLanguage('tt-foreign', 'jpn');
    await vi.waitFor(() => expect(wantedAudio('tt-foreign')).toBe('jpn'));
    expect(preferences.get()).toMatchObject({ subtitleLanguage: 'en', audioLanguage: null });
    expect(wantedSubtitle('tt-foreign')).toBe('fr');
    expect(wantedAudio('tt-foreign')).toBe('jpn');
    expect(wantedSubtitle('tt-next')).toBe('en');
    expect(wantedAudio('tt-next')).toBeNull();
  });

  it('become the profile’s own too with "Use player choices for every title"', () => {
    setPreference('learnLanguages', true);
    chooseSubtitleLanguage('tt-learnt', null);
    chooseAudioLanguage(undefined, 'spa');
    expect(preferences.get()).toMatchObject({ subtitleLanguage: null, audioLanguage: 'spa' });
  });
});

describe('subtitles only when the audio is in another language', () => {
  it('shows them for audio in another language, and not for audio in theirs or unknown', async () => {
    setPreference('subtitleLanguage', 'eng');
    setPreference('subtitleWhen', 'foreign');
    expect(wantedSubtitle('tt-a', ['fre'])).toBe('eng');
    expect(wantedSubtitle('tt-a', ['en-GB'])).toBeNull();
    expect(wantedSubtitle('tt-a', [])).toBeNull();
    // A choice made for the title still wins.
    await trackMemory.rememberSubtitle('tt-b', 'eng');
    expect(wantedSubtitle('tt-b', ['en'])).toBe('eng');
  });

  it('hears the playing track, else what the stream names', () => {
    const entry = { facts: { hdr: [], audio: [], languages: ['multi', 'es'] } };
    expect(heardLanguages([{ lang: 'jpn', active: true }], entry)).toEqual(['jpn']);
    expect(heardLanguages([{ lang: 'und', active: true }], entry)).toEqual(['es']);
    expect(heardLanguages([], null)).toEqual([]);
  });
});

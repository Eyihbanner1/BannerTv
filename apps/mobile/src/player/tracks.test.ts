import { toEngineTrack } from '@tv/player/engines/android';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import { describe, expect, it } from 'vitest';
import { toAndroidTrack } from './tracks';

/** A track as expo-video gives it on Android: the language's own name as its label. */
const subtitle = (id: string, name: string | undefined): SubtitleTrack => ({
  id,
  language: 'en',
  label: 'English',
  name,
  isDefault: false,
  autoSelect: false,
});

describe('the phone’s tracks for the Android bridge', () => {
  it('names a subtitle track by its title in the stream, so one of forced lines only is known', () => {
    const forced = subtitle('2', 'Forced');
    const full = subtitle('3', 'Full');
    const sent = [forced, full].map((track, index) => toAndroidTrack('t', track, index, full));
    expect(sent.map((track) => track.label)).toEqual(['Forced', 'Full']);
    expect(sent.map((track) => track.active)).toEqual([false, true]);
    // The player passes the forced one over while a full one in the language is there.
    expect(sent.map((track) => !!toEngineTrack(track, false).forced)).toEqual([true, false]);
  });

  it('falls back to the language’s name, and keeps an audio track’s label first', () => {
    expect(toAndroidTrack('t', subtitle('4', undefined), 0, null).label).toBe('English');
    const audio = { ...subtitle('5', 'Commentary'), label: 'English' } as AudioTrack;
    expect(toAndroidTrack('a', audio, 0, null)).toMatchObject({ id: 'a:5', label: 'English' });
  });
});

import type { AndroidTrack } from '@tv/platform/android';
import type { AudioTrack, SubtitleTrack } from 'expo-video';

/**
 * expo-video's tracks as the Android bridge sends them (the TV app's PlayerController.kt).
 *
 * On Android expo-video gives each track two names: `label` is the language's own name, made
 * from its code ("English"), and `name` is the title the stream gives it ("Forced", "English
 * SDH"). The TV app sends the stream's title, which is how a subtitle track of forced lines only
 * is known (`isForcedName`), so a subtitle track goes by its `name` first. expo-video does not
 * say when the stream marks a track forced, so one whose title does not say so is taken for a
 * full track (ADR 0007).
 */

/** A track's id for the bridge: its group's prefix and expo-video's id, or its place. */
export function trackId(prefix: string, track: AudioTrack | SubtitleTrack, index: number): string {
  return `${prefix}:${track.id ?? index}`;
}

/** Whether `track` is the one playing. */
export function sameTrack(
  track: AudioTrack | SubtitleTrack,
  active: AudioTrack | SubtitleTrack | null,
): boolean {
  if (!active) return false;
  if (track.id !== undefined || active.id !== undefined) return track.id === active.id;
  return track.language === active.language && track.label === active.label;
}

/** An audio track (prefix 'a') or a subtitle track ('t'), as the bridge sends it. */
export function toAndroidTrack(
  prefix: 'a' | 't',
  track: AudioTrack | SubtitleTrack,
  index: number,
  active: AudioTrack | SubtitleTrack | null,
): AndroidTrack {
  const label = prefix === 't' ? track.name || track.label : track.label || track.name;
  return {
    id: trackId(prefix, track, index),
    lang: track.language || 'und',
    label: label || '',
    active: sameTrack(track, active),
    supported: true,
  };
}

import { createStore, MAIN_PROFILE_ID, type StreamOrder } from '@bannertv/core';
import { activeProfileId } from './profiles';

export type SubtitleSize = 'small' | 'medium' | 'large' | 'huge';
export type SubtitleColour = 'white' | 'yellow' | 'cyan' | 'green';
/** outline: letters edged in black, no box. shadow: a soft drop shadow. box: a translucent box. solid: an opaque box. */
export type SubtitleBackground = 'outline' | 'shadow' | 'box' | 'solid';
export type SubtitlePosition = 'bottom' | 'raised' | 'top';

export interface SubtitleStyle {
  size: SubtitleSize;
  colour: SubtitleColour;
  background: SubtitleBackground;
  position: SubtitlePosition;
}

export interface Preferences {
  /** What auto-play looks for first. */
  streamChoice: Exclude<StreamOrder, 'addon'>;
  /**
   * Testing links before playing. auto: on, except on webOS 5 TVs until it
   * has been measured on one (docs/PLAN.md, auto-play).
   */
  probing: 'auto' | 'on' | 'off';
  /** The order of the All streams list. */
  allStreamsOrder: StreamOrder;
  /** Learned from the last audio track chosen. Null: the stream's default. */
  audioLanguage: string | null;
  /** Learned from the last subtitles chosen. Null: subtitles off. */
  subtitleLanguage: string | null;
  subtitleStyle: SubtitleStyle;
}

export const DEFAULT_PREFERENCES: Preferences = {
  streamChoice: 'quality',
  probing: 'auto',
  allStreamsOrder: 'quality',
  audioLanguage: null,
  subtitleLanguage: null,
  subtitleStyle: { size: 'medium', colour: 'white', background: 'outline', position: 'bottom' },
};

// Small and needed before the first stream is picked, so localStorage like the welcome flag.
// Main keeps the key it had before profiles (ADR 0004, item 1).
const KEY = 'bannertv.preferences';

function keyFor(profileId: string): string {
  return profileId === MAIN_PROFILE_ID ? KEY : `${KEY}.${profileId}`;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.indexOf(value as T) !== -1 ? (value as T) : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/** Reads stored preferences field by field, so one bad value never loses the rest. */
export function readPreferences(raw: string | null): Preferences {
  const d = DEFAULT_PREFERENCES;
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const style =
    typeof stored.subtitleStyle === 'object' && stored.subtitleStyle !== null
      ? (stored.subtitleStyle as Record<string, unknown>)
      : {};
  return {
    streamChoice: pick(stored.streamChoice, ['quality', 'fast'] as const, d.streamChoice),
    probing: pick(stored.probing, ['auto', 'on', 'off'] as const, d.probing),
    allStreamsOrder: pick(
      stored.allStreamsOrder,
      ['quality', 'fast', 'addon'] as const,
      d.allStreamsOrder,
    ),
    audioLanguage: nullableString(stored.audioLanguage, d.audioLanguage),
    subtitleLanguage: nullableString(stored.subtitleLanguage, d.subtitleLanguage),
    subtitleStyle: {
      size: pick(style.size, ['small', 'medium', 'large', 'huge'] as const, d.subtitleStyle.size),
      colour: pick(
        style.colour,
        ['white', 'yellow', 'cyan', 'green'] as const,
        d.subtitleStyle.colour,
      ),
      background: pick(
        style.background,
        ['outline', 'shadow', 'box', 'solid'] as const,
        d.subtitleStyle.background,
      ),
      position: pick(
        style.position,
        ['bottom', 'raised', 'top'] as const,
        d.subtitleStyle.position,
      ),
    },
  };
}

function load(profileId: string | null): Preferences {
  if (profileId === null) return DEFAULT_PREFERENCES;
  try {
    return readPreferences(localStorage.getItem(keyFor(profileId)));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** The preferences of the profile in use: the defaults until someone is chosen. */
export const preferences = createStore<Preferences>(load(activeProfileId.get()));

// Read when the picker has an answer; nothing reads preferences before then.
activeProfileId.subscribe(() => preferences.set(load(activeProfileId.get())));

preferences.subscribe(() => {
  const profileId = activeProfileId.get();
  if (profileId === null) return;
  try {
    localStorage.setItem(keyFor(profileId), JSON.stringify(preferences.get()));
  } catch {
    // Without storage the choices last until the app closes.
  }
});

/** Forgets a deleted profile's preferences. */
export function deletePreferences(profileId: string): void {
  if (profileId === MAIN_PROFILE_ID) return;
  try {
    localStorage.removeItem(keyFor(profileId));
  } catch {
    // Nothing was saved, then.
  }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  preferences.set((current) => (current[key] === value ? current : { ...current, [key]: value }));
}

export function setSubtitleStyle<K extends keyof SubtitleStyle>(
  key: K,
  value: SubtitleStyle[K],
): void {
  preferences.set((current) =>
    current.subtitleStyle[key] === value
      ? current
      : { ...current, subtitleStyle: { ...current.subtitleStyle, [key]: value } },
  );
}

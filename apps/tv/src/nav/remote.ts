export type RemoteKey =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'select'
  | 'playPause'
  | 'play'
  | 'pause'
  | 'rewind'
  | 'fastForward'
  | 'next'
  | 'previous'
  | 'info'
  | 'menu';

const KEYS = new Set<string>([
  'left',
  'right',
  'up',
  'down',
  'select',
  'playPause',
  'play',
  'pause',
  'rewind',
  'fastForward',
  'next',
  'previous',
  'info',
  'menu',
]);

/** Held keys that repeat: Android sends one of these about every 300 ms while the key is down. */
const HELD: Record<string, RemoteKey> = {
  longLeft: 'left',
  longRight: 'right',
  longRewind: 'rewind',
  longFastForward: 'fastForward',
};

const KEY_DOWN = 0;

/**
 * What React Native for TV hands a TV event handler. Its key action is a number on Android,
 * though typed as text.
 */
export interface RemoteEvent {
  eventType: string;
  eventKeyAction?: string | number | undefined;
}

/**
 * The key a remote event stands for, once per press. React Native for TV sends a press as its
 * key up on Android, and a held key as repeated "long" key downs followed by one key up, which
 * is dropped here so a hold doesn't count once more as it ends.
 */
export function remoteKey(event: RemoteEvent): {
  key: RemoteKey;
  held: boolean;
} | null {
  const down = event.eventKeyAction !== undefined && Number(event.eventKeyAction) === KEY_DOWN;
  const held = HELD[event.eventType];
  if (held) return down ? { key: held, held: true } : null;
  if (!KEYS.has(event.eventType) || down) return null;
  return { key: event.eventType as RemoteKey, held: false };
}

/**
 * What new-episode alerts keep on the phone: which profiles have them on, and the alerts the
 * phone has scheduled, so that no episode is alerted twice. Both are this phone's own, like
 * match reminders: never synced, since the notifications are this phone's. Pure, so it is
 * unit-tested; episode-alerts-on.ts hands it the phone's storage.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The profiles with alerts on, by id. Off unless the person switched them on. */
export const ALERTS_ON_KEY = 'bannertv.phone.episodeAlerts';
/** The alerts scheduled, those whose time has come included. */
export const ALERTS_SENT_KEY = 'bannertv.phone.episodeAlertsSent';
/**
 * How long an alert that came is remembered: longer than the three weeks ahead an alert can be
 * scheduled, so an episode whose date moves after its alert came gets no second one.
 */
export const SENT_KEEP_MS = 60 * DAY;
/** At most this many remembered, the latest kept. */
export const MAX_SENT = 300;

/** The part of Web Storage these need. */
export interface AlertStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parse(raw: string | null): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** The profiles with alerts on, read field by field: anything else is none. */
export function readAlertProfiles(raw: string | null): string[] {
  const saved = parse(raw);
  if (!Array.isArray(saved)) return [];
  const ids: string[] = [];
  for (const id of saved) {
    if (typeof id === 'string' && id !== '' && ids.indexOf(id) === -1) ids.push(id);
  }
  return ids;
}

/** The profile in use, as the TV's activeProfileId store. */
export interface ProfileSource {
  get(): string | null;
  subscribe(listener: () => void): () => void;
}

/** The switch for the profile in use: off until someone is chosen. */
export interface AlertSwitch {
  get(): boolean;
  /** Ignored until someone is chosen. */
  set(on: boolean): void;
  subscribe(listener: () => void): () => void;
}

/**
 * The Settings switch, for whichever profile is in use, read from `storage` once and saved
 * there on each change. `known` gives the profiles there are, so one deleted since drops out
 * of the list the next time it is saved.
 */
export function alertSwitchStore(
  storage: AlertStorage,
  profile: ProfileSource,
  known: () => readonly string[] = () => [],
): AlertSwitch {
  let ids: string[] = [];
  try {
    ids = readAlertProfiles(storage.getItem(ALERTS_ON_KEY));
  } catch {
    // Without storage every profile starts with alerts off.
  }
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  return {
    get() {
      const id = profile.get();
      return id !== null && ids.indexOf(id) !== -1;
    },
    set(on) {
      const id = profile.get();
      if (id === null || (ids.indexOf(id) !== -1) === on) return;
      const there = known();
      ids = ids.filter(
        (other) => other !== id && (there.length === 0 || there.indexOf(other) !== -1),
      );
      if (on) ids.push(id);
      try {
        storage.setItem(ALERTS_ON_KEY, JSON.stringify(ids));
      } catch {
        // Then the choice lasts until the app closes.
      }
      tell();
    },
    subscribe(listener) {
      listeners.add(listener);
      // Someone chosen at launch reads their own switch.
      const stop = profile.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
  };
}

/** One alert the phone scheduled: its series and day, its time, and the episodes it tells of. */
export interface SentAlert {
  key: string;
  at: number;
  videos: string[];
}

/** The alerts remembered, read field by field, so one bad entry never loses the rest. */
export function readSent(raw: string | null): SentAlert[] {
  const saved = parse(raw);
  if (!Array.isArray(saved)) return [];
  const sent: SentAlert[] = [];
  for (const entry of saved as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, at, videos } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (!Array.isArray(videos)) continue;
    sent.push({ key, at, videos: videos.filter((id): id is string => typeof id === 'string') });
  }
  return sent;
}

/** The episodes alerted for already: those of alerts whose time has come. */
export function sentVideos(sent: readonly SentAlert[], now: number): Set<string> {
  const videos = new Set<string>();
  for (const alert of sent) {
    if (alert.at <= now) alert.videos.forEach((video) => videos.add(video));
  }
  return videos;
}

/**
 * What to remember after a pass: the alerts that came in the last SENT_KEEP_MS, and those
 * scheduled now. One still to come that the pass did not schedule again was cancelled, so it is
 * forgotten and its episodes can have an alert later.
 */
export function recordSent(
  sent: readonly SentAlert[],
  scheduled: readonly SentAlert[],
  now: number,
): SentAlert[] {
  const kept = sent.filter((alert) => alert.at <= now && now - alert.at < SENT_KEEP_MS);
  for (const alert of scheduled) {
    if (kept.some((other) => other.key === alert.key && other.at === alert.at)) continue;
    kept.push({ key: alert.key, at: alert.at, videos: alert.videos.slice() });
  }
  kept.sort((a, b) => a.at - b.at);
  return kept.slice(Math.max(0, kept.length - MAX_SENT));
}

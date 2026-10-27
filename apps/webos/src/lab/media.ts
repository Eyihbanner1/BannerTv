/**
 * Helpers for the playback lab (Phase 0 spikes 2 and 3). Pure functions, tested off-device.
 */

export function guessMimeType(url: string): string {
  const path = (url.split(/[?#]/)[0] ?? '').toLowerCase();
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.mpd')) return 'application/dash+xml';
  if (path.endsWith('.mkv')) return 'video/x-matroska';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.ts') || path.endsWith('.m2ts')) return 'video/mp2t';
  return 'video/mp4';
}

/**
 * The `type` attribute that hands a start position to the webOS media pipeline,
 * so the TV starts there instead of seeking after load.
 *
 * Source: https://webostv.developer.lge.com/develop/guides/mediaoption-parameter
 */
export function buildMediaOptionType(mime: string, startMs: number): string {
  const options = { option: { transmission: { playTime: { start: Math.round(startMs) } } } };
  return `${mime};mediaOption=${encodeURI(JSON.stringify(options))}`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Media error codes from the HTML spec, as words. */
export function describeMediaError(code: number): string {
  switch (code) {
    case 1:
      return 'aborted';
    case 2:
      return 'network';
    case 3:
      return 'decode';
    case 4:
      return 'source not supported';
    default:
      return `code ${code}`;
  }
}

// AudioTrackList and VideoTrackList are not in TypeScript's DOM types, and the
// whole point of spike 2 is to find out whether webOS exposes them.
export interface MediaTrackLike {
  id: string;
  kind: string;
  label: string;
  language: string;
  enabled?: boolean;
  selected?: boolean;
}

export interface MediaTrackListLike {
  readonly length: number;
  [index: number]: MediaTrackLike;
  addEventListener?(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
}

export interface TrackInfo {
  index: number;
  label: string;
  language: string;
  kind: string;
  active: boolean;
}

export function listTracks<T extends { label: string; language: string; kind: string }>(
  list: { readonly length: number; [index: number]: T } | undefined,
  isActive: (track: T) => boolean,
): TrackInfo[] {
  if (!list) return [];
  const tracks: TrackInfo[] = [];
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (!track) continue;
    tracks.push({
      index: i,
      label: track.label,
      language: track.language,
      kind: track.kind,
      active: isActive(track),
    });
  }
  return tracks;
}

/** Enables one audio track and disables the rest. */
export function selectAudioTrack(list: MediaTrackListLike, index: number): void {
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (track) track.enabled = i === index;
  }
}

/** Shows one text track, or none when `index` is null. */
export function selectTextTrack(
  list: { readonly length: number; [index: number]: { mode: TextTrackMode } },
  index: number | null,
): void {
  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (track) track.mode = i === index ? 'showing' : 'disabled';
  }
}

export function trackName(track: TrackInfo): string {
  const parts = [track.language || 'und', track.label].filter(Boolean);
  return `${track.index + 1}: ${parts.join(' · ')}`;
}

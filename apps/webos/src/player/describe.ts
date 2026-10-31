import {
  languageName,
  type Resolution,
  SEVERE_WARNINGS,
  type StreamEntry,
  type StreamFacts,
  type StreamWarning,
} from '@bannertv/core';
import type { TFunction } from 'i18next';

/** How the picture size reads on a TV: "4K" rather than "2160p". */
export function resolutionLabel(resolution: Resolution | undefined): string | undefined {
  if (!resolution) return undefined;
  if (resolution === '2160p') return '4K';
  if (resolution === '1440p') return '1440p';
  return resolution;
}

/** "4.2 GB", "700 MB". */
export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * The short facts shown next to a stream: picture, HDR, audio and size. These
 * are the names printed on boxes and remotes, so they are not translated.
 */
export function streamBadges(facts: StreamFacts): string[] {
  const badges: string[] = [];
  const resolution = resolutionLabel(facts.resolution);
  if (resolution) badges.push(resolution);
  if (facts.hdr.length > 0) badges.push(facts.hdr[0] === 'DV' ? 'Dolby Vision' : facts.hdr[0]!);
  const audio = facts.audio[0];
  if (audio) badges.push(facts.channels ? `${audio} ${facts.channels}` : audio);
  if (facts.sizeBytes) badges.push(formatSize(facts.sizeBytes));
  return badges;
}

/** The three the player's header shows: resolution, HDR and sound. */
export function headlineBadges(facts: StreamFacts): string[] {
  return streamBadges({ ...facts, sizeBytes: undefined });
}

/** The addon's own first line for a stream, which usually names the release. */
export function streamTitle(entry: StreamEntry): string {
  const { name, description, behaviorHints } = entry.stream;
  const first = description?.split('\n')[0]?.trim();
  return first || behaviorHints.filename || name?.split('\n').join(' ') || '';
}

/** One plain sentence per warning, for the stream list and the player's info line. */
export function warningText(t: TFunction, warning: StreamWarning): string {
  return t(`streams.warnings.${warning}`);
}

/** What one stream's row says, in the player's Sources and in All streams. */
export interface StreamRowText {
  title: string;
  badges: string[];
  playable: boolean;
  /** The one note shown: why it can't play here, or its most serious warning. */
  note?: string;
  /** Every note, for Audio Guidance. */
  notes: string[];
}

export function streamRowText(
  t: TFunction,
  entry: StreamEntry,
  {
    heavy,
    languages,
  }: {
    /** Needs more data than the connection has carried. */
    heavy: boolean;
    /** Only in other languages than the one heard: "Spanish audio". */
    languages?: readonly string[];
  },
): StreamRowText {
  const action = entry.assessment.action;
  const playable = action.kind === 'play';
  const badges = streamBadges(entry.facts);
  if (entry.facts.cached === true) badges.push(t('streams.cached'));
  // Most serious first: what stops a picture or sound, then a file too big for
  // the connection, then a language the viewer may not want.
  const warnings = entry.assessment.warnings;
  const severe = warnings.filter((w) => SEVERE_WARNINGS.has(w)).length;
  const notes = warnings.map((w) => warningText(t, w));
  const after: string[] = [];
  if (playable && heavy) after.push(t('streams.heavy'));
  if (languages && languages.length > 0) {
    after.push(t('player.otherAudio', { languages: languages.map(languageName).join(', ') }));
  }
  notes.splice(severe, 0, ...after);
  if (!playable) {
    const reason = t(
      `streams.cannot.${action.kind === 'unavailable' ? action.reason : action.kind}`,
    );
    return { title: streamTitle(entry), badges, playable, note: reason, notes: [reason] };
  }
  const note =
    notes[0] &&
    (notes.length > 1
      ? t('streams.moreNotes', { note: notes[0], count: notes.length - 1 })
      : notes[0]);
  return { title: streamTitle(entry), badges, playable, note, notes };
}

/** "Asking 2 addons…", "1 addon didn't answer", "12 streams". */
export function streamsStatus(
  t: TFunction,
  state: { pending: number; failed: readonly unknown[] },
  count: number,
): string {
  return state.pending > 0
    ? t('streams.asking', { count: state.pending })
    : state.failed.length > 0
      ? t('streams.failed', { count: state.failed.length })
      : t('streams.count', { count });
}

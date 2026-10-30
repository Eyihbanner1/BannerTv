import type { Resolution, StreamEntry, StreamFacts, StreamWarning } from '@bannertv/core';
import type { TFunction } from 'i18next';

/** How the picture size reads on a TV: "4K" rather than "2160p". */
export function resolutionLabel(resolution: Resolution | undefined): string | undefined {
  if (!resolution) return undefined;
  if (resolution === '2160p') return '4K';
  if (resolution === '1440p') return '1440p';
  return resolution;
}

function formatSize(bytes: number): string {
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

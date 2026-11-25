import { summarisePlays, TARGET_START_MS, type PlayRecord } from '@bannertv/core';
import { formatClock } from './media';

/** One line of the scorecard: its label and its value. */
export type ScorecardRow = readonly [label: string, value: string];

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const joined = (parts: readonly (string | undefined)[]) =>
  parts.filter((part) => part !== undefined).join(' · ');

const OUTCOME_WORDS: Record<PlayRecord['outcome'], string> = {
  played: 'played',
  failed: 'failed',
  left: 'left before the picture',
};

/**
 * The plays kept on this screen against BannerTV's targets, as Diagnostics
 * and the phone's report show them. Numbers only, never a link or a title.
 */
export function scorecardRows(plays: readonly PlayRecord[]): ScorecardRow[] {
  if (plays.length === 0) return [['Plays', 'none yet on this screen']];
  const summary = summarisePlays(plays);
  return [
    [
      'Plays',
      joined([
        `${plays.length} kept`,
        summary.failed > 0 ? `${summary.failed} failed` : undefined,
        summary.left > 0 ? `${summary.left} left early` : undefined,
        `${summary.hours.toFixed(1)} h played`,
      ]),
    ],
    [
      `Start (aim ${seconds(TARGET_START_MS)})`,
      summary.medianStartMs === undefined || summary.quickStarts === undefined
        ? 'no picture yet'
        : `${seconds(summary.medianStartMs)} middle · ${Math.round(summary.quickStarts * 100)}% in time`,
    ],
    [
      'Waits per hour',
      summary.waitsPerHour === undefined || summary.waitSecondsPerHour === undefined
        ? 'under 6 min played'
        : `${summary.waitsPerHour.toFixed(1)} · ${Math.round(summary.waitSecondsPerHour)} s waiting`,
    ],
    [
      'Auto-play',
      joined([
        counted(summary.failovers, 'failover'),
        counted(summary.stepDowns, 'step-down'),
        `${summary.retries} reopened`,
      ]),
    ],
    ['Changed soon', `audio ${summary.audioChanged} · subtitles ${summary.subtitlesChanged}`],
  ];
}

/**
 * Each play in a line, newest first: when, what it was, how it started, how
 * it went. The label is the day and time it opened.
 */
export function playRows(plays: readonly PlayRecord[]): ScorecardRow[] {
  return plays.map((play) => {
    const when = new Date(play.at);
    const moves = play.failovers + play.stepDowns + play.retries;
    const changed = [play.audioChanged && 'audio', play.subtitlesChanged && 'subtitles'].filter(
      (part): part is string => typeof part === 'string',
    );
    return [
      `${when.getDate()}/${when.getMonth() + 1} ${formatClock(play.at)}`,
      joined([
        play.kind,
        play.startMs !== undefined ? seconds(play.startMs) : OUTCOME_WORDS[play.outcome],
        play.outcome === 'left' ? undefined : counted(play.waits, 'wait'),
        moves > 0 ? counted(moves, 'switch', 'switches') : undefined,
        changed.length > 0 ? `${changed.join('+')} changed` : undefined,
        play.outcome === 'left' ? undefined : `${Math.round(play.playedS / 60)} min`,
      ]),
    ];
  });
}

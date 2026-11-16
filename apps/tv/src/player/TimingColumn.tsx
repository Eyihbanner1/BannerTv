import { DRIFT_CHOICES, driftHintKey, driftOn, syncLine } from '@tv/player/subtitle-versions';
import {
  formatOffset,
  offsetWay,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_COLUMN_STEPS,
  timingSummary,
} from '@tv/player/timing';
import type { Subtitles } from '@tv/screens/player/use-subtitles';
import { useTranslation } from 'react-i18next';
import { SheetColumn, SheetNote, SheetOption } from '../ui/Sheet';

/**
 * The tracks sheet's Timing column: the subtitles showing moved later or earlier, Reset, and the
 * drift fix for a file timed for another frame rate, as the LG's Timing tab has them. Only a
 * press changes them, so the viewer's own choices win; each is kept for the file.
 */
export function TimingColumn({ subtitles }: { subtitles: Subtitles }) {
  const { t } = useTranslation();
  const summary = timingSummary(subtitles);
  const title = [
    t('player.timing'),
    ...(summary
      ? [
          summary.offset,
          ...(summary.linedUp ? [t('player.linedUp')] : []),
          ...(summary.driftFixed ? [t('player.driftFixed')] : []),
        ]
      : []),
  ].join(' · ');

  if (subtitles.choice === null) {
    return (
      <SheetColumn title={title}>
        <SheetNote>{t('player.timingOff')}</SheetNote>
      </SheetColumn>
    );
  }

  const { offset } = subtitles;
  const { way, amount } = offsetWay(offset);
  const wayText =
    way === 'later'
      ? t('player.timingLater', { amount })
      : way === 'earlier'
        ? t('player.timingEarlier', { amount })
        : t('player.timingNone');
  // What lining the file up against the video did: moved by BannerTV, or why not.
  const sync = syncLine(subtitles.sync);
  return (
    <SheetColumn title={title}>
      <SheetNote>{`${formatOffset(offset)} · ${wayText}`}</SheetNote>
      {TIMING_COLUMN_STEPS.map((step) => (
        <SheetOption
          key={`step-${step}`}
          label={stepLabel(step)}
          detail={t(step < 0 ? 'player.earlierBy' : 'player.laterBy', {
            amount: stepAmount(step),
          })}
          selected={false}
          onPress={() => subtitles.setOffset(stepOffset(subtitles.offset, step))}
        />
      ))}
      <SheetOption
        label={t('player.timingReset')}
        selected={offset === 0}
        onPress={() => subtitles.setOffset(0)}
      />
      {/* For a file timed for another frame rate, which slides further out as the film goes on.
          Not for a track inside the file, whose lines Android shows and clears itself. */}
      {subtitles.canFixDrift
        ? DRIFT_CHOICES.map(({ name, drift, label }) => (
            <SheetOption
              key={`drift-${name}`}
              label={t(label)}
              detail={t('player.drift')}
              selected={driftOn(subtitles, drift)}
              onPress={() => subtitles.setDrift(drift)}
            />
          ))
        : null}
      {sync ? (
        <SheetNote>
          {t(sync.key, sync.amount !== undefined ? { amount: sync.amount } : undefined)}
        </SheetNote>
      ) : null}
      <SheetNote>
        {subtitles.canFixDrift
          ? `${t(driftHintKey(subtitles))} ${t('player.timingKept')}`
          : t('player.timingKept')}
      </SheetNote>
    </SheetColumn>
  );
}

import { DRIFT_CHOICES, driftHintKey, driftOn, syncLine } from '@tv/player/subtitle-versions';
import {
  formatOffset,
  lineText,
  offsetWay,
  preferredRow,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_COLUMN_STEPS,
  timingSummary,
} from '@tv/player/timing';
import { type MatchClock, useMatchRows } from '@tv/screens/player/use-match-rows';
import type { MatchResult, Subtitles } from '@tv/screens/player/use-subtitles';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SheetColumn, SheetNote, SheetOption } from '../ui/Sheet';
import {
  OFFER_FOCUS,
  openingFocus,
  type OpeningFocus,
  SPENT,
  takesFocus,
  WAITING,
} from './opening-focus';

/** What matching a line did, in the words the LG uses. */
function matchNote(result: MatchResult): { key: string; again: boolean } {
  if (result.presses === 1) return { key: 'player.matchDone', again: result.again };
  if ('unsteady' in result) return { key: 'player.matchUnsteady', again: false };
  return { key: result.drift ? 'player.matchDrift' : 'player.matchBoth', again: false };
}

/**
 * The tracks sheet's Timing column, as the LG's Timing tab has it: last episode's timing,
 * offered where it may be; the lines around now, to press on the one just heard (a second
 * press, much later in the film, fixes a drift too); the subtitles showing moved later or
 * earlier, Reset, Undo after a press, and the drift fix for a file timed for another frame
 * rate. Only a press changes them, so the viewer's own choices win; each is kept for the file.
 */
export function TimingColumn({
  subtitles,
  clock,
}: {
  subtitles: Subtitles;
  /** The player's clock now, read as a line is pressed; null before there is a video. */
  clock: () => MatchClock | null;
}) {
  const { t } = useTranslation();
  // What the last press did, said until the next change.
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  // The row with focus stays in the list while the lines move on.
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const match = useMatchRows(
    subtitles.canMatch ? subtitles.cues : null,
    subtitles.offset,
    clock,
    pinned,
  );
  // What takes focus as the sheet opens, decided once (`openingFocus`) and handed out for that
  // draw only: React Native moves the remote's focus each time an option's preferred focus turns
  // on, so it must never follow the lines as they go by, nor take focus from the viewer.
  const [opening, setOpening] = useState<OpeningFocus>(WAITING);
  const focus = openingFocus(opening, {
    offer: subtitles.offer !== null,
    matching: subtitles.canMatch && subtitles.cues !== null,
    read: match.read,
    line: () =>
      subtitles.cues
        ? preferredRow(match.rows, subtitles.cues, (clock()?.time ?? 0) - subtitles.offset)?.key
        : undefined,
  });
  if (focus !== opening) setOpening(focus);
  const handing = focus.kind === 'decided' && focus.key !== null;
  useEffect(() => {
    if (!handing) return;
    // Once drawn with it, nothing takes focus again while the sheet stays open.
    const timer = setTimeout(() => setOpening(SPENT), 0);
    return () => clearTimeout(timer);
  }, [handing]);
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

  if (subtitles.pictureTrack) {
    return (
      <SheetColumn title={title}>
        <SheetNote>{t('player.matchPicture')}</SheetNote>
      </SheetColumn>
    );
  }

  const { offset, offer, cues } = subtitles;
  const { way, amount } = offsetWay(offset);
  const wayText =
    way === 'later'
      ? t('player.timingLater', { amount })
      : way === 'earlier'
        ? t('player.timingEarlier', { amount })
        : t('player.timingNone');
  // What lining the file up against the video did: moved by BannerTV, or why not.
  const sync = syncLine(subtitles.sync);
  // Any other change says nothing more of the last press.
  const change = (act: () => void) => () => {
    setLastMatch(null);
    act();
  };
  const offerAmount = offer
    ? offer.drift
      ? t('player.offerAmountDrift', { amount: formatOffset(offer.offset) })
      : formatOffset(offer.offset)
    : '';
  const matchCues = subtitles.canMatch ? cues : null;
  const said = lastMatch ? matchNote(lastMatch) : null;
  return (
    <SheetColumn title={title}>
      {offer ? (
        <>
          <SheetNote>{t('player.offerTiming', { amount: offerAmount })}</SheetNote>
          <SheetOption
            label={t('player.offerUse')}
            selected={false}
            preferred={takesFocus(focus, OFFER_FOCUS)}
            onPress={change(() => subtitles.takeOffer())}
          />
          <SheetOption
            label={t('player.offerNo')}
            selected={false}
            onPress={change(() => subtitles.declineOffer())}
          />
        </>
      ) : null}
      {matchCues ? (
        <>
          <SheetNote>{t('player.matchLine')}</SheetNote>
          <SheetNote>{t(match.paused ? 'player.matchPaused' : 'player.matchHint')}</SheetNote>
          {match.rows.length === 0 ? (
            <SheetNote>{t('player.matchWaiting')}</SheetNote>
          ) : (
            match.rows.map((row) => (
              <SheetOption
                key={`match-${row.key}`}
                label={lineText(matchCues[row.index]!)}
                {...(row.onScreen ? { detail: t('player.matchOnScreen') } : {})}
                selected={false}
                preferred={takesFocus(focus, row.key)}
                onFocus={() => setPinned(row.key)}
                onBlur={() => setPinned((key) => (key === row.key ? undefined : key))}
                onPress={() => {
                  // The clock as the viewer pressed, read now: never a value kept from a draw.
                  const now = clock();
                  if (!now || now.paused) return;
                  setLastMatch(
                    subtitles.matchLine(row.index, { time: now.time, speed: now.speed }),
                  );
                }}
              />
            ))
          )}
        </>
      ) : null}
      <SheetNote>{`${formatOffset(offset)} · ${wayText}`}</SheetNote>
      {TIMING_COLUMN_STEPS.map((step) => (
        <SheetOption
          key={`step-${step}`}
          label={stepLabel(step)}
          detail={t(step < 0 ? 'player.earlierBy' : 'player.laterBy', {
            amount: stepAmount(step),
          })}
          selected={false}
          onPress={change(() => subtitles.setOffset(stepOffset(subtitles.offset, step)))}
        />
      ))}
      <SheetOption
        label={t('player.timingReset')}
        selected={offset === 0}
        onPress={change(() => subtitles.setOffset(0))}
      />
      {lastMatch ? (
        <SheetOption
          label={t('player.matchUndo')}
          selected={false}
          onPress={() => {
            subtitles.undoMatch();
            setLastMatch(null);
          }}
        />
      ) : null}
      {/* For a file timed for another frame rate, which slides further out as the film goes on.
          Not for a track inside the file, whose lines Android shows and clears itself. */}
      {subtitles.canFixDrift
        ? DRIFT_CHOICES.map(({ name, drift, label }) => (
            <SheetOption
              key={`drift-${name}`}
              label={t(label)}
              detail={t('player.drift')}
              selected={driftOn(subtitles, drift)}
              onPress={change(() => subtitles.setDrift(drift))}
            />
          ))
        : null}
      {said && lastMatch ? (
        <SheetNote>
          {`${t(said.key, { amount: formatOffset(lastMatch.offset) })}${
            said.again ? ` ${t('player.matchAgain')}` : ''
          }`}
        </SheetNote>
      ) : (
        <>
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
        </>
      )}
    </SheetColumn>
  );
}

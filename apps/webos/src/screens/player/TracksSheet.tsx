import { languageKey, languageName, numberBySource, type StreamEntry } from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { preferences } from '../../data/preferences';
import { focusedKey } from '../../navigation/spatial';
import { inputMode } from '../../platform/input-mode';
import { audioDetail, audioLanguage, audioSummary } from '../../player/audio';
import { resolutionLabel } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import {
  createOrderMemory,
  DRIFT_CHOICES,
  driftHintKey,
  driftOn,
  isUnfit,
  languageFirstPick,
  playingRelease,
  sameChoice,
  subtitlesValue,
  subtitleVersions,
  syncLine,
  type SubtitleVersion,
  VERSION_NOTES,
  versionDetail,
  versionGroups,
  versionNotes,
} from '../../player/subtitle-versions';
import {
  formatOffset,
  lineText,
  offsetWay,
  preferredRow,
  stepOffset,
  TIMING_STEPS,
} from '../../player/timing';
import { type SheetRow, SheetList } from './SheetList';
import { Pane, SheetTabs } from './SheetTabs';
import { SubtitleStyleChoices, useStyleSummary } from './SubtitleStylePanel';
import { type MatchClock, useMatchRows } from './use-match-rows';
import type { MatchResult, SubtitleChoice, Subtitles } from './use-subtitles';
import styles from './TracksSheet.module.css';

export type SheetTab = 'subtitles' | 'audio' | 'timing' | 'style';

const SHEET = 'player-tracks';
const TABS: readonly SheetTab[] = ['subtitles', 'audio', 'timing', 'style'];
/** Rows a column shows at a time. */
const VISIBLE = 4;

// The chip beside the player's controls reads it from here.
export { subtitlesValue };

const versionKey = (choice: NonNullable<SubtitleChoice>) =>
  choice.kind === 'file' ? `${SHEET}-file-${choice.key}` : `${SHEET}-track-${choice.id}`;

interface TracksSheetProps {
  audio: readonly EngineTrack[];
  subtitles: Subtitles;
  entry: StreamEntry | null;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  /** Focused again when it closes: read at closing time. */
  returnFocusKey: () => string;
  onAudio: (track: EngineTrack) => void;
  /**
   * A stream to switch to for audio in a language this one lacks, as the
   * Audio tab's last row ("English audio: switch stream").
   */
  audioSwitch?: { language: string; entry: StreamEntry; onPress: () => void };
  /** Back from the tabs: the sheet closes onto the controls. */
  onBack: () => void;
  /** Blue, or a click above it. */
  onClose: () => void;
  /** The video's clock now, read as a line is matched; null before there is a video. */
  clock: () => MatchClock | null;
}

/** What matching a line did, said in the Timing tab: [key, amount], and the again note. */
function matchNote(result: MatchResult): { key: string; again: boolean } {
  if (result.presses === 1) return { key: 'player.matchDone', again: result.again };
  if ('unsteady' in result) return { key: 'player.matchUnsteady', again: false };
  return { key: result.drift ? 'player.matchDrift' : 'player.matchBoth', again: false };
}

/** A column that only says something: still asking, nothing found. */
function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/**
 * Audio and subtitles in a sheet that rises from the bottom and leaves the
 * picture above it clear, the subtitle line lifted just above it. Tabs along
 * the top say what is on now; Back goes from a tab's choices to the tabs,
 * then closes. Subtitles: languages on the left, that language's versions on
 * the right, numbered by source, with the release name when the addon sends
 * one. Rows keep their places while the sheet is open, as more addons answer.
 */
export function TracksSheet(props: TracksSheetProps) {
  const { audio, subtitles, entry, tab, onTab, onAudio, audioSwitch } = props;
  const { t } = useTranslation();
  const styleSummary = useStyleSummary();
  const { choice } = subtitles;
  // The language last chosen comes first, as it was when the sheet opened.
  const [firstLanguage] = useState(() => preferences.get().subtitleLanguage);
  // Languages and versions keep the places they had when first shown.
  const [stable] = useState(createOrderMemory);

  // Every version, the stream's own tracks first: they are always in step, and stay
  // first even when listed after the files.
  const versions = subtitleVersions(subtitles, t('player.inTheStream'));
  const groups = versionGroups(versions, firstLanguage, stable);
  const chosen = choice ? versions.find((v) => sameChoice(v.choice, choice)) : undefined;
  const chosenLanguage = chosen ? languageKey(chosen.lang) : null;
  const [view, setView] = useState(chosenLanguage);
  // Match a line: its list open, what the last match did (said until the next change), and the
  // line focused, kept among the rows as the film plays on.
  const [matching, setMatching] = useState(false);
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const match = useMatchRows(
    tab === 'timing' && matching ? subtitles.cues : null,
    subtitles.offset,
    props.clock,
    pinned,
  );
  // Focus to move once what it goes to is drawn: the match list opening or closing.
  const focusNext = useRef<string | null>(null);
  // The match list's rows were focused since it opened: focus is the viewer's from then on.
  const rowsFocused = useRef(false);
  const matchCues = subtitles.cues;
  const matchFirst =
    matching && matchCues && match.rows.length > 0
      ? `${SHEET}-match-${(preferredRow(match.rows, matchCues, (props.clock()?.time ?? 0) - subtitles.offset) ?? match.rows[0]!).key}`
      : null;
  useEffect(() => {
    const key = focusNext.current;
    if (key) {
      focusNext.current = null;
      void setFocus(key);
    }
    if (matchFirst && !rowsFocused.current) {
      rowsFocused.current = true;
      void setFocus(matchFirst);
    }
  });
  const toTab = (next: SheetTab) => {
    // A tab takes focus as the match list waits for its lines: it stays open.
    if (next === tab) return;
    setLastMatch(null);
    setMatching(false);
    setPinned(undefined);
    onTab(next);
  };
  const openMatch = () => {
    rowsFocused.current = false;
    setMatching(true);
    setLastMatch(null);
    // Until the lines are read, the tab: they take focus as they come.
    focusNext.current = `${SHEET}-tab-timing`;
  };
  const closeMatch = () => {
    setMatching(false);
    setPinned(undefined);
    focusNext.current = `${SHEET}-timing-match`;
  };
  const shown =
    groups.find((group) => group.key === view) ??
    groups.find((group) => group.key === chosenLanguage) ??
    groups[0];

  const video = playingRelease(entry);
  const versionRow = ({ item, number }: { item: SubtitleVersion; number?: number }): SheetRow => {
    const selected = sameChoice(item.choice, choice);
    const status = subtitles.statusOf(item.choice);
    const check = subtitles.checkOf(item.choice);
    const said = versionNotes(item, selected, status, video, check).map((note) =>
      t(VERSION_NOTES[note]),
    );
    return {
      focusKey: versionKey(item.choice),
      label:
        number === undefined
          ? item.source
          : t('player.sourceNumber', { source: item.source, number }),
      detail: versionDetail(said, item.release),
      selected,
      // Passed over, for good reason: still there to pick by hand.
      dim: status === 'failed' || isUnfit(check),
      onPress: () => subtitles.choose(item.choice),
    };
  };

  const languageRows: SheetRow[] = [
    {
      focusKey: `${SHEET}-off`,
      label: t('player.subtitlesOff'),
      selected: choice === null,
      onPress: () => subtitles.choose(null),
    },
    ...groups.map((group): SheetRow => ({
      focusKey: `${SHEET}-lang-${group.key}`,
      label: group.name,
      detail: String(group.items.length),
      spoken: `${group.name}, ${t('player.versions', { count: group.items.length })}`,
      selected: group.key === chosenLanguage,
      // Its versions show beside it as it takes focus; with the pointer, as it
      // is clicked, so passing over languages on the way to a version moves nothing.
      onFocus: () => {
        if (inputMode.get() !== 'pointer') setView(group.key);
      },
      onPress: () => {
        setView(group.key);
        // The language showing: on to its versions. Another starts on its best placed version,
        // and the player reads its files and may move to one that fits better.
        if (group.key === chosenLanguage && chosen) {
          if (inputMode.get() !== 'pointer') void setFocus(versionKey(chosen.choice));
          return;
        }
        subtitles.choose(languageFirstPick(group, subtitles, video).choice, 'language');
      },
    })),
  ];
  const languageFocus =
    chosenLanguage === null ? `${SHEET}-off` : `${SHEET}-lang-${chosenLanguage}`;

  let content: ReactNode;
  if (tab === 'subtitles') {
    // A language whose versions the viewer is among stays shown, whatever
    // the start-of-stream choice settles on meanwhile.
    const fileRows = shown
      ? numberBySource(shown.items).map((version): SheetRow => ({
          ...versionRow(version),
          onFocus: () => setView(shown.key),
        }))
      : [];
    const chosenHere = fileRows.find((row) => row.selected);
    content = (
      <Pane focusKey={`${SHEET}-subtitles`} preferred={`${SHEET}-langs`} className={styles.content}>
        <SheetList
          focusKey={`${SHEET}-langs`}
          rows={languageRows}
          preferred={languageFocus}
          remember
          visible={VISIBLE}
          className={styles.languages}
        />
        {fileRows.length > 0 ? (
          <SheetList
            key={shown!.key}
            focusKey={`${SHEET}-files`}
            rows={fileRows}
            preferred={chosenHere?.focusKey ?? fileRows[0]!.focusKey}
            remember={false}
            visible={VISIBLE}
            className={styles.files}
          />
        ) : (
          <div className={styles.files}>
            <Note>
              {subtitles.pending > 0
                ? t('player.stillAsking', { count: subtitles.pending })
                : subtitles.subdlAsking
                  ? t('player.stillSubdl')
                  : subtitles.hashReading
                    ? t('player.stillLinking')
                    : subtitles.textComing
                      ? t('player.stillReadingVideo')
                      : t('player.noSubtitles')}
            </Note>
          </div>
        )}
      </Pane>
    );
  } else if (tab === 'audio') {
    const rows = audio.map((track): SheetRow => ({
      focusKey: `${SHEET}-audio-${track.id}`,
      label: audioLanguage(track),
      detail:
        [
          audioDetail(track),
          track.commentary && !/commentar/i.test(track.label) ? t('player.commentary') : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      selected: track.active,
      onPress: () => onAudio(track),
    }));
    if (audioSwitch) {
      rows.push({
        focusKey: `${SHEET}-audio-switch`,
        label: t('player.audioSwitch', { language: languageName(audioSwitch.language) }),
        detail: resolutionLabel(audioSwitch.entry.facts.resolution),
        onPress: audioSwitch.onPress,
      });
    }
    content =
      rows.length > 0 ? (
        <Pane focusKey={`${SHEET}-audio`} className={styles.content}>
          <SheetList
            focusKey={`${SHEET}-audio-list`}
            rows={rows}
            preferred={rows.find((row) => row.selected)?.focusKey ?? rows[0]!.focusKey}
            remember={false}
            visible={VISIBLE}
            className={styles.wide}
          />
        </Pane>
      ) : (
        <div className={styles.content}>
          <Note>{t('player.noAudioChoice')}</Note>
        </div>
      );
  } else if (tab === 'timing' && choice !== null && matching) {
    const rows = matchCues
      ? match.rows.map((row): SheetRow => {
          const label = lineText(matchCues[row.index]!);
          return {
            focusKey: `${SHEET}-match-${row.key}`,
            label,
            detail: row.onScreen ? t('player.matchOnScreen') : undefined,
            spoken: label,
            onFocus: () => setPinned(row.key),
            onPress: () => {
              // The clock as the viewer pressed, read now: never a value kept from a draw.
              const clock = props.clock();
              if (!clock || clock.paused) return;
              const result = subtitles.matchLine(row.index, {
                time: clock.time,
                speed: clock.speed,
              });
              closeMatch();
              setLastMatch(result);
            },
          };
        })
      : [];
    content =
      rows.length === 0 ? (
        <div className={styles.content}>
          <Note>{t('player.matchWaiting')}</Note>
        </div>
      ) : (
        <Pane
          focusKey={`${SHEET}-match`}
          preferred={matchFirst ?? undefined}
          className={styles.content}
        >
          <SheetList
            focusKey={`${SHEET}-match-list`}
            rows={rows}
            preferred={matchFirst ?? rows[0]!.focusKey}
            remember={false}
            visible={VISIBLE}
            className={styles.wide}
          />
        </Pane>
      );
  } else if (tab === 'timing') {
    const { way, amount } = offsetWay(subtitles.offset);
    // What lining the file up against the video did: moved by BannerTV, or why not.
    const sync = syncLine(subtitles.sync);
    const { offer } = subtitles;
    const offerAmount = offer
      ? offer.drift
        ? t('player.offerAmountDrift', { amount: formatOffset(offer.offset) })
        : formatOffset(offer.offset)
      : '';
    const said = lastMatch ? matchNote(lastMatch) : null;
    // Any other change says nothing more of the last match.
    const change = (act: () => void) => () => {
      setLastMatch(null);
      act();
    };
    content =
      choice === null ? (
        <div className={styles.content}>
          <Note>{t('player.timingOff')}</Note>
        </div>
      ) : subtitles.pictureTrack ? (
        <div className={styles.content}>
          <Note>{t('player.matchPicture')}</Note>
        </div>
      ) : (
        <Pane
          focusKey={`${SHEET}-timing`}
          preferred={
            offer
              ? `${SHEET}-offer-use`
              : subtitles.canMatch
                ? `${SHEET}-timing-match`
                : `${SHEET}-timing-p01`
          }
          className={styles.content}
        >
          {offer ? (
            <p className={styles.timing}>
              <span className={styles.offerText}>
                {t('player.offerTiming', { amount: offerAmount })}
              </span>
              <Pressable
                focusKey={`${SHEET}-offer-use`}
                label={t('player.offerUse')}
                className={styles.step}
                focusedClassName={styles.stepFocused}
                onPress={change(() => subtitles.takeOffer())}
              >
                {t('player.offerUse')}
              </Pressable>
              <Pressable
                focusKey={`${SHEET}-offer-no`}
                label={t('player.offerNo')}
                className={styles.step}
                focusedClassName={styles.stepFocused}
                onPress={change(() => subtitles.declineOffer())}
              >
                {t('player.offerNo')}
              </Pressable>
            </p>
          ) : (
            <p className={styles.timing}>
              <span className={styles.offset}>{formatOffset(subtitles.offset)}</span>
              <span className={styles.way}>
                {way === 'later'
                  ? t('player.timingLater', { amount })
                  : way === 'earlier'
                    ? t('player.timingEarlier', { amount })
                    : t('player.timingNone')}
              </span>
            </p>
          )}
          <div className={styles.steps}>
            {subtitles.canMatch && (
              <Pressable
                focusKey={`${SHEET}-timing-match`}
                label={t('player.matchLine')}
                className={styles.step}
                focusedClassName={styles.stepFocused}
                onPress={openMatch}
              >
                {t('player.matchLine')}
              </Pressable>
            )}
            {TIMING_STEPS.map((step) => {
              const size = Math.abs(step).toFixed(1);
              return (
                <Pressable
                  key={step}
                  focusKey={`${SHEET}-timing-${step < 0 ? 'm' : 'p'}${size.replace('.', '')}`}
                  label={t(step < 0 ? 'player.earlierBy' : 'player.laterBy', { amount: size })}
                  className={styles.step}
                  focusedClassName={styles.stepFocused}
                  onPress={change(() => subtitles.setOffset(stepOffset(subtitles.offset, step)))}
                >
                  {`${step < 0 ? '−' : '+'}${size} s`}
                </Pressable>
              );
            })}
            <Pressable
              focusKey={`${SHEET}-timing-reset`}
              label={t('player.timingReset')}
              className={`${styles.step} ${styles.resetStep}`}
              focusedClassName={styles.stepFocused}
              onPress={change(() => subtitles.setOffset(0))}
            >
              {t('player.timingReset')}
            </Pressable>
            {lastMatch && (
              <Pressable
                focusKey={`${SHEET}-timing-undo`}
                label={t('player.matchUndo')}
                className={styles.step}
                focusedClassName={styles.stepFocused}
                onPress={() => {
                  subtitles.undoMatch();
                  setLastMatch(null);
                  focusNext.current = `${SHEET}-timing-match`;
                }}
              >
                {t('player.matchUndo')}
              </Pressable>
            )}
          </div>
          {/* For a file timed for another frame rate, which slides further out as the film goes on.
              Not for the lines Android hands over from inside the file, which keep in step. */}
          {subtitles.canFixDrift && (
            <div className={styles.steps}>
              <span className={styles.rowLabel}>{t('player.drift')}</span>
              {DRIFT_CHOICES.map(({ name, drift, label }) => {
                const on = driftOn(subtitles, drift);
                return (
                  <Pressable
                    key={name}
                    focusKey={`${SHEET}-drift-${name}`}
                    label={on ? `${t(label)}, ${t('player.driftChosen')}` : t(label)}
                    className={on ? `${styles.step} ${styles.stepOn}` : styles.step}
                    focusedClassName={styles.stepFocused}
                    onPress={change(() => subtitles.setDrift(drift))}
                  >
                    {t(label)}
                  </Pressable>
                );
              })}
            </div>
          )}
          {said && lastMatch ? (
            <p className={styles.kept}>
              {t(said.key, { amount: formatOffset(lastMatch.offset) })}
              {said.again ? ` ${t('player.matchAgain')}` : ''}
            </p>
          ) : (
            <>
              {sync && (
                <p className={styles.kept}>
                  {t(sync.key, sync.amount !== undefined ? { amount: sync.amount } : undefined)}
                </p>
              )}
              <p className={styles.kept}>
                {subtitles.canFixDrift
                  ? `${t(driftHintKey(subtitles))} ${t('player.timingKept')}`
                  : t('player.timingKept')}
              </p>
            </>
          )}
        </Pane>
      );
  } else {
    content = (
      <div className={styles.content}>
        <SubtitleStyleChoices focusKey={`${SHEET}-style`} />
      </div>
    );
  }

  const active = audio.find((track) => track.active) ?? audio[0];
  const names: Record<SheetTab, string> = {
    subtitles: t('player.subtitles'),
    audio: t('player.audio'),
    timing: t('player.timing'),
    style: t('player.styleTab'),
  };
  const values: Record<SheetTab, string> = {
    subtitles: subtitlesValue(subtitles) ?? t('player.subtitlesOff'),
    audio: active ? audioSummary(active) : t('player.audioDefault'),
    timing: [
      formatOffset(subtitles.offset),
      subtitles.sync?.state === 'moved' ? t('player.linedUp') : null,
      subtitles.drift ? t('player.driftFixed') : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
    style: styleSummary,
  };

  // Back from a tab's choices goes to the tabs; from the tabs it closes.
  const back = () => {
    if (matching) {
      closeMatch();
      return true;
    }
    const at = focusedKey();
    if (at.startsWith(`${SHEET}-`) && !at.startsWith(`${SHEET}-tab-`)) {
      void setFocus(`${SHEET}-tab-${tab}`);
      return true;
    }
    props.onBack();
    return true;
  };

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.audioAndSubtitles')}
      defaultFocusKey={languageFocus}
      returnFocusKey={props.returnFocusKey}
      onClose={props.onClose}
      onBack={back}
      placement="bottom"
    >
      <SheetTabs
        sheet={SHEET}
        tabs={TABS}
        names={names}
        tab={tab}
        values={values}
        onTab={toTab}
        aside={
          tab === 'timing' && matching
            ? t(match.paused ? 'player.matchPaused' : 'player.matchHint')
            : tab !== 'subtitles' || groups.length === 0
              ? undefined
              : subtitles.pending > 0
                ? t('player.stillAsking', { count: subtitles.pending })
                : subtitles.subdlAsking
                  ? t('player.stillSubdl')
                  : subtitles.hashReading
                    ? t('player.stillLinking')
                    : subtitles.textComing
                      ? t('player.stillReadingVideo')
                      : undefined
        }
      />
      {/* Each tab's choices register afresh: a focusable keeps the key it was first given. */}
      <Fragment key={tab}>{content}</Fragment>
    </Overlay>
  );
}

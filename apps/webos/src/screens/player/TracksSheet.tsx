import {
  languageKey,
  languageName,
  numberBySource,
  releaseShort,
  type StreamEntry,
} from '@bannertv/core';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { preferences } from '../../data/preferences';
import { audioDetail, audioLanguage } from '../../player/audio';
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
import { SheetDetail } from './SheetDetail';
import { rowParts, type SheetRow, SheetList } from './SheetList';
import { Pane } from './SheetTabs';
import { SubtitleStyleChoices, useStyleSummary } from './SubtitleStylePanel';
import { type MatchClock, useMatchRows } from './use-match-rows';
import type { MatchResult, SubtitleChoice, Subtitles } from './use-subtitles';
import styles from './TracksSheet.module.css';

/**
 * What the sheet shows: audio, subtitles and the chosen language's settings side
 * by side, or one of those settings on its own: the language's versions, its
 * timing, or how subtitles look.
 */
export type SheetView = 'main' | 'versions' | 'timing' | 'style';

const SHEET = 'player-tracks';
/** Rows a column of the three shows at a time. */
const VISIBLE = 5;
/** Two-line rows: a version, a setting. */
const TALL_ROW = 100;
const VERSIONS_VISIBLE = 4;

// The chip beside the player's controls reads it from here.
export { subtitlesValue };

const versionKey = (choice: NonNullable<SubtitleChoice>) =>
  choice.kind === 'file' ? `${SHEET}-file-${choice.key}` : `${SHEET}-track-${choice.id}`;

/** The row on the main view each setting goes back to. */
const SETTING_ROW: Record<Exclude<SheetView, 'main'>, string> = {
  versions: `${SHEET}-versions`,
  timing: `${SHEET}-timing`,
  style: `${SHEET}-style`,
};

interface TracksSheetProps {
  audio: readonly EngineTrack[];
  subtitles: Subtitles;
  entry: StreamEntry | null;
  view: SheetView;
  onView: (view: SheetView) => void;
  /** Focused again when it closes: read at closing time. */
  returnFocusKey: () => string;
  onAudio: (track: EngineTrack) => void;
  /**
   * A stream to switch to for audio in a language this one lacks, as the
   * Audio column's last row ("English audio: switch stream").
   */
  audioSwitch?: { language: string; entry: StreamEntry; onPress: () => void };
  /** Back from the main view: the sheet closes onto the controls. */
  onBack: () => void;
  /** Blue, or a click above it. */
  onClose: () => void;
  /** The video's clock now, read as a line is matched; null before there is a video. */
  clock: () => MatchClock | null;
}

/** What matching a line did, said in the Timing view: [key, amount], and the again note. */
function matchNote(result: MatchResult): { key: string; again: boolean } {
  if (result.presses === 1) return { key: 'player.matchDone', again: result.again };
  if ('unsteady' in result) return { key: 'player.matchUnsteady', again: false };
  return { key: result.drift ? 'player.matchDrift' : 'player.matchBoth', again: false };
}

/** A column or view that only says something: still asking, nothing found. */
function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** A setting's row on the main view: its name, what it is now, and a chevron on to it. */
function SettingBody({ name, value }: { name: string; value: string }) {
  return (
    <>
      <span className={styles.settingName}>{name}</span>
      <span className={`${rowParts.line} ${styles.settingValue}`}>{value}</span>
      <span className={rowParts.chevron} />
    </>
  );
}

/**
 * Audio and subtitles in a sheet that rises from the bottom and leaves the
 * picture above it clear, the subtitle line lifted just above it. Three
 * columns side by side: the audio, the subtitle languages, and the chosen
 * language's settings (its version, timing, and how subtitles look). A
 * language starts on its best version; the versions, each with what is known
 * of it and its release name in full in a box beside them, are one step in,
 * as are timing and style. Back goes from a setting to the columns, then
 * closes. Rows keep their places while the sheet is open, as more addons
 * answer.
 */
export function TracksSheet(props: TracksSheetProps) {
  const { audio, subtitles, entry, view, onView, onAudio, audioSwitch } = props;
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
  const chosenGroup = groups.find((group) => group.key === chosenLanguage);
  // The version focused in the versions view, whose name and notes show in the box beside.
  const [focusedVersion, setFocusedVersion] = useState<string | null>(null);
  // Match a line: its list open, what the last match did (said until the next change), and the
  // line focused, kept among the rows as the film plays on.
  const [matching, setMatching] = useState(false);
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const match = useMatchRows(
    view === 'timing' && matching ? subtitles.cues : null,
    subtitles.offset,
    props.clock,
    pinned,
  );
  // Focus to move once what it goes to is drawn: a view or the match list opening or closing.
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

  const video = playingRelease(entry);
  const noteOf = (item: SubtitleVersion, selected: boolean): string[] =>
    versionNotes(
      item,
      selected,
      subtitles.statusOf(item.choice),
      video,
      subtitles.checkOf(item.choice),
    ).map((note) => t(VERSION_NOTES[note]));
  const versionLabel = (item: SubtitleVersion, number?: number) =>
    number === undefined ? item.source : t('player.sourceNumber', { source: item.source, number });

  /** Opens a setting on its own; focus goes to its first choice once drawn. */
  const open = (next: Exclude<SheetView, 'main'>, focus: string) => {
    setLastMatch(null);
    setMatching(false);
    setPinned(undefined);
    focusNext.current = focus;
    onView(next);
  };
  /** Back to the three columns, on the setting's row. */
  const toMain = () => {
    if (view === 'main') return;
    focusNext.current = SETTING_ROW[view];
    setMatching(false);
    setPinned(undefined);
    setLastMatch(null);
    onView('main');
  };
  const openMatch = () => {
    rowsFocused.current = false;
    setMatching(true);
    setLastMatch(null);
    // Until the lines are read, the heading: they take focus as they come.
    focusNext.current = `${SHEET}-back`;
  };
  const closeMatch = () => {
    setMatching(false);
    setPinned(undefined);
    focusNext.current = `${SHEET}-timing-match`;
  };

  const status =
    subtitles.pending > 0
      ? t('player.stillAsking', { count: subtitles.pending })
      : subtitles.subdlAsking
        ? t('player.stillSubdl')
        : subtitles.hashReading
          ? t('player.stillLinking')
          : subtitles.textComing
            ? t('player.stillReadingVideo')
            : undefined;

  const languageFocus =
    chosenLanguage === null ? `${SHEET}-off` : `${SHEET}-lang-${chosenLanguage}`;
  const timingValue = [
    formatOffset(subtitles.offset),
    subtitles.sync?.state === 'moved' ? t('player.linedUp') : null,
    subtitles.drift ? t('player.driftFixed') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  /** A back row atop a setting's view: the heading of what shows, and Back with the pointer. */
  const backRow = (title: string, aside?: string) => (
    <div className={styles.head}>
      <Pressable
        focusKey={`${SHEET}-back`}
        label={`${t('common.back')}, ${title}`}
        className={styles.back}
        focusedClassName={styles.backFocused}
        onPress={() => (matching ? closeMatch() : toMain())}
      >
        <span className={styles.backArrow} />
        {title}
      </Pressable>
      {aside && <span className={styles.aside}>{aside}</span>}
    </div>
  );

  let content: ReactNode;
  if (view === 'main') {
    const audioRows = audio.map((track): SheetRow => ({
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
      audioRows.push({
        focusKey: `${SHEET}-audio-switch`,
        label: t('player.audioSwitch', { language: languageName(audioSwitch.language) }),
        detail: resolutionLabel(audioSwitch.entry.facts.resolution),
        onPress: audioSwitch.onPress,
      });
    }
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
        spoken: `${group.name}, ${t('player.versions', { count: group.items.length })}`,
        selected: group.key === chosenLanguage,
        onPress: () => {
          // The language showing: on to its versions. Another starts on its best placed
          // version, and the player reads its files and may move to one that fits better.
          if (group.key === chosenLanguage && chosen) {
            open('versions', versionKey(chosen.choice));
            return;
          }
          subtitles.choose(languageFirstPick(group, subtitles, video).choice, 'language');
        },
      })),
    ];
    const chosenNumber =
      chosen && chosenGroup
        ? numberBySource(chosenGroup.items).find((v) => v.item === chosen)?.number
        : undefined;
    const versionValue =
      chosen && chosenGroup
        ? `${versionLabel(chosen, chosenNumber)} · ${t('player.versions', {
            count: chosenGroup.items.length,
          })}`
        : '';
    const timingShown = subtitles.offer ? t('player.timingOffered') : timingValue;
    const timingFirst = subtitles.offer
      ? `${SHEET}-offer-use`
      : subtitles.canMatch
        ? `${SHEET}-timing-match`
        : subtitles.pictureTrack
          ? `${SHEET}-back`
          : `${SHEET}-timing-p01`;
    // The chosen language's version and timing, when there is one; how subtitles look, always.
    const settingRows: SheetRow[] = [
      ...(chosen && chosenGroup
        ? [
            {
              focusKey: `${SHEET}-versions`,
              label: t('player.version'),
              spoken: `${t('player.version')}, ${versionValue}`,
              body: <SettingBody name={t('player.version')} value={versionValue} />,
              onPress: () => open('versions', versionKey(chosen.choice)),
            },
          ]
        : []),
      ...(choice !== null
        ? [
            {
              focusKey: `${SHEET}-timing`,
              label: t('player.timing'),
              spoken: `${t('player.timing')}, ${timingShown}`,
              body: <SettingBody name={t('player.timing')} value={timingShown} />,
              onPress: () => open('timing', timingFirst),
            },
          ]
        : []),
      {
        focusKey: `${SHEET}-style`,
        label: t('player.styleTab'),
        spoken: `${t('player.styleTab')}, ${styleSummary}`,
        body: <SettingBody name={t('player.styleTab')} value={styleSummary} />,
        onPress: () => open('style', `${SHEET}-style-choices`),
      },
    ];

    content = (
      <Pane focusKey={`${SHEET}-columns`} preferred={languageFocus} className={styles.columns}>
        <div className={`${styles.column} ${styles.audio}`}>
          <h2 className={styles.heading}>{t('player.audio')}</h2>
          {audioRows.length > 0 ? (
            <SheetList
              focusKey={`${SHEET}-audio-list`}
              rows={audioRows}
              preferred={audioRows.find((row) => row.selected)?.focusKey ?? audioRows[0]!.focusKey}
              remember={false}
              visible={VISIBLE}
            />
          ) : (
            <Note>{t('player.noAudioChoice')}</Note>
          )}
        </div>
        <div className={`${styles.column} ${styles.languages}`}>
          <h2 className={styles.heading}>
            {t('player.subtitles')}
            {status && <span className={styles.status}>{status}</span>}
          </h2>
          <SheetList
            focusKey={`${SHEET}-langs`}
            rows={languageRows}
            preferred={languageFocus}
            remember
            visible={VISIBLE}
          />
          {groups.length === 0 && <Note>{status ?? t('player.noSubtitles')}</Note>}
        </div>
        <div className={styles.divider} />
        <div className={`${styles.column} ${styles.settings}`}>
          <h2 className={styles.heading}>
            {chosenGroup
              ? t('player.languageSubtitles', { language: chosenGroup.name })
              : t('player.subtitleSettings')}
          </h2>
          <SheetList
            focusKey={`${SHEET}-settings`}
            rows={settingRows}
            preferred={settingRows[0]!.focusKey}
            remember={false}
            visible={3}
            rowHeight={TALL_ROW}
          />
        </div>
      </Pane>
    );
  } else if (view === 'versions') {
    const group = chosenGroup ?? groups[0];
    const numbered = group ? numberBySource(group.items) : [];
    const rows = numbered.map(({ item, number }): SheetRow => {
      const selected = sameChoice(item.choice, choice);
      const notes = noteOf(item, selected);
      const label = versionLabel(item, number);
      const short = item.release ? (releaseShort(item.release) ?? item.release) : undefined;
      const line = notes.slice(1).concat(short ? [short] : []);
      return {
        focusKey: versionKey(item.choice),
        label,
        spoken: [label, ...notes, short].filter(Boolean).join(', '),
        selected,
        // Passed over, for good reason: still there to pick by hand.
        dim:
          subtitles.statusOf(item.choice) === 'failed' || isUnfit(subtitles.checkOf(item.choice)),
        body: (
          <>
            <span className={styles.versionTop}>
              <span className={styles.versionName}>{label}</span>
              {notes[0] && <span className={rowParts.chip}>{notes[0]}</span>}
            </span>
            {line.length > 0 && <span className={rowParts.line}>{line.join(' · ')}</span>}
          </>
        ),
        onFocus: () => setFocusedVersion(versionKey(item.choice)),
        onPress: () => subtitles.choose(item.choice),
      };
    });
    const shown =
      numbered.find(({ item }) => versionKey(item.choice) === focusedVersion) ??
      numbered.find(({ item }) => sameChoice(item.choice, choice)) ??
      numbered[0];
    const title = group
      ? t('player.versionsHeading', { language: group.name, count: group.items.length })
      : t('player.subtitles');
    content = (
      <Pane
        focusKey={`${SHEET}-versions-view`}
        preferred={rows.find((row) => row.selected)?.focusKey ?? rows[0]?.focusKey}
        className={styles.view}
      >
        {backRow(title, status)}
        {rows.length > 0 ? (
          <>
            <SheetList
              focusKey={`${SHEET}-files`}
              rows={rows}
              preferred={rows.find((row) => row.selected)?.focusKey ?? rows[0]!.focusKey}
              remember={false}
              visible={VERSIONS_VISIBLE}
              rowHeight={TALL_ROW}
              className={styles.versionList}
            />
            {shown && (
              <SheetDetail
                className={styles.box}
                title={versionLabel(shown.item, shown.number)}
                text={noteOf(shown.item, sameChoice(shown.item.choice, choice)).join(' · ')}
                label={t('player.file')}
                name={shown.item.release}
              />
            )}
          </>
        ) : (
          <Note>{status ?? t('player.noSubtitles')}</Note>
        )}
      </Pane>
    );
  } else if (view === 'timing' && choice !== null && matching) {
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
    content = (
      <Pane
        focusKey={`${SHEET}-match`}
        preferred={matchFirst ?? `${SHEET}-back`}
        className={styles.view}
      >
        {backRow(
          t('player.matchLine'),
          t(match.paused ? 'player.matchPaused' : 'player.matchHint'),
        )}
        {rows.length === 0 ? (
          <Note>{t('player.matchWaiting')}</Note>
        ) : (
          <SheetList
            focusKey={`${SHEET}-match-list`}
            rows={rows}
            preferred={matchFirst ?? rows[0]!.focusKey}
            remember={false}
            visible={VERSIONS_VISIBLE}
            className={styles.wide}
          />
        )}
      </Pane>
    );
  } else if (view === 'timing') {
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
    const heading = backRow(t('player.timingHeading'));
    content =
      choice === null ? (
        <Pane focusKey={`${SHEET}-timing`} preferred={`${SHEET}-back`} className={styles.view}>
          {heading}
          <Note>{t('player.timingOff')}</Note>
        </Pane>
      ) : subtitles.pictureTrack ? (
        <Pane focusKey={`${SHEET}-timing`} preferred={`${SHEET}-back`} className={styles.view}>
          {heading}
          <Note>{t('player.matchPicture')}</Note>
        </Pane>
      ) : (
        <Pane
          focusKey={`${SHEET}-timing-view`}
          preferred={
            offer
              ? `${SHEET}-offer-use`
              : subtitles.canMatch
                ? `${SHEET}-timing-match`
                : `${SHEET}-timing-p01`
          }
          className={styles.view}
        >
          {heading}
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
      <Pane
        focusKey={`${SHEET}-style-view`}
        preferred={`${SHEET}-style-choices`}
        className={styles.view}
      >
        {backRow(t('player.style'))}
        <SubtitleStyleChoices focusKey={`${SHEET}-style-choices`} />
      </Pane>
    );
  }

  // Back from a setting goes to the three columns; from the columns it closes.
  const back = () => {
    if (matching) {
      closeMatch();
      return true;
    }
    if (view !== 'main') {
      toMain();
      return true;
    }
    props.onBack();
    return true;
  };

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.audioAndSubtitles')}
      defaultFocusKey={view === 'main' ? languageFocus : `${SHEET}-back`}
      returnFocusKey={props.returnFocusKey}
      onClose={props.onClose}
      onBack={back}
      placement="bottom"
    >
      {/* Each view's choices register afresh: a focusable keeps the key it was first given. */}
      <Fragment key={view}>{content}</Fragment>
    </Overlay>
  );
}

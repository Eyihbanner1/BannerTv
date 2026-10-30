import {
  groupByLanguage,
  keepOrder,
  type LanguageGroup,
  languageKey,
  languageName,
  numberBySource,
  releaseMatch,
  type StreamEntry,
} from '@bannertv/core';
import {
  doesFocusableExist,
  FocusContext,
  setFocus,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import { Fragment, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { preferences } from '../../data/preferences';
import { focusedKey } from '../../navigation/spatial';
import { inputMode } from '../../platform/input-mode';
import { audioDetail, audioSummary } from '../../player/audio';
import { streamTitle } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { formatOffset, offsetWay, stepOffset, TIMING_STEPS } from '../../player/timing';
import { type SheetRow, SheetList } from './SheetList';
import { SubtitleStyleChoices, useStyleSummary } from './SubtitleStylePanel';
import type { SubtitleChoice, Subtitles } from './use-subtitles';
import styles from './TracksSheet.module.css';

export type SheetTab = 'subtitles' | 'audio' | 'timing' | 'style';

const SHEET = 'player-tracks';
const TABS: readonly SheetTab[] = ['subtitles', 'audio', 'timing', 'style'];
/** Rows a column shows at a time. */
const VISIBLE = 4;

/** A subtitle file or one of the stream's own tracks, as one version of its language. */
interface Version {
  choice: NonNullable<SubtitleChoice>;
  lang: string;
  source: string;
  /** The release name an addon sent. */
  release?: string;
}

const versionId = (choice: NonNullable<SubtitleChoice>) =>
  choice.kind === 'file' ? `file:${choice.key}` : `track:${choice.id}`;

const versionKey = (choice: NonNullable<SubtitleChoice>) =>
  choice.kind === 'file' ? `${SHEET}-file-${choice.key}` : `${SHEET}-track-${choice.id}`;

const sameChoice = (a: SubtitleChoice, b: SubtitleChoice) =>
  a !== null && b !== null && versionId(a) === versionId(b);

/** The language of the subtitles showing, for the chip and the tab; none when off. */
export function subtitlesValue(subtitles: Subtitles): string | undefined {
  const { choice } = subtitles;
  if (!choice) return undefined;
  if (choice.kind === 'track') {
    const track = subtitles.tracks.find((candidate) => candidate.id === choice.id);
    return (track?.lang && languageName(track.lang)) || track?.label || undefined;
  }
  const option = subtitles.options.find((candidate) => candidate.key === choice.key);
  return option ? languageName(option.lang) || undefined : undefined;
}

/**
 * Puts items in the order first seen under a scope (the languages, each
 * language's versions): those shown keep their places, new ones go after.
 * The same items give the same order, so drawing twice lands on it again.
 */
function rememberOrder() {
  const seen = new Map<string, string[]>();
  return <T,>(scope: string, items: readonly T[], id: (item: T) => string): T[] => {
    const byId = new Map(items.map((item) => [id(item), item]));
    const order = keepOrder(seen.get(scope) ?? [], Array.from(byId.keys()));
    seen.set(scope, order);
    return order.map((key) => byId.get(key)!);
  };
}

interface TracksSheetProps {
  audio: readonly EngineTrack[];
  subtitles: Subtitles;
  entry: StreamEntry | null;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  /** Focused again when it closes: read at closing time. */
  returnFocusKey: () => string;
  onAudio: (track: EngineTrack) => void;
  /** Back from the tabs: the sheet closes onto the controls. */
  onBack: () => void;
  /** Blue, or a click above it. */
  onClose: () => void;
}

/** A column that only says something: still asking, nothing found. */
function Note({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

/** A focusable box for one tab's content, so Up from anywhere in it reaches the tabs. */
function Pane({
  focusKey,
  preferred,
  className,
  children,
}: {
  focusKey: string;
  preferred?: string;
  className?: string;
  children: ReactNode;
}) {
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: false,
    preferredChildFocusKey: preferred,
  });
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}

function Tabs({
  tab,
  values,
  onTab,
  aside,
}: {
  tab: SheetTab;
  values: Record<SheetTab, string>;
  onTab: (tab: SheetTab) => void;
  aside?: string;
}) {
  const { t } = useTranslation();
  const names: Record<SheetTab, string> = {
    subtitles: t('player.subtitles'),
    audio: t('player.audio'),
    timing: t('player.timing'),
    style: t('player.styleTab'),
  };
  return (
    <Pane focusKey={`${SHEET}-tabs`} preferred={`${SHEET}-tab-${tab}`} className={styles.tabs}>
      {TABS.map((name) => (
        <Pressable
          key={name}
          focusKey={`${SHEET}-tab-${name}`}
          label={`${names[name]}, ${values[name]}`}
          className={name === tab ? `${styles.tab} ${styles.current}` : styles.tab}
          focusedClassName={styles.tabFocused}
          // Moving along the tabs shows each one's choices, as the season tabs
          // do. The pointer passing over them on its way down does not: a click does.
          onFocus={() => {
            if (inputMode.get() !== 'pointer') onTab(name);
          }}
          onPress={() => {
            if (name !== tab) onTab(name);
            // On to its choices, when it has any: Timing with subtitles off has none.
            else if (doesFocusableExist(`${SHEET}-${name}`)) void setFocus(`${SHEET}-${name}`);
          }}
        >
          <span className={styles.tabName}>{names[name]}</span>
          <span className={styles.tabValue}>{values[name]}</span>
        </Pressable>
      ))}
      {aside && <span className={styles.aside}>{aside}</span>}
    </Pane>
  );
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
  const { audio, subtitles, entry, tab, onTab, onAudio } = props;
  const { t } = useTranslation();
  const styleSummary = useStyleSummary();
  const { choice } = subtitles;
  // The language last chosen comes first, as it was when the sheet opened.
  const [firstLanguage] = useState(() => preferences.get().subtitleLanguage);
  // Languages and versions keep the places they had when first shown.
  const [stable] = useState(rememberOrder);

  // Every version, the stream's own tracks first: they are always in step.
  const versions: Version[] = [
    ...subtitles.tracks.map((track) => ({
      choice: { kind: 'track', id: track.id } as const,
      lang: track.lang,
      source: t('player.inTheStream'),
      release:
        track.label && track.label.toLowerCase() !== languageName(track.lang).toLowerCase()
          ? track.label
          : undefined,
    })),
    ...subtitles.options.map((option) => ({
      choice: { kind: 'file', key: option.key } as const,
      lang: option.lang,
      source: option.source,
      release: option.label,
    })),
  ];
  // The stream's own tracks stay first, even one listed after the files.
  const inOrder = (group: LanguageGroup<Version>, kind: Version['choice']['kind']) =>
    stable(
      `${group.key}|${kind}`,
      group.items.filter((item) => item.choice.kind === kind),
      (item) => versionId(item.choice),
    );
  const groups = stable(
    '',
    groupByLanguage(versions, firstLanguage).map((group): LanguageGroup<Version> => ({
      ...group,
      items: inOrder(group, 'track').concat(inOrder(group, 'file')),
    })),
    (group) => group.key,
  );
  const chosen = choice ? versions.find((v) => sameChoice(v.choice, choice)) : undefined;
  const chosenLanguage = chosen ? languageKey(chosen.lang) : null;
  const [view, setView] = useState(chosenLanguage);
  const shown =
    groups.find((group) => group.key === view) ??
    groups.find((group) => group.key === chosenLanguage) ??
    groups[0];

  const video = entry
    ? { filename: entry.stream.behaviorHints.filename, title: streamTitle(entry) }
    : {};
  const versionRow = ({ item, number }: { item: Version; number?: number }): SheetRow => {
    const selected = sameChoice(item.choice, choice);
    const status = subtitles.statusOf(item.choice);
    const said =
      status === 'loading'
        ? t('player.versionLoading')
        : status === 'failed'
          ? t(selected ? 'player.versionFailed' : 'player.versionSkipped')
          : releaseMatch(item.release, video)
            ? t('player.matchesVideo')
            : undefined;
    return {
      focusKey: versionKey(item.choice),
      label:
        number === undefined
          ? item.source
          : t('player.sourceNumber', { source: item.source, number }),
      detail: [item.release, said].filter(Boolean).join(' · ') || undefined,
      selected,
      dim: status === 'failed',
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
        // The language showing: on to its versions. Another: its first that loads.
        if (group.key === chosenLanguage && chosen) {
          if (inputMode.get() !== 'pointer') void setFocus(versionKey(chosen.choice));
          return;
        }
        const first =
          group.items.find((item) => subtitles.statusOf(item.choice) !== 'failed') ??
          group.items[0]!;
        subtitles.choose(first.choice);
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
                : t('player.noSubtitles')}
            </Note>
          </div>
        )}
      </Pane>
    );
  } else if (tab === 'audio') {
    const rows = audio.map((track): SheetRow => ({
      focusKey: `${SHEET}-audio-${track.id}`,
      label: (track.lang && languageName(track.lang)) || track.label || '?',
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
  } else if (tab === 'timing') {
    const { way, amount } = offsetWay(subtitles.offset);
    content =
      choice === null ? (
        <div className={styles.content}>
          <Note>{t('player.timingOff')}</Note>
        </div>
      ) : (
        <Pane
          focusKey={`${SHEET}-timing`}
          preferred={`${SHEET}-timing-p01`}
          className={styles.content}
        >
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
          <div className={styles.steps}>
            {TIMING_STEPS.map((step) => {
              const size = Math.abs(step).toFixed(1);
              return (
                <Pressable
                  key={step}
                  focusKey={`${SHEET}-timing-${step < 0 ? 'm' : 'p'}${size.replace('.', '')}`}
                  label={t(step < 0 ? 'player.earlierBy' : 'player.laterBy', { amount: size })}
                  className={styles.step}
                  focusedClassName={styles.stepFocused}
                  onPress={() => subtitles.setOffset(stepOffset(subtitles.offset, step))}
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
              onPress={() => subtitles.setOffset(0)}
            >
              {t('player.timingReset')}
            </Pressable>
          </div>
          <p className={styles.kept}>{t('player.timingKept')}</p>
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
  const values: Record<SheetTab, string> = {
    subtitles: subtitlesValue(subtitles) ?? t('player.subtitlesOff'),
    audio: active ? audioSummary(active) : t('player.audioDefault'),
    timing: formatOffset(subtitles.offset),
    style: styleSummary,
  };

  // Back from a tab's choices goes to the tabs; from the tabs it closes.
  const back = () => {
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
      <Tabs
        tab={tab}
        values={values}
        onTab={onTab}
        aside={
          tab === 'subtitles' && subtitles.pending > 0 && groups.length > 0
            ? t('player.stillAsking', { count: subtitles.pending })
            : undefined
        }
      />
      {/* Each tab's choices register afresh: a focusable keeps the key it was first given. */}
      <Fragment key={tab}>{content}</Fragment>
    </Overlay>
  );
}

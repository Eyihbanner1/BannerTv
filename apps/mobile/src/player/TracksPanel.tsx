import { type LanguageGroup, languageKey, numberBySource, type StreamEntry } from '@bannertv/core';
import { preferences } from '@tv/data/preferences';
import {
  createOrderMemory,
  DRIFT_CHOICES,
  isUnfit,
  languageFirstPick,
  type OrderMemory,
  playingRelease,
  sameChoice,
  subtitleVersions,
  syncLine,
  type SubtitleVersion,
  VERSION_NOTES,
  versionDetail,
  versionGroups,
  versionId,
  versionNotes,
} from '@tv/player/subtitle-versions';
import {
  COARSE_TIMING_STEPS,
  formatOffset,
  offsetWay,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_STEPS,
} from '@tv/player/timing';
import type { SubtitleChoice, Subtitles } from '@tv/screens/player/use-subtitles';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip } from '../ui/Chip';
import { colors, radius, space, touch, type } from '../ui/theme';
import { PanelOption } from './SidePanel';

type Tab = 'subtitles' | 'audio' | 'timing';

export interface TracksPanelProps {
  subtitles: Subtitles;
  /** The stream playing, whose release name the versions are matched against. */
  entry: StreamEntry | null;
  /**
   * The player draws the stream's own subtitle tracks itself (Android), and no lines of them
   * reach the page, so timing and the drift fix cannot move them.
   */
  /** Off or a version was picked: the panel closes. */
  onChoose: (choice: SubtitleChoice) => void;
  /**
   * The Audio tab's rows, made by the player, which switches audio (and streams); null when
   * the stream has no audio to choose from.
   */
  audioRows: ReactNode;
  /** Opens the subtitle style, from the foot of the Subtitles tab. */
  onStyle?: () => void;
}

/**
 * The player's audio and subtitles panel, as the TV's sheet has them: Subtitles, Audio and
 * Timing tabs. Subtitles lists Off and the languages, the last chosen first, each with how
 * many versions it has; the open language shows its versions under it, numbered by source,
 * each saying first whether it is loading, couldn't be read, or is linked to the video or the
 * same release. Rows keep their places while the panel is open, as more addons answer. Mount
 * it only while open, so each opening starts afresh, as the TV's sheet does.
 */
export function TracksPanel(props: TracksPanelProps) {
  const { subtitles } = props;
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('subtitles');
  // The language last chosen comes first, as it was when the panel opened.
  const [firstLanguage] = useState(() => preferences.get().subtitleLanguage);
  // Languages and versions keep the places they had when first shown, across tabs too.
  const [order] = useState(createOrderMemory);
  // The language whose versions show; until one is tapped, the one showing.
  const [open, setOpen] = useState<string | null>(null);

  const { choice, offset, drift } = subtitles;
  const moved = choice !== null && (offset !== 0 || drift !== null);
  const linedUp = choice !== null && subtitles.sync?.state === 'moved';
  const timingName =
    moved || linedUp
      ? [
          `${t('player.timing')} ${formatOffset(offset)}`,
          linedUp ? t('player.linedUp') : null,
          drift ? t('player.driftFixed') : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
      : t('player.timing');

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Chip
          label={t('phone.subtitles')}
          on={tab === 'subtitles'}
          onPress={() => setTab('subtitles')}
        />
        <Chip label={t('phone.audio')} on={tab === 'audio'} onPress={() => setTab('audio')} />
        <Chip label={timingName} on={tab === 'timing'} onPress={() => setTab('timing')} />
      </View>
      <View style={styles.content}>
        {tab === 'subtitles' ? (
          <SubtitleChoices
            subtitles={subtitles}
            entry={props.entry}
            firstLanguage={firstLanguage}
            order={order}
            open={open}
            onOpen={setOpen}
            onChoose={props.onChoose}
            {...(props.onStyle ? { onStyle: props.onStyle } : {})}
          />
        ) : tab === 'audio' ? (
          <AudioChoices rows={props.audioRows} />
        ) : (
          <TimingChoices subtitles={subtitles} />
        )}
      </View>
    </View>
  );
}

/** The Subtitles tab: Off, the languages, and the open language's versions under it. */
function SubtitleChoices({
  subtitles,
  entry,
  firstLanguage,
  order,
  open,
  onOpen,
  onChoose,
  onStyle,
}: {
  subtitles: Subtitles;
  entry: StreamEntry | null;
  firstLanguage: string | null;
  order: OrderMemory;
  open: string | null;
  onOpen: (language: string) => void;
  onChoose: (choice: SubtitleChoice) => void;
  onStyle?: () => void;
}) {
  const { t } = useTranslation();
  const { choice } = subtitles;
  const versions = subtitleVersions(subtitles, t('phone.embeddedSubtitles'));
  const groups = versionGroups(versions, firstLanguage, order);
  const chosen = choice ? versions.find((v) => sameChoice(v.choice, choice)) : undefined;
  const chosenLanguage = chosen ? languageKey(chosen.lang) : null;
  // A language the viewer opened stays open, whatever the start-of-stream choice settles on.
  const shown =
    groups.find((group) => group.key === open) ??
    groups.find((group) => group.key === chosenLanguage);
  const video = playingRelease(entry);

  const versionRow = ({ item, number }: { item: SubtitleVersion; number?: number }) => {
    const selected = sameChoice(item.choice, choice);
    const status = subtitles.statusOf(item.choice);
    const check = subtitles.checkOf(item.choice);
    const notes = versionNotes(item, selected, status, video, check).map((note) =>
      t(VERSION_NOTES[note]),
    );
    const label =
      number === undefined
        ? item.source
        : t('player.sourceNumber', { source: item.source, number });
    // The notes first: a long release name is cut at the end, and the notes must stay in sight.
    const detail = versionDetail(notes, item.release);
    return (
      <PanelOption
        key={versionId(item.choice)}
        label={label}
        {...(detail ? { detail } : {})}
        selected={selected}
        // Passed over, for good reason: still there to pick by hand.
        dim={status === 'failed' || isUnfit(check)}
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
        onPress={() => onChoose(item.choice)}
      />
    );
  };

  // A language not showing starts on its best placed version, which the player may move
  // from once it has read the language's files, and the panel stays open on its versions;
  // the language showing only opens.
  const pickLanguage = (group: LanguageGroup<SubtitleVersion>) => {
    onOpen(group.key);
    if (group.key === chosenLanguage) return;
    subtitles.choose(languageFirstPick(group, subtitles, video).choice, 'language');
  };

  return (
    <ScrollView>
      <PanelOption
        label={t('phone.subtitlesOff')}
        selected={choice === null}
        onPress={() => onChoose(null)}
      />
      {groups.map((group) => {
        const versionsLabel = t('player.versions', { count: group.items.length });
        return (
          <View key={group.key}>
            <PanelOption
              label={group.name}
              detail={versionsLabel}
              selected={group.key === chosenLanguage}
              accessibilityLabel={`${group.name}, ${versionsLabel}`}
              onPress={() => pickLanguage(group)}
            />
            {group.key === shown?.key ? (
              <View style={styles.versions}>{numberBySource(group.items).map(versionRow)}</View>
            ) : null}
          </View>
        );
      })}
      {subtitles.pending > 0 ? (
        <Text style={styles.note}>{t('player.stillAsking', { count: subtitles.pending })}</Text>
      ) : groups.length === 0 ? (
        <Text style={styles.note}>{t('player.noSubtitles')}</Text>
      ) : null}
      {onStyle ? (
        <PanelOption label={t('player.style')} detail={t('phone.styleFor')} onPress={onStyle} />
      ) : null}
    </ScrollView>
  );
}

/**
 * The Audio tab: the rows the player made (its audio tracks, as the panel has always listed
 * them), or a note when there are none. The player owns the rows, so one that is not a track
 * (a stream in the viewer's language) joins them there.
 */
function AudioChoices({ rows }: { rows: ReactNode }) {
  const { t } = useTranslation();
  if (rows === null || rows === undefined || rows === false) {
    return <Text style={styles.note}>{t('player.noAudioChoice')}</Text>;
  }
  return <ScrollView>{rows}</ScrollView>;
}

/** A Timing step or Reset: a quiet pill, as wide as its row allows. */
function Step({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
    >
      <Text style={styles.stepText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The Timing tab: how far the subtitles showing are moved, steps of a tenth and half a second
 * and of 5 s either way, Reset, and the drift fix for a file timed for another frame rate.
 * Both are kept for the file. Not for subtitles off, nor for tracks the player draws itself.
 */
function TimingChoices({ subtitles }: { subtitles: Subtitles }) {
  const { t } = useTranslation();
  if (subtitles.choice === null) return <Text style={styles.note}>{t('player.timingOff')}</Text>;

  const { offset } = subtitles;
  const { way, amount } = offsetWay(offset);
  // What lining the file up against the video did: moved by BannerTV, or why not.
  const sync = syncLine(subtitles.sync);
  const step = (by: number) => (
    <Step
      key={by}
      label={stepLabel(by)}
      accessibilityLabel={t(by < 0 ? 'player.earlierBy' : 'player.laterBy', {
        amount: stepAmount(by),
      })}
      onPress={() => subtitles.setOffset(stepOffset(subtitles.offset, by))}
    />
  );
  return (
    <ScrollView>
      <Text style={styles.offset}>{formatOffset(offset)}</Text>
      <Text style={styles.way}>
        {way === 'later'
          ? t('player.timingLater', { amount })
          : way === 'earlier'
            ? t('player.timingEarlier', { amount })
            : t('player.timingNone')}
      </Text>
      <View style={styles.steps}>{TIMING_STEPS.map(step)}</View>
      <View style={styles.steps}>
        {COARSE_TIMING_STEPS.map(step)}
        <Step
          label={t('player.timingReset')}
          accessibilityLabel={t('player.timingReset')}
          onPress={() => subtitles.setOffset(0)}
        />
      </View>
      {sync ? (
        <Text style={styles.note}>
          {t(sync.key, sync.amount !== undefined ? { amount: sync.amount } : undefined)}
        </Text>
      ) : null}
      {/* For a file timed for another frame rate, which slides further out as the film goes on.
          Not for a track inside the file, whose lines Android shows and clears itself. */}
      {subtitles.canFixDrift ? (
        <>
          <Text style={styles.rowLabel}>{t('player.drift')}</Text>
          <View style={styles.drifts}>
            {DRIFT_CHOICES.map(({ name, drift, label }) => (
              <Chip
                key={name}
                label={t(label)}
                on={subtitles.drift === drift}
                onPress={() => subtitles.setDrift(drift)}
              />
            ))}
          </View>
          <Text style={styles.note}>
            {`${t(subtitles.autoDrift ? 'player.driftAuto' : 'player.driftHint')} ${t('player.timingKept')}`}
          </Text>
        </>
      ) : (
        <Text style={styles.note}>{t('player.timingKept')}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: space.m },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  content: { flex: 1 },
  versions: { marginLeft: space.l },
  note: { ...type.small, color: colors.textMuted, padding: space.m },
  offset: { ...type.heading, color: colors.text, paddingHorizontal: space.m },
  way: { ...type.small, color: colors.textMuted, paddingHorizontal: space.m },
  steps: { flexDirection: 'row', gap: space.s, marginTop: space.m },
  step: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: touch.min,
    paddingHorizontal: space.s,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: { backgroundColor: colors.raised },
  stepText: { ...type.label, color: colors.text },
  rowLabel: { ...type.overline, color: colors.accent, marginTop: space.l },
  drifts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
});

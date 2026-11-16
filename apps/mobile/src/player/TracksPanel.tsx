import { type LanguageGroup, languageKey, numberBySource, type StreamEntry } from '@bannertv/core';
import { preferences } from '@tv/data/preferences';
import {
  createOrderMemory,
  DRIFT_CHOICES,
  driftHintKey,
  driftOn,
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
  lineText,
  offsetWay,
  stepAmount,
  stepLabel,
  stepOffset,
  TIMING_STEPS,
} from '@tv/player/timing';
import { type MatchClock, useMatchRows } from '@tv/screens/player/use-match-rows';
import type { MatchResult, SubtitleChoice, Subtitles } from '@tv/screens/player/use-subtitles';
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
  /** Off or a version was picked: the panel closes. */
  onChoose: (choice: SubtitleChoice) => void;
  /**
   * The Audio tab's rows, made by the player, which switches audio (and streams); null when
   * the stream has no audio to choose from.
   */
  audioRows: ReactNode;
  /** Opens the subtitle style, from the foot of the Subtitles tab. */
  onStyle?: () => void;
  /** The player's clock now, read as a line is tapped; null before there is a video. */
  clock: () => MatchClock | null;
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
          <TimingChoices subtitles={subtitles} clock={props.clock} />
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
      ) : subtitles.subdlAsking ? (
        <Text style={styles.note}>{t('player.stillSubdl')}</Text>
      ) : subtitles.hashReading ? (
        <Text style={styles.note}>{t('player.stillLinking')}</Text>
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

/** What matching a line did, in the words the TV uses. */
function matchNote(result: MatchResult): { key: string; again: boolean } {
  if (result.presses === 1) return { key: 'player.matchDone', again: result.again };
  if ('unsteady' in result) return { key: 'player.matchUnsteady', again: false };
  return { key: result.drift ? 'player.matchDrift' : 'player.matchBoth', again: false };
}

/**
 * The Timing tab: last episode's timing, offered where it may be; the lines around now, to tap
 * the one just heard (a second tap, much later in the film, fixes a drift too); how far the
 * subtitles showing are moved, steps of a tenth and half a second and of 5 s either way,
 * Reset, Undo after a tap, and the drift fix for a file timed for another frame rate. Both are
 * kept for the file. Not for subtitles off, nor for picture tracks the player draws itself.
 */
function TimingChoices({
  subtitles,
  clock,
}: {
  subtitles: Subtitles;
  clock: () => MatchClock | null;
}) {
  const { t } = useTranslation();
  // What the last tap did, said until the next change.
  const [lastMatch, setLastMatch] = useState<MatchResult | null>(null);
  const match = useMatchRows(
    subtitles.canMatch ? subtitles.cues : null,
    subtitles.offset,
    clock,
    undefined,
  );
  if (subtitles.choice === null) return <Text style={styles.note}>{t('player.timingOff')}</Text>;
  if (subtitles.pictureTrack) {
    return <Text style={styles.note}>{t('player.matchPicture')}</Text>;
  }

  const { offset, offer, cues } = subtitles;
  const { way, amount } = offsetWay(offset);
  // What lining the file up against the video did: moved by BannerTV, or why not.
  const sync = syncLine(subtitles.sync);
  // Any other change says nothing more of the last tap.
  const change = (act: () => void) => () => {
    setLastMatch(null);
    act();
  };
  const step = (by: number) => (
    <Step
      key={by}
      label={stepLabel(by)}
      accessibilityLabel={t(by < 0 ? 'player.earlierBy' : 'player.laterBy', {
        amount: stepAmount(by),
      })}
      onPress={change(() => subtitles.setOffset(stepOffset(subtitles.offset, by)))}
    />
  );
  const offerAmount = offer
    ? offer.drift
      ? t('player.offerAmountDrift', { amount: formatOffset(offer.offset) })
      : formatOffset(offer.offset)
    : '';
  const said = lastMatch ? matchNote(lastMatch) : null;
  return (
    <ScrollView>
      {offer ? (
        <>
          <Text style={styles.offerText}>{t('player.offerTiming', { amount: offerAmount })}</Text>
          <View style={styles.steps}>
            <Step
              label={t('player.offerUse')}
              accessibilityLabel={t('player.offerUse')}
              onPress={change(() => subtitles.takeOffer())}
            />
            <Step
              label={t('player.offerNo')}
              accessibilityLabel={t('player.offerNo')}
              onPress={change(() => subtitles.declineOffer())}
            />
          </View>
        </>
      ) : null}
      {subtitles.canMatch && cues ? (
        <>
          <Text style={styles.rowLabel}>{t('player.matchLine')}</Text>
          <Text style={styles.note}>
            {t(match.paused ? 'player.matchPausedTap' : 'player.matchHintTap')}
          </Text>
          {match.rows.length === 0 ? (
            <Text style={styles.note}>{t('player.matchWaiting')}</Text>
          ) : (
            match.rows.map((row) => {
              const label = lineText(cues[row.index]!);
              const detail = row.onScreen ? t('player.matchOnScreen') : undefined;
              return (
                <PanelOption
                  key={`match-${row.key}`}
                  label={label}
                  {...(detail ? { detail } : {})}
                  accessibilityLabel={label}
                  onPress={() => {
                    // The clock as the viewer tapped, read now: never a value kept from a draw.
                    const now = clock();
                    if (!now || now.paused) return;
                    setLastMatch(
                      subtitles.matchLine(row.index, { time: now.time, speed: now.speed }),
                    );
                  }}
                />
              );
            })
          )}
        </>
      ) : null}
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
          onPress={change(() => subtitles.setOffset(0))}
        />
        {lastMatch ? (
          <Step
            label={t('player.matchUndo')}
            accessibilityLabel={t('player.matchUndo')}
            onPress={() => {
              subtitles.undoMatch();
              setLastMatch(null);
            }}
          />
        ) : null}
      </View>
      {said && lastMatch ? (
        <Text style={styles.note}>
          {t(said.key, { amount: formatOffset(lastMatch.offset) })}
          {said.again ? ` ${t('player.matchAgain')}` : ''}
        </Text>
      ) : sync ? (
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
                on={driftOn(subtitles, drift)}
                onPress={change(() => subtitles.setDrift(drift))}
              />
            ))}
          </View>
          {lastMatch ? null : (
            <Text style={styles.note}>
              {`${t(driftHintKey(subtitles))} ${t('player.timingKept')}`}
            </Text>
          )}
        </>
      ) : lastMatch ? null : (
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
  offerText: { ...type.body, color: colors.text, paddingHorizontal: space.m },
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

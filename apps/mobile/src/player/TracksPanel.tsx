import {
  type LanguageGroup,
  languageKey,
  numberBySource,
  releaseShort,
  type StreamEntry,
} from '@bannertv/core';
import { preferences } from '@tv/data/preferences';
import {
  createOrderMemory,
  DRIFT_CHOICES,
  driftHintKey,
  driftOn,
  isUnfit,
  languageFirstPick,
  playingRelease,
  sameChoice,
  subtitleVersions,
  syncLine,
  type SubtitleVersion,
  VERSION_NOTES,
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
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Chip } from '../ui/Chip';
import { colors, radius, space, touch, type } from '../ui/theme';
import { BackRow, ChoiceHeading, ChoiceRow } from './ChoiceRow';
import { useSubtitleStyle } from './SubtitleStyle';

/** What the panel shows: the three columns, or one of the chosen language's settings. */
type PanelView = 'main' | 'versions' | 'timing';

/** Narrower than this, the three columns stack: a phone held upright. */
const COLUMNS_FROM = 600;

export interface TracksPanelProps {
  subtitles: Subtitles;
  /** The stream playing, whose release name the versions are matched against. */
  entry: StreamEntry | null;
  /** Off or a version was picked: the panel closes. */
  onChoose: (choice: SubtitleChoice) => void;
  /**
   * The Audio column's rows, made by the player, which switches audio (and streams); null
   * when the stream has no audio to choose from.
   */
  audioRows: ReactNode;
  /** Opens the subtitle style, from the Style row. */
  onStyle?: () => void;
  /** The player's clock now, read as a line is tapped; null before there is a video. */
  clock: () => MatchClock | null;
}

/**
 * The player's audio and subtitles, as the TV's sheet has them: three columns side by side
 * (the audio, the subtitle languages, and the chosen language's settings: its version, its
 * timing and how subtitles look), stacked when the phone is held upright. A language starts
 * on its best version; its versions, each on two lines with what is known of it, and its
 * timing are one step in, with Back to the columns. Rows keep their places while the panel is
 * open, as more addons answer. Mount it only while open, so each opening starts afresh.
 */
export function TracksPanel(props: TracksPanelProps) {
  const { subtitles } = props;
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [view, setView] = useState<PanelView>('main');
  // The language last chosen comes first, as it was when the panel opened.
  const [firstLanguage] = useState(() => preferences.get().subtitleLanguage);
  // Languages and versions keep the places they had when first shown, across views too.
  const [order] = useState(createOrderMemory);
  const look = useSubtitleStyle();

  const { choice, offset, drift } = subtitles;
  const versions = subtitleVersions(subtitles, t('phone.embeddedSubtitles'));
  const groups = versionGroups(versions, firstLanguage, order);
  const chosen = choice ? versions.find((v) => sameChoice(v.choice, choice)) : undefined;
  const chosenLanguage = chosen ? languageKey(chosen.lang) : null;
  const chosenGroup = groups.find((group) => group.key === chosenLanguage);
  const video = playingRelease(props.entry);
  const versionLabel = (item: SubtitleVersion, number?: number) =>
    number === undefined ? item.source : t('player.sourceNumber', { source: item.source, number });
  const status =
    subtitles.pending > 0
      ? t('player.stillAsking', { count: subtitles.pending })
      : subtitles.subdlAsking
        ? t('player.stillSubdl')
        : subtitles.hashReading
          ? t('player.stillLinking')
          : undefined;

  if (view === 'versions' && chosenGroup) {
    return (
      <VersionChoices
        group={chosenGroup}
        subtitles={subtitles}
        video={video}
        status={status}
        versionLabel={versionLabel}
        onBack={() => setView('main')}
        onChoose={props.onChoose}
      />
    );
  }
  if (view === 'timing') {
    return (
      <View style={styles.root}>
        <BackRow
          title={t('player.timingHeading')}
          backLabel={t('common.back')}
          onPress={() => setView('main')}
        />
        <TimingChoices subtitles={subtitles} clock={props.clock} />
      </View>
    );
  }

  // A language not showing starts on its best placed version, which the player may move from
  // once it has read the language's files, and the panel stays open; the language showing
  // goes on to its versions.
  const pickLanguage = (group: LanguageGroup<SubtitleVersion>) => {
    if (group.key === chosenLanguage) {
      setView('versions');
      return;
    }
    subtitles.choose(languageFirstPick(group, subtitles, video).choice, 'language');
  };
  const timingValue =
    subtitles.offer && choice !== null
      ? t('player.timingOffered')
      : [
          formatOffset(offset),
          subtitles.sync?.state === 'moved' ? t('player.linedUp') : null,
          drift ? t('player.driftFixed') : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
  const chosenNumber = chosenGroup
    ? numberBySource(chosenGroup.items).find((v) => v.item === chosen)?.number
    : undefined;
  const styleSummary = t('player.styleSummary', {
    size: t(`player.styleValue.size.${look.size}`),
    colour: t(`player.styleColourInline.${look.colour}`),
  });

  // Side by side, each column scrolls on its own; stacked, the whole panel scrolls.
  const wide = width >= COLUMNS_FROM;
  const List = wide ? ScrollView : View;
  const column = wide ? styles.column : undefined;
  const audio = (
    <View style={column}>
      <ChoiceHeading>{t('phone.audio')}</ChoiceHeading>
      <AudioChoices rows={props.audioRows} scroll={wide} />
    </View>
  );
  const languages = (
    <View style={column}>
      <ChoiceHeading {...(status ? { aside: status } : {})}>{t('phone.subtitles')}</ChoiceHeading>
      <List>
        <ChoiceRow
          label={t('phone.subtitlesOff')}
          selected={choice === null}
          onPress={() => props.onChoose(null)}
        />
        {groups.map((group) => (
          <ChoiceRow
            key={group.key}
            label={group.name}
            selected={group.key === chosenLanguage}
            accessibilityLabel={`${group.name}, ${t('player.versions', { count: group.items.length })}`}
            onPress={() => pickLanguage(group)}
          />
        ))}
        {groups.length === 0 && !status ? (
          <Text style={styles.note}>{t('player.noSubtitles')}</Text>
        ) : null}
      </List>
    </View>
  );
  const settings = (
    <View style={wide ? [styles.column, styles.settings] : undefined}>
      <ChoiceHeading>
        {chosenGroup
          ? t('player.languageSubtitles', { language: chosenGroup.name })
          : t('player.subtitleSettings')}
      </ChoiceHeading>
      <List>
        {chosen && chosenGroup ? (
          <ChoiceRow
            label={t('player.version')}
            line={`${versionLabel(chosen, chosenNumber)} · ${t('player.versions', {
              count: chosenGroup.items.length,
            })}`}
            chevron
            onPress={() => setView('versions')}
          />
        ) : null}
        {choice !== null ? (
          <ChoiceRow
            label={t('player.timing')}
            line={timingValue}
            chevron
            onPress={() => setView('timing')}
          />
        ) : null}
        {props.onStyle ? (
          <ChoiceRow
            label={t('player.styleTab')}
            line={styleSummary}
            chevron
            onPress={props.onStyle}
          />
        ) : null}
      </List>
    </View>
  );

  if (!wide) {
    return (
      <ScrollView contentContainerStyle={styles.stack}>
        {languages}
        {settings}
        {audio}
      </ScrollView>
    );
  }
  return (
    <View style={styles.columns}>
      {audio}
      {languages}
      <View style={styles.divider} />
      {settings}
    </View>
  );
}

/**
 * The chosen language's versions, one step in: each on two lines, its name and the note that
 * matters most, then what else is known and its release name cut to what tells copies apart.
 * The version showing has its release name in full underneath.
 */
function VersionChoices({
  group,
  subtitles,
  video,
  status,
  versionLabel,
  onBack,
  onChoose,
}: {
  group: LanguageGroup<SubtitleVersion>;
  subtitles: Subtitles;
  video: ReturnType<typeof playingRelease>;
  status?: string;
  versionLabel: (item: SubtitleVersion, number?: number) => string;
  onBack: () => void;
  onChoose: (choice: SubtitleChoice) => void;
}) {
  const { t } = useTranslation();
  const { choice } = subtitles;
  const chosen = group.items.find((item) => sameChoice(item.choice, choice));
  return (
    <View style={styles.root}>
      <BackRow
        title={t('player.versionsHeading', { language: group.name, count: group.items.length })}
        backLabel={t('common.back')}
        onPress={onBack}
      />
      <ScrollView>
        {numberBySource(group.items).map(({ item, number }) => {
          const selected = sameChoice(item.choice, choice);
          const check = subtitles.checkOf(item.choice);
          const itemStatus = subtitles.statusOf(item.choice);
          const notes = versionNotes(item, selected, itemStatus, video, check).map((note) =>
            t(VERSION_NOTES[note]),
          );
          const label = versionLabel(item, number);
          const short = item.release ? (releaseShort(item.release) ?? item.release) : undefined;
          const line = notes.slice(1).concat(short ? [short] : []);
          return (
            <ChoiceRow
              key={versionId(item.choice)}
              label={label}
              {...(notes[0] ? { chip: notes[0] } : {})}
              {...(line.length > 0 ? { line: line.join(' · ') } : {})}
              selected={selected}
              // Passed over, for good reason: still there to pick by hand.
              dim={itemStatus === 'failed' || isUnfit(check)}
              accessibilityLabel={[label, ...notes, item.release].filter(Boolean).join(', ')}
              onPress={() => onChoose(item.choice)}
            />
          );
        })}
        {status ? <Text style={styles.note}>{status}</Text> : null}
        {chosen?.release ? (
          <View style={styles.file}>
            <Text style={styles.fileLabel}>{t('player.file')}</Text>
            <Text style={styles.fileName}>{chosen.release}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * The Audio column: the rows the player made (its audio tracks), or a note when there are
 * none. The player owns the rows, so one that is not a track (a stream in the viewer's
 * language) joins them there.
 */
function AudioChoices({ rows, scroll }: { rows: ReactNode; scroll: boolean }) {
  const { t } = useTranslation();
  if (rows === null || rows === undefined || rows === false) {
    return <Text style={styles.note}>{t('player.noAudioChoice')}</Text>;
  }
  return scroll ? <ScrollView>{rows}</ScrollView> : <View>{rows}</View>;
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
 * Timing, one step in: last episode's timing, offered where it may be; the lines around now, to tap
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
                <ChoiceRow
                  key={`match-${row.key}`}
                  label={label}
                  {...(detail ? { line: detail } : {})}
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
  root: { flex: 1 },
  columns: { flex: 1, flexDirection: 'row', gap: space.l },
  column: { flex: 1 },
  settings: { flex: 1.25 },
  divider: { width: 1, marginVertical: space.s, backgroundColor: 'rgba(241, 237, 255, 0.12)' },
  stack: { gap: space.xl, paddingBottom: space.xl },
  file: { paddingLeft: 32, paddingRight: space.m, marginTop: space.l },
  fileLabel: { ...type.overline, color: colors.textSubtle },
  fileName: { ...type.small, color: colors.textMuted, marginTop: space.xs },
  note: { ...type.small, color: colors.textMuted, paddingVertical: space.m, paddingLeft: 32 },
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

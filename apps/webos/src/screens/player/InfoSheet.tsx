import {
  languageName,
  otherLanguages,
  type QualityReference,
  type SleepChoice,
  type SleepTimer,
  type SpeedKind,
  type StreamEntry,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { doesFocusableExist, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { addonNames } from '../../data/addons';
import { formatDate, metaFacts } from '../../data/describe';
import { formatSize, resolutionLabel, streamRowText, streamTitle } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { formatTime } from '../../player/media';
import { focusedKey } from '../../navigation/spatial';
import { SheetTabs } from './SheetTabs';
import { SleepChoices, sleepValue } from './SleepTimer';
import { SpeedChoices, speedName } from './Speed';
import styles from './InfoSheet.module.css';

const SHEET = 'player-info';
type InfoTab = 'about' | 'speed' | 'sleep';
const TABS: readonly InfoTab[] = ['about', 'speed', 'sleep'];
const NO_SPEED_TABS: readonly InfoTab[] = ['about', 'sleep'];

/** The Speed tab, where it shows: in the Lab, and once the Lab passed any speed on this TV. */
export interface InfoSpeed {
  /** The speeds passed for the kind of stream playing, Normal left out. */
  rates: readonly number[];
  current: number;
  kind: SpeedKind | undefined;
  lab: boolean;
  video: HTMLVideoElement | null;
  onChoose: (rate: number) => void;
}
/** Starring, as Details names them. */
const CAST = 4;

interface Line {
  label: string;
  value: string;
}

/**
 * What plays and what it is, over the picture, which keeps playing: the
 * stream on the left (the addon, the release, its size and how it is
 * played), the title or episode on the right. It asks for nothing: what it
 * shows is what the player already has. Other tabs set the speed, where the
 * Lab passed one, and the sleep timer.
 */
export function InfoSheet({
  title,
  subtitle,
  item,
  episode,
  entry,
  audio,
  duration,
  live,
  engine,
  heavy,
  reference,
  sleep,
  onSleep,
  speed,
  returnFocusKey,
  onBack,
  onClose,
}: {
  title: string;
  /** "S1:E2 · Episode title". */
  subtitle?: string;
  item?: MetaPreview | MetaDetail;
  episode?: Video;
  entry: StreamEntry | null;
  audio: readonly EngineTrack[];
  /** Seconds; 0 while unknown. */
  duration: number;
  live: boolean;
  engine: 'native' | 'hls.js' | 'shaka' | null;
  heavy: boolean;
  reference?: QualityReference;
  sleep: SleepTimer;
  onSleep: (choice: SleepChoice) => void;
  speed?: InfoSpeed;
  returnFocusKey: () => string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<InfoTab>('about');
  // Speed goes when another stream turns out to be a broadcast: Info shows in its place.
  if (tab === 'speed' && !speed) setTab('about');
  const facts = entry?.facts;
  const playing = audio.find((track) => track.active);
  const lines: Line[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push({ label: t(`player.infoRow.${label}`), value });
  };
  if (entry && facts) {
    add('source', addonNames().get(entry.addonId));
    // The addon's own words, unless they hold a link.
    const release = streamTitle(entry);
    add('release', release.indexOf('://') < 0 ? release : undefined);
    add('size', facts.sizeBytes ? formatSize(facts.sizeBytes) : undefined);
    const codec = facts.videoCodec
      ? facts.bitDepth
        ? `${facts.videoCodec} ${facts.bitDepth}-bit`
        : facts.videoCodec
      : undefined;
    const hdr = facts.hdr.map((format) => (format === 'DV' ? 'Dolby Vision' : format)).join(', ');
    add(
      'picture',
      [resolutionLabel(facts.resolution), hdr, codec].filter(Boolean).join(' · ') || undefined,
    );
    // The engine's own reading of the track playing; else the release name's,
    // which describes the first track.
    const first = audio.length === 0 || audio[0] === playing;
    const format =
      playing?.format ?? (first && facts.audio.length > 0 ? facts.audio.join(' ') : undefined);
    const channels = playing?.channels ?? (first ? facts.channels : undefined);
    add(
      'sound',
      [
        [format, channels].filter(Boolean).join(' '),
        playing?.lang ? languageName(playing.lang) : undefined,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    );
    if (facts.languages.length > 1) {
      add(
        'languages',
        facts.languages
          .map((code) => (code === 'multi' ? t('player.severalLanguages') : languageName(code)))
          .join(', '),
      );
    }
  }
  add('length', live ? t('player.liveBroadcast') : duration > 0 ? formatTime(duration) : undefined);
  if (engine) add('playedBy', t(`player.playedBy.${engine === 'native' ? 'native' : 'app'}`));
  const notes = entry
    ? streamRowText(t, entry, {
        heavy,
        languages: otherLanguages(entry.facts, reference),
      }).notes
    : [];

  const about = episode
    ? episode.released
      ? t('player.firstShown', { date: formatDate(episode.released) })
      : undefined
    : item
      ? metaFacts(t, item)
          .concat(item.genres.length > 0 ? [item.genres.join(', ')] : [])
          .join(' · ')
      : undefined;
  const story = episode?.overview || item?.description;
  const cast =
    item && 'cast' in item && item.cast.length > 0
      ? t('details.cast', { names: item.cast.slice(0, CAST).join(', ') })
      : undefined;

  const spoken = [
    title,
    subtitle,
    ...lines.map((line) => `${line.label}, ${line.value}`),
    ...notes,
    about,
    story,
    cast,
  ]
    .filter(Boolean)
    // One stop between parts, whether or not a part ends with its own.
    .map((part) => part!.replace(/[.!?]\s*$/, ''))
    .join('. ');

  const names: Record<InfoTab, string> = {
    about: t('player.info'),
    speed: t('player.speed.title'),
    sleep: t('player.sleep.title'),
  };
  const values: Record<InfoTab, string> = {
    about: subtitle ?? title,
    speed: speedName(t, speed?.current ?? 1),
    sleep: sleepValue(t, sleep, !!episode),
  };
  // Back from a tab's choices goes to the tabs; from the tabs, or from what
  // plays, which has nothing to choose, it closes.
  const back = () => {
    const at = focusedKey();
    const tabKey = `${SHEET}-tab-${tab}`;
    if (
      at.startsWith(`${SHEET}-`) &&
      !at.startsWith(`${SHEET}-tab-`) &&
      tab !== 'about' &&
      doesFocusableExist(tabKey)
    ) {
      void setFocus(tabKey);
      return true;
    }
    onBack();
    return true;
  };

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.info')}
      defaultFocusKey={`${SHEET}-about`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      onBack={back}
      placement="bottom"
    >
      <SheetTabs
        sheet={SHEET}
        tabs={speed ? TABS : NO_SPEED_TABS}
        names={names}
        values={values}
        tab={tab}
        onTab={setTab}
      />
      {tab === 'about' ? (
        // Nothing to choose: OK, as Back, closes it.
        <Pressable
          focusKey={`${SHEET}-about`}
          label={spoken}
          className={styles.body}
          focusedClassName={styles.body}
          onPress={onBack}
        >
          <div className={styles.stream}>
            {lines.map((line) => (
              <p key={line.label} className={styles.line}>
                <span className={styles.label}>{line.label}</span>
                <span className={styles.value}>{line.value}</span>
              </p>
            ))}
            {notes.length > 0 && <p className={styles.notes}>{notes.join(' ')}</p>}
          </div>
          <div className={styles.about}>
            {about && <p className={styles.facts}>{about}</p>}
            {story && <p className={styles.story}>{story}</p>}
            {cast && <p className={styles.cast}>{cast}</p>}
          </div>
        </Pressable>
      ) : tab === 'speed' && speed ? (
        <SpeedChoices
          focusKey={`${SHEET}-speed`}
          rates={speed.rates}
          current={speed.current}
          kind={speed.kind}
          lab={speed.lab}
          video={speed.video}
          onChoose={speed.onChoose}
        />
      ) : (
        <SleepChoices
          focusKey={`${SHEET}-sleep`}
          timer={sleep}
          episode={!!episode}
          live={live}
          onChoose={onSleep}
        />
      )}
    </Overlay>
  );
}

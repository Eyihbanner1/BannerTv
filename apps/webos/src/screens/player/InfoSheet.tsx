import {
  languageName,
  otherLanguages,
  type QualityReference,
  type StreamEntry,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { Pressable } from '../../components/Pressable';
import { addonNames } from '../../data/addons';
import { formatDate, metaFacts } from '../../data/describe';
import { formatSize, resolutionLabel, streamRowText, streamTitle } from '../../player/describe';
import type { EngineTrack } from '../../player/engines/types';
import { formatTime } from '../../player/media';
import styles from './InfoSheet.module.css';

const SHEET = 'player-info';
/** Starring, as Details names them. */
const CAST = 4;

interface Line {
  label: string;
  value: string;
  /** Two lines rather than one. */
  long?: boolean;
}

/**
 * What plays and what it is, over the picture, which keeps playing: the
 * stream on the left (the addon, the release, its size and how it is
 * played), the title or episode on the right. It asks for nothing: what it
 * shows is what the player already has.
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
  returnFocusKey: () => string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const facts = entry?.facts;
  const playing = audio.find((track) => track.active);
  const lines: Line[] = [];
  const add = (label: string, value: string | undefined, long?: boolean) => {
    if (value) lines.push({ label: t(`player.infoRow.${label}`), value, long });
  };
  if (entry && facts) {
    add('source', addonNames().get(entry.addonId));
    // The addon's own words, unless they hold a link.
    const release = streamTitle(entry);
    add('release', release.indexOf('://') < 0 ? release : undefined, true);
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

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.info')}
      defaultFocusKey={`${SHEET}-body`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      onBack={() => {
        onBack();
        return true;
      }}
      placement="bottom"
    >
      {/* Nothing to choose: OK, as Back, closes it. */}
      <Pressable
        focusKey={`${SHEET}-body`}
        label={spoken}
        className={styles.body}
        focusedClassName={styles.body}
        onPress={onBack}
      >
        <p className={styles.heading}>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.episode}>{subtitle}</span>}
        </p>
        <div className={styles.stream}>
          {lines.map((line) => (
            <p
              key={line.label}
              className={line.long ? `${styles.line} ${styles.long}` : styles.line}
            >
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
    </Overlay>
  );
}

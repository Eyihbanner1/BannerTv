import { groupByLanguage, languageName } from '@bannertv/core';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { preferences } from '../../data/preferences';
import type { EngineTrack } from '../../player/engines/types';
import { PanelList, type PanelItem, panelItemKey } from './PanelList';
import type { Subtitles } from './use-subtitles';
import styles from './PlayerScreen.module.css';

const FOCUS_KEY = 'player-tracks';
const OFFSET_STEP = 0.1;

function trackLabel(track: EngineTrack): string {
  const language = track.lang ? languageName(track.lang) : '';
  if (!language) return track.label || '?';
  return track.label && track.label.toLowerCase() !== language.toLowerCase()
    ? `${language} (${track.label})`
    : language;
}

export function formatOffset(offset: number): string {
  const rounded = Math.round(offset * 10) / 10;
  if (rounded === 0) return '0.0 s';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)} s`;
}

interface TracksPanelProps {
  audio: readonly EngineTrack[];
  subtitles: Subtitles;
  returnFocusKey: string;
  onAudio: (track: EngineTrack) => void;
  onStyle: () => void;
  onClose: () => void;
}

/**
 * Audio and subtitles in one panel. Subtitles are grouped by language, the
 * last chosen language first. Pressing the language already showing moves to
 * its next version, the usual fix for subtitles out of step with the picture.
 */
export function TracksPanel(props: TracksPanelProps) {
  const { audio, subtitles, onAudio, onStyle, onClose } = props;
  const { t } = useTranslation();
  const items: PanelItem[] = [];
  let focusIndex = -1;
  const mark = () => {
    if (focusIndex === -1) focusIndex = items.length - 1;
  };

  if (audio.length > 0) {
    items.push({ kind: 'header', label: t('player.audio') });
    for (const track of audio) {
      items.push({
        kind: 'option',
        key: `audio-${track.id}`,
        label: trackLabel(track),
        selected: track.active,
        onPress: () => onAudio(track),
      });
    }
  }

  items.push({ kind: 'header', label: t('player.subtitles') });
  const { choice } = subtitles;
  items.push({
    kind: 'option',
    key: 'off',
    label: t('player.subtitlesOff'),
    selected: choice === null,
    onPress: () => subtitles.choose(null),
  });
  if (choice === null) mark();

  for (const track of subtitles.tracks) {
    const selected = choice?.kind === 'track' && choice.id === track.id;
    items.push({
      kind: 'option',
      key: `track-${track.id}`,
      label: trackLabel(track),
      detail: t('player.fromStream'),
      selected,
      onPress: () => subtitles.choose({ kind: 'track', id: track.id }),
    });
    if (selected) mark();
  }

  const groups = groupByLanguage(subtitles.options, preferences.get().subtitleLanguage);
  for (const group of groups) {
    const current =
      choice?.kind === 'file' ? group.items.findIndex((o) => o.key === choice.key) : -1;
    const selected = current !== -1;
    const count = group.items.length;
    items.push({
      kind: 'option',
      key: `lang-${group.key}`,
      label: group.name,
      detail: selected
        ? count > 1
          ? t('player.version', { number: current + 1, count })
          : group.items[current]!.source
        : count > 1
          ? t('player.versions', { count })
          : group.items[0]!.source,
      selected,
      onPress: () => {
        const next = group.items[selected ? (current + 1) % count : 0]!;
        subtitles.choose({ kind: 'file', key: next.key });
      },
    });
    if (selected) mark();
  }
  if (subtitles.pending > 0) items.push({ kind: 'header', label: t('player.lookingForSubtitles') });
  else if (groups.length === 0 && subtitles.tracks.length === 0) {
    items.push({ kind: 'header', label: t('player.noSubtitles') });
  }

  items.push({ kind: 'header', label: t('player.subtitleSettings') });
  items.push({
    kind: 'stepper',
    key: 'offset',
    label: t('player.timing'),
    value: formatOffset(subtitles.offset),
    onStep: (direction) =>
      subtitles.setOffset(Math.round((subtitles.offset + direction * OFFSET_STEP) * 10) / 10),
  });
  items.push({ kind: 'option', key: 'style', label: t('player.style'), onPress: onStyle });

  const initial = focusIndex === -1 ? 1 : focusIndex;
  return (
    <Overlay
      focusKey={FOCUS_KEY}
      label={t('player.audioAndSubtitles')}
      defaultFocusKey={panelItemKey(FOCUS_KEY, items[initial]) ?? `${FOCUS_KEY}-off`}
      returnFocusKey={props.returnFocusKey}
      onClose={onClose}
      placement="side"
    >
      <h2 className={styles.panelTitle}>{t('player.audioAndSubtitles')}</h2>
      <PanelList focusKey={FOCUS_KEY} items={items} initialIndex={initial} />
    </Overlay>
  );
}

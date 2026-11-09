import type { MetaDetail, Video } from '@bannertv/protocol';
import { formatDate } from '@tv/data/describe';
import { watchedSet } from '@tv/data/library';
import { progress } from '@tv/data/playback';
import { noteInput } from '@tv/navigation/activity';
import { groupSeasons, type Season, seasonOf } from '@tv/screens/details/seasons';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip } from '../ui/Chip';
import { ChipRow } from '../ui/ChipRow';
import { colors, space } from '../ui/theme';
import { type EpisodeLine, episodeLines, type EpisodeNote } from './episode-lines';
import { PanelOption } from './SidePanel';

type Translate = ReturnType<typeof useTranslation>['t'];

/** Where the episode playing sits as the list opens: a little way down, so earlier ones show. */
const PLAYING_AT = 0.3;
/** Tries at scrolling to it while the list is still measuring its rows. */
const SCROLL_TRIES = 3;

function seasonName(t: Translate, season: Season): string {
  if (season.number === null) return t('details.episodes');
  if (season.number === 0) return t('details.specials');
  return t('details.season', { number: season.number });
}

function noteText(t: Translate, note: EpisodeNote): string | undefined {
  switch (note.kind) {
    case 'playing':
      return t('player.playingNow');
    case 'upcoming':
      return t('details.airs', { date: formatDate(note.released) });
    case 'watched':
      return t('player.watchedEpisode');
    case 'started':
      return t('player.minutesLeft', { count: note.minutesLeft });
    case 'none':
      return undefined;
  }
}

/**
 * More's Episodes row, as the TV's Episodes chip: on anything with an episode list, dimmed with
 * the reason until the list comes.
 */
export function EpisodesRow({ listed, onPress }: { listed: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const label = t('player.episodes');
  const reason = listed ? undefined : t('player.noEpisodeList');
  return (
    <PanelOption
      label={label}
      {...(reason ? { detail: reason, accessibilityLabel: `${label}, ${reason}` } : {})}
      disabled={!listed}
      wrap
      onPress={onPress}
    />
  );
}

/**
 * The series' episodes inside the player, which keeps playing behind the panel, as the TV's
 * Episodes sheet: the seasons in a row of pills when there are several, opening on the one
 * playing, and that season's episodes, the one playing marked, each saying whether it is
 * watched, part watched or not out yet. A tap plays another episode where the player is, on the
 * same release, as Up Next does; the one playing just closes the panel, and one not out yet does
 * nothing. It draws no images and asks for nothing. Mount it only while open, so each opening
 * starts on the episode playing.
 */
export function EpisodesPanel({
  meta,
  videoId,
  onPlay,
  onClose,
}: {
  meta: MetaDetail;
  videoId: string;
  /** Plays another episode, replacing this player. */
  onPlay: (video: Video) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Ticks and minutes left follow a Trakt sync, and the episode playing's own progress.
  const progressVersion = useSyncExternalStore(progress.subscribe, progress.version);
  const watchedVersion = useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const seasons = useMemo(() => groupSeasons(meta.videos), [meta.videos]);
  const [view, setView] = useState(() => seasonOf(seasons, videoId));
  const [now] = useState(Date.now);
  const season = seasons[Math.min(view, seasons.length - 1)];
  const lines = useMemo(
    () =>
      season
        ? episodeLines(
            season.videos,
            videoId,
            (id) => progress.get(id),
            (id) => watchedSet.has(id),
            now,
          )
        : [],
    // The versions change with the progress and Trakt's ticks read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [season, videoId, now, progressVersion, watchedVersion],
  );
  const playingIndex = lines.findIndex((line) => line.note.kind === 'playing');

  // The list opens on the episode playing. Rows wrap at large text, so their heights are only
  // known once drawn: a jump that lands short is tried again from the rows' average height.
  const list = useRef<FlatList<EpisodeLine>>(null);
  const tries = useRef(0);
  const showPlaying = () => {
    if (playingIndex < 0 || tries.current >= SCROLL_TRIES) return;
    tries.current += 1;
    list.current?.scrollToIndex({ index: playingIndex, viewPosition: PLAYING_AT, animated: false });
  };

  const pick = (line: EpisodeLine) => {
    if (!line.playable) return;
    if (line.note.kind === 'playing') {
      onClose();
      return;
    }
    noteInput();
    onPlay(line.video);
  };

  return (
    <View style={styles.root}>
      {seasons.length > 1 ? (
        <ChipRow selected={view} inset={0} fadeColor={colors.sheet}>
          {seasons.map((option, index) => (
            <Chip
              key={`${option.number}`}
              label={seasonName(t, option)}
              on={index === view}
              onPress={() => {
                tries.current = 0;
                setView(index);
              }}
            />
          ))}
        </ChipRow>
      ) : null}
      <FlatList
        // Each season's list starts afresh, at its top or on the episode playing.
        key={view}
        ref={list}
        data={lines}
        keyExtractor={(line) => line.video.id}
        initialNumToRender={Math.max(10, playingIndex + 4)}
        onLayout={showPlaying}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          setTimeout(showPlaying, 50);
        }}
        renderItem={({ item: line }) => {
          const number = line.number;
          const label = line.video.title
            ? t('details.episodeTitle', { number, title: line.video.title })
            : t('details.untitledEpisode', { number });
          const detail = noteText(t, line.note);
          return (
            <PanelOption
              label={label}
              {...(detail ? { detail, accessibilityLabel: `${label}, ${detail}` } : {})}
              selected={line.note.kind === 'playing'}
              disabled={!line.playable}
              wrap
              onPress={() => pick(line)}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: space.s },
});

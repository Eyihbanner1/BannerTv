import type { MetaDetail, Video } from '@bannertv/protocol';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '../../components/Overlay';
import { formatDate } from '../../data/describe';
import { watchedSet } from '../../data/library';
import { progress } from '../../data/playback';
import { inputMode } from '../../platform/input-mode';
import { episodeState, groupSeasons, type Season, seasonOf } from '../details/seasons';
import { type SheetRow, SheetList } from './SheetList';
import styles from './EpisodesSheet.module.css';

const SHEET = 'player-episodes';
/** Rows a column shows at a time. */
const VISIBLE = 4;

/**
 * The series' seasons and episodes over the picture, which keeps playing:
 * seasons on the left, the season in focus's episodes on the right. It draws
 * no images and asks for nothing: the picture above is the video itself.
 */
export function EpisodesSheet({
  meta,
  videoId,
  returnFocusKey,
  onPlay,
  onBack,
  onClose,
}: {
  meta: MetaDetail;
  videoId: string;
  returnFocusKey: () => string;
  /** Plays another episode; the one playing closes the sheet. */
  onPlay: (video: Video) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The player hands a new function each time it draws: the rows press the latest.
  const play = useRef(onPlay);
  useLayoutEffect(() => {
    play.current = onPlay;
  });
  // Ticks and bars follow a Trakt sync, and the episode playing's own progress.
  const progressVersion = useSyncExternalStore(progress.subscribe, progress.version);
  const watchedVersion = useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const seasons = useMemo(() => groupSeasons(meta.videos), [meta.videos]);
  const playing = seasonOf(seasons, videoId);
  const [view, setView] = useState(playing);
  const [now] = useState(Date.now);
  const [summary, setSummary] = useState(
    () => meta.videos.find((video) => video.id === videoId)?.overview,
  );

  const seasonName = (season: Season) =>
    season.number === null
      ? t('details.episodes')
      : season.number === 0
        ? t('details.specials')
        : t('details.season', { number: season.number });

  const seasonRows = seasons.map((season, index): SheetRow => ({
    focusKey: `${SHEET}-season-${season.number ?? 'x'}`,
    label: seasonName(season),
    detail: t('player.episodeCount', { count: season.videos.length }),
    selected: index === playing,
    // Its episodes show beside it as it takes focus; with the pointer, as it
    // is clicked, so passing over seasons on the way to an episode moves nothing.
    onFocus: () => {
      if (inputMode.get() !== 'pointer') setView(index);
    },
    onPress: () => {
      setView(index);
      if (inputMode.get() !== 'pointer') void setFocus(`${SHEET}-list`);
    },
  }));

  const episodeRows = useMemo(
    () =>
      seasons[view]!.videos.map((video, index): SheetRow => {
        const number = video.episode ?? index + 1;
        const label = video.title
          ? t('details.episodeTitle', { number, title: video.title })
          : t('details.untitledEpisode', { number });
        const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
        const here = video.id === videoId;
        const detail = here
          ? t('player.playingNow')
          : state.kind === 'upcoming'
            ? t('details.airs', { date: formatDate(video.released!) })
            : state.kind === 'watched'
              ? t('player.watchedEpisode')
              : state.kind === 'started'
                ? t('player.minutesLeft', {
                    count: Math.max(1, Math.round(state.secondsLeft / 60)),
                  })
                : undefined;
        return {
          focusKey: `${SHEET}-ep-${index}`,
          label,
          detail,
          selected: here,
          // Not out yet: it says when, and does nothing.
          dim: state.kind === 'upcoming' && !here,
          progress: state.kind === 'started' && !here ? state.fraction : undefined,
          onFocus: () => setSummary(video.overview),
          onPress: () => {
            if (state.kind !== 'upcoming' || here) play.current(video);
          },
        };
      }),
    // The versions change with the progress and Trakt's ticks read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasons, view, videoId, now, t, progressVersion, watchedVersion],
  );
  const playingKey = episodeRows.find((row) => row.selected)?.focusKey;

  return (
    <Overlay
      focusKey={SHEET}
      label={t('player.episodes')}
      defaultFocusKey={playingKey ?? `${SHEET}-seasons`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      // The columns sit side by side, not one inside the other: Back closes from either.
      onBack={() => {
        onBack();
        return true;
      }}
      placement="bottom"
    >
      <div className={styles.header}>
        <div className={styles.series}>
          <span className={styles.kicker}>{t('player.episodes')}</span>
          <span className={styles.name}>{meta.name}</span>
        </div>
        {summary && <p className={styles.summary}>{summary}</p>}
      </div>
      <div className={styles.content}>
        <SheetList
          focusKey={`${SHEET}-seasons`}
          rows={seasonRows}
          preferred={seasonRows[view]!.focusKey}
          remember={false}
          visible={VISIBLE}
          className={styles.seasons}
        />
        {/* Each season's episodes register afresh: a focusable keeps the key it was first given. */}
        <SheetList
          key={view}
          focusKey={`${SHEET}-list`}
          rows={episodeRows}
          preferred={playingKey ?? episodeRows[0]?.focusKey}
          remember={false}
          visible={VISIBLE}
          className={styles.episodes}
        />
      </div>
    </Overlay>
  );
}

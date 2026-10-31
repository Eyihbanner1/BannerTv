import { kidsTitleAllowed, ratingAllowed, type TmdbDetails, tmdbImageUrl } from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { artworkUrl } from '../../components/artwork-size';
import { Button } from '../../components/Button';
import { Pressable } from '../../components/Pressable';
import { addonClient } from '../../data/addons';
import { describeAddonError, metaFacts } from '../../data/describe';
import { progress } from '../../data/playback';
import { activeProfile, isKidsProfile } from '../../data/profiles';
import { tmdbClient, useTmdbDetails } from '../../data/tmdb';
import { useQuery } from '../../data/use-query';
import { playTrailer } from '../../platform/youtube';
import { formatTime } from '../../player/media';
import { usePrefetch } from '../../player/prefetch';
import { EpisodeList } from './EpisodeList';
import { MyListButton } from './MyListButton';
import { defaultSeason, groupSeasons, type Season } from './seasons';
import styles from './DetailsScreen.module.css';

const MAX_CAST = 4;
/** Cast shown with TMDB's photos. */
const MAX_FACES = 6;

interface DetailsScreenProps {
  type: string;
  id: string;
  preview?: MetaPreview;
}

function SeasonTabs({
  seasons,
  selected,
  onSelect,
}: {
  seasons: readonly Season[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'details-seasons',
    saveLastFocusedChild: false,
    preferredChildFocusKey: `details-season-${selected}`,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.seasons}>
        <div ref={trackRef} className={styles.seasonTrack}>
          {seasons.map((season, index) => {
            const label =
              season.number === null
                ? t('details.episodes')
                : season.number === 0
                  ? t('details.specials')
                  : t('details.season', { number: season.number });
            return (
              <Pressable
                key={index}
                focusKey={`details-season-${index}`}
                label={label}
                className={index === selected ? `${styles.season} ${styles.active}` : styles.season}
                focusedClassName={styles.seasonFocused}
                onFocus={(layout) => {
                  // Seasons switch as focus moves, so Down lands straight in the episodes.
                  onSelect(index);
                  const track = trackRef.current;
                  if (track) {
                    const overflow =
                      layout.left + layout.width - (track.parentElement!.offsetWidth - 48);
                    track.style.transform = overflow > 0 ? `translateX(${-overflow}px)` : '';
                  }
                }}
              >
                {label}
              </Pressable>
            );
          })}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

// The season last shown per title, for this session.
const seasonMemory = new Map<string, number>();

function Episodes({
  meta,
  tmdb,
  onPress,
  onFocusVideo,
}: {
  meta: MetaDetail;
  tmdb?: TmdbDetails;
  onPress: (video: Video) => void;
  onFocusVideo: (video: Video) => void;
}) {
  const seasons = useMemo(() => groupSeasons(meta.videos), [meta.videos]);
  const [selected, setSelected] = useState(() => {
    const saved = seasonMemory.get(meta.id);
    return saved !== undefined && saved < seasons.length ? saved : defaultSeason(seasons);
  });
  const season = seasons[selected]!;
  // TMDB's names, overviews and stills, for episodes the addon describes less.
  const extrasQuery = useMemo(
    () =>
      tmdb && tmdb.kind === 'tv' && season.number !== null
        ? tmdbClient.season(tmdb.tmdbId, season.number)
        : null,
    [tmdb, season.number],
  );
  const extras = useQuery(extrasQuery).data;
  return (
    <>
      {seasons.length > 1 && (
        <SeasonTabs
          seasons={seasons}
          selected={selected}
          onSelect={(index) => {
            seasonMemory.set(meta.id, index);
            setSelected(index);
          }}
        />
      )}
      <EpisodeList
        key={selected}
        focusKey="details-episodes"
        memoryKey={`details-${meta.id}-${selected}`}
        videos={season.videos}
        extras={extras}
        onPress={onPress}
        onFocusVideo={onFocusVideo}
      />
    </>
  );
}

/**
 * Backdrop, logo, facts and synopsis on the left; for a series, seasons and
 * episodes in a panel on the right. It draws what the tile knew at once and
 * fills in the rest when the addon answers.
 */
export function DetailsScreen({ type, id, preview }: DetailsScreenProps) {
  const { t } = useTranslation();
  const query = useMemo(() => addonClient.meta(type, id), [type, id]);
  const state = useQuery(query);
  const meta = state.data;
  const item: MetaPreview | undefined = meta ?? preview;
  const [note, setNote] = useState<string | null>(null);
  const trailer = item?.trailers[0];
  const isMovie = type === 'movie';
  const failed = state.status === 'error';
  const tmdb = useTmdbDetails(type, id);
  const extra = tmdb.details;
  // A kids profile plays a title only once its full details are in. With a
  // UK rating from TMDB, the rating decides, within the profile's (the
  // strictest of that country's ratings, so a 15 on disc outranks a PG at the
  // cinema); without one, the details must list it as Family. Either way no genre that is not
  // for children (Cinemeta's Family rows hold PG films its details tag only
  // Animation or Adventure).
  const kids = isKidsProfile();
  const kidsMax = activeProfile()?.kids;
  const kidsDecided = !kids || (meta !== undefined && tmdb.settled);
  const kidsRating = extra?.strictestCertificate ?? extra?.certificate;
  const kidsAllowed =
    !kids ||
    (kidsDecided &&
      meta !== undefined &&
      (kidsRating === undefined
        ? kidsTitleAllowed(meta)
        : kidsMax !== undefined &&
          ratingAllowed(kidsRating, kidsMax) &&
          kidsTitleAllowed(meta, true)));
  const hasEpisodes = !isMovie && meta !== undefined && meta.videos.length > 0;
  // Titles without episodes get Watch, which plays the addon's default video.
  const canWatch = kidsAllowed && (isMovie || (meta !== undefined && !hasEpisodes));
  const watchVideoId = canWatch ? (meta?.behaviorHints.defaultVideoId ?? id) : null;

  // Progress decides between Watch and Resume, and marks episodes.
  useSyncExternalStore(progress.subscribe, progress.version);
  useEffect(() => {
    void progress.load();
  }, []);
  const resumeAt = watchVideoId === null ? undefined : progress.resumeAt(watchVideoId);
  const latest = !canWatch && kidsAllowed ? progress.forMeta(id)[0] : undefined;
  const latestVideo = latest && meta?.videos.find((v) => v.id === latest.videoId);
  const latestResume = latest && progress.resumeAt(latest.videoId);

  // Streams are looked for while focus rests on what would play.
  const [resting, setResting] = useState<string | null>(null);
  usePrefetch(type, resting, item?.runtime);

  const play = (videoId: string, startAt?: number) => {
    setNote(null);
    push({ name: 'player', type, metaId: id, videoId, preview: item, startAt });
  };
  const restOn = (videoId: string | null) => () => setResting(videoId);

  const defaultFocus = failed
    ? 'details-retry'
    : latestVideo && latestResume !== undefined
      ? 'details-resume-episode'
      : hasEpisodes && kidsAllowed
        ? 'details-episodes'
        : watchVideoId !== null
          ? 'details-watch'
          : 'details-my-list';
  // A kids profile waits for the full details and TMDB, which decide whether Watch is there.
  useScreenFocus(
    defaultFocus,
    (isMovie && !kids) || failed || (state.status === 'success' && kidsDecided),
  );

  // The same sizes as the hero, so the image it already loaded is reused.
  // TMDB's artwork only fills in for what the addon has none of.
  const backdrop =
    artworkUrl(item?.background, 'backdrop') ?? tmdbImageUrl(extra?.backdropPath, 'w1280');
  const logo = artworkUrl(item?.logo, 'titleLogo') ?? tmdbImageUrl(extra?.logoPath, 'w500');
  const facts = item ? metaFacts(t, item) : [];
  if (extra?.certificate) facts.push(extra.certificate);
  if (extra?.network) facts.push(extra.network);
  const faces = extra ? extra.cast.filter((person) => person.profilePath).slice(0, MAX_FACES) : [];
  const separator = t('common.listSeparator');
  const error = failed ? describeAddonError(t, state.error, t('rail.addons')) : undefined;

  return (
    <section className={styles.details} aria-label={item?.name}>
      <div className={styles.art}>
        {backdrop && (
          <Artwork
            key={backdrop}
            src={backdrop}
            retrySrc={item?.background}
            className={styles.backdrop}
          />
        )}
      </div>
      <div className={isMovie ? `${styles.info} ${styles.wide}` : styles.info}>
        <div className={styles.logoBox}>
          {item ? (
            <Artwork
              key={logo}
              src={logo}
              retrySrc={item.logo}
              className={styles.logo}
              fallback={<h1 className={styles.title}>{item.name}</h1>}
            />
          ) : (
            <h1 className={styles.title}>{t('details.loading')}</h1>
          )}
        </div>
        {facts.length > 0 && <p className={styles.facts}>{facts.join(' · ')}</p>}
        {item && item.genres.length > 0 && (
          <p className={styles.genres}>{item.genres.slice(0, 4).join(' · ')}</p>
        )}
        {item?.description && (
          <p
            className={
              faces.length > 0 ? `${styles.description} ${styles.short}` : styles.description
            }
          >
            {item.description}
          </p>
        )}
        {faces.length === 0 && meta && meta.cast.length > 0 && (
          <p className={styles.credits}>
            {t('details.cast', { names: meta.cast.slice(0, MAX_CAST).join(separator) })}
          </p>
        )}
        {meta && meta.directors.length > 0 && (
          <p className={styles.credits}>
            {t('details.directors', { names: meta.directors.join(separator) })}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          {watchVideoId !== null && (
            <Button
              focusKey="details-watch"
              label={
                resumeAt === undefined
                  ? t('details.watch')
                  : t('details.resumeFrom', { time: formatTime(resumeAt) })
              }
              variant="primary"
              onFocus={restOn(watchVideoId)}
              onPress={() => play(watchVideoId)}
            />
          )}
          {watchVideoId !== null && resumeAt !== undefined && (
            <Button
              focusKey="details-restart"
              label={t('details.startOver')}
              onFocus={restOn(watchVideoId)}
              onPress={() => play(watchVideoId, 0)}
            />
          )}
          {latestVideo && latestResume !== undefined && (
            <Button
              focusKey="details-resume-episode"
              label={
                latestVideo.season !== undefined && latestVideo.episode !== undefined
                  ? t('details.resumeEpisode', {
                      season: latestVideo.season,
                      episode: latestVideo.episode,
                    })
                  : t('details.resumeFrom', { time: formatTime(latestResume) })
              }
              variant="primary"
              onFocus={restOn(latestVideo.id)}
              onPress={() => play(latestVideo.id)}
            />
          )}
          {trailer && kidsAllowed && (
            <Button
              focusKey="details-trailer"
              label={t('details.trailer')}
              onFocus={restOn(null)}
              onPress={() => {
                setNote(null);
                playTrailer(trailer).catch(() => setNote(t('details.trailerFailed')));
              }}
            />
          )}
          {watchVideoId !== null && (
            <Button
              focusKey="details-streams"
              label={t('details.allStreams')}
              onFocus={restOn(watchVideoId)}
              onPress={() =>
                push({ name: 'streams', type, metaId: id, videoId: watchVideoId, preview: item })
              }
            />
          )}
          {failed && (
            <Button
              focusKey="details-retry"
              label={t('common.tryAgain')}
              onPress={() => query.retry()}
            />
          )}
          {item && <MyListButton item={item} onFocus={restOn(null)} />}
        </div>
        {note && <p className={styles.note}>{note}</p>}
        {kids && meta && kidsDecided && !kidsAllowed && (
          <p className={styles.note}>{t('kids.notForKids')}</p>
        )}
        {faces.length > 0 && (
          <ul className={styles.cast} aria-label={t('details.castTitle')}>
            {faces.map((person, index) => (
              <li key={index} className={styles.person}>
                <Artwork
                  src={tmdbImageUrl(person.profilePath, 'w185')}
                  className={styles.face}
                  fallback={<span className={styles.face} />}
                />
                <span className={styles.personName}>{person.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isMovie && !canWatch && !failed && kidsAllowed && (
        <div className={styles.panel}>
          {meta && hasEpisodes ? (
            <Episodes
              meta={meta}
              tmdb={extra}
              onPress={(video) => play(video.id)}
              onFocusVideo={(video) => setResting(video.id)}
            />
          ) : (
            <p className={styles.note}>{t('details.loading')}</p>
          )}
        </div>
      )}
    </section>
  );
}

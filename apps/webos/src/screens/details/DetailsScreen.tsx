import { kidsDetailsAllowed, type TmdbDetails, tmdbImageUrl } from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { push } from '../../app/router';
import { useScreenFocus } from '../../app/use-screen-focus';
import { Artwork } from '../../components/Artwork';
import { artworkUrl } from '../../components/artwork-size';
import { Button } from '../../components/Button';
import { Menu, type MenuOption } from '../../components/Menu';
import { Pressable } from '../../components/Pressable';
import { addonClient } from '../../data/addons';
import { describeAddonError, metaFacts } from '../../data/describe';
import { watchedSet } from '../../data/library';
import { isWatched, markEpisodes, type TitleRoute } from '../../data/marks';
import { progress } from '../../data/playback';
import { activeProfile, isKidsProfile } from '../../data/profiles';
import { tmdbClient, useTmdbDetails } from '../../data/tmdb';
import { useQuery } from '../../data/use-query';
import { playTrailer } from '../../platform/youtube';
import { formatTime } from '../../player/media';
import { usePrefetch } from '../../player/prefetch';
import { CastFaces } from './CastFaces';
import { EpisodeList } from './EpisodeList';
import { GenreLinks } from './GenreLinks';
import { MoreLikeThis } from './MoreLikeThis';
import { MyListButton } from './MyListButton';
import {
  groupSeasons,
  type MarkOffer,
  markOffer,
  openingEpisode,
  type Season,
  type StartPoint,
  startPoint,
  type StartReader,
  startReader,
} from './seasons';
import { StreamReady } from './StreamReady';
import { WatchedButton } from './WatchedButton';
import styles from './DetailsScreen.module.css';

const MAX_CAST = 4;
/** With focus in More like this, the page slides up so the row ends this far above the bottom. */
const SCREEN_HEIGHT = 1080;
const MORE_MARGIN = 32;
/** Cast shown with TMDB's photos. */
const MAX_FACES = 6;

interface DetailsScreenProps {
  type: string;
  id: string;
  preview?: MetaPreview;
  /** An episode to open the episodes on, as a Watch Next card names it. */
  video?: string;
  /**
   * This visit to the page, the same when Back comes back to it: where it
   * was left is kept per visit, so a page opened afresh opens where the
   * viewer is up to, and one come back to is as it was left.
   */
  visit: number;
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

// The season last shown on each visit to a series' page, for this session.
const seasonMemory = new Map<number, number>();

type MarkChoice = 'episode' | 'season';

/**
 * What OK held on an episode offers: marking it watched or not, and, in a
 * numbered season with more than one episode out, the season's episodes
 * that are out: not watched when all of them are watched, else watched.
 */
function markOptions(t: TFunction, offer: MarkOffer): MenuOption[] {
  const options: MenuOption[] = [
    {
      value: 'episode',
      label: offer.watched ? t('browsing.markUnwatched') : t('browsing.markWatched'),
    },
  ];
  if (offer.season !== undefined) {
    const numbers = { season: offer.season };
    options.push({
      value: 'season',
      label: offer.allWatched
        ? t('browsing.markSeasonUnwatched', numbers)
        : t('browsing.markSeasonWatched', numbers),
    });
  }
  return options;
}

function Episodes({
  visit,
  route,
  meta,
  seasons,
  opening,
  tmdb,
  onPress,
  onFocusVideo,
}: {
  visit: number;
  route: TitleRoute;
  meta: MetaDetail;
  seasons: readonly Season[];
  /** Where the viewer is up to: the season shown first, and the episode focus goes to in it. */
  opening: { season: number; index: number };
  tmdb?: TmdbDetails;
  onPress: (video: Video) => void;
  onFocusVideo: (video: Video) => void;
}) {
  const [selected, setSelected] = useState(() => {
    const saved = seasonMemory.get(visit);
    return saved !== undefined && saved < seasons.length ? saved : opening.season;
  });
  const season = seasons[Math.min(selected, seasons.length - 1)]!;
  // TMDB's names, overviews and stills, for episodes the addon describes less.
  const extrasQuery = useMemo(
    () =>
      tmdb && tmdb.kind === 'tv' && season.number !== null
        ? tmdbClient.season(tmdb.tmdbId, season.number)
        : null,
    [tmdb, season.number],
  );
  const extras = useQuery(extrasQuery).data;
  const { t } = useTranslation();
  const [now] = useState(Date.now);
  const [held, setHeld] = useState<{ video: Video; index: number } | null>(null);
  const marks = held ? markOffer(held.video, season, isWatched, now) : null;
  const onMark = (choice: MarkChoice) => {
    if (!held || !marks) return;
    setHeld(null);
    if (choice === 'episode') markEpisodes(route, meta, [held.video], !marks.watched);
    else markEpisodes(route, meta, marks.out, !marks.allWatched);
  };
  return (
    <>
      {seasons.length > 1 && (
        <SeasonTabs
          seasons={seasons}
          selected={selected}
          onSelect={(index) => {
            seasonMemory.set(visit, index);
            setSelected(index);
          }}
        />
      )}
      <EpisodeList
        key={selected}
        focusKey="details-episodes"
        memoryKey={`details-${visit}-${selected}`}
        videos={season.videos}
        startIndex={selected === opening.season ? opening.index : 0}
        extras={extras}
        onPress={onPress}
        onLongPress={(video, index) => setHeld({ video, index })}
        onFocusVideo={onFocusVideo}
      />
      {held && marks && (
        <Menu
          focusKey="details-marks"
          title={
            held.video.title ||
            t('details.untitledEpisode', { number: held.video.episode ?? held.index + 1 })
          }
          options={markOptions(t, marks)}
          selected={undefined}
          returnFocusKey={`details-episodes-${held.index}`}
          onSelect={(value) => onMark(value as MarkChoice)}
          onClose={() => setHeld(null)}
        />
      )}
    </>
  );
}

/** The primary button's words for where a series' page sends the viewer. */
function startLabel(t: TFunction, point: StartPoint): string {
  const { season, episode } = point.video;
  const numbered = season !== undefined && episode !== undefined;
  switch (point.kind) {
    case 'resume':
      return numbered
        ? t('details.resumeEpisode', { season, episode })
        : t('details.resumeFrom', { time: formatTime(point.at) });
    case 'next':
      return numbered ? t('home.nextEpisodeNote', { season, episode }) : t('home.nextNote');
    default:
      return numbered ? t('browsing.playEpisode', { season, episode }) : t('browsing.play');
  }
}

/**
 * Backdrop, logo, facts and synopsis on the left; for a series, seasons and
 * episodes in a panel on the right. It draws what the tile knew at once and
 * fills in the rest when the addon answers.
 */
export function DetailsScreen({ type, id, preview, video, visit }: DetailsScreenProps) {
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
  // A kids profile plays a title only once its full details are in, by the
  // rule the phone uses too (kidsDetailsAllowed): TMDB's strictest UK rating
  // within the profile's, or without one, a Family listing.
  const kids = isKidsProfile();
  const kidsMax = activeProfile()?.kids;
  const kidsDecided = !kids || (meta !== undefined && tmdb.settled);
  const kidsAllowed =
    !kids || (kidsDecided && meta !== undefined && kidsDetailsAllowed(meta, extra, kidsMax));
  const hasEpisodes = !isMovie && meta !== undefined && meta.videos.length > 0;
  // Titles without episodes get Watch, which plays the addon's default video.
  const canWatch = kidsAllowed && (isMovie || (meta !== undefined && !hasEpisodes));
  const watchVideoId = canWatch ? (meta?.behaviorHints.defaultVideoId ?? id) : null;

  // Progress decides between Watch and Resume, and marks episodes.
  useSyncExternalStore(progress.subscribe, progress.version);
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  // The episodes wait for saved progress and Trakt's ticks, which decide where they open.
  const [progressReady, setProgressReady] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([progress.load(), watchedSet.load()])
      .catch(() => undefined)
      .then(() => {
        if (live) setProgressReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const [now] = useState(Date.now);
  const resumeAt = watchVideoId === null ? undefined : progress.resumeAt(watchVideoId);
  // A series opens where the viewer is up to: the episode to resume, the next
  // one after a finished episode, or the first for a series not started.
  const seasons = useMemo(
    () => (meta && hasEpisodes ? groupSeasons(meta.videos) : []),
    [hasEpisodes, meta],
  );
  const reader: StartReader | undefined =
    hasEpisodes && kidsAllowed && progressReady ? startReader(progress, watchedSet, id) : undefined;
  const start = reader && meta ? startPoint(meta, seasons, reader, now) : undefined;
  // Read by the episodes as they first show only, so the list never jumps
  // about when progress is saved behind it or a Trakt sync comes in.
  const opening = reader ? openingEpisode(seasons, start, reader, video) : null;
  // A Watch Next card for another episode than the one to resume has focus go to that episode.
  const askedOther =
    video !== undefined &&
    video !== start?.video.id &&
    opening !== null &&
    seasons[opening.season]?.videos[opening.index]?.id === video;

  // Streams are looked for while focus rests on what would play.
  const [resting, setResting] = useState<string | null>(null);
  usePrefetch(type, resting, item?.runtime);

  const play = (videoId: string, startAt?: number) => {
    setNote(null);
    push({ name: 'player', type, metaId: id, videoId, preview: item, startAt });
  };
  // Focus back on the buttons or the episodes brings the page back down from More like this.
  const [slide, setSlide] = useState(0);
  const restOn = (videoId: string | null) => () => {
    setResting(videoId);
    setSlide(0);
  };
  const onMoreFocus = useCallback(
    (row: HTMLElement) => {
      setResting(null);
      setSlide(Math.min(0, SCREEN_HEIGHT - MORE_MARGIN - (row.offsetTop + row.offsetHeight)));
    },
    [setResting, setSlide],
  );
  // The line under the buttons speaks of what Watch, Resume or Next would play.
  const primaryVideoId = watchVideoId ?? start?.video.id ?? null;
  // The buttons and More like this sit in one column, so Left from the episodes
  // comes back to the first button rather than to whichever poster is nearest.
  const { ref: infoRef, focusKey: infoKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'details-info',
    saveLastFocusedChild: false,
    preferredChildFocusKey: failed
      ? 'details-retry'
      : watchVideoId !== null
        ? 'details-watch'
        : start
          ? 'details-start'
          : 'details-my-list',
  });
  // Progress is kept under the id the page opened with, which the addon's answer may not repeat.
  const route = useMemo(() => ({ metaId: id, type }), [id, type]);

  // A series opens with focus on the episode it is up to, in its list; on the
  // button when there is one to resume, as Resume did before.
  const defaultFocus = failed
    ? 'details-retry'
    : start?.kind === 'resume' && !askedOther
      ? 'details-start'
      : hasEpisodes && kidsAllowed
        ? 'details-episodes'
        : watchVideoId !== null
          ? 'details-watch'
          : 'details-my-list';
  // A kids profile waits for the full details and TMDB, which decide whether Watch is there.
  // A series also waits for saved progress, which decides whether there is a place to start.
  useScreenFocus(
    defaultFocus,
    failed ||
      ((isMovie || progressReady) &&
        ((isMovie && !kids) || (state.status === 'success' && kidsDecided))),
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
      <FocusContext.Provider value={infoKey}>
        <div
          ref={infoRef}
          className={isMovie ? `${styles.info} ${styles.wide}` : styles.info}
          style={slide ? { transform: `translateY(${slide}px)` } : undefined}
        >
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
          {item && <GenreLinks item={item} type={type} onFocus={restOn(null)} />}
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
            {start && (
              <Button
                focusKey="details-start"
                label={startLabel(t, start)}
                variant="primary"
                onFocus={restOn(start.video.id)}
                onPress={() => play(start.video.id, start.kind === 'again' ? 0 : undefined)}
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
            {item && watchVideoId !== null && (
              <WatchedButton
                route={route}
                item={item}
                meta={meta}
                videoId={watchVideoId}
                onFocus={restOn(null)}
              />
            )}
          </div>
          {resting !== null && resting === primaryVideoId && kidsAllowed && (
            <StreamReady type={type} videoId={resting} />
          )}
          {note && <p className={styles.note}>{note}</p>}
          {kids && meta && kidsDecided && !kidsAllowed && (
            <p className={styles.note}>{t('kids.notForKids')}</p>
          )}
          {faces.length > 0 && <CastFaces faces={faces} onFocus={restOn(null)} />}
          {item && kidsAllowed && !failed && (
            <div className={isMovie ? `${styles.more} ${styles.moreWide}` : styles.more}>
              <MoreLikeThis item={item} type={type} onFocus={onMoreFocus} />
            </div>
          )}
        </div>
      </FocusContext.Provider>
      {!isMovie && !canWatch && !failed && kidsAllowed && (
        <div className={styles.panel}>
          {meta && hasEpisodes && opening ? (
            <Episodes
              visit={visit}
              route={route}
              meta={meta}
              seasons={seasons}
              opening={opening}
              tmdb={extra}
              onPress={(video) => play(video.id)}
              onFocusVideo={(video) => {
                setResting(video.id);
                setSlide(0);
              }}
            />
          ) : (
            <p className={styles.note}>{t('details.loading')}</p>
          )}
        </div>
      )}
    </section>
  );
}

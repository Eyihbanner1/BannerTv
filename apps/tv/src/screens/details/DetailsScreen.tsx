import {
  kidsTitleAllowed,
  MIN_RESUME_SECONDS,
  nextVideo,
  ratingAllowed,
  tmdbImageUrl,
} from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { Artwork } from '@phone/ui/Artwork';
import { addonClient } from '@tv/data/addons';
import { describeAddonError, formatDate, metaFacts } from '@tv/data/describe';
import { library, watchedSet } from '@tv/data/library';
import { progress } from '@tv/data/playback';
import { activeProfile, isKidsProfile } from '@tv/data/profiles';
import { tmdbClient, useTmdbDetails } from '@tv/data/tmdb';
import { useQuery } from '@tv/data/use-query';
import { formatTime } from '@tv/player/media';
import { usePrefetch } from '@tv/player/prefetch';
import { playTrailer } from '@tv/platform/youtube';
import {
  defaultSeason,
  episodeState,
  groupSeasons,
  type Season,
  seasonOf,
} from '@tv/screens/details/seasons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
} from 'react-native';
import { openPlayer, openStreams } from '../../nav/routes';
import { Button } from '../../ui/Button';
import { Focusable } from '../../ui/Focusable';
import { Icon } from '../../ui/icons';
import { tvArt } from '../../ui/Tile';
import { color, layout, px, radii, spacing, type } from '../../ui/theme';

type Translate = ReturnType<typeof useTranslation>['t'];

/** The season each title last showed, for this run. */
const shownSeason = new Map<string, number>();

function seasonLabel(t: Translate, season: Season): string {
  if (season.number === null) return t('details.episodes');
  if (season.number === 0) return t('details.specials');
  return t('details.season', { number: season.number });
}

function episodeCode(video: Video): string | undefined {
  return video.season !== undefined && video.episode !== undefined
    ? `S${video.season}:E${video.episode}`
    : undefined;
}

interface PrimaryAction {
  label: string;
  videoId: string;
  startAt?: number;
}

const EPISODE = { width: px(400), height: px(225) };

const EpisodeCard = memo(function EpisodeCard({
  video,
  index,
  extra,
  now,
  onPlay,
}: {
  video: Video;
  index: number;
  extra?: { name?: string; overview?: string; stillPath?: string };
  now: number;
  onPlay: (video: Video) => void;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  useSyncExternalStore(progress.subscribe, progress.version);
  const number = video.episode ?? index + 1;
  const name = video.title || extra?.name;
  const title = name
    ? t('details.episodeTitle', { number, title: name })
    : t('details.untitledEpisode', { number });
  const thumbnail = video.thumbnail ?? tmdbImageUrl(extra?.stillPath, 'w300');
  const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
  const upcoming = state.kind === 'upcoming';
  const date = video.released
    ? upcoming
      ? t('details.airs', { date: formatDate(video.released) })
      : formatDate(video.released)
    : '';
  return (
    <View style={[styles.episode, upcoming && styles.dim]}>
      <Focusable
        onPress={() => onPlay(video)}
        disabled={upcoming}
        grow
        radius={radii.md}
        style={EPISODE}
        accessibilityLabel={[title, date, state.kind === 'watched' ? t('details.watched') : '']
          .filter(Boolean)
          .join(', ')}
      >
        <Artwork
          src={thumbnail}
          seed={video.id}
          style={{ ...EPISODE, borderRadius: radii.md }}
          fallback={
            <View style={styles.stillFallback}>
              <Icon name="play" size={px(56)} tint={color.textMuted} />
            </View>
          }
        />
        {state.kind === 'watched' ? (
          <View style={styles.tick}>
            <Icon name="check" size={px(28)} tint={color.onFocus} />
          </View>
        ) : null}
        {state.kind === 'started' ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(state.fraction * 100)}%` }]} />
          </View>
        ) : null}
      </Focusable>
      <Text style={styles.episodeTitle} numberOfLines={1}>
        {title}
      </Text>
      {date ? <Text style={styles.episodeDate}>{date}</Text> : null}
    </View>
  );
});

/** A title: what it is, the one thing to press to watch it, and its episodes. */
export function DetailsScreen({ item: preview, active }: { item: MetaPreview; active: boolean }) {
  const { t } = useTranslation();
  const titleType = preview.type;
  const id = preview.id;
  const query = useMemo(() => addonClient.meta(titleType, id), [titleType, id]);
  const state = useQuery(query);
  const meta: MetaDetail | undefined = state.data;
  const item: MetaPreview = meta ?? preview;
  const failed = state.status === 'error' && !meta;
  const tmdb = useTmdbDetails(titleType, id);
  const extra = tmdb.details;
  const [now] = useState(Date.now);

  // Kids: the same gate as the LG's Details and the phone's.
  const kids = isKidsProfile();
  const kidsMax = activeProfile()?.kids;
  const kidsDecided = !kids || (meta !== undefined && tmdb.settled);
  const kidsAllowed =
    !kids ||
    (kidsDecided &&
      meta !== undefined &&
      kidsTitleAllowed(meta) &&
      (extra?.certificate === undefined ||
        (kidsMax !== undefined && ratingAllowed(extra.certificate, kidsMax))));

  const isMovie = titleType === 'movie';
  const hasEpisodes = !isMovie && meta !== undefined && meta.videos.length > 0;
  const canWatch = kidsAllowed && (isMovie || (meta !== undefined && !hasEpisodes));
  const watchVideoId = canWatch ? (meta?.behaviorHints.defaultVideoId ?? id) : null;

  useSyncExternalStore(progress.subscribe, progress.version);
  useSyncExternalStore(library.subscribe, library.version);
  useEffect(() => {
    void progress.load();
  }, []);
  useEffect(() => {
    if (library.has(item.id)) void library.refresh(item);
  }, [item]);

  const resumeAt = watchVideoId === null ? undefined : progress.resumeAt(watchVideoId);
  const latest = !canWatch && kidsAllowed ? progress.forMeta(id)[0] : undefined;
  const latestVideo = latest && meta?.videos.find((video) => video.id === latest.videoId);
  const latestResume = latest && progress.resumeAt(latest.videoId);
  // An episode stopped in its first seconds starts again, as Continue Watching has it.
  const latestAgain =
    !!latest &&
    latestResume === undefined &&
    !latest.watched &&
    latest.position < MIN_RESUME_SECONDS &&
    !!latestVideo;
  const upNext =
    latest && latestResume === undefined && !latestAgain && meta
      ? nextVideo(meta, latest.videoId, now)
      : undefined;
  const firstListed = hasEpisodes && !latest ? groupSeasons(meta.videos)[0]?.videos[0] : undefined;
  const firstEpisode =
    firstListed && episodeState(firstListed, undefined, false, now).kind !== 'upcoming'
      ? firstListed
      : undefined;

  const primary: PrimaryAction | null = (() => {
    if (watchVideoId !== null) {
      return resumeAt === undefined
        ? { label: t('details.watch'), videoId: watchVideoId }
        : {
            label: t('details.resumeFrom', { time: formatTime(resumeAt) }),
            videoId: watchVideoId,
          };
    }
    if (latestVideo && latestAgain) {
      const code = episodeCode(latestVideo);
      return {
        label: code ? `${t('tv.play')} ${code}` : t('tv.play'),
        videoId: latestVideo.id,
        startAt: 0,
      };
    }
    if (latestVideo && latestResume !== undefined) {
      return {
        label:
          latestVideo.season !== undefined && latestVideo.episode !== undefined
            ? t('details.resumeEpisode', {
                season: latestVideo.season,
                episode: latestVideo.episode,
              })
            : t('details.resumeFrom', { time: formatTime(latestResume) }),
        videoId: latestVideo.id,
      };
    }
    if (upNext) {
      return {
        label:
          upNext.season !== undefined && upNext.episode !== undefined
            ? t('home.nextEpisodeNote', { season: upNext.season, episode: upNext.episode })
            : t('home.nextNote'),
        videoId: upNext.id,
      };
    }
    if (firstEpisode && kidsAllowed) return { label: t('tv.play'), videoId: firstEpisode.id };
    return null;
  })();
  usePrefetch(titleType, kidsAllowed ? (primary?.videoId ?? null) : null, item.runtime);

  const seasons = useMemo(() => (meta ? groupSeasons(meta.videos) : []), [meta]);
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null);
  const shownIndex =
    seasonIndex ??
    shownSeason.get(id) ??
    (seasons.length > 0
      ? latest
        ? seasonOf(seasons, latest.videoId)
        : defaultSeason(seasons)
      : 0);
  const season = seasons[Math.min(shownIndex, seasons.length - 1)];
  const seasonQuery = useMemo(
    () =>
      extra?.kind === 'tv' && season?.number !== null && season?.number !== undefined
        ? tmdbClient.season(extra.tmdbId, season.number)
        : null,
    [extra, season],
  );
  const seasonExtras = useQuery(seasonQuery).data;

  const play = (videoId: string, startAt?: number) =>
    openPlayer({
      type: titleType,
      metaId: id,
      videoId,
      preview: item,
      ...(startAt !== undefined ? { startAt } : {}),
    });

  const backdrop = item.background ?? (extra?.backdropPath ? undefined : item.poster);
  const backdropSrc = tvArt(backdrop) ?? tmdbImageUrl(extra?.backdropPath, 'w1280');
  const facts = [...metaFacts(t, item), extra?.certificate, extra?.network]
    .filter(Boolean)
    .join(' · ');
  const saved = library.has(item.id);
  const trailer = item.trailers[0];
  const cast = meta?.cast.slice(0, 5) ?? [];
  const showEpisodes = hasEpisodes && kidsAllowed && season !== undefined;

  return (
    <View style={styles.screen}>
      {backdropSrc ? (
        <Image
          source={{ uri: backdropSrc }}
          style={styles.backdrop}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          accessible={false}
        />
      ) : null}
      <LinearGradient
        colors={[color.bg, 'rgba(11,8,21,0.8)', 'rgba(11,8,21,0)']}
        locations={[0, 0.4, 0.75]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(11,8,21,0)', color.bg]}
        locations={[0.5, 0.85]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {item.name}
          </Text>
          {facts ? <Text style={styles.facts}>{facts}</Text> : null}
          {item.genres.length > 0 ? (
            <Text style={styles.genres}>{item.genres.slice(0, 4).join(' · ')}</Text>
          ) : null}
          {kids && kidsDecided && !kidsAllowed ? (
            <Text style={styles.notice}>{t('kids.notForKids')}</Text>
          ) : null}
          {item.description ? (
            <Text style={styles.description} numberOfLines={4}>
              {item.description}
            </Text>
          ) : null}
          {cast.length > 0 ? (
            <Text style={styles.cast} numberOfLines={1}>
              {t('details.cast', { names: cast.join(', ') })}
            </Text>
          ) : null}
        </View>

        {failed ? (
          <View style={styles.actions}>
            <Text style={styles.facts}>{describeAddonError(t, state.error, t('rail.addons'))}</Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} preferred={active} />
          </View>
        ) : !meta && !primary ? (
          <ActivityIndicator color={color.accent} size="large" style={styles.loading} />
        ) : (
          <TVFocusGuideView autoFocus style={styles.actions}>
            {primary ? (
              <Button
                kind="primary"
                icon="play"
                label={primary.label}
                onPress={() => play(primary.videoId, primary.startAt)}
                width={layout.detailsResumeW}
                preferred={active}
              />
            ) : null}
            {watchVideoId !== null && resumeAt !== undefined ? (
              <Button label={t('details.startOver')} onPress={() => play(watchVideoId, 0)} />
            ) : null}
            {primary ? (
              <Button
                icon="layers"
                label={t('details.allStreams')}
                onPress={() =>
                  openStreams({
                    type: titleType,
                    metaId: id,
                    videoId: primary.videoId,
                    preview: item,
                  })
                }
              />
            ) : null}
            <Button
              icon={saved ? 'check' : 'plus'}
              label={t(saved ? 'tv.onMyList' : 'tv.myList')}
              onPress={() => void (saved ? library.remove(item.id) : library.add(meta ?? item))}
              {...(primary ? {} : { preferred: active })}
            />
            {trailer && kidsAllowed ? (
              <Button label={t('details.trailer')} onPress={() => void playTrailer(trailer)} />
            ) : null}
          </TVFocusGuideView>
        )}

        {showEpisodes ? (
          <View style={styles.episodes}>
            {seasons.length > 1 ? (
              <TVFocusGuideView autoFocus style={styles.seasons}>
                {seasons.map((option, index) => (
                  <Focusable
                    key={`${option.number}`}
                    radius={radii.pill}
                    onPress={() => {
                      shownSeason.set(id, index);
                      setSeasonIndex(index);
                    }}
                    accessibilityLabel={seasonLabel(t, option)}
                  >
                    {(focused) => (
                      <View
                        style={[
                          styles.chip,
                          index === shownIndex && styles.chipOn,
                          focused && styles.chipFocused,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            index === shownIndex && styles.chipTextOn,
                            focused && styles.chipTextFocused,
                          ]}
                        >
                          {seasonLabel(t, option)}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                ))}
              </TVFocusGuideView>
            ) : (
              <Text style={styles.sectionTitle}>{seasonLabel(t, season)}</Text>
            )}
            <TVFocusGuideView autoFocus>
              <FlatList
                horizontal
                data={season.videos}
                keyExtractor={(video, index) => `${index}:${video.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.episodeList}
                renderItem={({ item: video, index }) => (
                  <EpisodeCard
                    video={video}
                    index={index}
                    {...(video.episode !== undefined && seasonExtras?.[video.episode]
                      ? { extra: seasonExtras[video.episode] }
                      : {})}
                    now={now}
                    onPlay={(target) => play(target.id)}
                  />
                )}
              />
            </TVFocusGuideView>
          </View>
        ) : !isMovie && meta && !hasEpisodes && !canWatch && kidsAllowed ? (
          <Text style={[styles.facts, styles.inset]}>{t('details.noEpisodes')}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  backdrop: { position: 'absolute', top: 0, right: 0, width: '70%', height: '80%' },
  content: { paddingTop: px(150), paddingBottom: px(120), gap: spacing.xxl },
  text: { marginLeft: layout.heroLeft, width: px(1000), gap: spacing.md },
  title: { ...type.detailsTitle, color: color.text },
  facts: { ...type.meta, color: color.textSoft },
  genres: { ...type.meta, color: color.textMuted },
  notice: { ...type.body, color: color.kidsText },
  description: { ...type.body, color: color.textMuted },
  cast: { ...type.small, color: color.textFaint },
  loading: { alignSelf: 'flex-start', marginLeft: layout.heroLeft },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: layout.heroLeft,
  },
  inset: { marginLeft: layout.heroLeft },
  episodes: { gap: spacing.lg },
  seasons: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: layout.heroLeft },
  sectionTitle: { ...type.rowTitle, color: color.textSoft, marginLeft: layout.heroLeft },
  chip: {
    height: px(60),
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  chipOn: { backgroundColor: color.raised },
  chipFocused: { backgroundColor: color.focusFill },
  chipText: { ...type.label, color: color.textMuted },
  chipTextOn: { color: color.text },
  chipTextFocused: { color: color.onFocus },
  episodeList: {
    paddingHorizontal: layout.heroLeft,
    gap: layout.rowGap,
    paddingVertical: spacing.lg,
  },
  episode: { width: EPISODE.width, gap: spacing.sm },
  dim: { opacity: 0.5 },
  stillFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tick: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: px(40),
    height: px(40),
    borderRadius: px(20),
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    height: px(6),
    borderRadius: px(3),
    backgroundColor: color.barTrack,
  },
  fill: { height: '100%', borderRadius: px(3), backgroundColor: color.accent },
  episodeTitle: { ...type.label, color: color.text },
  episodeDate: { ...type.small, color: color.textMuted },
});

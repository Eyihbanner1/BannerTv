import { kidsTitleAllowed, nextVideo, ratingAllowed, tmdbImageUrl } from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { addonClient } from '@tv/data/addons';
import { describeAddonError, formatDate, metaFacts } from '@tv/data/describe';
import { library, watchedSet } from '@tv/data/library';
import { progress } from '@tv/data/playback';
import { activeProfile, isKidsProfile } from '@tv/data/profiles';
import { tmdbClient, useTmdbDetails } from '@tv/data/tmdb';
import { useQuery } from '@tv/data/use-query';
import { usePrefetch } from '@tv/player/prefetch';
import { formatTime } from '@tv/player/media';
import { playTrailer } from '@tv/platform/youtube';
import {
  defaultSeason,
  episodeState,
  groupSeasons,
  type Season,
  seasonOf,
} from '@tv/screens/details/seasons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack, openPlayer, openStreams } from '../nav/routes';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { colors, radius, space, type } from '../ui/theme';
import { phoneArt } from '../ui/Tile';

/** The season each title last showed, for this run. */
const shownSeason = new Map<string, number>();

function seasonLabel(t: ReturnType<typeof useTranslation>['t'], season: Season): string {
  if (season.number === null) return t('details.episodes');
  if (season.number === 0) return t('details.specials');
  return t('details.season', { number: season.number });
}

const EpisodeRow = memo(function EpisodeRow({
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
  const overview = video.overview || extra?.overview;
  const state = episodeState(video, progress.get(video.id), watchedSet.has(video.id), now);
  const date = video.released
    ? state.kind === 'upcoming'
      ? t('details.airs', { date: formatDate(video.released) })
      : formatDate(video.released)
    : '';
  const upcoming = state.kind === 'upcoming';
  return (
    <Pressable
      onPress={() => onPlay(video)}
      disabled={upcoming}
      accessibilityRole="button"
      accessibilityLabel={[title, date, state.kind === 'watched' ? t('details.watched') : '']
        .filter(Boolean)
        .join(', ')}
      style={({ pressed }) => [styles.episode, pressed && styles.pressed, upcoming && styles.dim]}
    >
      <View>
        <Artwork
          src={thumbnail}
          seed={video.id}
          style={styles.still}
          fallback={<Icon name="play" size={28} color={colors.textMuted} />}
        />
        {state.kind === 'watched' ? (
          <View style={styles.tick}>
            <Icon name="check" size={16} color={colors.bg} />
          </View>
        ) : null}
        {state.kind === 'started' ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(state.fraction * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.episodeText}>
        <Text style={styles.episodeTitle} numberOfLines={2}>
          {title}
        </Text>
        {date ? <Text style={styles.episodeDate}>{date}</Text> : null}
        {overview ? (
          <Text style={styles.episodeOverview} numberOfLines={3}>
            {overview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

export function TitleScreen({
  type: titleType,
  id,
  preview,
}: {
  type: string;
  id: string;
  preview?: MetaPreview;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const query = useMemo(() => addonClient.meta(titleType, id), [titleType, id]);
  const state = useQuery(query);
  const meta: MetaDetail | undefined = state.data;
  const item: MetaPreview | undefined = meta ?? preview;
  const failed = state.status === 'error' && !meta;
  const tmdb = useTmdbDetails(titleType, id);
  const extra = tmdb.details;
  const [now] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);

  // Kids: the same gate as the TV's Details.
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
    if (item && library.has(item.id)) void library.refresh(item);
  }, [item]);

  const resumeAt = watchVideoId === null ? undefined : progress.resumeAt(watchVideoId);
  const latest = !canWatch && kidsAllowed ? progress.forMeta(id)[0] : undefined;
  const latestVideo = latest && meta?.videos.find((video) => video.id === latest.videoId);
  const latestResume = latest && progress.resumeAt(latest.videoId);
  // After a finished episode, the next one that has aired.
  const upNext =
    latest && latestResume === undefined && meta ? nextVideo(meta, latest.videoId, now) : undefined;
  const firstEpisode = hasEpisodes && !latest ? groupSeasons(meta.videos)[0]?.videos[0] : undefined;

  const primaryVideoId = watchVideoId ?? latestVideo?.id ?? upNext?.id ?? firstEpisode?.id ?? null;
  usePrefetch(titleType, kidsAllowed ? primaryVideoId : null, item?.runtime);

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

  const play = (videoId: string, startAt?: number) => {
    if (!item) return;
    openPlayer({
      type: titleType,
      metaId: id,
      videoId,
      preview: item,
      ...(startAt !== undefined ? { startAt } : {}),
    });
  };

  if (!item) {
    return (
      <View style={[styles.screen, styles.centre]}>
        {failed ? (
          <View style={styles.failed}>
            <Text style={styles.body}>{describeAddonError(t, state.error, t('rail.addons'))}</Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
            <Button label={t('common.back')} kind="quiet" onPress={goBack} />
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  const backdrop = item.background ?? (extra?.backdropPath ? undefined : item.poster);
  const backdropSrc = phoneArt(backdrop) ?? tmdbImageUrl(extra?.backdropPath, 'w1280');
  const logo = phoneArt(item.logo) ?? tmdbImageUrl(extra?.logoPath, 'w500');
  const facts = [...metaFacts(t, item), extra?.certificate, extra?.network]
    .filter(Boolean)
    .join(' · ');
  const saved = library.has(item.id);
  const trailer = item.trailers[0];
  const cast = meta?.cast.slice(0, 6) ?? [];
  const heroHeight = Math.round((width * 9) / 16) + 80;

  const header = (
    <View>
      <View style={{ height: heroHeight }}>
        <Artwork
          src={backdropSrc}
          retrySrc={backdrop}
          seed={item.id}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(11,8,21,0.35)', 'rgba(11,8,21,0)', colors.bg]}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={[styles.back, { top: insets.top + space.s }]}
          hitSlop={8}
        >
          <Icon name="back" />
        </Pressable>
      </View>
      <View style={styles.body}>
        {logo ? (
          <Artwork
            src={logo}
            retrySrc={item.logo}
            seed={`${item.id}-logo`}
            contentFit="contain"
            backdrop={false}
            style={styles.logo}
            fallback={<Text style={styles.name}>{item.name}</Text>}
          />
        ) : (
          <Text style={styles.name}>{item.name}</Text>
        )}
        {facts ? <Text style={styles.facts}>{facts}</Text> : null}
        {item.genres.length > 0 ? (
          <Text style={styles.facts}>{item.genres.slice(0, 4).join(' · ')}</Text>
        ) : null}

        {kids && kidsDecided && !kidsAllowed ? (
          <Text style={styles.notice}>{t('kids.notForKids')}</Text>
        ) : null}

        <View style={styles.actions}>
          {watchVideoId !== null ? (
            <Button
              kind="primary"
              icon="play"
              label={
                resumeAt === undefined
                  ? t('details.watch')
                  : t('details.resumeFrom', { time: formatTime(resumeAt) })
              }
              onPress={() => play(watchVideoId)}
              style={styles.wide}
            />
          ) : null}
          {latestVideo && latestResume !== undefined ? (
            <Button
              kind="primary"
              icon="play"
              label={
                latestVideo.season !== undefined && latestVideo.episode !== undefined
                  ? t('details.resumeEpisode', {
                      season: latestVideo.season,
                      episode: latestVideo.episode,
                    })
                  : t('details.resumeFrom', { time: formatTime(latestResume) })
              }
              onPress={() => play(latestVideo.id)}
              style={styles.wide}
            />
          ) : null}
          {upNext ? (
            <Button
              kind="primary"
              icon="play"
              label={
                upNext.season !== undefined && upNext.episode !== undefined
                  ? t('home.nextEpisodeNote', { season: upNext.season, episode: upNext.episode })
                  : t('home.nextNote')
              }
              onPress={() => play(upNext.id)}
              style={styles.wide}
            />
          ) : null}
          {firstEpisode && kidsAllowed ? (
            <Button
              kind="primary"
              icon="play"
              label={t('phone.play')}
              onPress={() => play(firstEpisode.id)}
              style={styles.wide}
            />
          ) : null}
          <View style={styles.actionRow}>
            {watchVideoId !== null && resumeAt !== undefined ? (
              <Button label={t('details.startOver')} onPress={() => play(watchVideoId, 0)} />
            ) : null}
            <Button
              icon={saved ? 'check' : 'plus'}
              label={saved ? t('library.remove') : t('library.add')}
              accessibilityLabel={
                saved
                  ? t('library.removeLabel', { name: item.name })
                  : t('library.addLabel', { name: item.name })
              }
              onPress={() => void (saved ? library.remove(item.id) : library.add(meta ?? item))}
            />
            {trailer && kidsAllowed ? (
              <Button label={t('details.trailer')} onPress={() => void playTrailer(trailer)} />
            ) : null}
            {watchVideoId !== null ? (
              <Button
                icon="layers"
                label={t('details.allStreams')}
                onPress={() =>
                  openStreams({ type: titleType, metaId: id, videoId: watchVideoId, preview: item })
                }
              />
            ) : null}
          </View>
        </View>

        {failed ? (
          <View style={styles.failed}>
            <Text style={styles.facts}>{describeAddonError(t, state.error, t('rail.addons'))}</Text>
            <Button label={t('common.tryAgain')} onPress={() => query.retry()} />
          </View>
        ) : null}

        {item.description ? (
          <Pressable onPress={() => setExpanded((open) => !open)} accessibilityRole="button">
            <Text style={styles.description} numberOfLines={expanded ? undefined : 4}>
              {item.description}
            </Text>
          </Pressable>
        ) : null}
        {cast.length > 0 ? (
          <Text style={styles.facts}>{t('details.cast', { names: cast.join(', ') })}</Text>
        ) : null}
        {meta && meta.directors.length > 0 ? (
          <Text style={styles.facts}>
            {t('details.directors', { names: meta.directors.join(', ') })}
          </Text>
        ) : null}

        {hasEpisodes && kidsAllowed && seasons.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasons}>
            {seasons.map((option, index) => (
              <Pressable
                key={`${option.number}`}
                onPress={() => {
                  shownSeason.set(id, index);
                  setSeasonIndex(index);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: index === shownIndex }}
                style={[styles.chip, index === shownIndex && styles.chipOn]}
              >
                <Text style={[styles.chipText, index === shownIndex && styles.chipTextOn]}>
                  {seasonLabel(t, option)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : hasEpisodes && kidsAllowed && season ? (
          <Text style={styles.sectionTitle}>{seasonLabel(t, season)}</Text>
        ) : null}
        {!isMovie && meta && !hasEpisodes && !canWatch && kidsAllowed ? (
          <Text style={styles.facts}>{t('details.noEpisodes')}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      data={hasEpisodes && kidsAllowed && season ? season.videos : []}
      keyExtractor={(video, index) => `${index}:${video.id}`}
      ListHeaderComponent={header}
      renderItem={({ item: video, index }) => (
        <EpisodeRow
          video={video}
          index={index}
          {...(video.episode !== undefined && seasonExtras?.[video.episode]
            ? { extra: seasonExtras[video.episode] }
            : {})}
          now={now}
          onPlay={(target) => play(target.id)}
        />
      )}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      initialNumToRender={8}
      windowSize={9}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  back: {
    position: 'absolute',
    left: space.l,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: space.l, gap: space.s, marginTop: -64 },
  logo: { width: '75%', height: 80 },
  name: { ...type.display, color: colors.text },
  facts: { ...type.small, color: colors.textMuted },
  notice: { ...type.body, color: colors.text },
  actions: { gap: space.s, marginTop: space.s },
  wide: { alignSelf: 'stretch' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  failed: { gap: space.s, alignItems: 'flex-start' },
  description: { ...type.body, color: colors.textMuted, marginTop: space.s },
  seasons: { marginTop: space.l, flexGrow: 0 },
  chip: {
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    marginRight: space.s,
  },
  chipOn: { backgroundColor: colors.action },
  chipText: { ...type.label, color: colors.textMuted },
  chipTextOn: { color: colors.text },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.l },
  episode: {
    flexDirection: 'row',
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  pressed: { backgroundColor: colors.surface1 },
  dim: { opacity: 0.55 },
  still: {
    width: 128,
    height: 72,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.prismTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 4,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  fill: { height: 3, backgroundColor: colors.accent },
  episodeText: { flex: 1, gap: 2 },
  episodeTitle: { ...type.label, color: colors.text },
  episodeDate: { ...type.small, color: colors.textSubtle },
  episodeOverview: { ...type.small, color: colors.textMuted },
});

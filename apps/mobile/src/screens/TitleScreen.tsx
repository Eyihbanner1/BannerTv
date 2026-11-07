import { phone } from '@brand/tokens/design';
import { kidsDetailsAllowed, kidsTitleAllowed, moreLikeSource, tmdbImageUrl } from '@bannertv/core';
import type { MetaDetail, MetaPreview, Video } from '@bannertv/protocol';
import { addonClient, addonCollection } from '@tv/data/addons';
import { describeAddonError, formatDate, metaFacts } from '@tv/data/describe';
import { library, watchedSet } from '@tv/data/library';
import { isWatched, markEpisodes, markFilm } from '@tv/data/marks';
import { progress } from '@tv/data/playback';
import { activeProfile, isKidsProfile } from '@tv/data/profiles';
import { sportsState } from '@tv/data/sports';
import { tmdbClient, useTmdbDetails } from '@tv/data/tmdb';
import { useQuery } from '@tv/data/use-query';
import { resolutionLabel } from '@tv/player/describe';
import { streamFinder } from '@tv/player/finder';
import { OPEN_PAGE_REST_MS, usePrefetch } from '@tv/player/prefetch';
import { formatTime } from '@tv/player/media';
import { playTrailer } from '@tv/platform/youtube';
import {
  defaultSeason,
  episodeState,
  groupSeasons,
  type MarkOffer,
  markOffer,
  openingEpisode,
  type Season,
  type StartPoint,
  startPoint,
  type StartReader,
  startReader,
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
import { goBack, openCatalog, openPlayer, openStreams, openTitle } from '../nav/routes';
import { Artwork } from '../ui/Artwork';
import { Button } from '../ui/Button';
import { Icon, type IconName, OutlineIcon } from '../ui/icons';
import { Sheet, SheetOption } from '../ui/Sheet';
import { CastList, GenreLinks } from './TitleLinks';
import { colors, gutter, radius, space, touch, type } from '../ui/theme';
import { Row, type RowItem } from '../ui/Row';
import { phoneArt } from '../ui/Tile';

/** A square-ish button in the row of three under Play: My List, All streams and so on. */
function ActionTile({
  label,
  icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <Icon name={icon} size={20} color={colors.text} />
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

type ReadyState = 'none' | 'finding' | 'ready' | 'nothing';

/**
 * Under Play: whether the stream Play will start has been found ("Best stream ready · 1080p").
 * It reads the finder Details' prefetch started and draws again only when the line's words
 * change, not on every addon's answer.
 */
function StreamReady({ type: titleType, videoId }: { type: string; videoId: string }) {
  const { t } = useTranslation();
  const finder = useMemo(() => streamFinder(titleType, videoId), [titleType, videoId]);
  const line = useSyncExternalStore(finder.subscribe, () => {
    const state = finder.get();
    const best = state.candidates[0];
    const kind: ReadyState = state.settled
      ? best
        ? 'ready'
        : 'nothing'
      : state.pending > 0 || state.entries.length > 0
        ? 'finding'
        : 'none';
    const quality = kind === 'ready' ? (resolutionLabel(best?.facts.resolution) ?? '') : '';
    return `${kind}|${quality}`;
  });
  const [kind, quality] = line.split('|') as [ReadyState, string];
  if (kind === 'none') return null;
  const text =
    kind === 'ready'
      ? [t('phone.streamReady'), quality].filter(Boolean).join(' · ')
      : kind === 'finding'
        ? t('phone.findingStream')
        : t('phone.noStreamYet');
  return (
    <View style={styles.ready} accessibilityLiveRegion="polite">
      <View
        style={[
          styles.readyDot,
          kind === 'ready' && styles.readyDotOn,
          kind === 'nothing' && styles.readyDotOff,
        ]}
      />
      <Text style={styles.readyText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const MORE_ITEMS = 20;

function MoreFrom({ item, titleType }: { item: MetaPreview; titleType: string }) {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  // The same pick as the TV's More like this and the genre links above: only a catalog that
  // lists the genre, so See all opens Browse on it, and never a sport catalog.
  const source = useMemo(
    () =>
      collection.ready && sports.ready
        ? moreLikeSource(collection.addons, item, titleType, sports.homeLeaveOut)
        : undefined,
    // The title's genres and id decide it; the rest of the item may refresh underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, sports.ready, sports.homeLeaveOut, item.id, item.genres[0], titleType],
  );
  const query = useMemo(
    () =>
      source
        ? addonClient.catalog(source.addon, titleType, source.catalog.id, [['genre', source.genre]])
        : null,
    [source, titleType],
  );
  const state = useQuery(query);
  const items = useMemo<RowItem[] | null>(() => {
    if (!state.data) return null;
    const kids = isKidsProfile();
    return state.data
      .filter((other) => other.id !== item.id && (!kids || kidsTitleAllowed(other, true)))
      .slice(0, MORE_ITEMS)
      .map((other, index) => ({ item: other, key: `${index}:${other.id}` }));
  }, [state.data, item.id]);
  if (!source || state.status === 'error' || items?.length === 0) return null;
  const title = t('phone.moreFrom', { genre: source.genre, addon: source.addon.manifest.name });
  return (
    <Row
      title={title}
      items={items}
      shape="poster"
      onPress={(entry) => openTitle(entry.item)}
      seeAllLabel={t('home.seeAll')}
      onSeeAll={() =>
        openCatalog({
          transportUrl: source.addon.transportUrl,
          type: titleType,
          catalogId: source.catalog.id,
          genre: source.genre,
          title,
        })
      }
    />
  );
}

/** The season each title last showed, for this run. */
const shownSeason = new Map<string, number>();

/** The Play button's words for where a series' page sends the viewer, as on the TV. */
function startLabel(t: ReturnType<typeof useTranslation>['t'], point: StartPoint): string {
  const { season, episode } = point.video;
  const numbered = season !== undefined && episode !== undefined;
  if (point.kind === 'resume') {
    return numbered
      ? t('details.resumeEpisode', { season, episode })
      : t('details.resumeFrom', { time: formatTime(point.at) });
  }
  if (point.kind === 'next') {
    return numbered ? t('home.nextEpisodeNote', { season, episode }) : t('home.nextNote');
  }
  return numbered ? t('browsing.playEpisode', { season, episode }) : t('phone.play');
}

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
  onHold,
}: {
  video: Video;
  index: number;
  extra?: { name?: string; overview?: string; stillPath?: string };
  now: number;
  onPlay: (video: Video) => void;
  /** A long press: mark it, or its season, watched or not. */
  onHold: (video: Video) => void;
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
      onLongPress={() => onHold(video)}
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

  // Kids: the TV's Details rule, shared in core.
  const kids = isKidsProfile();
  const kidsMax = activeProfile()?.kids;
  const kidsDecided = !kids || (meta !== undefined && tmdb.settled);
  const kidsAllowed =
    !kids || (kidsDecided && meta !== undefined && kidsDetailsAllowed(meta, extra, kidsMax));

  const isMovie = titleType === 'movie';
  const hasEpisodes = !isMovie && meta !== undefined && meta.videos.length > 0;
  const canWatch = kidsAllowed && (isMovie || (meta !== undefined && !hasEpisodes));
  const watchVideoId = canWatch ? (meta?.behaviorHints.defaultVideoId ?? id) : null;

  useSyncExternalStore(progress.subscribe, progress.version);
  useSyncExternalStore(library.subscribe, library.version);
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  useEffect(() => {
    void progress.load();
  }, []);
  useEffect(() => {
    if (item && library.has(item.id)) void library.refresh(item);
  }, [item]);

  const resumeAt = watchVideoId === null ? undefined : progress.resumeAt(watchVideoId);
  // A series opens where the viewer is up to, with the same rules as the TV's Details.
  const seasons = useMemo(() => (meta ? groupSeasons(meta.videos) : []), [meta]);
  const reader: StartReader | undefined =
    hasEpisodes && kidsAllowed ? startReader(progress, watchedSet, id) : undefined;
  const start = reader && meta ? startPoint(meta, seasons, reader, now) : undefined;

  const primaryVideoId = watchVideoId ?? start?.video.id ?? null;
  // Nothing here moves focus: what Play plays is looked up once the page has been open a moment.
  usePrefetch(
    titleType,
    kidsAllowed ? primaryVideoId : null,
    item?.runtime,
    undefined,
    OPEN_PAGE_REST_MS,
  );

  const [seasonIndex, setSeasonIndex] = useState<number | null>(null);
  const shownIndex =
    seasonIndex ??
    shownSeason.get(id) ??
    (reader
      ? openingEpisode(seasons, start, reader).season
      : seasons.length > 0
        ? defaultSeason(seasons)
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
  // The episode long-pressed, while its sheet shows what marking it offers.
  const [held, setHeld] = useState<Video | null>(null);
  const offer: MarkOffer | null = held && season ? markOffer(held, season, isWatched, now) : null;
  const route = { metaId: id, type: titleType };

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
  const facts = [...metaFacts(t, item), extra?.network].filter(Boolean).join(' · ');
  const certificate = extra?.certificate;
  const saved = library.has(item.id);
  const trailer = item.trailers[0];
  const heroHeight = Math.max(phone.backdropH, Math.round((width * 9) / 16) + insets.top);

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
          colors={['rgba(11,8,21,0)', colors.bg]}
          locations={[0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={[styles.back, { top: insets.top + space.s }]}
        >
          <OutlineIcon name="back" size={22} weight={2.4} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} accessibilityRole="header">
          {item.name}
        </Text>
        {facts || certificate ? (
          <View style={styles.factsRow}>
            {facts ? <Text style={styles.factsLine}>{facts}</Text> : null}
            {certificate ? <Text style={styles.certificate}>{certificate}</Text> : null}
          </View>
        ) : null}
        <GenreLinks item={item} type={titleType} />

        {kids && kidsDecided && !kidsAllowed ? (
          <Text style={styles.notice}>{t('kids.notForKids')}</Text>
        ) : null}

        <View style={styles.actions}>
          {watchVideoId !== null ? (
            <Button
              kind="play"
              icon="play"
              label={
                resumeAt === undefined
                  ? t('details.watch')
                  : t('details.resumeFrom', { time: formatTime(resumeAt) })
              }
              onPress={() => play(watchVideoId)}
              style={styles.main}
            />
          ) : null}
          {start ? (
            <Button
              kind="play"
              icon="play"
              label={startLabel(t, start)}
              onPress={() => play(start.video.id, start.kind === 'again' ? 0 : undefined)}
              style={styles.main}
            />
          ) : null}
          {primaryVideoId !== null && kidsAllowed ? (
            <StreamReady type={titleType} videoId={primaryVideoId} />
          ) : null}
          <View style={styles.actionRow}>
            {watchVideoId !== null && resumeAt !== undefined ? (
              <ActionTile
                icon="replay10"
                label={t('details.startOver')}
                onPress={() => play(watchVideoId, 0)}
              />
            ) : null}
            <ActionTile
              icon={saved ? 'check' : 'plus'}
              label={saved ? t('library.remove') : t('library.add')}
              accessibilityLabel={
                saved
                  ? t('library.removeLabel', { name: item.name })
                  : t('library.addLabel', { name: item.name })
              }
              onPress={() => void (saved ? library.remove(item.id) : library.add(meta ?? item))}
            />
            {watchVideoId !== null ? (
              <ActionTile
                icon={isWatched(watchVideoId) ? 'check' : 'unchecked'}
                label={t('browsing.watched')}
                accessibilityLabel={
                  isWatched(watchVideoId)
                    ? t('browsing.markTitleUnwatched', { name: item.name })
                    : t('browsing.markTitleWatched', { name: item.name })
                }
                onPress={() => markFilm(route, item, meta, watchVideoId, !isWatched(watchVideoId))}
              />
            ) : null}
            {trailer && kidsAllowed ? (
              <ActionTile
                icon="movie"
                label={t('details.trailer')}
                onPress={() => void playTrailer(trailer)}
              />
            ) : null}
            {watchVideoId !== null ? (
              <ActionTile
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
        <CastList people={extra?.cast} names={meta?.cast ?? []} />
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

  const onMark = (whole: boolean) => {
    const target = held;
    setHeld(null);
    if (!target || !offer || !meta) return;
    // The list stays on this season, though the marks move where the viewer is up to.
    setSeasonIndex(shownIndex);
    if (whole) markEpisodes(route, meta, offer.out, !offer.allWatched);
    else markEpisodes(route, meta, [target], !offer.watched);
  };

  return (
    <>
      <FlatList
        style={styles.screen}
        data={hasEpisodes && kidsAllowed && season ? season.videos : []}
        keyExtractor={(video, index) => `${index}:${video.id}`}
        ListHeaderComponent={header}
        ListFooterComponent={
          kidsAllowed ? <MoreFrom item={item} titleType={titleType} /> : undefined
        }
        renderItem={({ item: video, index }) => (
          <EpisodeRow
            video={video}
            index={index}
            {...(video.episode !== undefined && seasonExtras?.[video.episode]
              ? { extra: seasonExtras[video.episode] }
              : {})}
            now={now}
            onPlay={(target) => play(target.id)}
            onHold={setHeld}
          />
        )}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        initialNumToRender={8}
        windowSize={9}
      />
      <Sheet
        visible={offer !== null}
        {...(held
          ? { title: held.title || t('details.untitledEpisode', { number: held.episode ?? 1 }) }
          : {})}
        onClose={() => setHeld(null)}
      >
        {offer ? (
          <>
            <SheetOption
              label={offer.watched ? t('browsing.markUnwatched') : t('browsing.markWatched')}
              onPress={() => onMark(false)}
            />
            {offer.season !== undefined ? (
              <SheetOption
                label={
                  offer.allWatched
                    ? t('browsing.markSeasonUnwatched', { season: offer.season })
                    : t('browsing.markSeasonWatched', { season: offer.season })
                }
                onPress={() => onMark(true)}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  back: {
    position: 'absolute',
    left: space.l,
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: gutter, paddingTop: 18, gap: space.m },
  name: { ...type.display, color: colors.text },
  factsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.m },
  factsLine: { ...type.label, fontWeight: '500', color: colors.textMuted, flexShrink: 1 },
  certificate: {
    ...type.small,
    fontWeight: '700',
    color: colors.textMuted,
    borderWidth: 1,
    borderColor: colors.textSubtle,
    borderRadius: radius.s,
    paddingHorizontal: space.s,
    paddingVertical: 1,
  },
  facts: { ...type.meta, color: colors.textMuted },
  notice: { ...type.body, color: colors.text },
  actions: { gap: space.s },
  main: { alignSelf: 'stretch', minHeight: touch.play, borderRadius: 14 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  ready: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: 2 },
  readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textSubtle },
  readyDotOn: { backgroundColor: colors.accent },
  readyDotOff: { backgroundColor: colors.danger },
  readyText: { ...type.meta, fontWeight: '600', color: colors.textSoft, flexShrink: 1 },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 64,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  tilePressed: { backgroundColor: colors.raised },
  tileLabel: { ...type.meta, fontWeight: '700', color: colors.text },
  failed: { gap: space.s, alignItems: 'flex-start' },
  description: { ...type.body, lineHeight: 23, color: colors.textSoft, marginTop: space.xs },
  seasons: { marginTop: space.l, flexGrow: 0 },
  chip: {
    minHeight: touch.chip,
    justifyContent: 'center',
    paddingHorizontal: space.l,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    marginRight: space.s,
  },
  chipOn: { backgroundColor: colors.playFill },
  chipText: { ...type.meta, fontWeight: '700', color: colors.textSoft },
  chipTextOn: { color: colors.onPlay, fontWeight: '800' },
  sectionTitle: { ...type.heading, color: colors.text, marginTop: space.l },
  episode: {
    flexDirection: 'row',
    gap: space.m,
    paddingHorizontal: gutter,
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

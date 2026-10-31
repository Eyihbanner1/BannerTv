import { parseRuntime, type StreamEntry, type StreamOrder } from '@bannertv/core';
import { addonClient } from '@tv/data/addons';
import { preferences, setPreference } from '@tv/data/preferences';
import { useQuery } from '@tv/data/use-query';
import { playTrailer } from '@tv/platform/youtube';
import { streamFinder } from '@tv/player/finder';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { openPlayer, type StreamsRoute } from '../nav/routes';
import { Button } from '../ui/Button';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Sheet, SheetOption } from '../ui/Sheet';
import { StreamList } from '../ui/StreamList';
import { colors, space, type } from '../ui/theme';

const ORDERS: readonly StreamOrder[] = ['quality', 'fast', 'addon'];

/**
 * Every stream the addons offered for one video, for choosing by hand when auto-play's pick is
 * not the one wanted. Streams this phone can't play stay in the list, last and dimmed.
 */
export function StreamsScreen({ route }: { route: StreamsRoute }) {
  const { type: titleType, metaId, videoId, preview, startAt } = route;
  const { t } = useTranslation();
  const finder = useMemo(() => streamFinder(titleType, videoId), [titleType, videoId]);
  const order = useSyncExternalStore(
    preferences.subscribe,
    () => preferences.get().allStreamsOrder,
  );
  const metaQuery = useMemo(
    () => (titleType === 'movie' ? null : addonClient.meta(titleType, metaId)),
    [titleType, metaId],
  );
  const meta = useQuery(metaQuery).data;
  const item = meta ?? preview;
  const episode = meta?.videos.find((video) => video.id === videoId);
  const [sorting, setSorting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => finder.start(), [finder]);
  const runtime = item?.runtime;
  useEffect(() => finder.setRuntime(parseRuntime(runtime)), [finder, runtime]);

  const open = (entry: StreamEntry) => {
    const action = entry.assessment.action;
    setNote(null);
    if (action.kind === 'play') {
      openPlayer(
        {
          type: titleType,
          metaId,
          videoId,
          ...(preview ? { preview } : {}),
          stream: entry,
          chosen: true,
          ...(startAt !== undefined ? { startAt } : {}),
        },
        'replace',
      );
    } else if (action.kind === 'youtube' && entry.stream.source.kind === 'youtube') {
      playTrailer(entry.stream.source.ytId).catch(() => setNote(t('details.trailerFailed')));
    } else {
      setNote(t(`streams.cannot.${action.kind === 'unavailable' ? action.reason : 'external'}`));
    }
  };

  const heading = episode
    ? [
        item?.name,
        episode.season !== undefined ? `S${episode.season}:E${episode.episode ?? ''}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : item?.name;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('streams.title')} />
      <StreamList
        finder={finder}
        onPick={open}
        header={
          <View style={styles.header}>
            {heading ? (
              <Text style={styles.name} numberOfLines={2}>
                {heading}
              </Text>
            ) : null}
            <Button
              label={t('streams.sortBy', { order: t(`streams.order.${order}`) })}
              icon="layers"
              onPress={() => setSorting(true)}
              style={styles.sort}
            />
            {note ? <Text style={styles.note}>{note}</Text> : null}
          </View>
        }
      />
      <Sheet visible={sorting} title={t('streams.sortTitle')} onClose={() => setSorting(false)}>
        {ORDERS.map((value) => (
          <SheetOption
            key={value}
            label={t(`streams.order.${value}`)}
            selected={value === order}
            onPress={() => {
              setPreference('allStreamsOrder', value);
              setSorting(false);
            }}
          />
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.l, gap: space.m, paddingBottom: space.s },
  name: { ...type.heading, color: colors.text },
  sort: { alignSelf: 'flex-start' },
  note: { ...type.body, color: colors.danger },
});

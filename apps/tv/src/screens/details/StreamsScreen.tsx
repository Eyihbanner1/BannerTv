import type { StreamEntry } from '@bannertv/core';
import { addonNames } from '@tv/data/addons';
import { preferences } from '@tv/data/preferences';
import { streamRowText, streamsStatus } from '@tv/player/describe';
import { entryKey, isHeavy, listOrder, streamFinder } from '@tv/player/finder';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { openPlayer, type StreamsRoute } from '../../nav/routes';
import { Focusable } from '../../ui/Focusable';
import { color, layout, px, radii, spacing, type } from '../../ui/theme';

/** Every stream the addons offered for one video, to pick one by hand. */
export function StreamsScreen({ route }: { route: StreamsRoute }) {
  const { t } = useTranslation();
  const finder = useMemo(
    () => streamFinder(route.type, route.videoId),
    [route.type, route.videoId],
  );
  useEffect(() => {
    finder.start();
  }, [finder]);
  const state = useSyncExternalStore(finder.subscribe, finder.get);
  const order = useSyncExternalStore(preferences.subscribe, preferences.get).allStreamsOrder;
  const names = addonNames();
  const entries = useMemo(
    () => listOrder(state.entries, order, finder.runtimeSeconds()),
    [state.entries, order, finder],
  );
  const pick = (entry: StreamEntry) =>
    openPlayer({
      type: route.type,
      metaId: route.metaId,
      videoId: route.videoId,
      ...(route.preview ? { preview: route.preview } : {}),
      stream: entry,
      chosen: true,
    });

  return (
    <View style={styles.screen}>
      <Text style={styles.title} numberOfLines={1}>
        {route.preview?.name ?? t('details.allStreams')}
      </Text>
      <View style={styles.status}>
        {state.pending > 0 ? <ActivityIndicator color={color.accent} /> : null}
        <Text style={styles.statusText}>{streamsStatus(t, state, entries.length)}</Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entryKey(entry)}
        contentContainerStyle={styles.list}
        renderItem={({ item: entry, index }) => {
          const text = streamRowText(t, entry, { heavy: isHeavy(entry, finder.runtimeSeconds()) });
          return (
            <Focusable
              onPress={() => pick(entry)}
              disabled={!text.playable}
              radius={radii.lg}
              // The ring follows this box, so it takes the row's width rather than the list's.
              style={styles.rowBox}
              {...(index === 0 ? { preferred: true } : {})}
              accessibilityLabel={[text.title, ...text.badges, ...text.notes].join(', ')}
            >
              {(focused) => (
                <View
                  style={[styles.row, focused && styles.rowFocused, !text.playable && styles.dim]}
                >
                  <Text style={[styles.addon, focused && styles.onFocus]} numberOfLines={1}>
                    {names.get(entry.addonId) ?? entry.addonId}
                  </Text>
                  <Text style={[styles.rowTitle, focused && styles.onFocus]} numberOfLines={2}>
                    {text.title}
                  </Text>
                  {text.badges.length > 0 || text.note ? (
                    <Text style={[styles.badges, focused && styles.onFocus]} numberOfLines={1}>
                      {[...text.badges, text.note].filter(Boolean).join('  ·  ')}
                    </Text>
                  ) : null}
                </View>
              )}
            </Focusable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingTop: px(90) },
  title: { ...type.heading, color: color.text, marginHorizontal: layout.heroLeft },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: layout.heroLeft,
    marginVertical: spacing.lg,
  },
  statusText: { ...type.meta, color: color.textMuted },
  list: { paddingHorizontal: layout.heroLeft, paddingBottom: px(200), gap: spacing.md },
  rowBox: { width: px(1400) },
  row: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: color.surface,
    gap: spacing.xs,
  },
  rowFocused: { backgroundColor: color.focusFill },
  dim: { opacity: 0.5 },
  addon: { ...type.small, color: color.accent },
  rowTitle: { ...type.label, color: color.text },
  badges: { ...type.small, color: color.textMuted },
  onFocus: { color: color.onFocus },
});

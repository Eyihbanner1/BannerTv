import type { StreamEntry } from '@bannertv/core';
import { addonNames } from '@tv/data/addons';
import { preferences } from '@tv/data/preferences';
import { streamRowText, streamsStatus } from '@tv/player/describe';
import { entryKey, isHeavy, listOrder, type StreamFinder } from '@tv/player/finder';
import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from './theme';

/** Every stream the addons offered for one video, in the viewer's chosen order. */
export function StreamList({
  finder,
  playingKey,
  onPick,
  header,
}: {
  finder: StreamFinder;
  playingKey?: string;
  onPick: (entry: StreamEntry) => void;
  header?: React.ReactElement;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(finder.subscribe, finder.get);
  const order = useSyncExternalStore(preferences.subscribe, preferences.get).allStreamsOrder;
  const names = addonNames();
  const entries = useMemo(
    () => listOrder(state.entries, order, finder.runtimeSeconds()),
    [state.entries, order, finder],
  );
  const status = streamsStatus(t, state, entries.length);
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entryKey(entry)}
      ListHeaderComponent={
        <View>
          {header}
          <View style={styles.status}>
            {state.pending > 0 ? <ActivityIndicator color={colors.accent} size="small" /> : null}
            <Text style={styles.statusText}>{status}</Text>
          </View>
        </View>
      }
      renderItem={({ item: entry }) => {
        const text = streamRowText(t, entry, { heavy: isHeavy(entry, finder.runtimeSeconds()) });
        const key = entryKey(entry);
        const playing = key === playingKey;
        return (
          <Pressable
            onPress={() => onPick(entry)}
            disabled={!text.playable}
            accessibilityRole="button"
            accessibilityState={{ selected: playing, disabled: !text.playable }}
            style={({ pressed }) => [
              styles.row,
              playing && styles.playing,
              pressed && styles.pressed,
              !text.playable && styles.unplayable,
            ]}
          >
            <Text style={styles.addon} numberOfLines={1}>
              {names.get(entry.addonId) ?? entry.addonId}
            </Text>
            <Text style={styles.title} numberOfLines={3}>
              {text.title}
            </Text>
            {text.badges.length > 0 ? (
              <View style={styles.badges}>
                {text.badges.map((badge) => (
                  <Text key={badge} style={styles.badge}>
                    {badge}
                  </Text>
                ))}
              </View>
            ) : null}
            {text.note ? <Text style={styles.note}>{text.note}</Text> : null}
          </Pressable>
        );
      }}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.xxl },
  status: { flexDirection: 'row', gap: space.s, alignItems: 'center', padding: space.l },
  statusText: { ...type.label, color: colors.textMuted },
  row: {
    marginHorizontal: space.l,
    marginBottom: space.s,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: colors.surface1,
    gap: space.xs,
  },
  playing: { borderWidth: 2, borderColor: colors.accent },
  pressed: { backgroundColor: colors.surface2 },
  unplayable: { opacity: 0.55 },
  addon: { ...type.small, color: colors.accent },
  title: { ...type.body, color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  badge: {
    ...type.small,
    color: colors.text,
    backgroundColor: colors.surface3,
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  note: { ...type.small, color: colors.textMuted },
});

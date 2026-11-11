import { languageName, type StreamEntry } from '@bannertv/core';
import { addonNames } from '@tv/data/addons';
import { preferences, setPreference } from '@tv/data/preferences';
import { streamRowText } from '@tv/player/describe';
import { entryKey, isHeavy, listOrder, type StreamFinder } from '@tv/player/finder';
import {
  filterChoices,
  filteredStatus,
  filterResolutionLabel,
  isFiltering,
  NO_FILTER,
  shownStreams,
  type StreamFilter,
} from '@tv/player/stream-filter';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './Chip';
import { ChipRow } from './ChipRow';
import { Sheet, SheetOption } from './Sheet';
import { colors, radius, space, type } from './theme';

type Picker = 'resolution' | 'addon' | 'language';

/** "Any" in a picker: no value in that part of the filter. */
const ANY = '';

/**
 * Every stream the addons offered for one video, in the viewer's chosen order, with the TV's quick
 * filter as chips above it: picture size, cached only, addon and audio language, kept for the
 * profile. The stream playing stays listed whatever the filter.
 */
export function StreamList({
  finder,
  playingKey,
  onPick,
  header,
  canOpen,
  background = colors.bg,
}: {
  finder: StreamFinder;
  playingKey?: string;
  onPick: (entry: StreamEntry) => void;
  header?: React.ReactElement;
  /** Rows this screen can act on though the player can't play them (YouTube, in All streams). */
  canOpen?: (entry: StreamEntry) => boolean;
  /** What the list sits on (the player's panel is a sheet), for the chips' edge fades. */
  background?: string;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(finder.subscribe, finder.get);
  const prefs = useSyncExternalStore(preferences.subscribe, preferences.get);
  const order = prefs.allStreamsOrder;
  const filter = prefs.streamFilter;
  const [picking, setPicking] = useState<Picker | null>(null);
  const names = addonNames();
  const ordered = useMemo(
    () => listOrder(state.entries, order, finder.orderOptions()),
    [state.entries, order, finder],
  );
  const shown = useMemo(
    () =>
      shownStreams(
        ordered,
        filter,
        playingKey === undefined ? undefined : (entry) => entryKey(entry) === playingKey,
      ),
    [ordered, filter, playingKey],
  );
  const choices = filterChoices(ordered, names, filter);
  const status = filteredStatus(t, state, shown, ordered.length);

  const setPart = <K extends keyof StreamFilter>(key: K, value: StreamFilter[K] | undefined) => {
    const next: StreamFilter = { ...filter };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setPreference('streamFilter', isFiltering(next) ? next : NO_FILTER);
  };

  // A chip shows when its part is on, or when it would change the list.
  const chips: React.ReactElement[] = [];
  if (filter.resolution !== undefined || choices.resolutions.length > 1) {
    chips.push(
      <Chip
        key="resolution"
        label={
          filter.resolution ? filterResolutionLabel(filter.resolution) : t('streams.filter.quality')
        }
        on={filter.resolution !== undefined}
        onPress={() => setPicking('resolution')}
      />,
    );
  }
  if (filter.cached || (choices.cached > 0 && choices.cached < ordered.length)) {
    chips.push(
      <Chip
        key="cached"
        label={t('streams.cached')}
        on={filter.cached === true}
        onPress={() => setPart('cached', filter.cached ? undefined : true)}
      />,
    );
  }
  if (filter.addonId !== undefined || choices.addons.length > 1) {
    chips.push(
      <Chip
        key="addon"
        label={
          filter.addonId !== undefined
            ? (names.get(filter.addonId) ?? filter.addonId)
            : t('streams.filter.addon')
        }
        on={filter.addonId !== undefined}
        onPress={() => setPicking('addon')}
      />,
    );
  }
  if (filter.language !== undefined || choices.languages.length > 1) {
    chips.push(
      <Chip
        key="language"
        label={
          filter.language !== undefined
            ? languageName(filter.language)
            : t('streams.filter.language')
        }
        on={filter.language !== undefined}
        onPress={() => setPicking('language')}
      />,
    );
  }
  if (isFiltering(filter)) {
    chips.push(
      <Chip
        key="clear"
        label={t('streams.filter.clear')}
        on={false}
        onPress={() => setPreference('streamFilter', NO_FILTER)}
      />,
    );
  }

  const count = (n: number) => t('streams.count', { count: n });
  const options: Array<{ value: string; label: string; detail?: string }> = [
    { value: ANY, label: t('streams.filter.any') },
  ];
  let selected: string = ANY;
  let title = '';
  if (picking === 'resolution') {
    title = t('streams.filter.quality');
    selected = filter.resolution ?? ANY;
    for (const choice of choices.resolutions) {
      options.push({
        value: choice.value,
        label: filterResolutionLabel(choice.value),
        detail: count(choice.count),
      });
    }
  } else if (picking === 'addon') {
    title = t('streams.filter.addon');
    selected = filter.addonId ?? ANY;
    for (const choice of choices.addons) {
      options.push({ value: choice.id, label: choice.name, detail: count(choice.count) });
    }
  } else if (picking === 'language') {
    title = t('streams.filter.language');
    selected = filter.language ?? ANY;
    for (const choice of choices.languages) {
      options.push({
        value: choice.code,
        label: languageName(choice.code),
        detail: count(choice.count),
      });
    }
  }
  const pick = (value: string) => {
    const part = value === ANY ? undefined : value;
    if (picking === 'resolution') setPart('resolution', part as StreamFilter['resolution']);
    else if (picking === 'addon') setPart('addonId', part);
    else if (picking === 'language') setPart('language', part);
    setPicking(null);
  };

  return (
    <>
      <FlatList
        data={shown.entries}
        keyExtractor={(entry) => entryKey(entry)}
        ListHeaderComponent={
          <View>
            {header}
            {chips.length > 0 ? (
              <ChipRow inset={space.l} fadeColor={background} style={styles.chips}>
                {chips}
              </ChipRow>
            ) : null}
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
          const enabled = text.playable || canOpen?.(entry) === true;
          return (
            <Pressable
              onPress={() => onPick(entry)}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityState={{ selected: playing, disabled: !enabled }}
              style={({ pressed }) => [
                styles.row,
                playing && styles.playing,
                pressed && styles.pressed,
                !enabled && styles.unplayable,
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
      <Sheet visible={picking !== null} title={title} onClose={() => setPicking(null)}>
        {options.map((option) => (
          <SheetOption
            key={option.value || 'any'}
            label={option.label}
            {...(option.detail ? { detail: option.detail } : {})}
            selected={option.value === selected}
            onPress={() => pick(option.value)}
          />
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.xxl },
  chips: { marginTop: space.s },
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

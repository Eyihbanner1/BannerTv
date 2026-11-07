import {
  buildBoard,
  CONTINUE_LINE,
  type HomeLine,
  homeLines,
  LIVE_SPORT_LINE,
  MY_LIST_LINE,
  moveLine,
  setLineHidden,
} from '@bannertv/core';
import { addonCollection } from '@tv/data/addons';
import { typeLabel } from '@tv/data/describe';
import { homeLayout } from '@tv/data/library';
import { sportsState } from '@tv/data/sports';
import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { phoneOwnLines } from '../data/home-lines';
import { Icon } from '../ui/icons';
import { Message } from '../ui/Message';
import { ScreenHeader } from '../ui/ScreenHeader';
import { colors, radius, space, type } from '../ui/theme';

const OWN_NAMES: Record<string, string> = {
  [CONTINUE_LINE]: 'home.continueWatching',
  [MY_LIST_LINE]: 'library.myList',
  [LIVE_SPORT_LINE]: 'sports.liveRow',
};
const OWN_NOTES: Record<string, string> = {
  [CONTINUE_LINE]: 'homeRows.continueNote',
  [MY_LIST_LINE]: 'homeRows.myListNote',
  [LIVE_SPORT_LINE]: 'homeRows.liveSportNote',
};

/**
 * Settings > Home rows, as on the TV: every row Home can show, in its order, with up, down and a
 * switch to show or hide it. Kept per profile and synced, so the TV follows. Continue Watching
 * is always first and can only be hidden.
 */
export function HomeRowsScreen() {
  const { t } = useTranslation();
  const collection = useSyncExternalStore(addonCollection.subscribe, addonCollection.get);
  const layout = useSyncExternalStore(homeLayout.subscribe, homeLayout.get);
  const sports = useSyncExternalStore(sportsState.subscribe, sportsState.get);
  const ready = collection.ready && sports.ready;
  const board = useMemo(
    () => (ready ? buildBoard(collection.addons, sports.homeLeaveOut) : []),
    [ready, collection.addons, sports.homeLeaveOut],
  );
  const own = useMemo(() => phoneOwnLines(sports.shown), [sports.shown]);
  const lines = useMemo(
    () => (ready ? homeLines(board, layout, own) : []),
    [ready, board, layout, own],
  );
  const movable = lines.filter((line) => line.id !== CONTINUE_LINE);

  const renderLine = ({ item: line }: { item: HomeLine }) => {
    const { row, id } = line;
    const name = row ? `${row.name} · ${typeLabel(t, row.type)}` : t(OWN_NAMES[id] ?? id);
    const from = row ? row.addon.manifest.name : t(OWN_NOTES[id] ?? id);
    const place = movable.indexOf(line);
    const canUp = place > 0;
    const canDown = place !== -1 && place < movable.length - 1;
    const move = (by: -1 | 1) =>
      void homeLayout.update((current) => moveLine(board, current, own, id, by));
    const setShown = (shown: boolean) =>
      void homeLayout.update((current) => setLineHidden(board, current, id, !shown));
    return (
      <View style={styles.line}>
        <View style={styles.text}>
          <Text style={[styles.name, line.hidden && styles.hiddenName]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.small} numberOfLines={1}>
            {line.hidden
              ? row
                ? t('homeRows.hiddenFrom', { addon: from })
                : t('homeRows.hidden')
              : from}
          </Text>
        </View>
        {place === -1 ? null : (
          <>
            <Pressable
              onPress={() => move(-1)}
              disabled={!canUp}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={t('homeRows.moveUp', { name })}
              style={[styles.iconButton, !canUp && styles.disabled]}
            >
              <Icon name="up" />
            </Pressable>
            <Pressable
              onPress={() => move(1)}
              disabled={!canDown}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={t('homeRows.moveDown', { name })}
              style={[styles.iconButton, !canDown && styles.disabled]}
            >
              <Icon name="down" />
            </Pressable>
          </>
        )}
        <Switch
          value={!line.hidden}
          onValueChange={setShown}
          trackColor={{ true: colors.action, false: colors.surface3 }}
          thumbColor={colors.text}
          accessibilityLabel={
            line.hidden ? t('homeRows.showLabel', { name }) : t('homeRows.hideLabel', { name })
          }
        />
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('homeRows.title')} />
      <FlatList
        data={lines}
        keyExtractor={(line) => line.id}
        renderItem={renderLine}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.lead}>{t('homeRows.lead')}</Text>}
        ListFooterComponent={
          ready && board.length === 0 ? <Message lead={t('homeRows.none')} /> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: space.l, paddingBottom: space.xxl * 2, gap: space.s },
  lead: { ...type.body, color: colors.textMuted, paddingBottom: space.s },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    backgroundColor: colors.surface1,
    borderRadius: radius.l,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  text: { flex: 1, gap: 2 },
  name: { ...type.label, color: colors.text },
  hiddenName: { color: colors.textSubtle, textDecorationLine: 'line-through' },
  small: { ...type.small, color: colors.textMuted },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  disabled: { opacity: 0.35 },
});

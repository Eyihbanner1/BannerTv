import type { FixtureText } from '@tv/screens/sports/fixture';
import { memo, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from './theme';

export const FIXTURE_WIDTH = 220;

/**
 * One match, drawn as text as on the TV: competition, the two sides, the local kick-off or a
 * LIVE pill, and how many sources have it.
 */
export const FixtureCard = memo(function FixtureCard({
  fixture,
  onPress,
}: {
  fixture: FixtureText;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={fixture.label}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.competition} numberOfLines={1}>
        {fixture.competition}
      </Text>
      <Text style={styles.side} numberOfLines={1}>
        {fixture.lines[0]}
      </Text>
      {fixture.lines[1] !== undefined ? (
        <Text style={styles.side} numberOfLines={1}>
          {fixture.lines[1]}
        </Text>
      ) : null}
      <View style={styles.footer}>
        {fixture.live ? (
          <Text style={styles.live}>{fixture.when}</Text>
        ) : (
          <Text style={styles.when} numberOfLines={1}>
            {fixture.when}
          </Text>
        )}
        {fixture.sources ? (
          <Text style={styles.sources} numberOfLines={1}>
            {fixture.sources}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** A titled, side-scrolling row of fixture cards. */
export function FixtureRow({
  title,
  tag,
  fixtures,
  onPress,
  footer,
}: {
  title: string;
  /** Who the row is from, after the title: an addon's name. */
  tag?: string;
  /** Null while the matches are asked: grey cards stand in. */
  fixtures: readonly FixtureText[] | null;
  onPress: (index: number) => void;
  /** Shown instead of cards: an error with Try again, for example. */
  footer?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {tag ? (
          <Text style={styles.tag} numberOfLines={1}>
            {tag}
          </Text>
        ) : null}
      </View>
      {footer ? (
        footer
      ) : fixtures === null ? (
        <View style={styles.placeholders}>
          {[0, 1].map((index) => (
            <View key={index} style={[styles.card, styles.placeholder]} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={fixtures}
          keyExtractor={(fixture) => fixture.key}
          renderItem={({ item, index }) => (
            <FixtureCard fixture={item} onPress={() => onPress(index)} />
          )}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
          initialNumToRender={3}
          windowSize={3}
        />
      )}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  row: { paddingTop: space.l, gap: space.s },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.s,
    paddingHorizontal: space.l,
  },
  title: { ...type.heading, color: colors.text, flexShrink: 1 },
  tag: { ...type.small, color: colors.textSubtle, flexShrink: 1 },
  placeholders: { flexDirection: 'row', gap: space.m, paddingHorizontal: space.l },
  placeholder: { opacity: 0.6 },
  list: { paddingHorizontal: space.l },
  separator: { width: space.m },
  card: {
    width: FIXTURE_WIDTH,
    minHeight: 124,
    padding: space.m,
    gap: space.xs,
    borderRadius: radius.m,
    backgroundColor: colors.surface2,
  },
  pressed: { backgroundColor: colors.surface3 },
  competition: { ...type.small, color: colors.textSubtle },
  side: { ...type.label, fontSize: 16, lineHeight: 21, color: colors.text },
  footer: {
    marginTop: 'auto',
    paddingTop: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
  },
  live: {
    ...type.small,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: '#D61F45',
    letterSpacing: 0.5,
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  when: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  sources: { ...type.small, color: colors.textSubtle, marginLeft: 'auto' },
});

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OutlineIcon } from '../ui/icons';
import { colors, radius, space, touch, type } from '../ui/theme';

/**
 * One choice in the player's audio, subtitles and quality lists, as the TV's sheet has them:
 * a tick before the chosen one's name, which turns white and bold; a quieter second line
 * under it; a small tag after the name for the one note that matters most; and a chevron for
 * a row that goes on to more. A dimmed one (a file that couldn't be read) can still be tapped.
 */
export function ChoiceRow({
  label,
  chip,
  line,
  selected = false,
  dim = false,
  chevron = false,
  wrap = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  chip?: string;
  line?: string;
  selected?: boolean;
  dim?: boolean;
  chevron?: boolean;
  /** The second line on as many lines as it needs: a release name read in full. */
  wrap?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        accessibilityLabel ?? [label, chip, line].filter((part) => !!part).join(', ')
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed, dim && styles.dim]}
    >
      <View style={styles.tick}>
        {selected ? (
          <OutlineIcon name="check" size={18} color={colors.prismTop} weight={2.8} />
        ) : null}
      </View>
      <View style={styles.text}>
        <View style={styles.top}>
          <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
            {label}
          </Text>
          {chip ? (
            <Text style={styles.chip} numberOfLines={1}>
              {chip}
            </Text>
          ) : null}
        </View>
        {line ? (
          <Text style={styles.line} numberOfLines={wrap ? undefined : 1}>
            {line}
          </Text>
        ) : null}
      </View>
      {chevron ? <OutlineIcon name="chevron" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

/** A heading over a column of choices: Audio, Subtitles, "English subtitles". */
export function ChoiceHeading({ children, aside }: { children: string; aside?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingText} accessibilityRole="header" numberOfLines={1}>
        {children}
      </Text>
      {aside ? (
        <Text style={styles.aside} numberOfLines={1}>
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

/** Back to the columns, atop a list one step in: "‹ English subtitles · 4 versions". */
export function BackRow({
  title,
  backLabel,
  onPress,
  children,
}: {
  title: string;
  /** Read aloud before the title: "Back". */
  backLabel: string;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.backRow}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${backLabel}, ${title}`}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <OutlineIcon name="back" size={20} weight={2.4} />
        <Text style={styles.backText} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touch.min,
    paddingVertical: space.s,
    paddingRight: space.m,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: { backgroundColor: colors.surface2 },
  dim: { opacity: 0.5 },
  tick: { width: 32, alignItems: 'center' },
  text: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center' },
  label: { ...type.label, fontWeight: '500', color: colors.textSoft, flexShrink: 1 },
  labelSelected: { fontWeight: '700', color: colors.text },
  chip: {
    ...type.small,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: 'rgba(241, 237, 255, 0.1)',
    borderRadius: radius.s,
    paddingHorizontal: space.s,
    paddingVertical: 2,
    marginLeft: space.s,
    overflow: 'hidden',
    flexShrink: 0,
  },
  line: { ...type.small, color: colors.textMuted, marginTop: 2 },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingLeft: 32,
    marginBottom: space.xs,
  },
  headingText: { ...type.label, color: colors.text, flexShrink: 1 },
  aside: { ...type.small, color: colors.textMuted, marginLeft: space.s, flexShrink: 1 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  back: {
    minHeight: touch.min,
    paddingRight: space.m,
    paddingLeft: space.xs,
    borderRadius: radius.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    flexShrink: 1,
  },
  backText: { ...type.label, color: colors.text, flexShrink: 1 },
});

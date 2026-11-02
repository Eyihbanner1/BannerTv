import type { CalendarDay, CalendarEntry } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { calendarDayLabel, calendarEntryLine, calendarEntryTag } from '@tv/data/calendar';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Artwork } from './Artwork';
import { colors, gutter, radius, space, type } from './theme';

interface Section {
  day: CalendarDay;
  data: CalendarEntry[];
}

/**
 * The calendar on the phone: a heading per day ("Today", "Tomorrow",
 * "Thursday 6 Nov"), then a row per episode or film, which opens its page.
 */
export function CalendarList({
  days,
  onPress,
  header,
}: {
  days: readonly CalendarDay[];
  onPress: (title: MetaPreview) => void;
  header?: ReactElement;
}) {
  const { t } = useTranslation();
  const sections: Section[] = days.map((day) => ({ day, data: day.entries }));
  return (
    <SectionList
      sections={sections}
      keyExtractor={(entry) => entry.key}
      stickySectionHeadersEnabled={false}
      {...(header ? { ListHeaderComponent: header } : {})}
      contentContainerStyle={styles.content}
      renderSectionHeader={({ section }) => {
        const label = calendarDayLabel(t, section.day);
        return (
          <View style={styles.dayHeader} accessibilityRole="header">
            <Text style={[styles.dayName, section.day.offset === 0 && styles.today]}>
              {label.name}
            </Text>
            <Text style={styles.date}>{label.date}</Text>
          </View>
        );
      }}
      renderItem={({ item, section }) => {
        const line = calendarEntryLine(t, item);
        const tag = calendarEntryTag(t, item, section.day);
        const picture = item.thumbnail ?? item.title.background ?? item.title.poster;
        return (
          <Pressable
            onPress={() => onPress(item.title)}
            accessibilityRole="button"
            accessibilityLabel={[item.title.name, line, tag].filter(Boolean).join(', ')}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Artwork src={picture} seed={item.title.id} style={styles.thumb} />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title.name}
              </Text>
              {line ? (
                <Text style={styles.line} numberOfLines={1}>
                  {line}
                </Text>
              ) : null}
              {tag ? <Text style={styles.tag}>{tag}</Text> : null}
            </View>
          </Pressable>
        );
      }}
      initialNumToRender={12}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.s,
    paddingHorizontal: gutter,
    paddingTop: space.l,
    paddingBottom: space.s,
  },
  dayName: { ...type.heading, color: colors.text },
  today: { color: colors.accent },
  date: { ...type.meta, color: colors.textSubtle },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 72,
    paddingHorizontal: gutter,
    paddingVertical: space.s,
  },
  pressed: { backgroundColor: colors.raised },
  thumb: { width: 128, height: 72, borderRadius: radius.m },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.label, color: colors.text },
  line: { ...type.meta, color: colors.textMuted },
  tag: {
    ...type.small,
    alignSelf: 'flex-start',
    marginTop: space.xs,
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: colors.accent,
    backgroundColor: colors.surface2,
  },
});

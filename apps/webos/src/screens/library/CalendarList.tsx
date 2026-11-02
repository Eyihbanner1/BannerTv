import { type CalendarDay, type CalendarEntry, calendarStart } from '@bannertv/core';
import type { MetaPreview } from '@bannertv/protocol';
import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Artwork } from '../../components/Artwork';
import { Pressable } from '../../components/Pressable';
import { fallbackArt } from '../../components/Tile';
import { calendarDayLabel, calendarEntryLine, calendarEntryTag } from '../../data/calendar';
import { watchedSet } from '../../data/library';
import { canSlide } from '../../platform/input-mode';
import styles from './CalendarList.module.css';

const ITEM_HEIGHT = 168;
const VISIBLE = 5;
const OVERSCAN = 2;

interface CalendarRow {
  day: CalendarDay;
  entry: CalendarEntry;
  /** The day's first entry, which carries the day's name. */
  first: boolean;
}

interface CalendarListProps {
  focusKey: string;
  days: readonly CalendarDay[];
  onPress: (title: MetaPreview) => void;
}

/**
 * The calendar, one entry a row, day by day, opening on today (or the next
 * day with something on it). Like the episode list, it slides so the
 * focused row stays near the top and draws only the rows near the view.
 */
export function CalendarList({ focusKey, days, onPress }: CalendarListProps) {
  const { t } = useTranslation();
  // Trakt's watched ticks arrive with a sync.
  useSyncExternalStore(watchedSet.subscribe, watchedSet.version);
  const rows: CalendarRow[] = [];
  let startRow = 0;
  const startDay = calendarStart(days);
  days.forEach((day, dayIndex) => {
    if (dayIndex === startDay) startRow = rows.length;
    day.entries.forEach((entry, index) => rows.push({ day, entry, first: index === 0 }));
  });
  const [anchor, setAnchor] = useState(() => Math.max(0, startRow - 1));
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey: `${focusKey}-${startRow}`,
  });

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(rows.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const { day, entry, first: firstOfDay } = rows[index]!;
    const itemKey = `${focusKey}-${index}`;
    const label = calendarDayLabel(t, day);
    const line = calendarEntryLine(t, entry);
    const tag = calendarEntryTag(t, entry, day);
    const picture = entry.thumbnail ?? entry.title.background ?? entry.title.poster;
    items.push(
      <Pressable
        key={entry.key}
        focusKey={itemKey}
        label={[`${label.name} ${label.date}`, entry.title.name, line, tag]
          .filter(Boolean)
          .join(', ')}
        className={styles.row}
        focusedClassName={styles.focused}
        style={{ top: index * ITEM_HEIGHT }}
        onPress={() => onPress(entry.title)}
        onFocus={() => {
          const target = Math.max(0, index - 1);
          if (canSlide() && target !== anchor) setAnchor(target);
        }}
      >
        <div className={styles.day} aria-hidden="true">
          {firstOfDay && (
            <>
              <p className={day.offset === 0 ? styles.today : styles.dayName}>{label.name}</p>
              <p className={styles.date}>{label.date}</p>
            </>
          )}
        </div>
        <div className={styles.thumb} style={{ backgroundImage: fallbackArt(index, 120) }}>
          <Artwork key={picture} src={picture} className={styles.image} />
        </div>
        <div className={styles.text}>
          <p className={styles.title}>{entry.title.name}</p>
          {line && <p className={styles.line}>{line}</p>}
          {tag && <span className={styles.tag}>{tag}</span>}
        </div>
      </Pressable>,
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.list}>
        <div
          className={styles.track}
          style={{ transform: `translateY(${-anchor * ITEM_HEIGHT}px)` }}
        >
          {items}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

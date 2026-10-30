import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { type ReactNode, useState } from 'react';
import { Pressable } from '../../components/Pressable';
import { canSlide } from '../../platform/input-mode';
import styles from './SheetList.module.css';

export interface SheetRow {
  focusKey: string;
  label: string;
  /** A second, quieter part of the line: a release name, "Loading…". */
  detail?: string;
  /** Read aloud in place of the label and detail. */
  spoken?: string;
  selected?: boolean;
  /** Can't be used now: a version that could not be read, an episode not out yet. */
  dim?: boolean;
  /** Drawn in place of the label and detail, in a taller row. */
  body?: ReactNode;
  /** How far into it the viewer got, 0 to 1, as a bar along the bottom. */
  progress?: number;
  onPress: () => void;
  onFocus?: () => void;
}

const ROW_HEIGHT = 88;
/** Space between rows, inside each row's height. */
const ROW_GAP = 12;
const OVERSCAN = 2;
/** Rows kept above the focused one as the list slides. */
const LEAD = 1;

/**
 * One column of rows in a player sheet. Only the rows near the
 * view are drawn, and the list slides to keep the focused row in sight. Each
 * row is keyed by its focus key, so rows added while it is open never take
 * another row's place.
 */
export function SheetList({
  focusKey,
  rows,
  preferred,
  remember,
  visible,
  rowHeight = ROW_HEIGHT,
  className,
}: {
  focusKey: string;
  rows: readonly SheetRow[];
  /** The row focus lands on from outside, and the one in view first. */
  preferred?: string;
  /** Back to the row last focused, rather than the preferred one. */
  remember: boolean;
  visible: number;
  /** Taller for rows with a body. */
  rowHeight?: number;
  className?: string;
}) {
  const { ref, focusKey: key } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: remember,
    preferredChildFocusKey: preferred,
  });
  const lastAnchor = Math.max(0, rows.length - visible);
  const anchorFor = (index: number) => Math.max(0, Math.min(lastAnchor, index - LEAD));
  const [place, setPlace] = useState<{ anchor: number; focused?: string }>(() => ({
    anchor: anchorFor(rows.findIndex((row) => row.focusKey === preferred)),
  }));
  // A row added above the focused one (a stream's own track, listed first)
  // moves it down: the view follows it, rather than leave it out of sight.
  const focusedIndex = rows.findIndex((row) => row.focusKey === place.focused);
  const anchor =
    focusedIndex < 0
      ? place.anchor
      : Math.max(focusedIndex - visible + 1, Math.min(place.anchor, focusedIndex));
  const top = Math.min(anchor, lastAnchor);

  const first = Math.max(0, top - OVERSCAN);
  const last = Math.min(rows.length, top + visible + OVERSCAN);
  const indexes = [];
  for (let index = first; index < last; index++) indexes.push(index);
  // The preferred row is always there to land on, even scrolled out of
  // sight: focus moved to a row that isn't drawn would be lost.
  const preferredIndex = rows.findIndex((row) => row.focusKey === preferred);
  if (preferredIndex >= 0 && (preferredIndex < first || preferredIndex >= last)) {
    indexes.push(preferredIndex);
  }

  const drawn = [];
  for (const index of indexes) {
    const row = rows[index]!;
    drawn.push(
      <Pressable
        key={row.focusKey}
        focusKey={row.focusKey}
        label={row.spoken ?? (row.detail ? `${row.label}, ${row.detail}` : row.label)}
        className={[
          styles.row,
          row.body !== undefined && styles.tall,
          row.selected && styles.selected,
          row.dim && styles.dim,
        ]
          .filter(Boolean)
          .join(' ')}
        focusedClassName={styles.focused}
        style={
          rowHeight === ROW_HEIGHT
            ? { top: index * rowHeight }
            : { top: index * rowHeight, height: rowHeight - ROW_GAP }
        }
        onPress={row.onPress}
        onFocus={() => {
          if (canSlide()) setPlace({ anchor: anchorFor(index), focused: row.focusKey });
          row.onFocus?.();
        }}
      >
        {row.body ?? (
          <>
            <span className={styles.label}>{row.label}</span>
            {row.detail && <span className={styles.detail}>{row.detail}</span>}
          </>
        )}
        {row.progress !== undefined && (
          <span className={styles.progress}>
            <span
              className={styles.progressFill}
              style={{ width: `${Math.round(Math.max(0, Math.min(1, row.progress)) * 100)}%` }}
            />
          </span>
        )}
      </Pressable>,
    );
  }

  return (
    <FocusContext.Provider value={key}>
      <div
        ref={ref}
        className={className ? `${styles.list} ${className}` : styles.list}
        style={{ height: visible * rowHeight }}
      >
        <div className={styles.track} style={{ transform: `translateY(${-top * rowHeight}px)` }}>
          {drawn}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

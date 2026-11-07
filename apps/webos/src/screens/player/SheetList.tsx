import {
  FocusContext,
  type FocusableComponentLayout,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable } from '../../components/Pressable';
import { focusedKey } from '../../navigation/spatial';
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

interface SheetRowItemProps {
  index: number;
  focusKey: string;
  /** Read aloud. */
  spoken: string;
  className: string;
  rowHeight: number;
  label: string;
  detail: string | undefined;
  body: ReactNode;
  progress: number | undefined;
  /** Stable handlers that take the row's index, so a move redraws only what changed. */
  onRowFocus: (index: number, layout: FocusableComponentLayout) => void;
  onRowPress: (index: number) => void;
}

/** One row of a sheet: its label and detail, or its own body, and how far in the viewer got. */
const SheetRowItem = memo(function SheetRowItem({
  index,
  focusKey,
  spoken,
  className,
  rowHeight,
  label,
  detail,
  body,
  progress,
  onRowFocus,
  onRowPress,
}: SheetRowItemProps) {
  const style = useMemo<CSSProperties>(
    () =>
      rowHeight === ROW_HEIGHT
        ? { top: index * rowHeight }
        : { top: index * rowHeight, height: rowHeight - ROW_GAP },
    [index, rowHeight],
  );
  return (
    <Pressable
      focusKey={focusKey}
      label={spoken}
      className={className}
      focusedClassName={styles.focused}
      style={style}
      onPress={() => onRowPress(index)}
      onFocus={(layout) => onRowFocus(index, layout)}
    >
      {body ?? (
        <>
          <span className={styles.label}>{label}</span>
          {detail && <span className={styles.detail}>{detail}</span>}
        </>
      )}
      {progress !== undefined && (
        <span className={styles.progress}>
          <span
            className={styles.progressFill}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
          />
        </span>
      )}
    </Pressable>
  );
});

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
  const {
    ref,
    focusKey: key,
    hasFocusedChild,
  } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: remember,
    preferredChildFocusKey: preferred,
    trackChildren: true,
  });
  const lastAnchor = Math.max(0, rows.length - visible);
  const anchorFor = (index: number) => Math.max(0, Math.min(lastAnchor, index - LEAD));
  const [place, setPlace] = useState<{
    anchor: number;
    focused?: string;
    /**
     * Under a resting pointer: where the focused row was when the pointer
     * took it. Let go once the pointer or focus leaves the list.
     */
    pointedAt?: number;
  }>(() => ({
    anchor: anchorFor(rows.findIndex((row) => row.focusKey === preferred)),
  }));
  // A row added above the focused one (a stream's own track, listed first)
  // moves it down: the view follows it, rather than leave it out of sight.
  // Under a resting pointer it moves with it exactly, so the row stays under
  // the pointer and a click presses the row pointed at, not one slid in.
  const focusedIndex = rows.findIndex((row) => row.focusKey === place.focused);
  const anchor =
    focusedIndex < 0
      ? place.anchor
      : place.pointedAt !== undefined
        ? place.anchor + focusedIndex - place.pointedAt
        : Math.max(focusedIndex - visible + 1, Math.min(place.anchor, focusedIndex));
  // Pinned, it may leave space under the last row rather than slide.
  const pinned = place.pointedAt !== undefined && focusedIndex >= 0;
  const top = Math.max(0, pinned ? anchor : Math.min(anchor, lastAnchor));
  const letGo = () => setPlace({ anchor: Math.min(top, lastAnchor), focused: place.focused });
  if (place.pointedAt !== undefined && !hasFocusedChild) letGo();

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

  // Rows get handlers that never change, so a move redraws the rows whose
  // focus changed and the one that slid into view, not every one drawn.
  const latest = useRef({ rows, lastAnchor, top });
  useLayoutEffect(() => {
    latest.current = { rows, lastAnchor, top };
  });
  const onRowFocus = useCallback(
    (index: number, layout: FocusableComponentLayout) => {
      const { rows: list, lastAnchor: end, top: shown } = latest.current;
      const row = list[index];
      if (!row) return;
      if (canSlide()) {
        setPlace({ anchor: Math.max(0, Math.min(end, index - LEAD)), focused: row.focusKey });
      }
      // Only the row the pointer is on: focus put on a row elsewhere moves nothing.
      else if (layout.node.matches(':hover')) {
        setPlace({ anchor: shown, focused: row.focusKey, pointedAt: index });
      }
      row.onFocus?.();
    },
    [setPlace],
  );
  const onRowPress = useCallback((index: number) => latest.current.rows[index]?.onPress(), []);

  const drawn = [];
  for (const index of indexes) {
    const row = rows[index]!;
    drawn.push(
      <SheetRowItem
        key={row.focusKey}
        index={index}
        focusKey={row.focusKey}
        spoken={row.spoken ?? (row.detail ? `${row.label}, ${row.detail}` : row.label)}
        className={[
          styles.row,
          row.body !== undefined && styles.tall,
          row.selected && styles.selected,
          row.dim && styles.dim,
        ]
          .filter(Boolean)
          .join(' ')}
        rowHeight={rowHeight}
        label={row.label}
        detail={row.detail}
        body={row.body}
        progress={row.progress}
        onRowFocus={onRowFocus}
        onRowPress={onRowPress}
      />,
    );
  }

  return (
    <FocusContext.Provider value={key}>
      <div
        ref={ref}
        className={className ? `${styles.list} ${className}` : styles.list}
        style={{ height: visible * rowHeight }}
        onMouseLeave={() => {
          if (place.pointedAt !== undefined) letGo();
        }}
        // Back over the row that kept focus, which takes no focus to say so: held again.
        onMouseMove={(event) => {
          if (place.pointedAt !== undefined || canSlide()) return;
          const over = (event.target as Element).closest('[data-focus-key]');
          const focused = focusedKey();
          if (!over || over.getAttribute('data-focus-key') !== focused) return;
          const index = rows.findIndex((row) => row.focusKey === focused);
          if (index >= 0) setPlace({ anchor: top, focused, pointedAt: index });
        }}
      >
        <div
          className={styles.track}
          // Rows added above the one pointed at move the view at once: sliding, it would pass under the pointer.
          style={{
            transform: `translateY(${-top * rowHeight}px)`,
            transition: place.pointedAt !== undefined ? 'none' : undefined,
          }}
        >
          {drawn}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

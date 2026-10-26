import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useRef } from 'react';
import { recallFocus, rememberFocus } from '../navigation/focus-memory';
import { inputMode } from '../platform/input-mode';
import type { SampleItem } from '../screens/home/sample-data';
import { Tile } from './Tile';
import styles from './Row.module.css';

const TILE_STEP = { poster: 220 + 24, landscape: 384 + 24 } as const;

interface RowProps {
  focusKey: string;
  title: string;
  shape: 'poster' | 'landscape';
  items: readonly SampleItem[];
  onItemFocus: (item: SampleItem, row: HTMLElement) => void;
  onItemPress: (item: SampleItem) => void;
}

/**
 * A horizontal row of tiles. With the remote's arrows the focused tile always
 * sits at the same anchor on the left and the row slides under it, so the eye
 * stays still. With the pointer the row holds still.
 */
export function Row({ focusKey, title, shape, items, onItemFocus, onItemPress }: RowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { ref } = useFocusable<object, HTMLElement>({
    focusKey,
    saveLastFocusedChild: true,
    preferredChildFocusKey: recallFocus(focusKey),
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} className={styles.row} aria-label={title}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.viewport}>
          <div ref={trackRef} className={styles.track}>
            {items.map((item, index) => {
              const tileKey = `${focusKey}-tile-${index}`;
              return (
                <Tile
                  key={item.id}
                  focusKey={tileKey}
                  item={item}
                  shape={shape}
                  onPress={() => onItemPress(item)}
                  onFocus={() => {
                    rememberFocus(focusKey, tileKey);
                    // With the pointer, sliding the row would move a new tile under it.
                    if (trackRef.current && inputMode.get() === 'keys') {
                      trackRef.current.style.transform = `translateX(${-index * TILE_STEP[shape]}px)`;
                    }
                    if (ref.current) onItemFocus(item, ref.current);
                  }}
                />
              );
            })}
          </div>
        </div>
      </section>
    </FocusContext.Provider>
  );
}

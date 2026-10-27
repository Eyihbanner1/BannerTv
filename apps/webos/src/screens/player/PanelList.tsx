import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useState } from 'react';
import { Pressable } from '../../components/Pressable';
import { canSlide } from '../../platform/input-mode';
import styles from './PanelList.module.css';

export type PanelItem =
  | { kind: 'header'; label: string }
  | {
      kind: 'option';
      key: string;
      label: string;
      /** A second, quieter part of the line: "version 2 of 5", "Torrentio". */
      detail?: string;
      selected?: boolean;
      onPress: () => void;
    }
  | {
      kind: 'stepper';
      key: string;
      label: string;
      value: string;
      /** Left is -1, Right is +1. */
      onStep: (direction: -1 | 1) => void;
    };

const ITEM_HEIGHT = 88;
const VISIBLE = 10;
const OVERSCAN = 2;
const LEAD = 3;

function Stepper({
  focusKey,
  label,
  value,
  top,
  onStep,
  onFocus,
}: {
  focusKey: string;
  label: string;
  value: string;
  top: number;
  onStep: (direction: -1 | 1) => void;
  onFocus: () => void;
}) {
  const { ref, focused } = useFocusable<object, HTMLDivElement>({
    focusKey,
    accessibilityLabel: `${label}, ${value}`,
    onFocus,
    onArrowPress: (direction) => {
      if (direction === 'left' || direction === 'right') {
        onStep(direction === 'left' ? -1 : 1);
        return false;
      }
      return true;
    },
  });
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={-1}
      aria-label={label}
      aria-valuetext={value}
      className={focused ? `${styles.item} ${styles.focused}` : styles.item}
      style={{ top }}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.stepper}>
        <span className={styles.arrow}>‹</span>
        <span className={styles.value}>{value}</span>
        <span className={styles.arrow}>›</span>
      </span>
    </div>
  );
}

/**
 * A long list of headed options, for the player's side panels. Like Menu,
 * only the rows near the view are drawn, and the list slides to keep the
 * focused row in sight.
 */
export function PanelList({
  focusKey,
  items,
  initialIndex,
}: {
  focusKey: string;
  items: readonly PanelItem[];
  /** The row that has focus first, so the list starts scrolled to it. */
  initialIndex: number;
}) {
  const lastAnchor = Math.max(0, items.length - VISIBLE);
  const anchorFor = (index: number) => Math.max(0, Math.min(lastAnchor, index - LEAD));
  const [anchor, setAnchor] = useState(() => anchorFor(initialIndex));
  const follow = (index: number) => {
    if (canSlide()) setAnchor(anchorFor(index));
  };

  const rows = [];
  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(items.length, anchor + VISIBLE + OVERSCAN);
  for (let index = first; index < last; index++) {
    const item = items[index]!;
    const top = index * ITEM_HEIGHT;
    if (item.kind === 'header') {
      rows.push(
        <h3 key={index} className={styles.header} style={{ top }}>
          {item.label}
        </h3>,
      );
    } else if (item.kind === 'stepper') {
      rows.push(
        <Stepper
          key={index}
          focusKey={`${focusKey}-${item.key}`}
          label={item.label}
          value={item.value}
          top={top}
          onStep={item.onStep}
          onFocus={() => follow(index)}
        />,
      );
    } else {
      rows.push(
        <Pressable
          key={index}
          focusKey={`${focusKey}-${item.key}`}
          label={item.detail ? `${item.label}, ${item.detail}` : item.label}
          className={item.selected ? `${styles.item} ${styles.selected}` : styles.item}
          focusedClassName={styles.focused}
          style={{ top }}
          onPress={item.onPress}
          onFocus={() => follow(index)}
        >
          <span className={styles.label}>{item.label}</span>
          {item.detail && <span className={styles.detail}>{item.detail}</span>}
        </Pressable>,
      );
    }
  }

  return (
    <div className={styles.list}>
      <div className={styles.track} style={{ transform: `translateY(${-anchor * ITEM_HEIGHT}px)` }}>
        {rows}
      </div>
    </div>
  );
}

/** The focus key of an item's row, for an Overlay's default focus. */
export function panelItemKey(focusKey: string, item: PanelItem | undefined): string | undefined {
  return item && item.kind !== 'header' ? `${focusKey}-${item.key}` : undefined;
}

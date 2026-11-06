import { useState } from 'react';
import { canSlide } from '../platform/input-mode';
import { Overlay } from './Overlay';
import { Pressable } from './Pressable';
import styles from './Menu.module.css';

export interface MenuOption {
  value: string;
  label: string;
  /** A quieter note after the label: "Spanish audio". */
  detail?: string;
}

const ITEM_HEIGHT = 88;
const VISIBLE = 9;
const OVERSCAN = 2;
// The focused option sits this many places from the top while the list scrolls.
const LEAD = 3;

interface MenuProps {
  focusKey: string;
  title: string;
  options: readonly MenuOption[];
  selected: string | undefined;
  /** Where focus lands when it opens, when not on the option selected: a menu of menus. */
  landOn?: string;
  returnFocusKey: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

/**
 * A list to pick one option from, sliding in from the right. Long lists
 * (Cinemeta has over a hundred years) draw only the options near the view.
 */
export function Menu({
  focusKey,
  title,
  options,
  selected,
  landOn,
  returnFocusKey,
  onSelect,
  onClose,
}: MenuProps) {
  const landing = Math.max(
    0,
    options.findIndex((option) => option.value === (landOn ?? selected)),
  );
  const lastAnchor = Math.max(0, options.length - VISIBLE);
  const anchorFor = (index: number) => Math.max(0, Math.min(lastAnchor, index - LEAD));
  const [anchor, setAnchor] = useState(() => anchorFor(landing));

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(options.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const option = options[index]!;
    const isSelected = option.value === selected;
    items.push(
      <Pressable
        key={index}
        focusKey={`${focusKey}-${index}`}
        label={option.detail ? `${option.label}, ${option.detail}` : option.label}
        className={isSelected ? `${styles.option} ${styles.selected}` : styles.option}
        focusedClassName={styles.focused}
        style={{ top: index * ITEM_HEIGHT }}
        onPress={() => onSelect(option.value)}
        onFocus={() => {
          if (canSlide()) setAnchor(anchorFor(index));
        }}
      >
        {option.detail ? (
          <>
            <span className={styles.label}>{option.label}</span>
            <span className={styles.detail}>{option.detail}</span>
          </>
        ) : (
          option.label
        )}
      </Pressable>,
    );
  }

  return (
    <Overlay
      focusKey={focusKey}
      label={title}
      defaultFocusKey={`${focusKey}-${landing}`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      placement="side"
    >
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.list}>
        <div
          className={styles.track}
          style={{ transform: `translateY(${-anchor * ITEM_HEIGHT}px)` }}
        >
          {items}
        </div>
      </div>
    </Overlay>
  );
}

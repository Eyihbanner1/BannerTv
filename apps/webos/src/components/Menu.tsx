import {
  type CSSProperties,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  /** Focused again when the menu closes. A function is read at closing time. */
  returnFocusKey: string | (() => string);
  onSelect: (value: string) => void;
  onClose: () => void;
}

interface MenuItemProps {
  /** The menu's focus key: the option's own is the menu's, a dash and its index. */
  menuKey: string;
  index: number;
  option: MenuOption;
  isSelected: boolean;
  /** Stable handlers that take the option's index, so a move redraws only what changed. */
  onItemFocus: (index: number) => void;
  onItemPress: (index: number) => void;
}

/** One option in the list. */
const MenuItem = memo(function MenuItem({
  menuKey,
  index,
  option,
  isSelected,
  onItemFocus,
  onItemPress,
}: MenuItemProps) {
  const style = useMemo<CSSProperties>(() => ({ top: index * ITEM_HEIGHT }), [index]);
  return (
    <Pressable
      focusKey={`${menuKey}-${index}`}
      label={option.detail ? `${option.label}, ${option.detail}` : option.label}
      className={isSelected ? `${styles.option} ${styles.selected}` : styles.option}
      focusedClassName={styles.focused}
      style={style}
      onPress={() => onItemPress(index)}
      onFocus={() => onItemFocus(index)}
    >
      {option.detail ? (
        <>
          <span className={styles.label}>{option.label}</span>
          <span className={styles.detail}>{option.detail}</span>
        </>
      ) : (
        option.label
      )}
    </Pressable>
  );
});

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

  // Options get handlers that never change, so a move redraws the options
  // whose focus changed and the ones that slid into view, not every one drawn.
  const latest = useRef({ options, lastAnchor, onSelect });
  useLayoutEffect(() => {
    latest.current = { options, lastAnchor, onSelect };
  });
  const onItemFocus = useCallback((index: number) => {
    const { lastAnchor: end } = latest.current;
    if (canSlide()) setAnchor(Math.max(0, Math.min(end, index - LEAD)));
  }, []);
  const onItemPress = useCallback((index: number) => {
    const { options: list, onSelect: select } = latest.current;
    const option = list[index];
    if (option) select(option.value);
  }, []);

  const first = Math.max(0, anchor - OVERSCAN);
  const last = Math.min(options.length, anchor + VISIBLE + OVERSCAN);
  const items = [];
  for (let index = first; index < last; index++) {
    const option = options[index]!;
    items.push(
      <MenuItem
        key={index}
        menuKey={focusKey}
        index={index}
        option={option}
        isSelected={option.value === selected}
        onItemFocus={onItemFocus}
        onItemPress={onItemPress}
      />,
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

import {
  type FocusableComponentLayout,
  getCurrentFocusKey,
  type KeyPressDetails,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { useScreenSlot } from '../app/screen-slot';
import { whilePressing } from '../navigation/focus-memory';
import { markActivity } from '../navigation/activity';
import { answeredOk, clickCameWithOk, okWentDownOn } from '../navigation/ok-click';
import { inputMode } from '../platform/input-mode';

/** OK held down this long is a hold, for a Pressable that has one. */
export const HOLD_MS = 600;

export interface PressableProps {
  focusKey: string;
  /** Read aloud by LG Audio Guidance. */
  label: string;
  onPress?: () => void;
  /**
   * OK held down (HOLD_MS) does this instead of onPress, such as opening a
   * menu of what else can be done. With one, onPress waits for OK to come
   * back up. A pointer click presses at once, as ever.
   */
  onLongPress?: () => void;
  onFocus?: (layout: FocusableComponentLayout) => void;
  /** An arrow pressed while it has focus. False takes the press: focus stays where it is. */
  onArrowPress?: (direction: string) => boolean;
  className?: string;
  focusedClassName?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Anything the remote can land on and press. It answers OK in 5-way mode,
 * and hover plus click in pointer mode.
 *
 * Spatial navigation re-registers an element whenever its handlers change,
 * so the handlers given to it never do: they read the latest props instead.
 */
export const Pressable = memo(function Pressable(props: PressableProps) {
  const { focusKey, label, className, focusedClassName, style, children } = props;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const slot = useScreenSlot();
  // OK is down on a Pressable with a hold: until it comes up, or the hold fires.
  const holding = useRef<{ timer: ReturnType<typeof setTimeout>; held: boolean } | null>(null);
  useEffect(
    () => () => {
      if (holding.current) clearTimeout(holding.current.timer);
    },
    [],
  );

  const onEnterPress = useCallback(
    (_props: object, details?: KeyPressDetails) => {
      // Focus can sit on a screen for a moment after another opens on top of it.
      if (!slot.get()) return;
      const repeat = (details?.pressedKeys.enter ?? 1) > 1;
      // A held OK repeats. It presses on only what had focus when it went down,
      // never what it just opened: a sheet's first row, a menu's current choice.
      if (repeat && okWentDownOn() !== latest.current.focusKey) return;
      answeredOk();
      const { focusKey: key, onPress, onLongPress } = latest.current;
      if (onLongPress) {
        // The press waits for OK to come up; held on, it is a hold. Its repeats press nothing.
        if (repeat || holding.current) return;
        const hold = {
          held: false,
          timer: setTimeout(() => {
            if (holding.current !== hold) return;
            // Still down, here, on a screen still shown.
            if (!slot.get() || okWentDownOn() !== key || getCurrentFocusKey() !== key) {
              holding.current = null;
              return;
            }
            hold.held = true;
            const { onLongPress: longPress } = latest.current;
            if (longPress) whilePressing(key, longPress);
          }, HOLD_MS),
        };
        holding.current = hold;
        return;
      }
      if (onPress) whilePressing(key, onPress);
    },
    [slot],
  );
  const onEnterRelease = useCallback(() => {
    const hold = holding.current;
    if (!hold) return;
    holding.current = null;
    clearTimeout(hold.timer);
    if (hold.held || !slot.get()) return;
    const { focusKey: key, onPress } = latest.current;
    if (onPress) whilePressing(key, onPress);
  }, [slot]);
  const onArrowPress = useCallback(
    (direction: string) =>
      // Focus can sit on a screen for a moment after another opens on top of it.
      slot.get() && (latest.current.onArrowPress?.(direction) ?? true),
    [slot],
  );
  const onFocus = useCallback(
    (layout: FocusableComponentLayout) => latest.current.onFocus?.(layout),
    [],
  );

  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey,
    accessibilityLabel: label,
    onEnterPress,
    onEnterRelease,
    onArrowPress,
    onFocus,
  });

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-label={label}
      data-focus-key={focusKey}
      data-focused={focused ? 'true' : undefined}
      className={focused && focusedClassName ? `${className ?? ''} ${focusedClassName}` : className}
      style={style}
      // Move rather than enter: the first move after the arrows enters the
      // element before it switches on pointer mode. While a text box is in
      // use (typing, or speaking into the TV keyboard) the pointer drifting
      // over a tile must not take focus from it.
      onMouseMove={() => {
        if (focused || inputMode.get() !== 'pointer') return;
        if (document.activeElement instanceof HTMLInputElement) return;
        markActivity();
        focusSelf();
      }}
      // In pointer mode the Magic Remote OK can come as a key press and a click.
      onClick={() => {
        if (clickCameWithOk()) return;
        const { onPress } = latest.current;
        if (!focused) focusSelf();
        if (onPress) whilePressing(focusKey, onPress);
      }}
    >
      {children}
    </div>
  );
});

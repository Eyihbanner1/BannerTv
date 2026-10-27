import {
  type FocusableComponentLayout,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import type { CSSProperties, ReactNode } from 'react';
import { whilePressing } from '../navigation/focus-memory';
import { inputMode } from '../platform/input-mode';

// In pointer mode the Magic Remote OK can arrive as a key press and a click.
let lastEnterAt = 0;
const CLICK_AFTER_ENTER_MS = 400;

export interface PressableProps {
  focusKey: string;
  /** Read aloud by LG Audio Guidance. */
  label: string;
  onPress?: () => void;
  onFocus?: (layout: FocusableComponentLayout) => void;
  className?: string;
  focusedClassName?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Anything the remote can land on and press. It answers OK in 5-way mode,
 * and hover plus click in pointer mode.
 */
export function Pressable({
  focusKey,
  label,
  onPress,
  onFocus,
  className,
  focusedClassName,
  style,
  children,
}: PressableProps) {
  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey,
    accessibilityLabel: label,
    onEnterPress: () => {
      lastEnterAt = Date.now();
      if (onPress) whilePressing(focusKey, onPress);
    },
    onFocus: (layout) => onFocus?.(layout),
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
      // element before it switches on pointer mode.
      onMouseMove={() => {
        if (!focused && inputMode.get() === 'pointer') focusSelf();
      }}
      onClick={() => {
        if (Date.now() - lastEnterAt <= CLICK_AFTER_ENTER_MS) return;
        if (!focused) focusSelf();
        if (onPress) whilePressing(focusKey, onPress);
      }}
    >
      {children}
    </div>
  );
}

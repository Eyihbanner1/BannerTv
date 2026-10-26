import {
  type FocusableComponentLayout,
  useFocusable,
} from '@noriginmedia/norigin-spatial-navigation';
import type { CSSProperties, ReactNode } from 'react';
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
      onPress?.();
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
      onMouseEnter={() => {
        if (inputMode.get() === 'pointer') focusSelf();
      }}
      onClick={() => {
        if (Date.now() - lastEnterAt > CLICK_AFTER_ENTER_MS) onPress?.();
      }}
    >
      {children}
    </div>
  );
}

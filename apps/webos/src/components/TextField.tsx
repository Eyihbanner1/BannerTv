import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { KeyCode } from '../navigation/keys';
import { useBack } from '../navigation/use-back';
import styles from './TextField.module.css';

interface KeyboardStateDetail {
  visibility: boolean;
}

interface TextFieldProps {
  focusKey: string;
  /** Read aloud, since the placeholder disappears once there is text. */
  label: string;
  placeholder: string;
  value: string;
  type?: 'text' | 'url';
  onChange: (value: string) => void;
  /** OK on the keyboard (Enter on a PC). */
  onSubmit?: () => void;
}

/**
 * A text box for the remote. Landing on it does not open the TV keyboard,
 * which would cover half the screen while the user is only passing through;
 * OK (or a pointer click) does. The webOS keyboard has a microphone key, which
 * is how BannerTV takes voice input.
 *
 * While typing on a PC keyboard, Left and Right move the caret, Up and Down
 * leave the box, and Enter or Back finish typing.
 */
export function TextField({
  focusKey,
  label,
  placeholder,
  value,
  type = 'text',
  onChange,
  onSubmit,
}: TextFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const editAfterFocus = useRef(false);
  const [editing, setEditing] = useState(false);
  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey,
    accessibilityLabel: label,
    onEnterPress: () => input.current?.focus(),
    // A click on a box that did not have focus: type once spatial navigation has focused it.
    onFocus: () => {
      if (!editAfterFocus.current) return;
      editAfterFocus.current = false;
      input.current?.focus();
    },
  });

  const stopEditing = () => input.current?.blur();

  useBack(
    'overlay',
    () => {
      stopEditing();
      return true;
    },
    editing,
  );

  // The TV keyboard closed (its own Back or Done key): leave the box focused but not typing.
  useEffect(() => {
    if (!editing) return;
    const onKeyboard = (event: Event) => {
      const detail = (event as CustomEvent<KeyboardStateDetail>).detail;
      if (detail && !detail.visibility) input.current?.blur();
    };
    document.addEventListener('keyboardStateChange', onKeyboard);
    return () => document.removeEventListener('keyboardStateChange', onKeyboard);
  }, [editing]);

  const className = [styles.field, focused && styles.focused, editing && styles.editing]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-focus-key={focusKey}
      className={className}
      onClick={() => {
        if (focused) input.current?.focus();
        else {
          editAfterFocus.current = true;
          focusSelf();
        }
      }}
    >
      <input
        ref={input}
        className={styles.input}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Stopping the event here keeps it from spatial navigation, which listens on window.
          if (event.keyCode === KeyCode.Left || event.keyCode === KeyCode.Right) {
            event.stopPropagation();
          } else if (event.keyCode === KeyCode.Ok) {
            event.stopPropagation();
            event.preventDefault();
            stopEditing();
            onSubmit?.();
          }
        }}
      />
    </div>
  );
}

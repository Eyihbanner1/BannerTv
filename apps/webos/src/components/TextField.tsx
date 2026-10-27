import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef, useState } from 'react';
import { useScreenSlot } from '../app/screen-slot';
import { KeyCode } from '../navigation/keys';
import { useBack } from '../navigation/use-back';
import styles from './TextField.module.css';

interface KeyboardStateDetail {
  visibility: boolean;
}

/**
 * How long the TV keyboard must stay hidden before the box stops typing. Its
 * microphone key hides the keyboard for a moment while voice input starts,
 * and LG warns that blurring the box then loses what is said.
 */
export const KEYBOARD_GONE_MS = 2000;

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
  /** The TV keyboard said it closed, and the box is waiting to stop typing. */
  const keyboardGone = useRef(false);
  const slot = useScreenSlot();
  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey,
    accessibilityLabel: label,
    // Not while another screen covers this one (see Pressable).
    onEnterPress: () => {
      if (slot.get()) input.current?.focus();
    },
    onArrowPress: () => slot.get(),
    // A click on a box that did not have focus: type once spatial navigation has focused it.
    onFocus: () => {
      if (!editAfterFocus.current) return;
      editAfterFocus.current = false;
      input.current?.focus();
    },
  });

  const stopEditing = () => input.current?.blur();

  // With the TV keyboard already closed, Back goes on to the screen or dialog.
  useBack(
    'overlay',
    () => {
      const gone = keyboardGone.current;
      stopEditing();
      return !gone;
    },
    editing,
  );

  // The TV keyboard closed (its own Back or Done key): leave the box focused
  // but not typing. Only once it stays closed: voice input closes it briefly
  // and then types the words into the box, which must still have focus.
  useEffect(() => {
    const node = input.current;
    if (!editing || !node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
      keyboardGone.current = false;
    };
    const wait = () => {
      cancel();
      keyboardGone.current = true;
      timer = setTimeout(() => {
        timer = undefined;
        if (document.activeElement === node) node.blur();
      }, KEYBOARD_GONE_MS);
    };
    const onKeyboard = (event: Event) => {
      const detail = (event as CustomEvent<KeyboardStateDetail>).detail;
      if (!detail) return;
      if (detail.visibility) cancel();
      else wait();
    };
    // Spoken words arriving as the voice overlay closes: wait again from there.
    const onInput = () => {
      if (timer !== undefined) wait();
    };
    document.addEventListener('keyboardStateChange', onKeyboard);
    node.addEventListener('input', onInput);
    return () => {
      cancel();
      document.removeEventListener('keyboardStateChange', onKeyboard);
      node.removeEventListener('input', onInput);
    };
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
          const key = event.keyCode;
          // The TV keyboard has closed: a remote key stops typing and then does
          // what it does on the box. OK opens the keyboard again.
          if (
            keyboardGone.current &&
            (key === KeyCode.Left || key === KeyCode.Right || key === KeyCode.Ok)
          ) {
            stopEditing();
            return;
          }
          // Stopping the event here keeps it from spatial navigation, which listens on window.
          if (key === KeyCode.Left || key === KeyCode.Right) {
            event.stopPropagation();
          } else if (key === KeyCode.Ok) {
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

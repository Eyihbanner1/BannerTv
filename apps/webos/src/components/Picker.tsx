import { useState } from 'react';
import { Menu, type MenuOption } from './Menu';
import { Pressable } from './Pressable';
import styles from './Picker.module.css';

interface PickerProps {
  focusKey: string;
  /** What is being picked, such as "Type". Read aloud and used as the menu title. */
  label: string;
  options: readonly MenuOption[];
  value: string | undefined;
  onChange: (value: string) => void;
}

/** A button showing the current choice; OK opens the menu of options. */
export function Picker({ focusKey, label, options, value, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const text = current ? current.label : '';

  return (
    <>
      <Pressable
        focusKey={focusKey}
        label={`${label}: ${text}`}
        className={styles.picker}
        focusedClassName={styles.focused}
        onPress={() => setOpen(true)}
      >
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{text}</span>
      </Pressable>
      {open && (
        <Menu
          focusKey={`${focusKey}-menu`}
          title={label}
          options={options}
          selected={value}
          returnFocusKey={focusKey}
          onSelect={(next) => {
            setOpen(false);
            if (next !== value) onChange(next);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

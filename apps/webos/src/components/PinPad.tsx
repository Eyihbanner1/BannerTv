import { PIN_LENGTH } from '@bannertv/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from './Overlay';
import { Pressable } from './Pressable';
import styles from './PinPad.module.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'cancel'] as const;

// The remote's number keys, and a PC keyboard's top row and number pad.
function digitOf(event: KeyboardEvent): string | null {
  if (event.keyCode >= 48 && event.keyCode <= 57) return String(event.keyCode - 48);
  if (event.keyCode >= 96 && event.keyCode <= 105) return String(event.keyCode - 96);
  return null;
}

interface PinPadProps {
  focusKey: string;
  title: string;
  /** Under the dots: what went wrong, or a hint. */
  message?: string;
  returnFocusKey: string | (() => string);
  /** Called with all four digits; the pad then starts empty again. */
  onPin: (digits: string) => void;
  onClose: () => void;
}

/**
 * Four digits, typed with the remote's number keys or picked on the pad.
 * The fourth digit sends the PIN; the digits are never shown, only dots.
 */
export function PinPad({ focusKey, title, message, returnFocusKey, onPin, onClose }: PinPadProps) {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const latest = useRef({ digits, onPin });
  useEffect(() => {
    latest.current = { digits, onPin };
  });

  const type = (digit: string) => {
    const next = latest.current.digits + digit;
    if (next.length < PIN_LENGTH) {
      latest.current.digits = next;
      setDigits(next);
      return;
    }
    latest.current.digits = '';
    setDigits('');
    latest.current.onPin(next);
  };
  const remove = () => {
    const next = latest.current.digits.slice(0, -1);
    latest.current.digits = next;
    setDigits(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const digit = digitOf(event);
      if (digit === null) return;
      event.preventDefault();
      event.stopPropagation();
      type(digit);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // `type` reads the latest digits and handler through the ref, so one listener serves.
  }, []);

  return (
    <Overlay
      focusKey={focusKey}
      label={title}
      defaultFocusKey={`${focusKey}-1`}
      returnFocusKey={returnFocusKey}
      onClose={onClose}
      placement="center"
    >
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.dots} aria-label={t('pin.entered', { count: digits.length })}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} className={index < digits.length ? styles.filled : styles.dot} />
        ))}
      </div>
      <p className={styles.message} role="status">
        {message ?? ''}
      </p>
      <div className={styles.pad}>
        {KEYS.map((key) => {
          const label =
            key === 'delete' ? t('pin.delete') : key === 'cancel' ? t('common.cancel') : key;
          return (
            <Pressable
              key={key}
              focusKey={`${focusKey}-${key}`}
              label={label}
              className={key.length === 1 ? styles.key : `${styles.key} ${styles.word}`}
              focusedClassName={styles.focused}
              onPress={() => {
                if (key === 'delete') remove();
                else if (key === 'cancel') onClose();
                else type(key);
              }}
            >
              {label}
            </Pressable>
          );
        })}
      </div>
    </Overlay>
  );
}

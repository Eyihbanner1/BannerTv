import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBack } from '../navigation/use-back';
import styles from './Overlay.module.css';

interface OverlayProps {
  focusKey: string;
  /** Read aloud by LG Audio Guidance when the layer opens. */
  label: string;
  /** Focused when the layer opens. */
  defaultFocusKey: string;
  /** Focused again when it closes: usually what opened it. A function is read at closing time. */
  returnFocusKey: string | (() => string);
  onClose: () => void;
  /** 'side' slides in from the right (menus), 'center' is a dialog. */
  placement: 'side' | 'center';
  children: ReactNode;
}

/**
 * A focus-isolated layer over the whole app: focus cannot leave it, Back and
 * a pointer click outside close it, and focus returns where it came from.
 * It covers the rail too, so it is drawn at the root of the page.
 */
export function Overlay(props: OverlayProps) {
  const { focusKey, label, defaultFocusKey, onClose, placement, children } = props;
  const { ref } = useFocusable<object, HTMLDivElement>({
    focusKey,
    isFocusBoundary: true,
    saveLastFocusedChild: false,
    preferredChildFocusKey: defaultFocusKey,
  });
  const returnTo = useRef(props.returnFocusKey);
  useEffect(() => {
    returnTo.current = props.returnFocusKey;
  });

  useBack('overlay', () => {
    onClose();
    return true;
  });

  // Children register before this effect runs, so the default target exists.
  useEffect(() => {
    void setFocus(defaultFocusKey);
    return () => {
      const target = returnTo.current;
      void setFocus(typeof target === 'function' ? target() : target);
    };
    // Focus moves once when the layer opens and once when it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const root = document.getElementById('root');
  if (!root) return null;
  return createPortal(
    <FocusContext.Provider value={focusKey}>
      <div className={styles.layer}>
        <div className={styles.backdrop} onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className={`${styles.panel} ${styles[placement]}`}
        >
          {children}
        </div>
      </div>
    </FocusContext.Provider>,
    root,
  );
}

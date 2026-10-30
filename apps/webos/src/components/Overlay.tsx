import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clickCameWithOk } from '../navigation/ok-click';
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
  /**
   * Back, in place of closing: a layer with levels goes back one. True when
   * answered. Children's own Back handlers answer after this one.
   */
  onBack?: () => boolean;
  /**
   * 'side' slides in from the right (menus), 'center' is a dialog, 'bottom'
   * rises from the bottom and leaves the picture above it clear.
   */
  placement: 'side' | 'center' | 'bottom';
  /** Whether a pointer click outside closes it. Not for a layer whose closing leaves the screen. */
  closeOnOutsideClick?: boolean;
  children: ReactNode;
}

/**
 * A focus-isolated layer over the whole app: focus cannot leave it, Back and
 * (unless told otherwise) a pointer click outside close it, and focus returns
 * where it came from.
 * It covers the rail too, so it is drawn at the root of the page.
 */
export function Overlay(props: OverlayProps) {
  const { focusKey, label, defaultFocusKey, onClose, placement, children } = props;
  const closeOnOutsideClick = props.closeOnOutsideClick ?? true;
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
    if (props.onBack) return props.onBack();
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

  // Not the click of the Magic Remote OK that opened the layer, which lands outside it.
  const onOutsideClick = () => {
    if (!clickCameWithOk()) onClose();
  };

  const root = document.getElementById('root');
  if (!root) return null;
  return createPortal(
    <FocusContext.Provider value={focusKey}>
      <div className={styles.layer}>
        <div
          className={
            placement === 'bottom' ? `${styles.backdrop} ${styles.clear}` : styles.backdrop
          }
          onClick={closeOnOutsideClick ? onOutsideClick : undefined}
        />
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

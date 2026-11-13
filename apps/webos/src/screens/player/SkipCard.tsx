import type { SkipKind } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { okDownBefore } from '../../navigation/ok-click';
import { useBack } from '../../navigation/use-back';
import { cardArrows } from './card-arrows';
import styles from './PlayerScreen.module.css';

interface SkipCardProps {
  kind: SkipKind;
  /** Jumps to the end of the intro or recap. */
  onSkip: () => void;
  /** Back: the card goes for this intro or recap, and the picture keeps playing. */
  onDismiss: () => void;
  /** Up or Down: the controls come up in its place. */
  onControls: () => void;
  /** Left or Right: a skip of 10 s that adds up, as over the picture. */
  onScrub: (direction: -1 | 1) => void;
}

/**
 * "Skip intro" or "Skip recap", one quiet button in the corner where Up Next
 * shows. It comes as the intro or recap starts, while nothing else is on
 * screen, and goes again after a few seconds: OK skips, Back lets it go, Up
 * or Down brings the controls, and Left or Right skip 10 s as they do over
 * the picture, so the card never leaves the arrows doing nothing. It never
 * skips by itself, and the wheel never presses it (the player keeps the
 * wheel off cards).
 */
export function SkipCard({ kind, onSkip, onDismiss, onControls, onScrub }: SkipCardProps) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-skip',
    isFocusBoundary: true,
    preferredChildFocusKey: 'player-skip-button',
  });
  // When it showed. An OK held since before then, on the card for the recap
  // just skipped, would press this one too (the same button, a new intro):
  // its repeats press nothing here. The player gives each intro or recap a card of its own.
  const shownAt = useRef(Infinity);
  useEffect(() => {
    shownAt.current = performance.now();
    void setFocus('player-skip-button');
  }, []);
  const skip = () => {
    if (!okDownBefore(shownAt.current)) onSkip();
  };
  useBack('overlay', () => {
    onDismiss();
    return true;
  });
  const label = t(kind === 'intro' ? 'player.skipIntro' : 'player.skipRecap');
  const upDown = cardArrows(onControls);
  // False takes the press from spatial navigation, whose focus boundary would swallow it.
  const onArrowPress = (direction: string) => {
    if (direction !== 'left' && direction !== 'right') return upDown(direction);
    onScrub(direction === 'left' ? -1 : 1);
    return false;
  };
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.skipCard} role="dialog" aria-label={label}>
        <Button
          focusKey="player-skip-button"
          variant="primary"
          label={label}
          onPress={skip}
          onArrowPress={onArrowPress}
        />
      </div>
    </FocusContext.Provider>
  );
}

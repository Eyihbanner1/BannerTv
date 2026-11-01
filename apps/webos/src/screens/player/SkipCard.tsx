import type { SkipKind } from '@bannertv/core';
import { FocusContext, setFocus, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
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
}

/**
 * "Skip intro" or "Skip recap", one quiet button in the corner where Up Next
 * shows. It comes as the intro or recap starts, while nothing else is on
 * screen, and goes again after a few seconds: OK skips, Back lets it go, Up
 * or Down brings the controls. It never skips by itself, and the wheel never
 * presses it (the player keeps the wheel off cards).
 */
export function SkipCard({ kind, onSkip, onDismiss, onControls }: SkipCardProps) {
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-skip',
    isFocusBoundary: true,
    preferredChildFocusKey: 'player-skip-button',
  });
  useEffect(() => void setFocus('player-skip-button'), []);
  useBack('overlay', () => {
    onDismiss();
    return true;
  });
  const label = t(kind === 'intro' ? 'player.skipIntro' : 'player.skipRecap');
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.skipCard} role="dialog" aria-label={label}>
        <Button
          focusKey="player-skip-button"
          variant="primary"
          label={label}
          onPress={onSkip}
          onArrowPress={cardArrows(onControls)}
        />
      </div>
    </FocusContext.Provider>
  );
}

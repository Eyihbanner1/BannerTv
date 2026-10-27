import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { formatTime } from '../../player/media';
import styles from './PlayerScreen.module.css';

export interface ControlButton {
  focusKey: string;
  label: string;
  onPress: () => void;
}

interface PlayerControlsProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Picture, HDR, audio and the addon, as badges. */
  facts: readonly string[];
  position: number;
  duration: number;
  /** Where a scrub would land, while the viewer is moving along the bar. */
  scrubTo: number | null;
  buttons: readonly ControlButton[];
  onScrub: (direction: -1 | 1) => void;
}

function SeekBar({
  position,
  duration,
  scrubTo,
  onScrub,
}: Pick<PlayerControlsProps, 'position' | 'duration' | 'scrubTo' | 'onScrub'>) {
  const { t } = useTranslation();
  const { ref, focused } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-seek',
    accessibilityLabel: t('player.seek'),
    onArrowPress: (direction) => {
      if (direction === 'left' || direction === 'right') {
        onScrub(direction === 'left' ? -1 : 1);
        return false;
      }
      return direction === 'down';
    },
  });
  const shown = scrubTo ?? position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const played = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={-1}
      aria-label={t('player.seek')}
      aria-valuetext={formatTime(shown)}
      className={focused ? `${styles.seek} ${styles.seekFocused}` : styles.seek}
    >
      <span className={styles.time}>{formatTime(shown)}</span>
      <div className={styles.bar}>
        <div className={styles.played} style={{ width: `${played * 100}%` }} />
        {scrubTo !== null && (
          <div
            className={styles.scrubbed}
            style={{
              left: `${Math.min(played, fraction) * 100}%`,
              width: `${Math.abs(fraction - played) * 100}%`,
            }}
          />
        )}
        <div className={styles.thumb} style={{ left: `${fraction * 100}%` }} />
      </div>
      <span className={styles.time}>{duration > 0 ? formatTime(duration) : ''}</span>
    </div>
  );
}

/**
 * The title, the seek bar and a row of buttons, over gradients at the top
 * and bottom of the picture. They stay mounted while hidden, so focus can
 * land on them the moment they show.
 */
export function PlayerControls(props: PlayerControlsProps) {
  const { visible, title, subtitle, facts, buttons } = props;
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-controls',
    saveLastFocusedChild: false,
    preferredChildFocusKey: buttons[0]?.focusKey,
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={visible ? `${styles.controls} ${styles.controlsShown}` : styles.controls}
      >
        <div className={styles.top}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {facts.length > 0 && (
            <p className={styles.facts}>
              {facts.map((fact) => (
                <span key={fact} className={styles.fact}>
                  {fact}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className={styles.bottom}>
          <SeekBar
            position={props.position}
            duration={props.duration}
            scrubTo={props.scrubTo}
            onScrub={props.onScrub}
          />
          <div className={styles.buttons}>
            {buttons.map((button, index) => (
              <Button
                key={button.focusKey}
                focusKey={button.focusKey}
                label={button.label}
                variant={index === 0 ? 'primary' : 'secondary'}
                onPress={button.onPress}
              />
            ))}
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { type MouseEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { markActivity } from '../../navigation/activity';
import { inputMode } from '../../platform/input-mode';
import { formatTime } from '../../player/media';
import styles from './PlayerScreen.module.css';

/** How far beside the bar the pointer still reaches its start or end. */
const BAR_REACH_PX = 16;

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
  onScrub: (direction: -1 | 1, repeats: number) => void;
  /** OK on the bar. */
  onCommit: () => void;
  /** A click on the bar, in seconds. */
  onSeekTo: (seconds: number) => void;
}

/**
 * Where the video is, and where a skip will land. Left and Right skip, OK
 * lands a skip at once; the pointer shows the time under it and a click
 * jumps there. The whole height of the 64 px row is the pointer's target,
 * across the bar but not the times beside it.
 */
function SeekBar({
  position,
  duration,
  scrubTo,
  onScrub,
  onCommit,
  onSeekTo,
}: Pick<
  PlayerControlsProps,
  'position' | 'duration' | 'scrubTo' | 'onScrub' | 'onCommit' | 'onSeekTo'
>) {
  const { t } = useTranslation();
  // Whether the pointer is over the row, where its OK is a click.
  const pointerOver = useRef(false);
  const { ref, focused, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-seek',
    accessibilityLabel: t('player.seek'),
    onArrowPress: (direction, _props, details) => {
      if (direction === 'left' || direction === 'right') {
        onScrub(direction === 'left' ? -1 : 1, (details.pressedKeys[direction] ?? 1) - 1);
        return false;
      }
      return direction === 'down';
    },
    // The Magic Remote OK over the bar also arrives as a click, which jumps:
    // the key press must not play or pause as well.
    onEnterPress: () => {
      if (inputMode.get() === 'pointer' && pointerOver.current) return;
      onCommit();
    },
  });
  const bar = useRef<HTMLDivElement>(null);
  // The fraction of the video under the pointer, while it is over the bar.
  const [hover, setHover] = useState<number | null>(null);
  const pointing = useSyncExternalStore(inputMode.subscribe, inputMode.get) === 'pointer';
  // An arrow hides the pointer without it leaving the bar, so no mouseleave
  // comes: the time goes now, and only a move over the bar brings it back.
  useEffect(
    () =>
      inputMode.subscribe(() => {
        if (inputMode.get() !== 'pointer') setHover(null);
      }),
    [],
  );
  const fractionAt = (event: MouseEvent): number | null => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || duration <= 0) return null;
    // A little either side of the bar reaches its ends; the times beside it are not a target.
    const x = event.clientX - rect.left;
    if (x < -BAR_REACH_PX || x > rect.width + BAR_REACH_PX) return null;
    return Math.max(0, Math.min(1, x / rect.width));
  };
  const shown = scrubTo ?? position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const played = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={-1}
      data-focus-key="player-seek"
      data-focused={focused ? 'true' : undefined}
      aria-label={t('player.seek')}
      aria-valuetext={formatTime(shown)}
      className={focused ? `${styles.seek} ${styles.seekFocused}` : styles.seek}
      onMouseMove={(event) => {
        if (inputMode.get() !== 'pointer') return;
        pointerOver.current = true;
        setHover(fractionAt(event));
        if (!focused) {
          markActivity();
          focusSelf();
        }
      }}
      onMouseLeave={() => {
        pointerOver.current = false;
        setHover(null);
      }}
      onClick={(event) => {
        const at = fractionAt(event);
        if (at !== null) onSeekTo(at * duration);
      }}
    >
      <span className={styles.time}>{formatTime(shown)}</span>
      <div ref={bar} className={styles.bar}>
        {hover !== null && pointing && focused && (
          <span className={styles.hoverTime} style={{ left: `${hover * 100}%` }}>
            {formatTime(hover * duration)}
          </span>
        )}
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
        <div className={styles.top} data-player-chrome>
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
        <div className={styles.bottom} data-player-chrome>
          <SeekBar
            position={props.position}
            duration={props.duration}
            scrubTo={props.scrubTo}
            onScrub={props.onScrub}
            onCommit={props.onCommit}
            onSeekTo={props.onSeekTo}
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

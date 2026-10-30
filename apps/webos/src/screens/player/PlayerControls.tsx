import { FocusContext, useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from '../../components/Pressable';
import { markActivity } from '../../navigation/activity';
import { answeredOk, clickCameWithOk } from '../../navigation/ok-click';
import { inputMode } from '../../platform/input-mode';
import { formatClock, formatTime } from '../../player/media';
import { PlayerIcon, type PlayerIconName } from './PlayerIcon';
import styles from './PlayerScreen.module.css';

/** How far beside the bar the pointer still reaches its start or end. */
const BAR_REACH_PX = 16;
/** How often the clock is read while the controls show. */
const CLOCK_TICK_MS = 5000;
/** Where the transport sits: five places, 170 px apart, Play and Pause in the middle. */
const TRANSPORT_SLOT_PX = 170;

/** One control: a transport icon with its name under it, or a tool chip. */
export interface PlayerAction {
  focusKey: string;
  icon: PlayerIconName;
  /** Its name, shown and read by Audio Guidance. */
  label: string;
  /** On a tool, what is on now: "English", "1080p". */
  value?: string;
  /** Why it can't be used now. It keeps its place, dimmed, and says this when focused. */
  unavailable?: string;
  /** The coloured key on the remote that does the same. */
  colourKey?: 'blue';
  onPress: () => void;
}

interface PlayerControlsProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Resolution, HDR and sound, as badges. */
  facts: readonly string[];
  live: boolean;
  position: number;
  duration: number;
  /** Where a scrub would land, while the viewer is moving along the bar. */
  scrubTo: number | null;
  /** Start over, back 10 s, Play or Pause, forward 10 s, Next episode; null leaves a place empty. */
  transport: readonly (PlayerAction | null)[];
  tools: readonly PlayerAction[];
  onScrub: (direction: -1 | 1, repeats: number) => void;
  /** OK on the bar. */
  onCommit: () => void;
  /** A click on the bar, in seconds. */
  onSeekTo: (seconds: number) => void;
  /** The back arrow at the top left, for the pointer: the same as Back with the controls hidden. */
  onLeave: () => void;
}

/**
 * Where the video is, and where a skip will land: the time played, the bar
 * and the time left, or LIVE on a broadcast. Left and Right skip, OK lands a
 * skip at once; the pointer shows the time under it and a click jumps there.
 * The whole height of the 64 px row is the pointer's target, across the bar
 * but not the times beside it.
 */
function SeekBar({
  position,
  duration,
  scrubTo,
  onScrub,
  onCommit,
  onSeekTo,
  live,
}: Pick<
  PlayerControlsProps,
  'position' | 'duration' | 'scrubTo' | 'onScrub' | 'onCommit' | 'onSeekTo' | 'live'
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
      answeredOk();
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
        // Not the click of an OK something else answered, such as the one that brought the bar up.
        if (clickCameWithOk()) return;
        const at = fractionAt(event);
        if (at !== null) onSeekTo(at * duration);
      }}
    >
      {live ? (
        <span className={styles.time}>
          <span className={styles.live}>
            <span className={styles.liveDot} />
            {t('player.live')}
          </span>
        </span>
      ) : (
        <span className={styles.time}>{formatTime(shown)}</span>
      )}
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
      <span className={`${styles.time} ${styles.timeLeft}`}>
        {!live && duration > 0 ? `−${formatTime(Math.max(0, duration - shown))}` : ''}
      </span>
    </div>
  );
}

/** The time now, to the last tick, read every few seconds while `active`. */
function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribeClock : subscribeNever, readTick) * CLOCK_TICK_MS;
}
function subscribeClock(listener: () => void): () => void {
  const timer = window.setInterval(listener, CLOCK_TICK_MS);
  return () => window.clearInterval(timer);
}
function subscribeNever(): () => void {
  return () => undefined;
}
function readTick(): number {
  return Math.floor(Date.now() / CLOCK_TICK_MS);
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * A round transport icon with its name under it. A control that can't be
 * used now stays in its place, dimmed, and says why when focused.
 */
function TransportButton({ action, index }: { action: PlayerAction; index: number }) {
  const large = action.icon === 'play' || action.icon === 'pause';
  const dim = action.unavailable !== undefined;
  return (
    <Pressable
      focusKey={action.focusKey}
      label={dim ? `${action.label}. ${action.unavailable}` : action.label}
      className={classes(styles.transportButton, large && styles.transportLarge, dim && styles.dim)}
      focusedClassName={styles.transportFocused}
      style={{ left: index * TRANSPORT_SLOT_PX }}
      onPress={dim ? undefined : action.onPress}
    >
      <span className={styles.disc}>
        <PlayerIcon name={action.icon} size={large ? 60 : 45} />
      </span>
      <span className={styles.transportName}>{action.label}</span>
      {dim && <span className={styles.reason}>{action.unavailable}</span>}
    </Pressable>
  );
}

/**
 * A tool: its icon, its name and what is on now, with the coloured key that
 * opens it. One that can't be used says why in place of the value, so the
 * row keeps its width whatever has focus.
 */
function ToolChip({ action }: { action: PlayerAction }) {
  const dim = action.unavailable !== undefined;
  return (
    <Pressable
      focusKey={action.focusKey}
      label={
        dim
          ? `${action.label}. ${action.unavailable}`
          : action.value
            ? `${action.label}, ${action.value}`
            : action.label
      }
      className={classes(styles.chip, dim && styles.dim)}
      focusedClassName={styles.chipFocused}
      onPress={dim ? undefined : action.onPress}
    >
      <PlayerIcon name={action.icon} size={32} />
      <span className={styles.chipLabel}>{action.label}</span>
      {dim ? (
        <span className={styles.reason}>{action.unavailable}</span>
      ) : (
        action.value && <span className={styles.chipValue}>{action.value}</span>
      )}
      {action.colourKey && <span className={`${styles.colourKey} ${styles.blueKey}`} />}
    </Pressable>
  );
}

/**
 * A row of controls. Up or Down from the row next to it lands on `first`.
 * Left and Right stay in the row: the back arrow at the top is the pointer's.
 */
function ControlRow({
  focusKey,
  first,
  className,
  children,
}: {
  focusKey: string;
  first: string;
  className?: string;
  children: ReactNode;
}) {
  const { ref, focusKey: rowKey } = useFocusable<object, HTMLDivElement>({
    focusKey,
    saveLastFocusedChild: false,
    preferredChildFocusKey: first,
    isFocusBoundary: true,
    focusBoundaryDirections: ['left', 'right'],
  });
  return (
    <FocusContext.Provider value={rowKey}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}

/**
 * Two tiers over the bottom of the picture: the seek bar, the transport
 * with a name under each icon, and the tools saying what is on now. At the
 * top: a back arrow for the pointer, the title, three facts, the clock and
 * when it ends. Down from Pause reaches Audio and subtitles; Up from the
 * tools comes back to Pause. They stay mounted while hidden, so focus can
 * land on them the moment they show.
 */
export function PlayerControls(props: PlayerControlsProps) {
  const { visible, title, subtitle, facts, transport, tools, live, duration, position } = props;
  const { t } = useTranslation();
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: 'player-controls',
    saveLastFocusedChild: false,
    preferredChildFocusKey: 'player-transport',
  });
  const now = useNow(visible);
  const shown = props.scrubTo ?? position;
  // Neither on a broadcast nor before the file gives its length. From the
  // clock to the millisecond, not the last tick: playing re-renders this as
  // the time left goes down, and against a tick up to 5 s old the end would
  // go back and forth over a minute. It is only text, so a render that reads
  // the clock again can only bring it up to date.
  const endsAt =
    !live && duration > 0
      ? // eslint-disable-next-line react-hooks/purity
        Math.max(now, Date.now()) + Math.max(0, duration - shown) * 1000
      : null;
  const pause = transport.find((action) => action?.icon === 'play' || action?.icon === 'pause');
  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={visible ? `${styles.controls} ${styles.controlsShown}` : styles.controls}
      >
        <div className={styles.top} data-player-chrome>
          <Pressable
            focusKey="player-back"
            label={t('player.leave')}
            className={styles.backButton}
            focusedClassName={styles.backFocused}
            onPress={props.onLeave}
          >
            <span className={styles.disc}>
              <PlayerIcon name="back" size={44} />
            </span>
          </Pressable>
          <div className={styles.heading}>
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
          <div className={styles.clock}>
            <p className={styles.now}>{formatClock(now)}</p>
            {endsAt !== null && (
              <p className={styles.endsAt}>{t('player.endsAt', { time: formatClock(endsAt) })}</p>
            )}
          </div>
        </div>
        <div className={styles.bottom} data-player-chrome>
          <SeekBar
            position={position}
            duration={duration}
            scrubTo={props.scrubTo}
            live={live}
            onScrub={props.onScrub}
            onCommit={props.onCommit}
            onSeekTo={props.onSeekTo}
          />
          <ControlRow
            focusKey="player-transport"
            first={pause?.focusKey ?? 'player-play'}
            className={styles.transport}
          >
            {transport.map(
              (action, index) =>
                action && <TransportButton key={action.focusKey} action={action} index={index} />,
            )}
          </ControlRow>
          <ControlRow
            focusKey="player-tools"
            first={tools[0]?.focusKey ?? 'player-tracks-button'}
            className={styles.tools}
          >
            {tools.map((action) => (
              <ToolChip key={action.focusKey} action={action} />
            ))}
          </ControlRow>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

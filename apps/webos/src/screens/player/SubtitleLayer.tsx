import { createCueIndex, type Cue, type CueIndex } from '@bannertv/core';
import { useEffect, useMemo, useState } from 'react';
import type { SubtitleStyle } from '../../data/preferences';
import styles from './SubtitleLayer.module.css';

/** How often the layer reads the clock. Cues rarely last under half a second. */
const TICK_MS = 100;
const NONE: Cue[] = [];

interface SubtitleLayerProps {
  video: HTMLVideoElement | null;
  cues: readonly Cue[] | null;
  /** Seconds added to every cue: positive shows them later. */
  offset: number;
  look: SubtitleStyle;
  /** The controls are showing, so bottom subtitles move up out of their way. */
  raised: boolean;
}

/**
 * Draws subtitles over the picture. BannerTV draws them itself because
 * webOS shows neither embedded nor HLS subtitles to web apps (ADR 0001), and
 * so that every source looks the same and follows the viewer's style.
 */
export function SubtitleLayer({ video, cues, offset, look, raised }: SubtitleLayerProps) {
  const index = useMemo(() => (cues ? createCueIndex(cues) : null), [cues]);
  const [read, setRead] = useState<{ index: CueIndex | null; cues: Cue[] }>({
    index: null,
    cues: NONE,
  });

  useEffect(() => {
    if (!video || !index) return;
    // The index hands back the same array while nothing changes, so React skips the redraw.
    const tick = () => {
      const cues = index.at(video.currentTime - offset);
      setRead((last) => (last.index === index && last.cues === cues ? last : { index, cues }));
    };
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [video, index, offset]);

  // Cues read from an older file never show over a new one.
  const showing = video && index && read.index === index ? read.cues : NONE;
  if (showing.length === 0) return null;
  const bottom = showing.filter((cue) => !cue.top);
  const top = showing.filter((cue) => cue.top);
  const lift = look.position === 'top' ? undefined : raised ? styles.raised : undefined;
  const placement = [styles[`at-${look.position}`], lift].filter(Boolean).join(' ');
  const text = [styles.text, styles[`size-${look.size}`], styles[`colour-${look.colour}`]].join(
    ' ',
  );

  const draw = (list: Cue[]) =>
    list.map((cue, i) => (
      <div key={`${cue.start}-${i}`} className={styles.cue}>
        {cue.lines.map((line, j) => (
          <div key={j} className={styles.line}>
            <span className={`${styles.box} ${styles[`back-${look.background}`]}`}>
              {line.map((span, k) => (
                <span
                  key={k}
                  className={[
                    span.italic && styles.italic,
                    span.bold && styles.bold,
                    span.underline && styles.underline,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {span.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    ));

  return (
    <div className={text} aria-hidden="true">
      {top.length > 0 && <div className={`${styles.area} ${styles['at-top']}`}>{draw(top)}</div>}
      {bottom.length > 0 && <div className={`${styles.area} ${placement}`}>{draw(bottom)}</div>}
    </div>
  );
}

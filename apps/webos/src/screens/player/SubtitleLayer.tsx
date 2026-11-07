import { createCueIndex, type Cue, type CueIndex } from '@bannertv/core';
import { useEffect, useMemo, useState } from 'react';
import type { SubtitleStyle } from '../../data/preferences';
import { nextReadDelay } from '../../player/timing';
import styles from './SubtitleLayer.module.css';

/** What the video says when its clock moves, stops or jumps. */
const CLOCK_EVENTS = ['play', 'playing', 'pause', 'seeking', 'seeked', 'ratechange', 'timeupdate'];
const NONE: Cue[] = [];

/**
 * What subtitles make way for. controls: bottom ones move up above the
 * controls, top ones down below the title. sheet: bottom ones sit just above
 * the audio and subtitle sheet.
 */
export type SubtitleLift = 'none' | 'controls' | 'sheet';

interface SubtitleLayerProps {
  video: HTMLVideoElement | null;
  cues: readonly Cue[] | null;
  /** Seconds added to every cue: positive shows them later. */
  offset: number;
  look: SubtitleStyle;
  lift: SubtitleLift;
  /** A line shown while nobody speaks, so a style change shows at once. */
  sample?: string;
}

/**
 * Draws subtitles over the picture. BannerTV draws them itself because
 * webOS shows neither embedded nor HLS subtitles to web apps (ADR 0001), and
 * so that every source looks the same and follows the viewer's style.
 *
 * Lines change on time: the layer reads the clock when the next line is due,
 * rather than every tenth of a second, which showed and cleared lines up to
 * 0.1 s late and made them feel loose against the speech.
 */
export function SubtitleLayer({ video, cues, offset, look, lift, sample }: SubtitleLayerProps) {
  const index = useMemo(() => (cues ? createCueIndex(cues) : null), [cues]);
  const [read, setRead] = useState<{ index: CueIndex | null; cues: Cue[] }>({
    index: null,
    cues: NONE,
  });

  useEffect(() => {
    if (!video || !index) return;
    let timer: number | undefined;
    // The index hands back the same array while nothing changes, so React skips the redraw.
    const tick = () => {
      window.clearTimeout(timer);
      const now = video.currentTime - offset;
      const showing = index.at(now);
      setRead((last) =>
        last.index === index && last.cues === showing ? last : { index, cues: showing },
      );
      const wait = nextReadDelay(now, index.nextChange(now), video.playbackRate, video.paused);
      timer = window.setTimeout(tick, wait);
    };
    for (const type of CLOCK_EVENTS) video.addEventListener(type, tick);
    tick();
    return () => {
      window.clearTimeout(timer);
      for (const type of CLOCK_EVENTS) video.removeEventListener(type, tick);
    };
  }, [video, index, offset]);

  // Cues read from an older file never show over a new one.
  const said = video && index && read.index === index ? read.cues : NONE;
  const showing = said.length > 0 || !sample ? said : sampleCue(sample);
  if (showing.length === 0) return null;
  const bottom = showing.filter((cue) => !cue.top);
  const top = showing.filter((cue) => cue.top);
  // Lines placed at the top of the picture stay there under a sheet.
  const below =
    lift === 'sheet' ? styles.aboveSheet : lift === 'controls' ? styles.raised : undefined;
  const lowered = lift === 'controls' ? styles.lowered : undefined;
  const placement =
    look.position === 'top' ? [styles['at-top'], lowered] : [styles[`at-${look.position}`], below];

  return (
    <div className={subtitleText(look)} aria-hidden="true">
      {top.length > 0 && (
        <div className={[styles.area, styles['at-top'], lowered].filter(Boolean).join(' ')}>
          {top.map((cue, i) => (
            <SubtitleCue key={`${cue.start}-${i}`} cue={cue} look={look} />
          ))}
        </div>
      )}
      {bottom.length > 0 && (
        <div className={[styles.area, ...placement].filter(Boolean).join(' ')}>
          {bottom.map((cue, i) => (
            <SubtitleCue key={`${cue.start}-${i}`} cue={cue} look={look} />
          ))}
        </div>
      )}
    </div>
  );
}

function sampleCue(text: string): Cue[] {
  return [{ start: 0, end: 0, lines: [[{ text }]] }];
}

/** The size and colour of subtitle text, for the layer and for the style samples. */
export function subtitleText(look: Pick<SubtitleStyle, 'size' | 'colour'>): string {
  return [styles.text, styles[`size-${look.size}`], styles[`colour-${look.colour}`]].join(' ');
}

/** The colour of subtitle text, as `color`: a swatch fills with it. */
export function subtitleColour(colour: SubtitleStyle['colour']): string {
  return styles[`colour-${colour}`]!;
}

/** The box or edge behind subtitle text. */
export function subtitleBack(background: SubtitleStyle['background']): string {
  return `${styles.box} ${styles[`back-${background}`]}`;
}

/** One cue, line by line, each line with its own background. */
export function SubtitleCue({ cue, look }: { cue: Cue; look: SubtitleStyle }) {
  return (
    <div className={styles.cue}>
      {cue.lines.map((line, j) => (
        <div key={j} className={styles.line}>
          <span className={subtitleBack(look.background)}>
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
  );
}

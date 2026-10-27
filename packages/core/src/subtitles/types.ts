/** A run of cue text in one style. */
export interface CueSpan {
  text: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
}

/** One line of a cue, as styled runs. */
export type CueLine = CueSpan[];

export interface Cue {
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds; always greater than start. */
  end: number;
  /** At least one line, none of them empty. */
  lines: CueLine[];
  /** Drawn at the top of the picture rather than the bottom (ASS \an7-9, VTT line:0 and the like). */
  top?: boolean;
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

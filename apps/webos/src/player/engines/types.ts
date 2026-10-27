import type { Cue } from '@bannertv/core';

/** An audio or subtitle track the stream itself carries. */
export interface EngineTrack {
  id: string;
  /** As the stream names it: ISO 639 code, a name, or '' when unknown. */
  lang: string;
  label: string;
  active: boolean;
}

/**
 * format: the TV cannot play this container or codec. network: the link
 * failed or expired. decode: the file is broken or the decoder gave up.
 */
export type PlaybackErrorKind = 'format' | 'network' | 'decode' | 'other';

export class PlaybackError extends Error {
  readonly kind: PlaybackErrorKind;
  /** The engine's own code (an hls.js detail, a Shaka error code), for Diagnostics. Never a link. */
  readonly detail?: string;

  constructor(kind: PlaybackErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'PlaybackError';
    this.kind = kind;
    this.detail = detail;
  }
}

export interface EngineListener {
  /** The audio or subtitle track list, or the active track, changed. */
  tracks(): void;
  /** Cues of the stream's own subtitle track `trackId`, as they arrive. */
  cues(trackId: string, cues: Cue[]): void;
  /** A failure the engine could not recover from. The player fails over or explains. */
  fatal(error: PlaybackError): void;
}

/**
 * One way of getting a stream into the video element: the TV's own player,
 * hls.js or Shaka. The player keeps one video element and swaps engines.
 */
export interface Engine {
  readonly name: 'native' | 'hls.js' | 'shaka';
  /** Starts loading at `startAt` seconds (0 for the beginning). Rejects when it cannot start at all. */
  load(url: string, startAt: number): Promise<void>;
  audioTracks(): EngineTrack[];
  selectAudio(id: string): void;
  /** Subtitles carried by the stream (HLS or DASH renditions). Cues arrive through the listener. */
  textTracks(): EngineTrack[];
  selectText(id: string | null): void;
  /**
   * Stops loading, detaches from the video element and frees the decoder.
   * Shaka finishes later, so the player waits before attaching another engine.
   */
  destroy(): void | Promise<void>;
}

export type EngineFactory = (video: HTMLVideoElement, listener: EngineListener) => Engine;

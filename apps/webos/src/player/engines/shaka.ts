import type { Cue, CueLine, CueSpan } from '@bannertv/core';
import type shakaNs from 'shaka-player/dist/shaka-player.dash';
import { resetVideo } from './native';
import {
  type Engine,
  type EngineFactory,
  type EngineListener,
  PlaybackError,
  type PlaybackErrorKind,
} from './types';
import { loadVendorScript } from './vendor';

declare global {
  interface Window {
    shaka?: typeof shakaNs;
  }
}

type ShakaPlayer = shakaNs.Player;
type ShakaCue = shakaNs.text.Cue;
type ShakaError = { severity: number; category: number; code: number };

const CRITICAL = 2;
const NETWORK = 1;
const MEDIA = 3;
/** Codes for content the TV's decoders cannot take (Shaka's own list: 4012, 4032, 4036). */
const FORMAT_CODES = [4012, 4032, 4036];
/** LOAD_INTERRUPTED and OBJECT_DESTROYED: BannerTV stopped it, nothing went wrong. */
const IGNORED_CODES = [7000, 7003];

let polyfilled = false;

function loadShaka(): Promise<typeof shakaNs> {
  return loadVendorScript('shaka').then(
    () => {
      const shaka = window.shaka;
      if (!shaka) throw new PlaybackError('other', 'The DASH player could not be loaded');
      if (!polyfilled) {
        shaka.polyfill.installAll();
        polyfilled = true;
      }
      if (!shaka.Player.isBrowserSupported()) {
        throw new PlaybackError('format', 'This TV cannot run the DASH player');
      }
      return shaka;
    },
    () => {
      throw new PlaybackError('other', 'The DASH player could not be loaded');
    },
  );
}

/** Flattens Shaka's nested cues into lines of styled spans. */
function toCue(cue: ShakaCue): Cue | undefined {
  const lines: CueLine[] = [[]];
  const walk = (node: ShakaCue, style: Omit<CueSpan, 'text'>) => {
    const own: Omit<CueSpan, 'text'> = {
      italic: style.italic || node.fontStyle === 'italic' || undefined,
      bold: style.bold || Number(node.fontWeight) >= 700 || undefined,
      underline:
        style.underline ||
        (Array.isArray(node.textDecoration) &&
          (node.textDecoration as string[]).indexOf('underline') !== -1) ||
        undefined,
    };
    if (node.lineBreak) {
      lines.push([]);
      return;
    }
    if (node.payload) {
      node.payload.split('\n').forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1]!.push({ text: part, ...own });
      });
    }
    node.nestedCues.forEach((child) => walk(child, own));
  };
  walk(cue, {});
  const kept = lines.filter((line) => line.some((span) => span.text.trim() !== ''));
  if (kept.length === 0 || !(cue.endTime > cue.startTime)) return undefined;
  return { start: cue.startTime, end: cue.endTime, lines: kept };
}

/** Hands Shaka's subtitle cues to BannerTV's own layer instead of drawing them. */
class CueHandoff implements shakaNs.extern.TextDisplayer {
  private visible = true;

  constructor(private readonly deliver: (cues: Cue[]) => void) {}

  append(cues: ShakaCue[]) {
    const converted = cues.map(toCue).filter((cue): cue is Cue => !!cue);
    if (converted.length > 0) this.deliver(converted);
  }

  configure() {}

  remove() {
    return true;
  }

  isTextVisible() {
    return this.visible;
  }

  setTextVisibility(on: boolean) {
    this.visible = on;
  }

  setTextLanguage() {}

  destroy() {
    return Promise.resolve();
  }
}

function describe(error: ShakaError): PlaybackError {
  let kind: PlaybackErrorKind = 'other';
  if (FORMAT_CODES.indexOf(error.code) !== -1) kind = 'format';
  else if (error.category === NETWORK) kind = 'network';
  else if (error.category === MEDIA) kind = 'decode';
  return new PlaybackError(kind, 'The DASH stream failed', `shaka ${error.code}`);
}

function report(listener: EngineListener, error: unknown) {
  const shakaError = error as Partial<ShakaError> | null;
  if (!shakaError || typeof shakaError.code !== 'number') {
    listener.fatal(new PlaybackError('other', String(error)));
    return;
  }
  if (IGNORED_CODES.indexOf(shakaError.code) !== -1) return;
  if (shakaError.severity !== CRITICAL) return;
  listener.fatal(describe(shakaError as ShakaError));
}

/**
 * Shaka Player 5 over Media Source Extensions, for DASH. Shaka 4 differs in
 * text track selection and preferences, so it is not a drop-in swap.
 */
export const createShakaEngine: EngineFactory = (video, listener) => {
  let player: ShakaPlayer | null = null;
  // Set by destroy(), so a load still waiting for Shaka never starts a player afterwards.
  let stopped = false;

  async function teardown() {
    const instance = player;
    player = null;
    if (instance) await instance.destroy().catch(() => undefined);
    resetVideo(video);
  }

  const engine: Engine = {
    name: 'shaka',

    async load(url, startAt) {
      const shaka = await loadShaka();
      if (stopped) return;
      await teardown();
      if (stopped) return;
      const instance = new shaka.Player();
      player = instance;
      await instance.attach(video);
      if (player !== instance) return;
      const activeText = () => instance.getTextTracks().find((track) => track.active);
      instance.configure({
        // Shaka's forward buffer is already small; keep less behind, for TVs
        // with 1.5 GB shared by everything.
        streaming: { bufferBehind: 10 },
        textDisplayFactory: () =>
          new CueHandoff((cues) => {
            const track = activeText();
            if (track) listener.cues(String(track.id), cues);
          }),
      });
      instance.addEventListener('error', (event) =>
        report(listener, (event as unknown as { detail: unknown }).detail),
      );
      const tracksChanged = () => listener.tracks();
      ['trackschanged', 'variantchanged', 'textchanged', 'audiotrackschanged'].forEach((type) =>
        instance.addEventListener(type, tracksChanged),
      );
      try {
        await instance.load(url, startAt > 0 ? startAt : undefined);
      } catch (error) {
        if (player === instance) report(listener, error);
        return;
      }
      if (player !== instance) return;
      video.play().catch(() => undefined);
    },

    audioTracks() {
      if (!player) return [];
      // Shaka leaves AudioTrack.id empty, so the position in this list is the id.
      return player.getAudioTracks().map((track, index) => ({
        id: String(index),
        lang: track.language,
        label: track.label ?? '',
        active: track.active,
      }));
    },

    selectAudio(id) {
      const track = player?.getAudioTracks()[Number(id)];
      if (player && track) player.selectAudioTrack(track);
    },

    textTracks() {
      if (!player) return [];
      return player.getTextTracks().map((track) => ({
        id: String(track.id),
        lang: track.language,
        label: track.label ?? '',
        active: track.active,
      }));
    },

    selectText(id) {
      if (!player) return;
      const track = id === null ? null : player.getTextTracks().find((t) => String(t.id) === id);
      player.selectTextTrack(track ?? null);
    },

    async destroy() {
      stopped = true;
      await teardown();
    },
  };
  return engine;
};

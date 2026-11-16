import { type Cue, parseCueMarkup } from '@bannertv/core';
import type { Stream } from '@bannertv/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AndroidCue, AndroidPlayerCommand, AndroidPlayerEvent } from '../../platform/android';
import { noteRequestHeaders } from '../request-headers';
import { createAndroidEngine, followCues, MAX_CUES, toEngineTrack } from './android';
import type { PlaybackError } from './types';

const bridge = vi.hoisted(() => ({
  commands: [] as AndroidPlayerCommand[],
  listeners: new Set<(event: AndroidPlayerEvent) => void>(),
}));

vi.mock('../../platform/android', () => ({
  sendPlayerCommand: (command: AndroidPlayerCommand) => bridge.commands.push(command),
  onAndroidPlayer: (listener: (event: AndroidPlayerEvent) => void) => {
    bridge.listeners.add(listener);
    return () => bridge.listeners.delete(listener);
  },
}));

/** A media element as the page has it with nothing loaded: Android's engine fills it in. */
class FakeVideo extends EventTarget {
  style = { background: '' };
  get paused() {
    return true;
  }
  get currentTime() {
    return 0;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

const classes = new Set<string>();

function lastCommand() {
  return bridge.commands[bridge.commands.length - 1];
}

function send(event: AndroidPlayerEvent) {
  bridge.listeners.forEach((listener) => listener(event));
}

function state(change: Partial<Extract<AndroidPlayerEvent, { event: 'state' }>> = {}) {
  send({
    type: 'player',
    event: 'state',
    playWhenReady: true,
    playing: true,
    buffering: false,
    ready: true,
    ended: false,
    position: 0,
    duration: 5400,
    live: false,
    ...change,
  });
}

function open(url = 'https://media.example.com/film.mkv', startAt = 0) {
  const video = new FakeVideo();
  const events: string[] = [];
  for (const type of ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended']) {
    video.addEventListener(type, () => events.push(type));
  }
  const fatal = vi.fn<(error: PlaybackError) => void>();
  const tracks = vi.fn();
  const cues = vi.fn<(trackId: string, cues: Cue[], replace?: boolean) => void>();
  const engine = createAndroidEngine(video as unknown as HTMLVideoElement, {
    tracks,
    cues,
    fatal,
  });
  void engine.load(url, startAt);
  const element = video as unknown as HTMLVideoElement;
  return { video, element, engine, events, fatal, tracks, cues };
}

/** Android hands over the lines that show from `at` on subtitle track `track`. */
function cuesAt(at: number, lines: AndroidCue[], track = '2:0') {
  send({ type: 'player', event: 'cues', track, at, cues: lines });
}

/** A line as the page draws it: open until the next group closes it. */
function line(start: number, end: number, text: string, top?: true): Cue {
  return { start, end, lines: parseCueMarkup(text), ...(top ? { top } : {}) };
}

/** Opens a film whose English subtitles inside the file are chosen. */
function withSubtitles() {
  const opened = open();
  send({
    type: 'player',
    event: 'tracks',
    audio: [],
    text: [
      {
        id: '2:0',
        lang: 'en',
        label: '',
        active: false,
        supported: true,
        mime: 'application/x-subrip',
      },
      { id: '2:1', lang: 'fr', label: '', active: false, supported: true, mime: 'text/vtt' },
    ],
  });
  opened.engine.selectText('2:0');
  return opened;
}

beforeEach(() => {
  vi.useFakeTimers();
  bridge.commands = [];
  bridge.listeners.clear();
  classes.clear();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  });
  vi.stubGlobal('HTMLMediaElement', { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_ENOUGH_DATA: 4 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Android's engine", () => {
  it('asks Android to open the link where playback starts, and clears the page over it', () => {
    const { video } = open('https://media.example.com/film.mkv?token=1', 1200);
    expect(bridge.commands).toEqual([
      {
        op: 'load',
        id: expect.any(Number),
        url: 'https://media.example.com/film.mkv?token=1',
        startAt: 1200,
        mime: '',
      },
    ]);
    expect(classes.has('android-video')).toBe(true);
    expect(video.style.background).toBe('transparent');
  });

  it('names HLS and DASH, which Android cannot tell from a link without an extension', () => {
    open('https://media.example.com/live/master.m3u8');
    open('https://media.example.com/film/manifest.mpd');
    expect(bridge.commands.map((command) => command.op === 'load' && command.mime)).toEqual([
      'application/vnd.apple.mpegurl',
      'application/dash+xml',
    ]);
  });

  it('plays as Android says: play, then playing once the picture moves', () => {
    const { element, events } = open();
    expect(element.paused).toBe(true);
    expect(element.readyState).toBe(0);
    state({ playing: false, buffering: true, ready: false, duration: null });
    // As a browser does for a video told to play before it has any data.
    expect(events).toEqual(['play', 'waiting']);
    expect(element.paused).toBe(false);
    expect(element.duration).toBeNaN();
    state({ position: 1 });
    expect(events).toEqual(['play', 'waiting', 'playing']);
    expect(element.readyState).toBe(4);
    expect(element.duration).toBe(5400);
  });

  it('runs the clock between Android readings, and stops it on pause', () => {
    const { element } = open();
    state({ position: 100 });
    vi.advanceTimersByTime(500);
    expect(element.currentTime).toBeCloseTo(100.5, 1);
    element.pause();
    const stopped = element.currentTime;
    vi.advanceTimersByTime(1000);
    expect(element.currentTime).toBe(stopped);
  });

  it("keeps the viewer's pause over Android news sent before it, then follows Android again", () => {
    const { element, events } = open();
    state();
    events.length = 0;
    element.pause();
    expect(lastCommand()).toEqual({ op: 'pause' });
    expect(element.paused).toBe(true);
    // Sent by Android before the pause reached it.
    state({ position: 3 });
    expect(element.paused).toBe(true);
    vi.advanceTimersByTime(0);
    expect(events).toEqual(['pause']);
    state({ playWhenReady: false, playing: false, position: 3 });
    // Later Android plays on by itself (a remote's own play key, audio focus back).
    state({ position: 3 });
    expect(element.paused).toBe(false);
    expect(events).toEqual(['pause', 'play', 'playing']);
  });

  it('tells the page when Android pauses by itself', () => {
    const { element, events } = open();
    state();
    state({ playWhenReady: false, playing: false });
    expect(element.paused).toBe(true);
    expect(events).toEqual(['play', 'playing', 'pause']);
  });

  it('seeks through Android and holds the clock at the target until Android has moved', () => {
    const { element, events } = open();
    state({ position: 10 });
    element.currentTime = 600;
    expect(lastCommand()).toEqual({ op: 'seek', position: 600 });
    expect(element.seeking).toBe(true);
    // A reading from before the seek does not pull the clock back.
    send({ type: 'player', event: 'time', position: 11, duration: 5400 });
    expect(element.currentTime).toBe(600);
    vi.advanceTimersByTime(0);
    send({ type: 'player', event: 'seeked', position: 600 });
    expect(element.seeking).toBe(false);
    expect(events).toEqual(['play', 'playing', 'seeking', 'seeked']);
  });

  it('ignores news about the stream it played before', () => {
    const { engine, element, events, fatal } = open();
    state({ position: 30 });
    const first = (bridge.commands[0] as { id: number }).id;
    void engine.load('https://media.example.com/other.mkv', 0);
    const second = (lastCommand() as { id: number }).id;
    expect(second).toBeGreaterThan(first);
    events.length = 0;
    // Sent before Android had the new load: the old film ended, and failed.
    state({ ended: true, playing: false, position: 5400, load: first });
    send({ type: 'player', event: 'error', kind: 'decode', message: 'Old', load: first });
    expect(events).toEqual([]);
    expect(fatal).not.toHaveBeenCalled();
    expect(element.currentTime).toBe(0);
    state({ position: 1, load: second });
    expect(events).toEqual(['play', 'playing']);
  });

  it('lets go of a seek Android never confirms', () => {
    const { element } = open();
    state();
    element.currentTime = 60;
    vi.advanceTimersByTime(5000);
    expect(element.seeking).toBe(false);
  });

  it('reports a live stream: no length, and nothing to resume', () => {
    const { element, engine } = open('https://media.example.com/live/master.m3u8');
    state({ duration: -1, live: true });
    expect(element.duration).toBe(Infinity);
    expect(engine.isLive()).toBe(true);
  });

  it('takes no stream for a broadcast until Android has read it', () => {
    const { element, engine } = open();
    // Android's placeholder while a film opens: no length, and nothing known yet.
    state({ playing: false, buffering: true, ready: false, duration: -1, live: true });
    expect(engine.isLive()).toBe(false);
    state({ position: 1, duration: 5400 });
    expect(engine.isLive()).toBe(false);
    expect(element.duration).toBe(5400);
  });

  it('reads a file with no length in it as Infinity once Android plays it, as the TV does', () => {
    const { element, engine } = open();
    expect(element.duration).toBeNaN();
    state({ duration: null });
    expect(element.duration).toBe(Infinity);
    expect(engine.isLive()).toBe(false);
  });

  it('says it is waiting when the viewer plays on before Android has enough to show', () => {
    const { element, events } = open();
    state();
    state({ playing: false, buffering: true, position: 40 });
    element.pause();
    vi.advanceTimersByTime(0);
    state({ playWhenReady: false, playing: false, buffering: true, position: 40 });
    events.length = 0;
    void element.play();
    vi.advanceTimersByTime(0);
    expect(events).toEqual(['play', 'waiting']);
  });

  it('ends as a browser does: pause, then ended', () => {
    const { events } = open();
    state();
    state({ ended: true, playing: false, position: 5400 });
    expect(events).toEqual(['play', 'playing', 'pause', 'ended']);
  });

  it('lists the tracks the device can play, as the menus name them', () => {
    const { engine, tracks } = open();
    send({
      type: 'player',
      event: 'tracks',
      audio: [
        {
          id: '1:0',
          lang: 'en',
          label: '',
          active: true,
          supported: true,
          channels: 6,
          mime: 'audio/eac3',
          codecs: '',
        },
        {
          id: '1:1',
          lang: 'en',
          label: 'Director',
          active: false,
          supported: true,
          channels: 2,
          mime: 'audio/mp4a-latm',
          codecs: 'mp4a.40.2',
          commentary: true,
        },
        {
          id: '1:2',
          lang: 'en',
          label: '',
          active: false,
          supported: false,
          mime: 'audio/true-hd',
        },
      ],
      text: [
        { id: '2:0', lang: 'und', label: 'Forced', active: false, supported: true },
        { id: '2:1', lang: 'en', label: 'English', active: false, supported: true, forced: true },
        { id: '2:2', lang: 'en', label: 'English', active: false, supported: true },
      ],
    });
    expect(tracks).toHaveBeenCalledTimes(1);
    expect(engine.audioTracks()).toEqual([
      { id: '1:0', lang: 'en', label: '', active: true, channels: '5.1', format: 'DD+' },
      {
        id: '1:1',
        lang: 'en',
        label: 'Director',
        active: false,
        channels: '2.0',
        format: 'AAC',
        commentary: true,
      },
    ]);
    // Forced lines only, by the track's flag or its name.
    expect(engine.textTracks()).toEqual([
      { id: '2:0', lang: '', label: 'Forced', active: false, forced: true },
      { id: '2:1', lang: 'en', label: 'English', active: false, forced: true },
      { id: '2:2', lang: 'en', label: 'English', active: false },
    ]);

    engine.selectAudio('1:1');
    engine.selectText('2:0');
    // The page draws the subtitles inside the file: Android hands their lines over.
    expect(bridge.commands.slice(-2)).toEqual([
      { op: 'audio', id: '1:1' },
      { op: 'text', id: '2:0', cues: true },
    ]);
    expect(engine.audioTracks().find((track) => track.active)?.id).toBe('1:1');
    expect(engine.textTracks()[0]?.active).toBe(true);
    engine.selectText(null);
    expect(lastCommand()).toEqual({ op: 'text', id: null, cues: true });
  });

  it('names Atmos and keeps every track when Android can play none of them', () => {
    expect(
      toEngineTrack(
        { id: '1:0', lang: 'en', label: '', active: true, supported: true, mime: 'audio/eac3-joc' },
        true,
      ).format,
    ).toBe('Atmos');
    const { engine } = open();
    send({
      type: 'player',
      event: 'tracks',
      audio: [
        { id: '1:0', lang: 'fr', label: '', active: true, supported: false, mime: 'audio/vnd.dts' },
      ],
      text: [],
    });
    expect(engine.audioTracks()).toEqual([
      { id: '1:0', lang: 'fr', label: '', active: true, format: 'DTS' },
    ]);
  });

  it('tells picture subtitles from text by their type, or the type they had before Android read them', () => {
    const text = (mime?: string, codecs?: string) =>
      toEngineTrack(
        { id: '2:0', lang: 'en', label: '', active: false, supported: true, mime, codecs },
        false,
      ).picture;
    expect(text('application/pgs')).toBe(true);
    expect(text('application/x-media3-cues', 'application/vobsub')).toBe(true);
    expect(text('application/x-media3-cues', 'application/x-subrip')).toBe(false);
    expect(text('text/vtt')).toBe(false);
    // Read into Android's own cues with nothing said of what they were: unknown.
    expect(text('application/x-media3-cues')).toBeUndefined();
    expect(text()).toBeUndefined();
  });

  it("passes Android's failures on as the player's", () => {
    const { fatal } = open();
    send({
      type: 'player',
      event: 'error',
      kind: 'format',
      message: 'This device cannot play the file',
      detail: 'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED (4005)',
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]![0].kind).toBe('format');
    expect(fatal.mock.calls[0]![0].detail).toBe('ERROR_CODE_DECODING_FORMAT_UNSUPPORTED (4005)');
  });

  it('draws the lines inside the file as Android hands them over, each until the next', () => {
    const { cues } = withSubtitles();
    cuesAt(1, [{ text: '<i>Hello</i>' }]);
    expect(parseCueMarkup('<i>Hello</i>')).toEqual([[{ text: 'Hello', italic: true }]]);
    expect(cues).toHaveBeenLastCalledWith('2:0', [line(1, Infinity, '<i>Hello</i>')], true);
    // An empty group ends the line.
    cuesAt(3, []);
    expect(cues).toHaveBeenLastCalledWith('2:0', [line(1, 3, '<i>Hello</i>')], true);
    // Two lines at once, one at the top; text Android escaped reads as text.
    cuesAt(4, [{ text: 'Tom &amp; Jerry &lt;3\nsecond line' }, { text: 'SIGN', top: true }]);
    const shown = cues.mock.lastCall![1];
    expect(shown).toEqual([
      line(1, 3, '<i>Hello</i>'),
      line(4, Infinity, 'Tom &amp; Jerry &lt;3\nsecond line'),
      line(4, Infinity, 'SIGN', true),
    ]);
    expect(shown[1]!.lines.map((spans) => spans.map((span) => span.text).join(''))).toEqual([
      'Tom & Jerry <3',
      'second line',
    ]);
    // The next group closes both, and a line that changes at once replaces the one before.
    cuesAt(6, [{ text: 'Next' }]);
    cuesAt(6, [{ text: 'Next, fixed' }]);
    expect(cues.mock.lastCall![1]).toEqual([
      line(1, 3, '<i>Hello</i>'),
      line(4, 6, 'Tom &amp; Jerry &lt;3\nsecond line'),
      line(4, 6, 'SIGN', true),
      line(6, Infinity, 'Next, fixed'),
    ]);
  });

  it("ignores lines for a track that is not the one chosen, and forgets the last one's", () => {
    const { engine, cues } = withSubtitles();
    cuesAt(1, [{ text: 'French' }], '2:1');
    expect(cues).not.toHaveBeenCalled();
    cuesAt(1, [{ text: 'English' }]);
    expect(cues).toHaveBeenCalledTimes(1);

    // Another track: the English lines go, and its own come in.
    engine.selectText('2:1');
    expect(cues).toHaveBeenLastCalledWith('2:0', [], true);
    cuesAt(2, [{ text: 'English, sent late' }]);
    cuesAt(2, [{ text: 'Français' }], '2:1');
    expect(cues).toHaveBeenLastCalledWith('2:1', [line(2, Infinity, 'Français')], true);
    // Choosing it again changes nothing.
    const calls = cues.mock.calls.length;
    engine.selectText('2:1');
    expect(cues).toHaveBeenCalledTimes(calls);
    // Subtitles off: nothing more is drawn.
    engine.selectText(null);
    expect(cues).toHaveBeenLastCalledWith('2:1', [], true);
    cuesAt(3, [{ text: 'Français encore' }], '2:1');
    expect(cues).toHaveBeenLastCalledWith('2:1', [], true);
  });

  it('starts the lines again after a jump, from the viewer or from Android', () => {
    const { element, cues } = withSubtitles();
    cuesAt(10, [{ text: 'Before the jump' }]);
    element.currentTime = 600;
    expect(cues).toHaveBeenLastCalledWith('2:0', [], true);
    cuesAt(600.5, [{ text: 'After it' }]);
    send({ type: 'player', event: 'seeked', position: 600 });
    expect(cues).toHaveBeenLastCalledWith('2:0', [], true);

    // A group timed before the last means the clock went back.
    cuesAt(601, [{ text: 'Later' }]);
    cuesAt(20, [{ text: 'Back again' }]);
    expect(cues).toHaveBeenLastCalledWith('2:0', [line(20, Infinity, 'Back again')], true);
  });

  it('takes no lines for a new stream until subtitles are chosen for it', () => {
    const { engine, cues } = withSubtitles();
    void engine.load('https://media.example.com/other.mkv', 0);
    cuesAt(1, [{ text: 'From the last film' }]);
    expect(cues).not.toHaveBeenCalled();
    engine.selectText('2:0');
    cuesAt(1, [{ text: 'This film' }]);
    expect(cues).toHaveBeenLastCalledWith('2:0', [line(1, Infinity, 'This film')], true);
  });

  it('keeps the last lines only, and skips groups it cannot read', () => {
    let history: Cue[] = [];
    for (let i = 0; i < MAX_CUES + 10; i++)
      history = followCues(history, i, [{ text: `Line ${i}` }]);
    expect(history).toHaveLength(MAX_CUES);
    expect(history[0]!.start).toBe(10);
    expect(history[history.length - 1]).toEqual(
      line(MAX_CUES + 9, Infinity, `Line ${MAX_CUES + 9}`),
    );

    const { cues } = withSubtitles();
    send({ type: 'player', event: 'cues', track: '2:0', at: NaN, cues: [{ text: 'x' }] });
    send({
      type: 'player',
      event: 'cues',
      track: '2:0',
      at: 1,
      cues: [{ text: '' }, { text: 5 } as unknown as AndroidCue, { text: 'Kept' }],
    });
    expect(cues).toHaveBeenCalledTimes(1);
    expect(cues).toHaveBeenLastCalledWith('2:0', [line(1, Infinity, 'Kept')], true);
  });

  it('gives the element back as it was, and lets Android free the decoder', () => {
    const { video, element, engine, events } = open();
    state({ position: 42 });
    void engine.destroy();
    expect(lastCommand()).toEqual({ op: 'release' });
    expect(classes.has('android-video')).toBe(false);
    expect(video.style.background).toBe('');
    expect(element.paused).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(Object.keys(video)).not.toContain('currentTime');
    // News for the stream let go of changes nothing.
    events.length = 0;
    state({ playWhenReady: false, playing: false });
    expect(events).toEqual([]);
  });
});

describe("Android's engine and an addon's request headers", () => {
  it('sends the headers noted for a link with its load command, and none for other links', () => {
    noteRequestHeaders({
      source: { kind: 'url', url: 'https://live.example.com/match.m3u8' },
      behaviorHints: {
        proxyHeaders: { request: { Referer: 'https://site.example/', Range: 'bytes=0-' } },
      },
    } as unknown as Stream);
    open('https://live.example.com/match.m3u8');
    expect(lastCommand()).toMatchObject({
      op: 'load',
      headers: { Referer: 'https://site.example/' },
    });
    open('https://media.example.com/film.mkv');
    expect(lastCommand()).toMatchObject({ op: 'load' });
    expect(lastCommand()).not.toHaveProperty('headers');
  });
});

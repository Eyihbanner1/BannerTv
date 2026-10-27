import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeEngine } from './native';
import type { PlaybackError } from './types';

const tv = vi.hoisted(() => ({ webOS: true }));

vi.mock('../../platform/webos', () => ({ isWebOS: () => tv.webOS }));
vi.mock('../../platform/capabilities', () => ({ knownCapabilities: () => ({ uhd: false }) }));

class FakeSource extends EventTarget {
  src = '';
  type = '';
}

/** A video element that keeps its <source> children, and fails when told. */
class FakeVideo extends EventTarget {
  children: FakeSource[] = [];
  src = '';
  currentTime = 0;
  error: { code: number } | null = null;

  get firstChild() {
    return this.children[0] ?? null;
  }
  appendChild(child: FakeSource) {
    this.children.push(child);
  }
  removeChild(child: FakeSource) {
    this.children = this.children.filter((c) => c !== child);
  }
  removeAttribute() {}
  canPlayType = () => '';
  pause() {}
  load() {}
  play = () => Promise.resolve();
}

function open(startAt: number) {
  const video = new FakeVideo();
  const fatal = vi.fn<(error: PlaybackError) => void>();
  const engine = createNativeEngine(video as unknown as HTMLVideoElement, {
    tracks: () => undefined,
    cues: () => undefined,
    fatal,
  });
  void engine.load('https://media.example.com/film.mkv', startAt);
  return { video, fatal };
}

beforeEach(() => {
  tv.webOS = true;
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { createElement: () => new FakeSource() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the native engine', () => {
  it('reports a resume link that fails, which only its <source> hears about', () => {
    const { video, fatal } = open(120);
    expect(video.children).toHaveLength(1);
    video.children[0]!.dispatchEvent(new Event('error'));
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]![0].kind).toBe('network');
  });

  it('counts a link the TV could not open as a network failure, not a format it lacks', () => {
    tv.webOS = false;
    const { video, fatal } = open(0);
    video.error = { code: 4 };
    video.dispatchEvent(new Event('error'));
    expect(fatal.mock.calls[0]![0].kind).toBe('network');
  });
});

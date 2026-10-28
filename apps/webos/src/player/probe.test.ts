import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdProbes, probeStream } from './probe';

/** The parts of the hidden video element a link test uses; it reads metadata as soon as it loads. */
class FakeVideo extends EventTarget {
  muted = false;
  preload = '';
  style = { cssText: '' };
  src = '';
  loads: string[] = [];

  setAttribute() {}

  removeAttribute() {
    this.src = '';
  }

  load() {
    if (!this.src) return;
    this.loads.push(this.src);
    queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
  }
}

const element = new FakeVideo();

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', {
    createElement: () => element,
    body: { appendChild: () => undefined },
  });
  element.loads.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('link tests while the player is open', () => {
  it('are refused until the player lets go, then run again', async () => {
    const release = holdProbes();
    expect(await probeStream('https://media.example.com/a.mkv')).toBe('cancelled');
    expect(element.loads).toEqual([]);

    release();
    // Letting go twice must not free a hold another player still has.
    const other = holdProbes();
    release();
    expect(await probeStream('https://media.example.com/b.mkv')).toBe('cancelled');

    other();
    expect(await probeStream('https://media.example.com/c.mkv')).toBe('works');
    expect(element.loads).toEqual(['https://media.example.com/c.mkv']);
  });
});

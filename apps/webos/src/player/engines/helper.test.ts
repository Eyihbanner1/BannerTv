import { describe, expect, it, vi } from 'vitest';
import { HelperUnavailable } from '../../data/stream-helper';
import { type HelperLink, throughStreamHelper } from './helper';
import { type Engine, PlaybackError } from './types';

vi.mock('../request-headers', () => ({
  requestHeadersFor: (url: string) =>
    url.includes('needs-headers') ? { Referer: 'https://site.example/' } : undefined,
}));

function fakeEngine(): Engine & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    name: 'native',
    loaded,
    load: async (url) => {
      loaded.push(url);
    },
    isLive: () => true,
    liveWindow: () => null,
    audioTracks: () => [],
    selectAudio: () => undefined,
    textTracks: () => [],
    selectText: () => undefined,
    destroy: () => undefined,
  };
}

describe('through the stream helper', () => {
  it('plays streams that need headers from the helper link', async () => {
    const engine = fakeEngine();
    const link = vi.fn<HelperLink>(async () => 'http://192.168.1.42:47020/s/t/x/live.m3u8');
    await throughStreamHelper(engine, link).load('https://a.example/needs-headers.m3u8', 0);
    expect(link).toHaveBeenCalledWith('https://a.example/needs-headers.m3u8', {
      Referer: 'https://site.example/',
    });
    expect(engine.loaded).toEqual(['http://192.168.1.42:47020/s/t/x/live.m3u8']);
  });

  it('plays other streams as they are, without asking the helper', async () => {
    const engine = fakeEngine();
    const link = vi.fn<HelperLink>(async () => 'unused');
    const wrapped = throughStreamHelper(engine, link);
    await wrapped.load('https://a.example/film.mp4', 12);
    expect(link).not.toHaveBeenCalled();
    expect(engine.loaded).toEqual(['https://a.example/film.mp4']);
    expect(wrapped.name).toBe('native');
    expect(wrapped.isLive()).toBe(true);
    expect(wrapped.seeked).toBeUndefined();
  });

  it('fails as a network error that says why, when the helper is not there', async () => {
    const engine = fakeEngine();
    const wrapped = throughStreamHelper(engine, () =>
      Promise.reject(new HelperUnavailable('unpaired')),
    );
    const failure = await wrapped
      .load('https://a.example/needs-headers.m3u8', 0)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PlaybackError);
    expect((failure as PlaybackError).kind).toBe('network');
    expect((failure as PlaybackError).detail).toBe('stream-helper-unpaired');
    expect(engine.loaded).toEqual([]);
  });

  it("keeps the engine's seeked hook", () => {
    const engine = fakeEngine();
    const seeked = vi.fn();
    const wrapped = throughStreamHelper({ ...engine, seeked });
    wrapped.seeked?.();
    expect(seeked).toHaveBeenCalledTimes(1);
  });
});

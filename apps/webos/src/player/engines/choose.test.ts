import { describe, expect, it, vi } from 'vitest';
import { readLive } from './choose';

// Only the playlist reading is under test: none of the engines are opened.
vi.mock('../../platform/android', () => ({ isAndroid: () => false }));
vi.mock('./android', () => ({ createAndroidEngine: vi.fn() }));
vi.mock('./hls', () => ({ createHlsEngine: vi.fn() }));
vi.mock('./native', () => ({ createNativeEngine: vi.fn() }));
vi.mock('./shaka', () => ({ createShakaEngine: vi.fn() }));
vi.mock('./helper', () => ({ throughStreamHelper: vi.fn() }));

const URL_ = 'https://cdn.example.com/live/master.m3u8';

describe('reading whether an HLS playlist is live', () => {
  it('calls a media playlist with no end live, and one with an end not', () => {
    const segments =
      '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2.ts\n';
    expect(readLive(segments, URL_)).toBe(true);
    expect(readLive(`${segments}#EXT-X-ENDLIST\n`, URL_)).toBe(false);
  });

  it('points a multivariant playlist at its first variant, against its own address', () => {
    const master =
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh/index.m3u8\n';
    expect(readLive(master, URL_)).toEqual({
      variant: 'https://cdn.example.com/live/low/index.m3u8',
    });
  });

  it('knows nothing from a playlist with neither', () => {
    expect(readLive('#EXTM3U\n', URL_)).toBeNull();
  });
});

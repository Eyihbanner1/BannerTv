import type { Stream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { orderStreams, playableCandidates } from './order';
import type { StreamEntry, StreamFacts, TvCapabilities } from './types';

const GB = 1e9;
const MBIT = 1e6;
const TWO_HOURS = 2 * 3600;

const TV: TvCapabilities = {
  webOS: 22,
  uhd: true,
  hdr10: true,
  dolbyVision: false,
  hevc: true,
  av1: false,
  dts: false,
  truehd: false,
};

function entry(rank: number, facts: Partial<StreamFacts>): StreamEntry {
  return {
    stream: {
      source: { kind: 'url', url: `https://example.invalid/${rank}` },
      behaviorHints: {},
    } as unknown as Stream,
    addonId: 'addon',
    addonRank: 0,
    rank,
    facts: { hdr: [], audio: [], languages: [], ...facts },
    assessment: { action: { kind: 'play' }, warnings: [] },
  };
}

// A 4K remux of 60 GB (about 67 Mbit/s over two hours) and a 4K web release of 15 GB (about 17).
const remux = entry(0, {
  resolution: '2160p',
  releaseSource: 'REMUX',
  sizeBytes: 60 * GB,
  cached: true,
  service: 'TB',
});
const web = entry(1, {
  resolution: '2160p',
  releaseSource: 'WEB-DL',
  sizeBytes: 15 * GB,
  cached: true,
  service: 'TB',
});

describe('orderStreams, with a limit per debrid service', () => {
  it("judges a service's links by that service's limit", () => {
    // 70 Mbit/s played smoothly in general (from Real-Debrid), but TorBox is held to 40.
    const options = {
      maxBitrate: 70 * MBIT,
      maxBitrateFor: (service: string | undefined) => (service === 'TB' ? 40 * MBIT : 70 * MBIT),
      runtimeSeconds: TWO_HOURS,
    };
    expect(orderStreams([remux, web], 'quality', TV, options)).toEqual([web, remux]);
    expect(playableCandidates([remux, web], 'quality', TV, options)[0]).toBe(web);
  });

  it('keeps the general limit when no service limit is given', () => {
    const options = { maxBitrate: 70 * MBIT, runtimeSeconds: TWO_HOURS };
    expect(orderStreams([remux, web], 'quality', TV, options)).toEqual([remux, web]);
  });

  it('falls back to the general limit when the service limit is not a rate', () => {
    const options = {
      maxBitrate: 40 * MBIT,
      maxBitrateFor: () => undefined,
      runtimeSeconds: TWO_HOURS,
    };
    expect(orderStreams([remux, web], 'quality', TV, options)).toEqual([web, remux]);
  });
});

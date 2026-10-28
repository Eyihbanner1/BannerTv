import { assessStream, describeStream, type StreamEntry } from '@bannertv/core';
import { type MetaPreview, parseStream } from '@bannertv/protocol';
import { knownCapabilities } from '../platform/capabilities';
import type { LabSource } from './sources';

/** A Lab source as a stream the player can open, so its engines can be tried without an addon. */
export function labStream(source: LabSource, index: number): StreamEntry | undefined {
  const stream = parseStream({ url: source.url, name: 'Lab', description: source.label });
  if (!stream) return undefined;
  const facts = describeStream(stream);
  return {
    stream,
    addonId: 'lab',
    addonRank: 0,
    rank: index,
    facts,
    assessment: assessStream(stream, facts, knownCapabilities()),
  };
}

export function labPreview(source: LabSource, index: number): MetaPreview {
  return {
    id: `lab:${index}`,
    type: 'movie',
    name: source.label,
    posterShape: 'poster',
    genres: [],
    trailers: [],
  };
}

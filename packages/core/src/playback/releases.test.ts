import { parseStream } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore } from '../storage';
import { assessStream } from '../streams/assess';
import { describeStream } from '../streams/facts';
import type { StreamEntry, TvCapabilities } from '../streams/types';
import { bingeEntry } from './next';
import { createReleaseMemory, MAX_RELEASE_TITLES, releaseHint } from './releases';

const TV: TvCapabilities = {
  webOS: 22,
  uhd: true,
  hdr10: true,
  dolbyVision: false,
  hevc: true,
  av1: true,
  dts: false,
  truehd: false,
};

function entry(addonId: string, title: string, bingeGroup?: string, rank = 0): StreamEntry {
  const stream = parseStream({
    url: `https://cdn.example.org/${addonId}/${rank}.mkv?key=secret`,
    name: 'Addon\n1080p',
    title,
    ...(bingeGroup ? { behaviorHints: { bingeGroup } } : {}),
  })!;
  const facts = describeStream(stream);
  return {
    stream,
    addonId,
    addonRank: 0,
    rank,
    facts,
    assessment: assessStream(stream, facts, TV),
  };
}

describe('createReleaseMemory', () => {
  it('keeps the addon and the names of the release played, never its link', async () => {
    const storage = memoryKeyValueStore();
    const memory = createReleaseMemory({ storage });
    await memory.remember(
      'tt1',
      entry('torrentio', 'Show.S01E01.1080p.WEB-DL-FLUX', 'tio|1080p|FLUX'),
    );
    await memory.remember('tt2', entry('direct', 'Film.2024.1080p.BluRay-SPARKS'));
    // A stream that names no release is not one to find again.
    await memory.remember('tt3', entry('direct', 'Film'));
    expect(memory.get('tt1')).toEqual({
      metaId: 'tt1',
      addonId: 'torrentio',
      bingeGroup: 'tio|1080p|FLUX',
      releaseGroup: 'flux',
    });
    expect(memory.get('tt2')).toEqual({ metaId: 'tt2', addonId: 'direct', releaseGroup: 'sparks' });
    expect(memory.get('tt3')).toBeUndefined();
    expect(JSON.stringify(await storage.get('releaseChoices'))).not.toContain('secret');

    const again = createReleaseMemory({ storage });
    await again.load();
    expect(again.get('tt1')?.bingeGroup).toBe('tio|1080p|FLUX');
  });

  it('drops the least recently played titles past the limit, and damaged entries', async () => {
    const storage = memoryKeyValueStore();
    await storage.set('releaseChoices', [
      { metaId: 'old', addonId: 'a', bingeGroup: 'g' },
      { metaId: 'nameless', addonId: 'a' },
      { metaId: '', addonId: 'a', bingeGroup: 'g' },
      { metaId: 'twice', addonId: 'a', bingeGroup: 'first' },
      { metaId: 'twice', addonId: 'a', bingeGroup: 'second' },
    ]);
    const memory = createReleaseMemory({ storage });
    await memory.load();
    expect(memory.get('twice')?.bingeGroup).toBe('second');
    expect(memory.get('nameless')).toBeUndefined();
    for (let i = 0; i < MAX_RELEASE_TITLES; i++) {
      await memory.remember(`t${i}`, entry('a', 'Film.1080p-GRP', `g${i}`));
    }
    expect(memory.get('old')).toBeUndefined();
    expect(memory.get(`t${MAX_RELEASE_TITLES - 1}`)).toBeDefined();
  });
});

describe('a remembered release, found again', () => {
  const list = [
    entry('other', 'Show.S01E02.2160p.WEB-DL-FLUX', 'other|2160p|FLUX', 0),
    entry('torrentio', 'Show.S01E02.2160p.WEB-DL-NTb', 'tio|2160p|NTb', 1),
    entry('torrentio', 'Show.S01E02.720p.WEB-DL-FLUX', 'tio|720p|FLUX', 2),
    entry('torrentio', 'Show.S01E02.1080p.WEB-DL-FLUX', 'tio|1080p|FLUX', 3),
  ];

  it('takes the same binge group first, then the same group from the same addon', () => {
    const hint = releaseHint({
      metaId: 'tt1',
      addonId: 'torrentio',
      bingeGroup: 'tio|1080p|FLUX',
      releaseGroup: 'FLUX',
    })!;
    expect(bingeEntry(list, hint)?.rank).toBe(3);
    expect(bingeEntry(list.slice(0, 3), hint)?.rank).toBe(2);
    expect(bingeEntry(list.slice(0, 2), hint)).toBeUndefined();
    expect(releaseHint(undefined)).toBeUndefined();
  });

  it('leaves the binge rule of the next episode as it was: a group alone finds nothing', () => {
    expect(bingeEntry(list, { addonId: 'torrentio', bingeGroup: 'tio|480p|FLUX' })).toBeUndefined();
  });
});

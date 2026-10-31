import type { MetaDetail, Stream, StreamSource, Video } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { assessStream } from '../streams/assess';
import type { StreamAction, StreamEntry } from '../streams/types';
import { bingeEntry, bingeHint, findBingeStream, nextVideo } from './next';

const NOW = Date.parse('2026-06-01T00:00:00Z');

function series(videos: Video[]): MetaDetail {
  return {
    id: 'tt9',
    type: 'series',
    name: 'Show',
    posterShape: 'poster',
    genres: [],
    trailers: [],
    videos,
    cast: [],
    directors: [],
    writers: [],
    links: [],
    behaviorHints: { hasScheduledVideos: false },
  };
}

function ep(season: number, episode: number, released = '2020-01-01T00:00:00Z'): Video {
  return {
    id: `tt9:${season}:${episode}`,
    title: `S${season}E${episode}`,
    season,
    episode,
    released,
  };
}

function after(meta: MetaDetail, videoId: string, now = NOW): string | undefined {
  return nextVideo(meta, videoId, now)?.id;
}

describe('nextVideo', () => {
  // Listed out of order, as some addons do.
  const show = series([ep(2, 1), ep(1, 2), ep(0, 2), ep(1, 1), ep(2, 2), ep(0, 1), ep(1, 3)]);

  it('plays the next episode of the same season', () => {
    expect(after(show, 'tt9:1:1')).toBe('tt9:1:2');
    expect(after(show, 'tt9:1:2')).toBe('tt9:1:3');
  });

  it('crosses into the next season after the last episode', () => {
    expect(after(show, 'tt9:1:3')).toBe('tt9:2:1');
  });

  it('skips a season the addon does not list', () => {
    const gap = series([ep(1, 1), ep(3, 1)]);
    expect(after(gap, 'tt9:1:1')).toBe('tt9:3:1');
  });

  it('stops after the last episode', () => {
    expect(after(show, 'tt9:2:2')).toBeUndefined();
  });

  it('keeps specials among specials, and never leads from one into the story or back', () => {
    expect(after(show, 'tt9:0:1')).toBe('tt9:0:2');
    expect(after(show, 'tt9:0:2')).toBeUndefined();
    expect(after(series([ep(1, 1), ep(0, 1)]), 'tt9:1:1')).toBeUndefined();
  });

  it('gives nothing for a video the series does not have', () => {
    expect(after(show, 'tt9:9:9')).toBeUndefined();
    expect(after(series([]), 'tt9:1:1')).toBeUndefined();
  });

  it('does not offer an episode that has not aired, nor jump over it', () => {
    const airing = series([ep(1, 1), ep(1, 2, '2026-06-08T00:00:00Z'), ep(1, 3)]);
    expect(after(airing, 'tt9:1:1')).toBeUndefined();
    expect(after(airing, 'tt9:1:1', Date.parse('2026-06-08T00:00:00Z'))).toBe('tt9:1:2');
  });

  it('treats an episode with no date, or an unreadable one, as aired', () => {
    const undated = series([
      { id: 'a', title: 'A', season: 1, episode: 1 },
      { id: 'b', title: 'B', season: 1, episode: 2 },
      { id: 'c', title: 'C', season: 1, episode: 3, released: 'soon' },
    ]);
    expect(after(undated, 'a')).toBe('b');
    expect(after(undated, 'b')).toBe('c');
  });

  it('ignores a video listed twice', () => {
    const twice = series([ep(1, 1), ep(1, 2), ep(1, 1), ep(1, 2), ep(1, 3)]);
    expect(after(twice, 'tt9:1:1')).toBe('tt9:1:2');
    expect(after(twice, 'tt9:1:2')).toBe('tt9:1:3');
  });

  it('treats two entries for the same episode as one episode', () => {
    const copies = series([
      ep(1, 1),
      { ...ep(1, 2), id: 'copy-b' },
      { ...ep(1, 2), id: 'copy-a', released: '2019-12-31T00:00:00Z' },
      ep(1, 3),
    ]);
    expect(after(copies, 'tt9:1:1')).toBe('copy-a');
    expect(after(copies, 'copy-a')).toBe('tt9:1:3');
    expect(after(copies, 'copy-b')).toBe('tt9:1:3');
  });

  it('follows the listed order for videos without season and episode numbers', () => {
    const channel = series([
      { id: 'c', title: 'Third upload' },
      { id: 'a', title: 'First upload' },
      { id: 'a', title: 'First upload again' },
      { id: 'b', title: 'Second upload', released: '2026-07-01T00:00:00Z' },
      { id: 'd', title: 'Fourth upload' },
    ]);
    expect(after(channel, 'c')).toBe('a');
    expect(after(channel, 'a')).toBeUndefined();
    expect(after(channel, 'b')).toBe('d');
    expect(after(channel, 'd')).toBeUndefined();
  });

  it('orders a long season listed backwards', () => {
    const long: Video[] = [];
    for (let episode = 24; episode >= 1; episode--) long.push(ep(1, episode));
    const big = series(long);
    for (let episode = 1; episode < 24; episode++) {
      expect(after(big, `tt9:1:${episode}`)).toBe(`tt9:1:${episode + 1}`);
    }
    expect(after(big, 'tt9:1:24')).toBeUndefined();
  });
});

function stream(source: StreamSource, hints: Partial<Stream['behaviorHints']> = {}): Stream {
  return { source, subtitles: [], behaviorHints: { notWebReady: false, ...hints } };
}

describe('findBingeStream', () => {
  const url = (name: string): StreamSource => ({ kind: 'url', url: `https://cdn.example/${name}` });

  it('needs a binge group to look for', () => {
    const streams = [stream(url('a'), { bingeGroup: 'g' })];
    expect(findBingeStream(streams, undefined)).toBeUndefined();
    expect(findBingeStream(streams, '')).toBeUndefined();
  });

  it('picks the first stream of the group that the player can play by itself', () => {
    const wanted = stream(url('wanted'), { bingeGroup: 'addon|1080p' });
    const streams = [
      stream(url('other-group'), { bingeGroup: 'addon|720p' }),
      stream(url('no-group')),
      stream({ kind: 'torrent', infoHash: 'abc', trackers: [] }, { bingeGroup: 'addon|1080p' }),
      stream({ kind: 'youtube', ytId: 'x' }, { bingeGroup: 'addon|1080p' }),
      stream({ kind: 'external', url: 'https://x.example' }, { bingeGroup: 'addon|1080p' }),
      stream(url('proxied'), {
        bingeGroup: 'addon|1080p',
        proxyHeaders: { request: { Referer: 'https://x.example' }, response: {} },
      }),
      wanted,
      stream(url('later'), { bingeGroup: 'addon|1080p' }),
    ];
    expect(findBingeStream(streams, 'addon|1080p')).toBe(wanted);
  });

  it('gives nothing when no stream of the group plays', () => {
    const streams = [stream(url('a'), { bingeGroup: 'x' })];
    expect(findBingeStream(streams, 'y')).toBeUndefined();
    expect(findBingeStream([], 'y')).toBeUndefined();
  });
});

const link = (name: string): StreamSource => ({ kind: 'url', url: `https://cdn.example/${name}` });

function entry(
  addonId: string,
  name: string,
  hints: Partial<Stream['behaviorHints']> = {},
  action: StreamAction = { kind: 'play' },
): StreamEntry {
  return {
    stream: stream(link(name), hints),
    addonId,
    addonRank: 0,
    rank: 0,
    facts: { hdr: [], audio: [], languages: [] },
    assessment: { action, warnings: [] },
  };
}

describe('bingeHint', () => {
  it('names the addon and the release of the stream playing', () => {
    const playing = entry('torrentio', 'e1', { bingeGroup: 'torrentio|720p' });
    expect(bingeHint(playing)).toEqual({ addonId: 'torrentio', bingeGroup: 'torrentio|720p' });
  });

  it('never carries the link', () => {
    const playing = entry('torrentio', 'secret-key/e1', { bingeGroup: 'torrentio|720p' });
    const hint = bingeHint(playing)!;
    expect(Object.keys(hint).sort()).toEqual(['addonId', 'bingeGroup']);
    expect(JSON.stringify(hint)).not.toContain('secret-key');
  });

  it('gives nothing without a stream, or for a stream that names no release', () => {
    expect(bingeHint(null)).toBeUndefined();
    expect(bingeHint(undefined)).toBeUndefined();
    expect(bingeHint(entry('torrentio', 'e1'))).toBeUndefined();
    expect(bingeHint(entry('torrentio', 'e1', { bingeGroup: '' }))).toBeUndefined();
  });
});

describe('bingeEntry', () => {
  const hint = { addonId: 'torrentio', bingeGroup: 'torrentio|720p' };

  it("picks the same addon's stream of the same release, not another addon's", () => {
    const wanted = entry('torrentio', 'e2-720p', { bingeGroup: 'torrentio|720p' });
    const entries = [
      entry('other', 'e2-other', { bingeGroup: 'torrentio|720p' }),
      entry('torrentio', 'e2-1080p', { bingeGroup: 'torrentio|1080p' }),
      entry('torrentio', 'e2-plain'),
      wanted,
      entry('torrentio', 'e2-720p-later', { bingeGroup: 'torrentio|720p' }),
    ];
    expect(bingeEntry(entries, hint)).toBe(wanted);
  });

  it("passes over a stream of the release that can't play here for the next one that can", () => {
    const wanted = entry('torrentio', 'e2-b', { bingeGroup: 'torrentio|720p' });
    const entries = [
      entry(
        'torrentio',
        'e2-a',
        {
          bingeGroup: 'torrentio|720p',
          proxyHeaders: { request: { Referer: 'https://x.example' }, response: {} },
        },
        { kind: 'unavailable', reason: 'proxy-headers' },
      ),
      entry('torrentio', 'e2-c', { bingeGroup: 'torrentio|720p' }, { kind: 'external' }),
      wanted,
    ];
    expect(bingeEntry(entries, hint)).toBe(wanted);
  });

  it('leaves out a torrent of the release, which needs a streaming server', () => {
    const torrent: StreamEntry = {
      ...entry('torrentio', 'e2', { bingeGroup: 'torrentio|720p' }),
      stream: stream(
        { kind: 'torrent', infoHash: 'abc', trackers: [] },
        { bingeGroup: 'torrentio|720p' },
      ),
      assessment: { action: { kind: 'unavailable', reason: 'torrent' }, warnings: [] },
    };
    expect(bingeEntry([torrent], hint)).toBeUndefined();
  });

  it('takes the first in the order given, from either install of the addon', () => {
    const first = { ...entry('torrentio', 'e2-a', { bingeGroup: 'torrentio|720p' }), addonRank: 2 };
    const second = {
      ...entry('torrentio', 'e2-b', { bingeGroup: 'torrentio|720p' }),
      addonRank: 0,
    };
    expect(bingeEntry([first, second], hint)).toBe(first);
    expect(bingeEntry([second, first], hint)).toBe(second);
  });

  it('gives nothing when the release is not there, so the usual choice applies', () => {
    const entries = [
      entry('other', 'e2-other', { bingeGroup: 'torrentio|720p' }),
      entry('torrentio', 'e2-1080p', { bingeGroup: 'torrentio|1080p' }),
      entry('torrentio', 'e2-case', { bingeGroup: 'Torrentio|720p' }),
      entry('torrentio', 'e2-plain'),
    ];
    expect(bingeEntry(entries, hint)).toBeUndefined();
    expect(bingeEntry([], hint)).toBeUndefined();
  });

  it('gives nothing for a hint with no release named', () => {
    const entries = [entry('torrentio', 'e2'), entry('torrentio', 'e2-g', { bingeGroup: 'g' })];
    expect(bingeEntry(entries, { addonId: 'torrentio' })).toBeUndefined();
    expect(bingeEntry(entries, { addonId: 'torrentio', bingeGroup: '' })).toBeUndefined();
  });

  it('picks what the player picked for the next episode before, for streams as they are assessed', () => {
    // The pick PlayerScreen made before bingeEntry: the addon's first stream of the group, if it plays.
    const before = (entries: StreamEntry[], playing: StreamEntry) => {
      const same = entries.filter((e) => e.addonId === playing.addonId);
      const found = findBingeStream(
        same.map((e) => e.stream),
        playing.stream.behaviorHints.bingeGroup,
      );
      return same.find((e) => e.stream === found && e.assessment.action.kind === 'play');
    };
    const tv = {
      webOS: 22,
      uhd: true,
      hdr10: true,
      dolbyVision: false,
      hevc: true,
      av1: false,
      dts: false,
      truehd: false,
    };
    const assessed = (addonId: string, source: StreamSource, hints = {}): StreamEntry => {
      const facts = { hdr: [], audio: [], languages: [] };
      const s = stream(source, { bingeGroup: 'g', ...hints });
      return { ...entry(addonId, ''), stream: s, facts, assessment: assessStream(s, facts, tv) };
    };
    const headers = (request: Record<string, string>) => ({
      proxyHeaders: { request, response: { 'Content-Type': 'video/mp4' } },
    });
    const all = [
      assessed('other', link('other')),
      assessed('torrentio', { kind: 'torrent', infoHash: 'abc', trackers: [] }),
      assessed('torrentio', { kind: 'youtube', ytId: 'x' }),
      assessed('torrentio', { kind: 'external', url: 'https://x.example' }),
      assessed('torrentio', link('needs-headers'), headers({ Referer: 'https://x.example' })),
      assessed('torrentio', link('response-headers'), headers({})),
      assessed('torrentio', link('other-group'), { bingeGroup: 'h' }),
      assessed('torrentio', link('wanted')),
      assessed('torrentio', link('later')),
    ];
    const playing = assessed('torrentio', link('e1'));
    let found = 0;
    for (let from = 0; from < all.length; from++) {
      for (const entries of [all.slice(from), all.slice(from).reverse()]) {
        const picked = bingeEntry(entries, bingeHint(playing)!);
        expect(picked).toBe(before(entries, playing));
        if (picked) found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("carries the playing episode's release on to the next episode's streams", () => {
    const playing = entry('torrentio', 'e1-720p', { bingeGroup: 'torrentio|720p' });
    const next = [
      entry('torrentio', 'e2-1080p', { bingeGroup: 'torrentio|1080p' }),
      entry('torrentio', 'e2-720p', { bingeGroup: 'torrentio|720p' }),
    ];
    expect(bingeEntry(next, bingeHint(playing)!)).toBe(next[1]);
  });
});

import type { MetaDetail, Stream, StreamSource, Video } from '@bannertv/protocol';
import { describe, expect, it } from 'vitest';
import { findBingeStream, nextVideo } from './next';

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

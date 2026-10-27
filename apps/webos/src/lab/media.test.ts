import { describe, expect, it } from 'vitest';
import {
  buildMediaOptionType,
  describeMediaError,
  formatTime,
  guessMimeType,
  listTracks,
  type MediaTrackListLike,
  selectAudioTrack,
  selectTextTrack,
  trackName,
} from './media';

describe('guessMimeType', () => {
  it.each([
    ['https://example.com/a.mkv', 'video/x-matroska'],
    ['https://example.com/a.MP4?token=1', 'video/mp4'],
    ['https://example.com/master.m3u8#x', 'application/vnd.apple.mpegurl'],
    ['https://example.com/manifest.mpd', 'application/dash+xml'],
    ['https://example.com/a.webm', 'video/webm'],
    ['https://example.com/a.ts', 'video/mp2t'],
    ['https://example.com/play?id=42', 'video/mp4'],
  ])('%s is %s', (url, mime) => {
    expect(guessMimeType(url)).toBe(mime);
  });
});

describe('buildMediaOptionType', () => {
  it('appends the start position in milliseconds, URI-encoded', () => {
    const type = buildMediaOptionType('video/mp4', 30000);
    expect(type.startsWith('video/mp4;mediaOption=')).toBe(true);
    const json = decodeURI(type.slice('video/mp4;mediaOption='.length));
    expect(JSON.parse(json)).toEqual({ option: { transmission: { playTime: { start: 30000 } } } });
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [65.4, '1:05'],
    [3725, '1:02:05'],
    [Number.NaN, '--:--'],
    [Number.POSITIVE_INFINITY, '--:--'],
  ])('%f seconds is %s', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});

describe('describeMediaError', () => {
  it('names the spec error codes', () => {
    expect(describeMediaError(3)).toBe('decode');
    expect(describeMediaError(4)).toBe('source not supported');
    expect(describeMediaError(9)).toBe('code 9');
  });
});

describe('listTracks', () => {
  it('reads an audio track list', () => {
    const list: MediaTrackListLike = {
      length: 2,
      0: { id: 'a', kind: 'main', label: 'Stereo', language: 'eng', enabled: true },
      1: { id: 'b', kind: 'translation', label: '', language: 'fre', enabled: false },
    };
    const tracks = listTracks(list, (track) => track.enabled === true);
    expect(tracks).toEqual([
      { index: 0, label: 'Stereo', language: 'eng', kind: 'main', active: true },
      { index: 1, label: '', language: 'fre', kind: 'translation', active: false },
    ]);
    expect(tracks.map(trackName)).toEqual(['1: eng · Stereo', '2: fre']);
  });

  it('returns nothing when the engine has no track list', () => {
    expect(listTracks(undefined, () => true)).toEqual([]);
  });
});

describe('selectAudioTrack and selectTextTrack', () => {
  it('enables exactly one audio track', () => {
    const list: MediaTrackListLike = {
      length: 2,
      0: { id: 'a', kind: 'main', label: '', language: 'eng', enabled: true },
      1: { id: 'b', kind: 'main', label: '', language: 'fre', enabled: false },
    };
    selectAudioTrack(list, 1);
    expect([list[0]!.enabled, list[1]!.enabled]).toEqual([false, true]);
  });

  it('shows one text track or none', () => {
    const list = {
      length: 2,
      0: { mode: 'disabled' as TextTrackMode },
      1: { mode: 'showing' as TextTrackMode },
    };
    selectTextTrack(list, 0);
    expect([list[0].mode, list[1].mode]).toEqual(['showing', 'disabled']);
    selectTextTrack(list, null);
    expect([list[0].mode, list[1].mode]).toEqual(['disabled', 'disabled']);
  });
});

import { describe, expect, it } from 'vitest';
import { videoSource } from './video-source';

const URL = 'https://live.example.org/match.m3u8';

describe('videoSource', () => {
  it('opens a link with no headers as the address alone', () => {
    expect(videoSource(URL, 'hls', undefined)).toEqual({ uri: URL, contentType: 'hls' });
    expect(videoSource(URL, 'auto', {})).toEqual({ uri: URL, contentType: 'auto' });
  });

  it("passes the addon's headers, and its User-Agent under the spelling expo-video reads", () => {
    expect(
      videoSource(URL, 'hls', {
        Referer: 'https://site.example/',
        Origin: 'https://site.example',
        'user-agent': 'Agent/1.0',
      }),
    ).toEqual({
      uri: URL,
      contentType: 'hls',
      headers: {
        Referer: 'https://site.example/',
        Origin: 'https://site.example',
        'User-Agent': 'Agent/1.0',
      },
    });
  });

  it('drops values OkHttp would refuse, and anything that is not text', () => {
    expect(
      videoSource(URL, 'auto', { Referer: 'https://café.example/', Cookie: 7, 'X-Token': 'abc' }),
    ).toEqual({ uri: URL, contentType: 'auto', headers: { 'X-Token': 'abc' } });
    expect(videoSource(URL, 'auto', { Referer: 'https://café.example/' })).toEqual({
      uri: URL,
      contentType: 'auto',
    });
  });
});

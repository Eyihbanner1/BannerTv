import { describe, expect, it } from 'vitest';
import {
  BACKGROUND,
  backgroundFilter,
  chooseFrames,
  coverBox,
  frameScore,
  parseCrop,
  POSTER,
  posterFilter,
} from './art.mjs';
import {
  CHECK_SHOWN_SECONDS,
  CHECK_TRACKS,
  checkCaptions,
  checkTimes,
  vttTime,
} from './captions.mjs';
import { checkFilms, loadFilms, mediaPath } from './films.mjs';
import { FFMPEG_MASTER, ladderArgs, RUNGS, rungCodecs, SEGMENT_SECONDS } from './ladder.mjs';
import {
  checkAligned,
  cleanMediaPlaylist,
  masterPlaylist,
  measureVariant,
  readMediaPlaylist,
} from './playlists.mjs';

/** A media playlist as ffmpeg 6 writes it for a VOD with 4-second segments. */
function mediaPlaylist(durations, extra = []) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durations))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    ...extra,
    ...durations.flatMap((duration, index) => [
      `#EXTINF:${duration.toFixed(6)},`,
      `${String(index).padStart(5, '0')}.ts`,
    ]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}

describe('the HLS ladder', () => {
  it('starts low enough for LG’s 512 kbps check and stays in level 4.0', () => {
    const [lowest] = RUNGS;
    // Video peak plus audio plus about 12% MPEG-TS overhead, well under 512 kbps.
    expect((lowest.maxKbps + lowest.audioKbps) * 1.12).toBeLessThan(450);
    for (const rung of RUNGS) {
      expect(Number(rung.level)).toBeLessThanOrEqual(4);
      expect(rung.width / rung.height).toBeCloseTo(16 / 9, 2);
      expect((rung.width % 2) + (rung.height % 2)).toBe(0);
    }
    // Even with every segment at its capped peak, each of LG's four speeds has a different
    // rung that leaves a fifth of the link spare, so the picture visibly changes and nothing
    // plays at the edge.
    const top = (kbps) =>
      RUNGS.filter((rung) => (rung.maxKbps + rung.audioKbps) * 1.12 < kbps * 0.8).at(-1)?.name;
    expect([512, 1000, 7000, 17500].map(top)).toEqual(['288p', '360p', '720p', '1080p']);
    expect(RUNGS.map((rung) => rung.videoKbps)).toEqual(
      [...RUNGS.map((rung) => rung.videoKbps)].sort((a, b) => a - b),
    );
  });

  it('names the codecs as the master playlist needs them', () => {
    expect(RUNGS.map(rungCodecs)).toEqual([
      'avc1.64001e,mp4a.40.2',
      'avc1.64001e,mp4a.40.2',
      'avc1.64001f,mp4a.40.2',
      'avc1.64001f,mp4a.40.2',
      'avc1.640028,mp4a.40.2',
    ]);
  });

  it('encodes every rung in one pass with fixed, closed GOPs', () => {
    const args = ladderArgs({ input: 'C:\\Films\\wing it.mp4', outDir: 'C:\\out\\wing-it\\v1\\' });
    const value = (name) => args[args.indexOf(name) + 1];
    expect(value('-i')).toBe('C:\\Films\\wing it.mp4');
    expect(value('-g')).toBe('48');
    expect(value('-keyint_min')).toBe('48');
    expect(value('-sc_threshold')).toBe('0');
    expect(value('-x264-params')).toBe('open-gop=0:scenecut=0');
    expect(value('-hls_time')).toBe(String(SEGMENT_SECONDS));
    expect(value('-hls_segment_type')).toBe('mpegts');
    expect(value('-hls_segment_filename')).toBe('C:/out/wing-it/v1/%v/%05d.ts');
    expect(value('-master_pl_name')).toBe(FFMPEG_MASTER);
    expect(args.at(-1)).toBe('C:/out/wing-it/v1/%v/index.m3u8');
    expect(value('-var_stream_map')).toBe(
      'v:0,a:0,name:288p v:1,a:1,name:360p v:2,a:2,name:540p v:3,a:3,name:720p v:4,a:4,name:1080p',
    );
    expect(value('-filter_complex')).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1');
    expect(value('-filter_complex')).toContain('[s0]scale=512:288:flags=lanczos[v0]');
    expect(value('-filter_complex')).toContain('[s4]null[v4]');
    expect(value('-b:v:0')).toBe('200k');
    expect(value('-maxrate:v:4')).toBe('6000k');
    expect(value('-b:a:0')).toBe('64k');
    expect(args.filter((arg) => arg === '-map')).toHaveLength(RUNGS.length * 2);
    expect(args.every((arg) => typeof arg === 'string')).toBe(true);
  });

  it('follows the film’s frame rate for the GOP', () => {
    const args = ladderArgs({ input: 'a.mov', outDir: 'out', fps: 25 });
    expect(args[args.indexOf('-g') + 1]).toBe('50');
    expect(args[args.indexOf('-filter_complex') + 1]).toMatch(/^\[0:v:0\]fps=25,/);
  });
});

describe('playlists', () => {
  it('reads segments and refuses playlists the demo should never have', () => {
    const text = mediaPlaylist([4, 4, 1.5]);
    expect(readMediaPlaylist(text).segments).toEqual([
      { uri: '00000.ts', duration: 4 },
      { uri: '00001.ts', duration: 4 },
      { uri: '00002.ts', duration: 1.5 },
    ]);
    expect(() => readMediaPlaylist(text.replace('#EXT-X-ENDLIST', ''))).toThrow(/ENDLIST/);
    expect(() => readMediaPlaylist(text.replace('00001.ts', '../00001.ts'))).toThrow(/relative/);
    expect(() => readMediaPlaylist(text.replace('00001.ts', 'https://x/1.ts'))).toThrow(/relative/);
    expect(() => readMediaPlaylist(mediaPlaylist([4], ['#EXT-X-DISCONTINUITY']))).toThrow();
    expect(() => readMediaPlaylist('not a playlist')).toThrow(/M3U8/);
  });

  it('measures peak and average bitrates from the segment sizes', () => {
    const sizes = { '00000.ts': 100_000, '00001.ts': 150_000, '00002.ts': 90_000 };
    const measured = measureVariant(mediaPlaylist([4, 4, 0.5]), (uri) => sizes[uri]);
    // The short last segment says little about the peak, so it is left out of it.
    expect(measured.peak).toBe(300_000);
    expect(measured.average).toBe(Math.ceil((340_000 * 8) / 8.5));
    expect(measured.segments).toBe(3);
    expect(measured.largest).toBe(150_000);
  });

  it('refuses a segment much longer than the target duration', () => {
    const text = mediaPlaylist([4, 4]).replace(
      '#EXTINF:4.000000,\n00001.ts',
      '#EXTINF:9.0,\n00001.ts',
    );
    expect(() => measureVariant(text, () => 1000)).toThrow(/over the target/);
  });

  it('writes the master lowest first, with what LG’s player reads', () => {
    const text = masterPlaylist([
      {
        peak: 400_000,
        average: 300_000,
        codecs: 'avc1.64001e,mp4a.40.2',
        width: 512,
        height: 288,
        fps: 24,
        uri: '288p/index.m3u8',
      },
      {
        peak: 7_000_000,
        average: 5_000_000,
        codecs: 'avc1.640028,mp4a.40.2',
        width: 1920,
        height: 1080,
        fps: 24,
        uri: '1080p/index.m3u8',
      },
    ]);
    expect(text).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-STREAM-INF:BANDWIDTH=400000,AVERAGE-BANDWIDTH=300000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=512x288,FRAME-RATE=24.000',
        '288p/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=7000000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=24.000',
        '1080p/index.m3u8',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('INDEPENDENT-SEGMENTS');
  });

  it('drops tags LG’s native player does not support', () => {
    const text = cleanMediaPlaylist(
      mediaPlaylist([4], ['#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-ALLOW-CACHE:YES']) + '\n\n',
    );
    expect(text).not.toContain('INDEPENDENT-SEGMENTS');
    expect(text).not.toContain('ALLOW-CACHE');
    expect(text.endsWith('#EXT-X-ENDLIST\n')).toBe(true);
    expect(readMediaPlaylist(text).segments).toHaveLength(1);
  });

  it('checks every rung cuts its segments at the same times', () => {
    const a = { name: '288p', text: mediaPlaylist([4, 4, 2]) };
    expect(() =>
      checkAligned([a, { name: '1080p', text: mediaPlaylist([4, 4.02, 1.98]) }]),
    ).not.toThrow();
    expect(() => checkAligned([a, { name: '1080p', text: mediaPlaylist([4, 4]) }])).toThrow(
      /segments/,
    );
    expect(() => checkAligned([a, { name: '1080p', text: mediaPlaylist([4, 3.5, 2.5]) }])).toThrow(
      /Segment 1 of 1080p/,
    );
  });
});

describe('subtitle check captions', () => {
  it('writes WebVTT times', () => {
    expect(vttTime(0)).toBe('00:00:00.000');
    expect(vttTime(65.5)).toBe('00:01:05.500');
    expect(vttTime(3725.042)).toBe('01:02:05.042');
  });

  it('runs through the whole film without passing its end', () => {
    const times = checkTimes(238);
    expect(times[0]).toBe(5);
    expect(times.at(-1)).toBeLessThanOrEqual(238 - CHECK_SHOWN_SECONDS);
    expect(times).toHaveLength(8);
  });

  it('numbers the lines in English and Korean', () => {
    const [english, korean] = CHECK_TRACKS.map((track) => checkCaptions(71, track));
    expect(english).toBe(
      [
        'WEBVTT',
        '',
        '1',
        '00:00:05.000 --> 00:00:11.000',
        'Subtitle check 1 of 3',
        'This line uses your subtitle size and colour.',
        '',
        '2',
        '00:00:35.000 --> 00:00:41.000',
        'Subtitle check 2 of 3',
        'This line uses your subtitle size and colour.',
        '',
        '3',
        '00:01:05.000 --> 00:01:11.000',
        'Subtitle check 3 of 3',
        'This line uses your subtitle size and colour.',
        '',
      ].join('\n'),
    );
    expect(korean).toContain('자막 확인 3/3');
    expect(CHECK_TRACKS.map((track) => track.lang)).toEqual(['eng', 'kor']);
  });
});

describe('artwork', () => {
  it('prefers colourful frames that are neither dark nor washed out', () => {
    expect(frameScore({ yavg: 30, satavg: 90 })).toBe(-Infinity);
    expect(frameScore({ yavg: 230, satavg: 90 })).toBe(-Infinity);
    expect(frameScore({ yavg: 115, satavg: 60 })).toBeGreaterThan(
      frameScore({ yavg: 180, satavg: 60 }),
    );
  });

  it('picks two frames apart, unless times are pinned', () => {
    const candidates = [
      { time: 30, yavg: 115, satavg: 80 },
      { time: 35, yavg: 115, satavg: 75 },
      { time: 120, yavg: 120, satavg: 60 },
      { time: 160, yavg: 20, satavg: 99 },
    ];
    expect(chooseFrames(candidates, 238)).toEqual({ background: 30, poster: 120 });
    expect(chooseFrames(candidates, 238, { poster: 200 })).toEqual({ background: 30, poster: 200 });
    expect(chooseFrames([], 100)).toEqual({ background: 30, poster: 30 });
  });

  it('keeps the largest picture cropdetect saw', () => {
    expect(parseCrop('x crop=1920:800:0:140 y crop=1920:640:0:220 z')).toEqual({
      width: 1920,
      height: 800,
      x: 0,
      y: 140,
    });
    expect(parseCrop('nothing')).toBeUndefined();
  });

  it('crops a scope picture to 16:9 and 2:3', () => {
    const scope = { width: 1920, height: 804, x: 0, y: 138 };
    expect(coverBox(scope, BACKGROUND.width / BACKGROUND.height)).toEqual({
      width: 1428,
      height: 804,
      x: 246,
      y: 138,
    });
    expect(coverBox(scope, POSTER.width / POSTER.height, 0)).toEqual({
      width: 536,
      height: 804,
      x: 0,
      y: 138,
    });
    expect(coverBox(scope, POSTER.width / POSTER.height, 1).x).toBe(1920 - 536);
    expect(backgroundFilter(scope)).toBe(
      'crop=1428:804:246:138,scale=1920:1080:flags=lanczos,setsar=1',
    );
    expect(posterFilter(scope, 0.5)).toMatch(/^\[0:v\]crop=536:804:692:138,scale=500:750/);
    expect(posterFilter(scope, 0.5)).toMatch(/\[poster\]$/);
  });
});

describe('films.json', () => {
  const films = loadFilms();

  it('is valid, with the licences and credits the store listing promises', () => {
    expect(films.map((film) => film.slug)).toEqual(['big-buck-bunny', 'spring', 'wing-it']);
    for (const film of films) {
      expect(film.licence.name).toMatch(/^CC BY/);
      expect(film.credit).toContain('Blender');
    }
    expect(mediaPath(films[0])).toBe('media/big-buck-bunny/v1');
  });

  it('catches the mistakes that would show on a TV', () => {
    const broken = (change) => {
      const copy = structuredClone({ films });
      change(copy.films[0]);
      return () => checkFilms(copy);
    };
    expect(broken((film) => (film.slug = 'Big Buck'))).toThrow(/kebab/);
    expect(broken((film) => (film.licence.name = 'CC BY-NC 3.0'))).toThrow(/no NC or ND/);
    expect(broken((film) => (film.description = 'x'.repeat(300)))).toThrow(/too long/);
    expect(broken((film) => (film.durationSeconds = 596.5))).toThrow(/whole number/);
    expect(broken((film) => (film.art.poster = 9999))).toThrow(/art.poster/);
    expect(broken((film) => (film.source.urls = ['http://example.com/a.mov']))).toThrow(/https/);
    expect(() => checkFilms({ films: [films[0], films[0]] })).toThrow(/twice/);
  });
});

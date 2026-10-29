/**
 * Reading ffmpeg's media playlists and writing the master playlist.
 *
 * ffmpeg 6 sets BANDWIDTH from the configured bitrates, which understates the
 * real peak at the bottom of the ladder, and writes no AVERAGE-BANDWIDTH or
 * FRAME-RATE. The master is therefore written here from the segments actually
 * produced: BANDWIDTH is the peak segment bitrate and AVERAGE-BANDWIDTH the
 * whole variant's average, as Apple's authoring spec asks (items 9.13, 9.14).
 *
 * LG's native player lists EXT-X-INDEPENDENT-SEGMENTS as not supported, so
 * neither playlist carries it, and version 3 is enough for MPEG-TS segments.
 */

/** Segments shorter than this (the last one of a film) say little about the peak. */
const MIN_PEAK_SECONDS = 1;

/** The segments of a media playlist, in order, with their durations. */
export function readMediaPlaylist(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('Not an M3U8 playlist');
  const segments = [];
  let duration;
  let ended = false;
  let targetDuration;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(line.slice('#EXTINF:'.length));
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Bad ${line}`);
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.slice('#EXT-X-TARGETDURATION:'.length));
    } else if (line === '#EXT-X-ENDLIST') {
      ended = true;
    } else if (line.startsWith('#EXT-X-DISCONTINUITY') || line.startsWith('#EXT-X-BYTERANGE')) {
      throw new Error(`${line} is not expected in a demo film`);
    } else if (line && !line.startsWith('#')) {
      if (duration === undefined) throw new Error(`Segment ${line} has no #EXTINF`);
      if (/^[a-z]+:|^\/|\\|\.\./i.test(line))
        throw new Error(`Segment ${line} is not a plain relative path`);
      segments.push({ uri: line, duration });
      duration = undefined;
    }
  }
  if (!ended) throw new Error('The playlist has no #EXT-X-ENDLIST');
  if (segments.length === 0) throw new Error('The playlist has no segments');
  if (targetDuration === undefined) throw new Error('The playlist has no #EXT-X-TARGETDURATION');
  return { segments, targetDuration };
}

/**
 * Peak and average bitrate of one variant, in bits per second, from its
 * playlist and the size in bytes of each segment.
 */
export function measureVariant(playlistText, sizeOf) {
  const { segments, targetDuration } = readMediaPlaylist(playlistText);
  let bytes = 0;
  let seconds = 0;
  let peak = 0;
  for (const segment of segments) {
    const size = sizeOf(segment.uri);
    bytes += size;
    seconds += segment.duration;
    if (segment.duration >= MIN_PEAK_SECONDS || segments.length === 1) {
      peak = Math.max(peak, (size * 8) / segment.duration);
    }
    if (segment.duration > targetDuration + 0.5) {
      throw new Error(`Segment ${segment.uri} is ${segment.duration} s, over the target duration`);
    }
  }
  return {
    peak: Math.ceil(peak),
    average: Math.ceil((bytes * 8) / seconds),
    bytes,
    seconds,
    segments: segments.length,
    largest: Math.max(...segments.map((segment) => sizeOf(segment.uri))),
  };
}

/**
 * The master playlist. Variants are written in the order given, which should
 * be lowest first.
 */
export function masterPlaylist(variants) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const variant of variants) {
    const attributes = [
      `BANDWIDTH=${variant.peak}`,
      `AVERAGE-BANDWIDTH=${variant.average}`,
      `CODECS="${variant.codecs}"`,
      `RESOLUTION=${variant.width}x${variant.height}`,
      `FRAME-RATE=${variant.fps.toFixed(3)}`,
    ];
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`, variant.uri);
  }
  return lines.join('\n') + '\n';
}

/**
 * The same media playlist without tags LG's native player doesn't support.
 * ffmpeg writes none of them with the options in ladder.mjs, so this is a
 * guard against a future ffmpeg changing its defaults.
 */
export function cleanMediaPlaylist(text) {
  const unsupported = [
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-ALLOW-CACHE',
    '#EXT-X-PROGRAM-DATE-TIME',
    '#EXT-X-I-FRAME-STREAM-INF',
  ];
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !unsupported.some((tag) => line.trim().startsWith(tag)));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/**
 * Every rung must cut its segments at the same times, or a player switching
 * rungs jumps or repeats a few frames. LG also asks for the same media
 * sequence numbers on every rung. Throws if any rung differs from the first.
 */
export function checkAligned(playlists) {
  const [first, ...rest] = playlists.map(({ name, text }) => ({
    name,
    durations: readMediaPlaylist(text).segments.map((segment) => segment.duration),
  }));
  if (!first) throw new Error('No rungs to compare');
  for (const other of rest) {
    if (other.durations.length !== first.durations.length) {
      throw new Error(
        `${other.name} has ${other.durations.length} segments and ${first.name} has ${first.durations.length}`,
      );
    }
    other.durations.forEach((duration, index) => {
      if (Math.abs(duration - first.durations[index]) > 0.05) {
        throw new Error(
          `Segment ${index} of ${other.name} is ${duration} s, ${first.name} has ${first.durations[index]} s`,
        );
      }
    });
  }
}

/**
 * The HLS ladder every demo film is encoded to, and the ffmpeg arguments that
 * make it.
 *
 * LG's self-check item 43 plays a title at 512 kbps, 1 Mbps, 7 Mbps and
 * 17.5 Mbps, twice each, and expects the picture to change resolution without
 * constant buffering. The rungs are sized so each of those lands on a
 * different one with a fifth of the link to spare, and the lowest stays well
 * under 512 kbps with its audio and the MPEG-TS overhead (about 14% at that
 * size, measured).
 *
 * What the webOS native player needs (LG's streaming spec and forum, see
 * docs/DEMO_ADDON.md): MPEG-TS segments, H.264 High at level 4.0 or lower,
 * AAC-LC stereo muxed into every variant (no separate audio renditions), and
 * the same segment boundaries on every rung. A fixed two-second closed GOP at a
 * constant 24 fps puts the keyframes at the same timestamps on every rung, so
 * the four-second segments line up.
 */

export const SEGMENT_SECONDS = 4;
export const GOP_SECONDS = 2;
export const AUDIO_SAMPLE_RATE = 48000;
/** ffmpeg's own master playlist, kept beside ours for comparison and never linked. */
export const FFMPEG_MASTER = 'ffmpeg-master.m3u8';

/**
 * Lowest first: the master playlist lists them in this order, so a player
 * that starts on the first variant starts on the one that plays at 512 kbps.
 */
export const RUNGS = [
  // name, width, height, video kbps, video peak kbps, audio kbps, H.264 level
  ['288p', 512, 288, 200, 220, 64, '3.0'],
  ['360p', 640, 360, 400, 440, 64, '3.0'],
  ['540p', 960, 540, 1100, 1320, 128, '3.1'],
  ['720p', 1280, 720, 2800, 3360, 128, '3.1'],
  ['1080p', 1920, 1080, 5000, 6000, 128, '4.0'],
].map(([name, width, height, videoKbps, maxKbps, audioKbps, level]) => ({
  name,
  width,
  height,
  videoKbps,
  maxKbps,
  audioKbps,
  level,
}));

/** The RFC 6381 codec string of a rung: H.264 High (0x64), no constraint flags, its level, AAC-LC. */
export function rungCodecs(rung) {
  const level = Math.round(Number(rung.level) * 10);
  return `avc1.6400${level.toString(16).padStart(2, '0')},mp4a.40.2`;
}

/**
 * ffmpeg arguments that encode one film to every rung in a single pass.
 *
 * The film is first fitted inside 1920x1080 and padded to 16:9 with square
 * pixels, so every rung has the same shape whatever the film's own aspect
 * ratio (most Blender films are 2.39:1). Paths are passed as arguments, never
 * through a shell, so spaces and backslashes in Windows paths are fine.
 */
export function ladderArgs({ input, outDir, fps = 24, preset = 'slow', rungs = RUNGS }) {
  const gop = Math.round(fps * GOP_SECONDS);
  const split = rungs.map((_, index) => `[s${index}]`).join('');
  const scaled = rungs
    .map((rung, index) =>
      rung.width === 1920 && rung.height === 1080
        ? `[s${index}]null[v${index}]`
        : `[s${index}]scale=${rung.width}:${rung.height}:flags=lanczos[v${index}]`,
    )
    .join(';');
  const filter =
    `[0:v:0]fps=${fps},` +
    'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,' +
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,' +
    `split=${rungs.length}${split};${scaled}`;

  // Option and value pairs, flattened at the end.
  const options = [
    ['-hide_banner'],
    ['-nostdin'],
    ['-y'],
    ['-i', input],
    ['-filter_complex', filter],
    ...rungs.flatMap((_, index) => [
      ['-map', `[v${index}]`],
      ['-map', '0:a:0'],
    ]),
    ['-map_metadata', '-1'],
    ['-map_chapters', '-1'],
    ['-c:v', 'libx264'],
    ['-preset', preset],
    ['-profile:v', 'high'],
    ['-pix_fmt', 'yuv420p'],
    ['-g', String(gop)],
    ['-keyint_min', String(gop)],
    ['-sc_threshold', '0'],
    ['-bf', '3'],
    ['-x264-params', 'open-gop=0:scenecut=0'],
    ...rungs.flatMap((rung, index) => [
      [`-b:v:${index}`, `${rung.videoKbps}k`],
      [`-maxrate:v:${index}`, `${rung.maxKbps}k`],
      [`-bufsize:v:${index}`, `${rung.maxKbps}k`],
      [`-level:v:${index}`, rung.level],
    ]),
    ['-c:a', 'aac'],
    ['-profile:a', 'aac_low'],
    ['-ar', String(AUDIO_SAMPLE_RATE)],
    ['-ac', '2'],
    ...rungs.map((rung, index) => [`-b:a:${index}`, `${rung.audioKbps}k`]),
    ['-max_muxing_queue_size', '4096'],
    ['-f', 'hls'],
    ['-hls_time', String(SEGMENT_SECONDS)],
    ['-hls_playlist_type', 'vod'],
    ['-hls_segment_type', 'mpegts'],
    ['-hls_segment_filename', joinForward(outDir, '%v', '%05d.ts')],
    // ffmpeg's own master is replaced by writeMaster() from measured sizes.
    ['-master_pl_name', FFMPEG_MASTER],
    ['-var_stream_map', rungs.map((rung, i) => `v:${i},a:${i},name:${rung.name}`).join(' ')],
    [joinForward(outDir, '%v', 'index.m3u8')],
  ];
  return options.flat();
}

/** ffmpeg accepts forward slashes on Windows too, and %v must not be escaped by path.join. */
function joinForward(...parts) {
  return parts.map((part) => part.replace(/\\/g, '/').replace(/\/+$/, '')).join('/');
}

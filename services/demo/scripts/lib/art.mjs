/**
 * Posters and backdrops from film frames: choosing the frames and the ffmpeg
 * filters that crop, shade and title them.
 *
 * The app draws `background` in the hero, Details, landscape tiles and
 * Continue Watching (16:9, cover), and `poster` on poster tiles (2:3, cover),
 * where it hides the title caption once the image loads, so posters carry the
 * title. Sizes follow the Stremio SDK's advice: posters under 100 KB,
 * backdrops under 500 KB.
 */

export const BACKGROUND = { width: 1920, height: 1080, maxBytes: 500 * 1024 };
export const POSTER = { width: 500, height: 750, maxBytes: 100 * 1024 };
/** The title logo on a poster: at most this wide, this far from the bottom. */
export const POSTER_LOGO = { maxWidth: 440, maxHeight: 150, bottom: 40 };

/** Candidate frame times, as fractions of the film, avoiding titles and end credits. */
export const CANDIDATE_FRACTIONS = [
  0.1, 0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7, 0.76,
];

/**
 * How good a frame looks as artwork: colourful and neither dark nor washed
 * out. YAVG and SATAVG are ffmpeg signalstats averages on 8-bit video.
 */
export function frameScore({ yavg, satavg }) {
  if (yavg < 45 || yavg > 205) return -Infinity;
  return satavg - 0.5 * Math.abs(yavg - 115);
}

/**
 * The frames for the backdrop and the poster: pinned times win, otherwise the
 * best-scoring candidate for the backdrop and the best one at least a tenth of
 * the film away for the poster, so the two don't look the same.
 */
export function chooseFrames(candidates, durationSeconds, pinned = {}) {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, score: frameScore(candidate) }))
    .filter((candidate) => candidate.score > -Infinity)
    .sort((a, b) => b.score - a.score || a.time - b.time);
  const fallback = durationSeconds * 0.3;
  const background = pinned.background ?? ranked[0]?.time ?? fallback;
  const apart = ranked.find(
    (candidate) => Math.abs(candidate.time - background) >= durationSeconds / 10,
  );
  const poster = pinned.poster ?? apart?.time ?? ranked[0]?.time ?? fallback;
  return { background, poster };
}

/** ffmpeg's cropdetect output, `crop=w:h:x:y`, as numbers. */
export function parseCrop(text) {
  const matches = [...text.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (matches.length === 0) return undefined;
  // The largest area seen: a dark scene can make cropdetect cut into the picture.
  let best;
  for (const match of matches) {
    const [width, height, x, y] = match.slice(1).map(Number);
    if (!best || width * height > best.width * best.height) best = { width, height, x, y };
  }
  return best;
}

/** The largest box of the given aspect ratio inside the picture, placed by `focus` (0 left, 1 right). */
export function coverBox(picture, aspect, focus = 0.5) {
  let width = picture.width;
  let height = Math.round(width / aspect);
  if (height > picture.height) {
    height = picture.height;
    width = Math.round(height * aspect);
  }
  width -= width % 2;
  height -= height % 2;
  const x = picture.x + Math.round((picture.width - width) * focus);
  const y = picture.y + Math.round((picture.height - height) / 2);
  return { width, height, x, y };
}

/** Filter for the backdrop: the picture without bars, cropped to 16:9, at 1920x1080. */
export function backgroundFilter(picture) {
  const box = coverBox(picture, BACKGROUND.width / BACKGROUND.height);
  return `crop=${box.width}:${box.height}:${box.x}:${box.y},scale=${BACKGROUND.width}:${BACKGROUND.height}:flags=lanczos,setsar=1`;
}

/**
 * Filter graph for the poster. Inputs: 0 the frame, 1 the shade PNG, 2 the
 * title logo PNG. The logo is fitted inside POSTER_LOGO and centred.
 */
export function posterFilter(picture, focus) {
  const box = coverBox(picture, POSTER.width / POSTER.height, focus);
  const { maxWidth, maxHeight, bottom } = POSTER_LOGO;
  return [
    `[0:v]crop=${box.width}:${box.height}:${box.x}:${box.y},scale=${POSTER.width}:${POSTER.height}:flags=lanczos,setsar=1[frame]`,
    `[frame][1:v]overlay=0:0[shaded]`,
    `[2:v]scale=w='min(${maxWidth},iw*${maxHeight}/ih)':h=-1:flags=lanczos[logo]`,
    `[shaded][logo]overlay=x=(W-w)/2:y=H-h-${bottom}:format=auto,format=yuvj420p[poster]`,
  ].join(';');
}

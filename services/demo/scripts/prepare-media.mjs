/**
 * Builds public/, the folder `wrangler deploy` uploads as static assets:
 * each film from films.json as adaptive HLS, its subtitle check captions, its
 * poster and backdrop, plus the _headers file and the addon's icon.
 *
 *   pnpm --filter @bannertv/demo media              every film
 *   ... media --only wing-it                         some films (comma-separated)
 *   ... media --source wing-it=D:\films\wing-it.mp4  use a file already on disk
 *   ... media --preset medium                        faster, slightly larger encode
 *   ... media --force                                encode again even if done
 *   ... media --sources                              only check the download addresses
 *   ... media --check                                only check public/ is complete
 *
 * Needs ffmpeg and ffprobe with libx264 (Windows: winget install Gyan.FFmpeg).
 * Downloads go to .work/, and frame choices for review to review/; neither is
 * deployed or committed. A finished film is skipped on the next run, so an
 * interrupted run can just be started again.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  backgroundFilter,
  BACKGROUND,
  CANDIDATE_FRACTIONS,
  chooseFrames,
  parseCrop,
  POSTER,
  posterFilter,
} from './lib/art.mjs';
import { CHECK_TRACKS, checkCaptions } from './lib/captions.mjs';
import { artPath, loadFilms, mediaPath } from './lib/films.mjs';
import { FFMPEG_MASTER, ladderArgs, RUNGS, rungCodecs } from './lib/ladder.mjs';
import {
  checkAligned,
  cleanMediaPlaylist,
  masterPlaylist,
  measureVariant,
  readMediaPlaylist,
} from './lib/playlists.mjs';
import {
  checkTools,
  download,
  FFMPEG,
  firstReachable,
  probe,
  progressPrinter,
  run,
  unzipVideo,
} from './lib/tools.mjs';

const service = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(service, 'public');
const STATIC = join(service, 'static');
const WORK = join(service, '.work');
const REVIEW = join(service, 'review');

/** Cloudflare's limits for static assets on the Workers Free plan. */
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The lowest rung's peak must leave room under LG's 512 kbps test. */
const LOWEST_PEAK_LIMIT = 450_000;

const { values: options } = parseArgs({
  // pnpm passes on the `--` in `pnpm … media -- --check`.
  args: process.argv.slice(2).filter((arg, index) => index > 0 || arg !== '--'),
  options: {
    only: { type: 'string' },
    source: { type: 'string', multiple: true, default: [] },
    preset: { type: 'string', default: 'slow' },
    force: { type: 'boolean', default: false },
    sources: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});

const allFilms = loadFilms();
const wanted = options.only
  ? new Set(options.only.split(',').map((slug) => slug.trim()))
  : undefined;
for (const slug of wanted ?? []) {
  if (!allFilms.some((film) => film.slug === slug))
    throw new Error(`No film "${slug}" in films.json`);
}
const films = allFilms.filter((film) => !wanted || wanted.has(film.slug));
const overrides = new Map(
  options.source.map((pair) => {
    const at = pair.indexOf('=');
    if (at < 1) throw new Error(`--source needs slug=path, not "${pair}"`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  }),
);
// A mistyped slug would otherwise download the film it was meant to replace.
for (const slug of overrides.keys()) {
  if (!allFilms.some((film) => film.slug === slug)) {
    throw new Error(`--source names "${slug}", which is not a film in films.json`);
  }
  if (!films.some((film) => film.slug === slug)) {
    console.warn(`--source for ${slug} is not used: --only leaves that film out`);
  }
}

function inPublic(sitePath) {
  return join(PUBLIC, ...sitePath.split('/'));
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** The film on disk: a --source file, an earlier download, or a new one. */
async function resolveSource(film) {
  const override = overrides.get(film.slug);
  if (override) {
    if (!existsSync(override)) throw new Error(`${override} does not exist`);
    return { file: override, from: override };
  }
  const folder = join(WORK, 'sources');
  mkdirSync(folder, { recursive: true });
  const unzipped = join(WORK, 'unzipped', film.slug);
  const earlier = readdirSync(folder).find(
    (name) => name.startsWith(`${film.slug}.`) && !name.endsWith('.part'),
  );
  if (earlier) {
    const file = join(folder, earlier);
    if (extname(earlier).toLowerCase() !== '.zip') return { file, from: file };
    return { file: await unzipVideo(file, unzipped), from: file };
  }
  const { url } = await firstReachable(film.source.urls);
  const extension = extname(new URL(url).pathname).toLowerCase() || '.mp4';
  const file = join(folder, `${film.slug}${extension}`);
  console.log(`  downloading ${url}`);
  await download(url, file, film.slug);
  if (extension === '.zip') return { file: await unzipVideo(file, unzipped), from: url };
  return { file, from: url };
}

/** Refuses a file that is not the film films.json describes. */
function checkSource(film, info) {
  const problems = [];
  if (Math.abs(info.fps - film.source.fps) > 0.05) {
    problems.push(`plays at ${info.fps.toFixed(3)} fps, films.json says ${film.source.fps}`);
  }
  if (Math.abs(info.duration - film.durationSeconds) > 5) {
    problems.push(`runs ${info.duration.toFixed(1)} s, films.json says ${film.durationSeconds} s`);
  }
  // How much the picture grows to fit 1920x1080. A 1920x804 scope film fits as it is.
  const upscale = Math.min(1920 / info.width, 1080 / info.height);
  if (upscale > 1.5) problems.push(`is only ${info.width}x${info.height}`);
  if (!info.audioCodec) problems.push('has no sound');
  if (problems.length > 0) throw new Error(`The ${film.slug} source ${problems.join('; ')}`);
  if (upscale > 1.01) {
    console.warn(
      `  note: the source is ${info.width}x${info.height}, so the 1080p rung is upscaled`,
    );
  }
}

async function encode(film, source, info, mediaDir) {
  rmSync(mediaDir, { recursive: true, force: true });
  mkdirSync(mediaDir, { recursive: true });
  const args = ladderArgs({
    input: source,
    outDir: mediaDir,
    fps: film.source.fps,
    preset: options.preset,
  });
  const started = Date.now();
  await run(FFMPEG, ['-progress', 'pipe:1', '-nostats', ...args], {
    onStdout: progressPrinter(`${film.slug} encode`, info.duration),
  });
  console.log(`  encoded in ${((Date.now() - started) / 60000).toFixed(1)} min`);
}

/** Tidies ffmpeg's playlists, checks the rungs line up, and writes the master from measured sizes. */
function finishPlaylists(film, mediaDir) {
  const playlists = RUNGS.map((rung) => {
    const file = join(mediaDir, rung.name, 'index.m3u8');
    const text = cleanMediaPlaylist(readFileSync(file, 'utf8'));
    writeFileSync(file, text);
    return { rung, name: rung.name, text };
  });
  checkAligned(playlists);
  const variants = playlists.map(({ rung, text }) => ({
    ...measureVariant(text, (uri) => statSync(join(mediaDir, rung.name, uri)).size),
    codecs: rungCodecs(rung),
    width: rung.width,
    height: rung.height,
    fps: film.source.fps,
    uri: `${rung.name}/index.m3u8`,
    name: rung.name,
  }));
  writeFileSync(join(mediaDir, 'master.m3u8'), masterPlaylist(variants));
  rmSync(join(mediaDir, FFMPEG_MASTER), { force: true });
  return variants;
}

function writeCaptions(film, mediaDir) {
  const folder = join(mediaDir, 'subs');
  mkdirSync(folder, { recursive: true });
  for (const track of CHECK_TRACKS) {
    writeFileSync(join(folder, track.file), checkCaptions(film.durationSeconds, track));
  }
}

/** The picture inside any black bars burned into the source. */
async function findPicture(source, info) {
  let text = '';
  for (const fraction of [0.25, 0.5, 0.75]) {
    const { stderr } = await run(FFMPEG, [
      '-hide_banner',
      '-ss',
      String(info.duration * fraction),
      '-i',
      source,
      '-t',
      '3',
      '-vf',
      'cropdetect=limit=24:round=2:reset=0',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    text += stderr;
  }
  return parseCrop(text) ?? { width: info.width, height: info.height, x: 0, y: 0 };
}

/** Scores candidate frames, saves them as thumbnails and a contact sheet for review. */
async function scoreCandidates(film, source, info, picture) {
  const folder = join(WORK, 'frames', film.slug);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const candidates = [];
  for (const [index, fraction] of CANDIDATE_FRACTIONS.entries()) {
    const time = Math.round(info.duration * fraction * 10) / 10;
    const thumb = join(folder, `${String(index + 1).padStart(2, '0')}.jpg`);
    const { stdout } = await run(FFMPEG, [
      '-hide_banner',
      '-y',
      '-ss',
      String(time),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      `crop=${picture.width}:${picture.height}:${picture.x}:${picture.y},scale=480:-2,signalstats,metadata=print:file=-`,
      '-q:v',
      '4',
      thumb,
    ]);
    const read = (key) => Number(new RegExp(`${key}=([\\d.]+)`).exec(stdout)?.[1] ?? NaN);
    candidates.push({
      time,
      yavg: read('lavfi.signalstats.YAVG'),
      satavg: read('lavfi.signalstats.SATAVG'),
    });
  }
  mkdirSync(REVIEW, { recursive: true });
  await run(FFMPEG, [
    '-hide_banner',
    '-y',
    '-i',
    join(folder, '%02d.jpg'),
    '-vf',
    'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,tile=4x3:padding=6:color=black',
    '-frames:v',
    '1',
    '-q:v',
    '4',
    join(REVIEW, `${film.slug}-frames.jpg`),
  ]);
  return candidates;
}

/** Writes a JPEG with the best quality that fits under maxBytes. */
async function jpegUnder(maxBytes, file, argsFor) {
  for (let quality = 2; quality <= 12; quality++) {
    await run(FFMPEG, ['-hide_banner', '-y', ...argsFor(quality), file]);
    if (statSync(file).size <= maxBytes) return quality;
  }
  throw new Error(`${file} is still over ${maxBytes} bytes at the lowest quality`);
}

async function makeArt(film, source, info) {
  const folder = inPublic(artPath(film));
  mkdirSync(folder, { recursive: true });
  const logo = join(STATIC, 'art', film.slug, 'logo.png');
  if (!existsSync(logo))
    throw new Error(`${logo} is missing; run pnpm --filter @bannertv/demo art`);
  copyFileSync(logo, join(folder, 'logo.png'));

  const picture = await findPicture(source, info);
  const candidates = await scoreCandidates(film, source, info, picture);
  const chosen = chooseFrames(candidates, info.duration, {
    background: film.art.background ?? undefined,
    poster: film.art.poster ?? undefined,
  });
  const frames = join(WORK, 'frames', film.slug);
  const grab = async (time, name) => {
    const file = join(frames, name);
    await run(FFMPEG, [
      '-hide_banner',
      '-y',
      '-ss',
      String(time),
      '-i',
      source,
      '-frames:v',
      '1',
      file,
    ]);
    return file;
  };
  const backgroundFrame = await grab(chosen.background, 'background.png');
  const posterFrame = await grab(chosen.poster, 'poster.png');

  await jpegUnder(BACKGROUND.maxBytes, join(folder, 'background.jpg'), (quality) => [
    '-i',
    backgroundFrame,
    '-vf',
    backgroundFilter(picture),
    '-frames:v',
    '1',
    '-q:v',
    String(quality),
  ]);
  await jpegUnder(POSTER.maxBytes, join(folder, 'poster.jpg'), (quality) => [
    '-i',
    posterFrame,
    '-i',
    join(STATIC, 'art', 'poster-shade.png'),
    '-i',
    logo,
    '-filter_complex',
    posterFilter(picture, film.art.posterFocus),
    '-map',
    '[poster]',
    '-frames:v',
    '1',
    '-q:v',
    String(quality),
  ]);

  const lines = candidates.map(
    (candidate, index) =>
      `${String(index + 1).padStart(2, '0')}  ${candidate.time.toFixed(1)} s  brightness ${candidate.yavg.toFixed(0)}  colour ${candidate.satavg.toFixed(0)}`,
  );
  writeFileSync(
    join(REVIEW, `${film.slug}-frames.txt`),
    [
      `${film.name}: picture ${picture.width}x${picture.height} at ${picture.x},${picture.y}`,
      `backdrop from ${chosen.background.toFixed(1)} s, poster from ${chosen.poster.toFixed(1)} s`,
      'To choose other frames, set art.background or art.poster in films.json (seconds), then run again: artwork is redrawn on every run, films are not encoded again.',
      '',
      ...lines,
      '',
    ].join('\n'),
  );
}

async function prepareFilm(film) {
  console.log(`\n${film.name} (${film.slug})`);
  const { file: source, from } = await resolveSource(film);
  const info = await probe(source);
  console.log(
    `  source ${info.width}x${info.height} ${info.fps.toFixed(3)} fps, ${info.duration.toFixed(1)} s, ${info.videoCodec}/${info.audioCodec} ${info.audioChannels} ch`,
  );
  checkSource(film, info);

  const mediaDir = inPublic(mediaPath(film));
  const master = join(mediaDir, 'master.m3u8');
  if (options.force || !existsSync(master)) {
    await encode(film, source, info, mediaDir);
    const variants = finishPlaylists(film, mediaDir);
    for (const variant of variants) {
      console.log(
        `  ${variant.name.padEnd(5)} peak ${(variant.peak / 1000).toFixed(0)} kbps, average ${(variant.average / 1000).toFixed(0)} kbps, ${variant.segments} segments`,
      );
    }
    mkdirSync(REVIEW, { recursive: true });
    writeFileSync(
      join(REVIEW, `${film.slug}-source.txt`),
      `${film.name}\nfrom ${from}\nsha256 ${await sha256(source)}\n${JSON.stringify(info, null, 2)}\n`,
    );
  } else {
    console.log('  already encoded; --force to encode again');
  }
  writeCaptions(film, mediaDir);
  await makeArt(film, source, info);
}

function copyStatic() {
  mkdirSync(join(PUBLIC, 'art'), { recursive: true });
  copyFileSync(join(STATIC, '_headers'), join(PUBLIC, '_headers'));
  copyFileSync(join(STATIC, 'art', 'addon.png'), join(PUBLIC, 'art', 'addon.png'));
}

function walk(folder, files = []) {
  if (!existsSync(folder)) return files;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push({ path, size: statSync(path).size });
  }
  return files;
}

/**
 * What `wrangler deploy` would upload: complete for every film, and inside
 * Cloudflare's limits. Returns the problems found.
 */
function checkPublic(everyFilm) {
  const problems = [];
  const files = walk(PUBLIC);
  if (files.length > MAX_FILES) problems.push(`${files.length} files, over the ${MAX_FILES} limit`);
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) problems.push(`${relative(PUBLIC, file.path)} is over 25 MiB`);
  }
  for (const required of ['_headers', 'art/addon.png']) {
    if (!existsSync(inPublic(required))) problems.push(`${required} is missing`);
  }
  for (const film of everyFilm) {
    const mediaDir = inPublic(mediaPath(film));
    const artDir = inPublic(artPath(film));
    for (const name of ['poster.jpg', 'background.jpg', 'logo.png']) {
      if (!existsSync(join(artDir, name))) problems.push(`${artPath(film)}/${name} is missing`);
    }
    for (const track of CHECK_TRACKS) {
      if (!existsSync(join(mediaDir, 'subs', track.file))) {
        problems.push(`${mediaPath(film)}/subs/${track.file} is missing`);
      }
    }
    const master = join(mediaDir, 'master.m3u8');
    if (!existsSync(master)) {
      problems.push(`${mediaPath(film)}/master.m3u8 is missing`);
      continue;
    }
    const peaks = [...readFileSync(master, 'utf8').matchAll(/BANDWIDTH=(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    if (peaks[0] === undefined || peaks[0] > LOWEST_PEAK_LIMIT) {
      problems.push(
        `${film.slug}: the first variant peaks at ${peaks[0]} bps, over ${LOWEST_PEAK_LIMIT}`,
      );
    }
    for (const rung of RUNGS) {
      const playlist = join(mediaDir, rung.name, 'index.m3u8');
      if (!existsSync(playlist)) {
        problems.push(`${mediaPath(film)}/${rung.name}/index.m3u8 is missing`);
        continue;
      }
      try {
        for (const segment of readMediaPlaylist(readFileSync(playlist, 'utf8')).segments) {
          if (!existsSync(join(mediaDir, rung.name, segment.uri))) {
            problems.push(`${mediaPath(film)}/${rung.name}/${segment.uri} is missing`);
          }
        }
      } catch (error) {
        problems.push(`${mediaPath(film)}/${rung.name}/index.m3u8: ${error.message}`);
      }
    }
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return { files: files.length, bytes, problems };
}

async function main() {
  if (options.sources) {
    for (const film of films) {
      const found = await firstReachable(film.source.urls);
      console.log(
        `${film.slug}: ${found.url}${found.bytes ? ` (${(found.bytes / 1e6).toFixed(0)} MB)` : ''}`,
      );
    }
    return;
  }
  if (!options.check) {
    checkTools();
    copyStatic();
    for (const film of films) await prepareFilm(film);
  }
  const { files, bytes, problems } = checkPublic(allFilms);
  console.log(`\npublic/: ${files} files, ${(bytes / 1e9).toFixed(2)} GB`);
  if (problems.length > 0) {
    console.error(`Not ready to deploy:\n  ${problems.slice(0, 40).join('\n  ')}`);
    if (problems.length > 40) console.error(`  ...and ${problems.length - 40} more`);
    process.exitCode = 1;
  } else {
    console.log('Ready to deploy: npx wrangler@4 deploy');
  }
}

await main();

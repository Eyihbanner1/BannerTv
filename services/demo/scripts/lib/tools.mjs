/**
 * Running ffmpeg and ffprobe, and downloading the films. Everything here
 * passes arguments as arrays, never through a shell, so it behaves the same
 * on Windows, macOS and Linux.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE || 'ffprobe';

/** Fails early, with a hint, when ffmpeg or ffprobe is missing. */
export function checkTools() {
  for (const tool of [FFMPEG, FFPROBE]) {
    const result = spawnSync(tool, ['-version'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      throw new Error(
        `${tool} was not found. Install ffmpeg (Windows: winget install Gyan.FFmpeg, then open a new terminal), or set FFMPEG and FFPROBE to its programs.`,
      );
    }
  }
  const version = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
  if (!/libx264/.test(version))
    throw new Error(`${FFMPEG} has no libx264 encoder; use a full (GPL) build`);
}

/**
 * Runs a program and resolves with its output. On failure the error carries
 * the last lines of stderr. `onStdout` sees stdout as it arrives.
 */
export function run(command, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      onStdout?.(chunk);
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.trim().split(/\r?\n/).slice(-15).join('\n');
        reject(new Error(`${basename(command)} exited with ${code}:\n${tail}`));
      }
    });
  });
}

/** Duration, picture and sound of a media file. */
export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams.find(
    (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  );
  const audio = data.streams.find((stream) => stream.codec_type === 'audio');
  const rate = (text) => {
    const [num, den] = String(text ?? '0/1')
      .split('/')
      .map(Number);
    return den ? num / den : 0;
  };
  return {
    duration: Number(data.format.duration),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: rate(video?.avg_frame_rate) || rate(video?.r_frame_rate),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    audioChannels: audio?.channels ?? 0,
  };
}

/** Plays `-progress` lines from ffmpeg as a percentage of the film. */
export function progressPrinter(label, durationSeconds) {
  let last = -1;
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const match = /^out_time_us=(\d+)/.exec(line.trim());
      if (!match) continue;
      const percent = Math.min(100, Math.floor((Number(match[1]) / 1e6 / durationSeconds) * 100));
      if (percent >= last + 5) {
        last = percent;
        process.stdout.write(`  ${label}: ${percent}%\n`);
      }
    }
  };
}

/**
 * Whether an address answers, and its size, without downloading it. Some
 * storage links (video.blender.org's signed redirects) refuse HEAD but answer
 * GET, so a refused HEAD is followed by a GET of the first byte.
 */
async function reach(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: USER_AGENT });
  if (head.ok) return { bytes: Number(head.headers.get('content-length')) || undefined };
  const get = await fetch(url, {
    redirect: 'follow',
    headers: { ...USER_AGENT, Range: 'bytes=0-0' },
  });
  await get.body?.cancel();
  if (!get.ok) return { failure: `${head.status}, then ${get.status} for a GET` };
  // 206 says the whole size after the slash; a server that ignores Range sends it all as 200.
  const total = /\/(\d+)$/.exec(get.headers.get('content-range') ?? '')?.[1];
  const length = get.status === 200 ? get.headers.get('content-length') : total;
  return { bytes: Number(length) || undefined };
}

/** The first address that answers, without downloading it. */
export async function firstReachable(urls) {
  const tried = [];
  for (const url of urls) {
    try {
      const { bytes, failure } = await reach(url);
      if (!failure) return { url, bytes };
      tried.push(`${url}: ${failure}`);
    } catch (error) {
      tried.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`None of the source addresses answered:\n  ${tried.join('\n  ')}`);
}

const USER_AGENT = {
  'User-Agent': 'BannerTV-demo-media/1 (+https://github.com/eyihbanner1/bannertv)',
};

/** Downloads to `file`, through a .part file so an interrupted download is never mistaken for a whole one. */
export async function download(url, file, label) {
  mkdirSync(dirname(file), { recursive: true });
  const response = await fetch(url, { redirect: 'follow', headers: USER_AGENT });
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let shown = -10;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (!total) return;
    const percent = Math.floor((received / total) * 100);
    if (percent >= shown + 10) {
      shown = percent;
      process.stdout.write(
        `  ${label}: downloaded ${percent}% of ${(total / 1e6).toFixed(0)} MB\n`,
      );
    }
  });
  const part = `${file}.part`;
  await pipeline(body, createWriteStream(part));
  if (total && statSync(part).size !== total) throw new Error(`${url} stopped early; run again`);
  renameSync(part, file);
}

/**
 * Unpacks a .zip and returns its largest video file. Windows 10 and 11 ship
 * tar (bsdtar), which reads zip files; elsewhere unzip is used.
 */
export async function unzipVideo(file, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') await run('tar', ['-xf', file, '-C', dir]);
  else await run('unzip', ['-o', '-q', file, '-d', dir]);
  const videos = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^\.(mov|mp4|m4v|mkv|avi|webm)$/i.test(extname(entry.name))) {
        videos.push({ path, size: statSync(path).size });
      }
    }
  };
  walk(dir);
  videos.sort((a, b) => b.size - a.size);
  if (!videos[0]) throw new Error(`${file} holds no video file`);
  return videos[0].path;
}

export function fileSize(file) {
  return existsSync(file) ? statSync(file).size : 0;
}

/**
 * Checks the deployed addon the way the TV app and LG's testers will reach
 * it: the manifest, catalog, search, details and streams for every film in
 * films.json, every rung's playlist with its first and last segment, the
 * subtitle tracks and the artwork, each with the right type and open to any
 * page. Then the address over IPv6, which LG's self-check also asks for.
 *
 *   pnpm --filter @bannertv/demo check:live
 *   pnpm --filter @bannertv/demo check:live -- --base https://demo.bannertv.workers.dev
 *
 * Only reads; changes nothing.
 */
import { resolve6 } from 'node:dns/promises';
import { request } from 'node:https';
import { parseArgs } from 'node:util';
import { BACKGROUND, POSTER } from './lib/art.mjs';
import { CHECK_TRACKS } from './lib/captions.mjs';
import { loadFilms } from './lib/films.mjs';
import { readMediaPlaylist } from './lib/playlists.mjs';

const { values: options } = parseArgs({
  options: { base: { type: 'string', default: 'https://demo.bannertv.workers.dev' } },
});
const BASE = options.base.replace(/\/+$/, '');
const ID_PREFIX = 'bannertv:';
const LOWEST_PEAK_LIMIT = 450_000;

let failures = 0;
function pass(message) {
  console.log(`  ok    ${message}`);
}
function fail(message) {
  failures++;
  console.log(`  FAIL  ${message}`);
}
function note(message) {
  console.log(`  note  ${message}`);
}

/** Fetches a URL as the TV app does (cross-origin) and checks status, type and CORS. */
async function get(url, { type, as = 'text' } = {}) {
  const response = await fetch(url, { headers: { Origin: 'null' } });
  const problems = [];
  if (response.status !== 200) problems.push(`answered ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (type && !contentType.startsWith(type)) problems.push(`is ${contentType || 'untyped'}`);
  if (response.headers.get('access-control-allow-origin') !== '*') {
    problems.push('is not open to other pages (Access-Control-Allow-Origin)');
  }
  const body =
    as === 'json'
      ? await response.json().catch(() => undefined)
      : as === 'bytes'
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text();
  if (problems.length > 0) fail(`${url.slice(BASE.length) || '/'} ${problems.join(', ')}`);
  return { ok: problems.length === 0, body, response };
}

const json = (path) => get(BASE + path, { type: 'application/json', as: 'json' });
const encode = (id) => encodeURIComponent(id);

async function checkArt(url, type, maxBytes) {
  const { ok, body } = await get(url, { type, as: 'bytes' });
  if (ok && maxBytes && body.length > maxBytes) {
    fail(`${url.slice(BASE.length)} is ${body.length} bytes, over ${maxBytes}`);
  }
  return ok;
}

/** The master, then every rung's playlist with its first and last segment. */
async function checkHls(url) {
  const master = await get(url, { type: 'application/vnd.apple.mpegurl' });
  if (!master.ok) return false;
  const lines = master.body.split(/\r?\n/);
  const variants = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1]);
    variants.push({ bandwidth, uri: lines[index + 1]?.trim() });
  });
  let ok = variants.length >= 4;
  if (!ok) fail(`${url.slice(BASE.length)} lists ${variants.length} rungs`);
  if (!(variants[0]?.bandwidth <= LOWEST_PEAK_LIMIT)) {
    fail(`the first rung peaks at ${variants[0]?.bandwidth} bps, over ${LOWEST_PEAK_LIMIT}`);
    ok = false;
  }
  for (const variant of variants) {
    const playlistUrl = new URL(variant.uri, url).href;
    const playlist = await get(playlistUrl, { type: 'application/vnd.apple.mpegurl' });
    if (!playlist.ok) {
      ok = false;
      continue;
    }
    const { segments } = readMediaPlaylist(playlist.body);
    for (const segment of [segments[0], segments.at(-1)]) {
      const segmentUrl = new URL(segment.uri, playlistUrl).href;
      const {
        ok: segmentOk,
        body,
        response,
      } = await get(segmentUrl, {
        type: 'video/mp2t',
        as: 'bytes',
      });
      // MPEG-TS packets start with the sync byte 0x47.
      if (segmentOk && body[0] !== 0x47) fail(`${segmentUrl.slice(BASE.length)} is not MPEG-TS`);
      if (segmentOk && !/immutable/.test(response.headers.get('cache-control') ?? '')) {
        note(`${segmentUrl.slice(BASE.length)} is not cached as immutable`);
      }
      ok &&= segmentOk;
    }
  }
  return ok;
}

async function checkFilm(film) {
  const id = ID_PREFIX + film.slug;
  const { ok: metaOk, body: metaBody } = await json(`/meta/movie/${encode(id)}.json`);
  const meta = metaBody?.meta;
  if (!metaOk || meta?.id !== id) {
    fail(`${film.slug}: no details`);
    return;
  }
  const artOk =
    (await checkArt(meta.poster, 'image/jpeg', POSTER.maxBytes)) &&
    (await checkArt(meta.background, 'image/jpeg', BACKGROUND.maxBytes)) &&
    (await checkArt(meta.logo, 'image/png'));
  if (artOk) pass(`${film.slug}: details and artwork`);

  const { body: streamBody } = await json(`/stream/movie/${encode(id)}.json`);
  const streams = streamBody?.streams ?? [];
  if (streams.length !== 2) {
    fail(`${film.slug}: ${streams.length} streams, expected 2`);
    return;
  }
  if (await checkHls(streams[0].url)) pass(`${film.slug}: every rung plays, first to last segment`);
  const backup = await get(streams[1].url, { type: 'application/vnd.apple.mpegurl' });
  if (backup.ok) pass(`${film.slug}: backup copy answers`);

  let subsOk = streams[0].subtitles?.length === CHECK_TRACKS.length;
  if (!subsOk) fail(`${film.slug}: ${streams[0].subtitles?.length ?? 0} subtitle tracks`);
  for (const subtitle of streams[0].subtitles ?? []) {
    const { ok, body } = await get(subtitle.url, { type: 'text/vtt' });
    if (ok && !body.startsWith('WEBVTT')) fail(`${subtitle.url.slice(BASE.length)} is not WebVTT`);
    subsOk &&= ok && body.startsWith('WEBVTT');
  }
  if (subsOk) pass(`${film.slug}: subtitle tracks`);
}

/** GET over IPv6 only. Resolves with the status, or rejects when this machine has no IPv6 route. */
function getOverIpv6(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { family: 6, timeout: 10_000 }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function checkIpv6() {
  const host = new URL(BASE).hostname;
  try {
    const addresses = await resolve6(host);
    pass(`${host} has IPv6 addresses (${addresses[0]})`);
  } catch (error) {
    fail(`${host} has no IPv6 address (${error.code ?? error.message})`);
    return;
  }
  try {
    const status = await getOverIpv6(`${BASE}/manifest.json`);
    if (status === 200) pass('the manifest answers over IPv6');
    else fail(`the manifest answers ${status} over IPv6`);
  } catch (error) {
    note(
      `could not connect over IPv6 from this machine (${error.message}); try from a phone on mobile data`,
    );
  }
}

async function main() {
  const films = loadFilms();
  console.log(`Checking ${BASE}\n`);

  const { ok: manifestOk, body: manifest } = await json('/manifest.json');
  if (!manifestOk || manifest?.id !== 'com.bannertv.demo') {
    fail('manifest');
    process.exitCode = 1;
    return;
  }
  pass(`manifest: ${manifest.name} ${manifest.version}`);
  await checkArt(manifest.logo, 'image/png');

  const { body: catalog } = await json('/catalog/movie/blender.json');
  const ids = (catalog?.metas ?? []).map((meta) => meta.id);
  const expected = films.map((film) => ID_PREFIX + film.slug);
  if (JSON.stringify(ids) === JSON.stringify(expected)) pass(`catalog: ${ids.length} films`);
  else fail(`catalog lists ${ids.join(', ') || 'nothing'}, expected ${expected.join(', ')}`);

  const [first] = films;
  const word = first.name.split(/\s+/)[0];
  const { body: found } = await json(`/catalog/movie/blender/search=${encode(word)}.json`);
  if (found?.metas?.some((meta) => meta.id === ID_PREFIX + first.slug)) {
    pass(`search: "${word}" finds ${first.name}`);
  } else fail(`search: "${word}" does not find ${first.name}`);

  const { ok: unknownOk, body: unknown } = await json(`/stream/movie/tt0000000.json`);
  if (unknownOk && Array.isArray(unknown?.streams) && unknown.streams.length === 0) {
    pass('other titles get an empty stream list');
  }

  for (const film of films) await checkFilm(film);
  await checkIpv6();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} problem(s).`);
  if (failures > 0) process.exitCode = 1;
}

await main();

/**
 * The demo's answers read through the TV app's own parser and stream ranker,
 * so a change on either side that would hide a film, drop its artwork or stop
 * auto-play from picking its stream fails here first.
 */
import { describe, expect, it } from 'vitest';
import {
  assessStream,
  describeStream,
  isLighter,
  languageKey,
  parseRuntime,
  playableCandidates,
  qualityChoices,
  type StreamEntry,
  type TvCapabilities,
} from '@bannertv/core';
import {
  boardCatalogs,
  catalogAccepts,
  parseCatalogResponse,
  parseManifest,
  parseMetaResponse,
  parseStreamResponse,
  supportsResource,
} from '@bannertv/protocol';
import { catalog, CATALOG_ID, FILMS, filmId, manifest, meta, STREAM_NAME, streams } from './addon';

const ORIGIN = 'https://demo.bannertv.example.workers.dev';

/** The development TV (webOS 22, 4K), the oldest webOS BannerTV supports, and a browser. */
const TVS: Record<string, TvCapabilities> = {
  'webOS 22, 4K': {
    webOS: 22,
    uhd: true,
    hdr10: true,
    dolbyVision: false,
    hevc: true,
    av1: false,
    dts: false,
    truehd: false,
  },
  'webOS 5, Full HD': {
    webOS: 5,
    uhd: false,
    hdr10: false,
    dolbyVision: false,
    hevc: false,
    av1: false,
    dts: false,
    truehd: false,
  },
  'not a TV': {
    webOS: null,
    uhd: null,
    hdr10: null,
    dolbyVision: null,
    hevc: null,
    av1: null,
    dts: null,
    truehd: null,
  },
};

function entries(answer: unknown, tv: TvCapabilities): StreamEntry[] {
  const { streams: parsed, dropped } = parseStreamResponse(answer);
  expect(dropped).toBe(0);
  return parsed.map((stream, rank) => {
    const facts = describeStream(stream);
    return {
      stream,
      addonId: 'com.bannertv.demo',
      addonRank: 0,
      rank,
      facts,
      assessment: assessStream(stream, facts, tv),
    };
  });
}

describe('the demo, as the TV app reads it', () => {
  const parsed = parseManifest(manifest(ORIGIN));

  it('installs, with one Home row and a search', () => {
    expect(parsed.name).toBe('BannerTV Demo');
    expect(parsed.logo).toBe(`${ORIGIN}/art/addon.png`);
    expect(boardCatalogs(parsed).map((c) => c.id)).toEqual([CATALOG_ID]);
    const [row] = parsed.catalogs;
    expect(row && catalogAccepts(row, ['search'])).toBe(true);
    // No genre list, so Cinemeta's genre rows keep Home's genre slots.
    expect(row && catalogAccepts(row, ['genre'])).toBe(false);
  });

  it('is asked about its own films only', () => {
    for (const resource of ['meta', 'stream']) {
      expect(supportsResource(parsed, resource, 'movie', 'bannertv:spring')).toBe(true);
      expect(supportsResource(parsed, resource, 'movie', 'tt1254207')).toBe(false);
      expect(supportsResource(parsed, resource, 'series', 'bannertv:spring')).toBe(false);
    }
    expect(supportsResource(parsed, 'subtitles', 'movie', 'bannertv:spring')).toBe(false);
  });

  it('gives every catalog item the artwork and text the Home hero shows', () => {
    const answer = parseCatalogResponse(catalog(ORIGIN, {}), 'movie');
    expect(answer.dropped).toBe(0);
    expect(answer.cache).toEqual({
      cacheMaxAge: 21600,
      staleRevalidate: 604800,
      staleError: 2592000,
    });
    expect(answer.metas).toHaveLength(FILMS.length);
    for (const item of answer.metas) {
      expect(item.posterShape).toBe('poster');
      expect(item.poster).toMatch(/^https:\/\/.+\/poster\.jpg$/);
      expect(item.background).toMatch(/^https:\/\/.+\/background\.jpg$/);
      expect(item.logo).toMatch(/^https:\/\/.+\/logo\.png$/);
      expect(item.description?.length).toBeGreaterThan(40);
      expect(item.releaseInfo).toMatch(/^\d{4}$/);
      expect(parseRuntime(item.runtime)).toBeGreaterThan(0);
      expect(item.genres.length).toBeGreaterThan(0);
    }
  });

  it('gives Details the credit, the director and no episode list', () => {
    for (const film of FILMS) {
      const { meta: detail } = parseMetaResponse({ meta: meta(ORIGIN, film) }, 'movie');
      expect(detail?.id).toBe(filmId(film));
      expect(detail?.description).toContain(film.licence.name);
      expect(detail?.description).toContain('Blender');
      expect(detail?.directors).toEqual(film.director);
      expect(detail?.videos).toEqual([]);
      expect(detail?.behaviorHints.defaultVideoId).toBeUndefined();
    }
  });

  for (const [label, tv] of Object.entries(TVS)) {
    it(`plays every film on ${label}, without a warning`, () => {
      for (const film of FILMS) {
        const list = entries(streams(ORIGIN, film), tv);
        expect(list).toHaveLength(2);
        for (const entry of list) {
          expect(entry.assessment).toEqual({ action: { kind: 'play' }, warnings: [] });
          expect(entry.facts).toMatchObject({
            resolution: '1080p',
            videoCodec: 'H.264',
            channels: '2.0',
            container: 'm3u8',
            hdr: [],
          });
          // Words like "TS" or a size would mislead the ranker.
          expect(entry.facts.releaseSource).toBeUndefined();
          expect(entry.facts.sizeBytes).toBeUndefined();
          expect(entry.facts.cached).toBeUndefined();
        }
        // Auto-play takes the primary copy first and falls back to the backup.
        const candidates = playableCandidates(list, 'quality', tv, {
          maxBitrate: 40e6,
          runtimeSeconds: film.durationSeconds,
        });
        expect(candidates.map((entry) => entry.rank)).toEqual([0, 1]);
        expect(qualityChoices(candidates).map((choice) => choice.resolution)).toEqual(['1080p']);
        // The backup is the same film at the same sizes, so it is never offered as a lighter copy.
        const [first, backup] = list;
        expect(first && backup && isLighter(backup.facts, first.facts, film.durationSeconds)).toBe(
          false,
        );
      }
    });
  }

  it('credits the film on the stream picker line the app shows', () => {
    const [film] = FILMS;
    if (!film) throw new Error('no films');
    const [primary, backup] = parseStreamResponse(streams(ORIGIN, film)).streams;
    expect(primary?.name).toBe(STREAM_NAME);
    expect(primary?.description?.split('\n')[0]).toBe(
      `${film.name} (${film.year}) · ${film.licence.name} · © Blender Foundation`,
    );
    expect(backup?.description?.split('\n').at(-1)).toBe('Backup copy');
    expect(primary?.behaviorHints.bingeGroup).toBe('bannertv-demo-hls');
    expect(primary?.behaviorHints.notWebReady).toBe(false);
  });

  it('carries English and Korean subtitle tracks the app recognises', () => {
    for (const film of FILMS) {
      const [primary] = parseStreamResponse(streams(ORIGIN, film)).streams;
      expect(primary?.subtitles.map((subtitle) => languageKey(subtitle.lang))).toEqual([
        'en',
        'ko',
      ]);
      for (const subtitle of primary?.subtitles ?? []) {
        expect(subtitle.url).toMatch(/^https:\/\/.+\/subs\/(eng|kor)\.vtt$/);
      }
    }
  });
});

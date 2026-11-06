import type { Stream } from '@bannertv/protocol';

/**
 * What BannerTV reads out of a stream's name and description, and what it
 * knows about the TV, so the stream picker can badge, warn and sort.
 */

export type Resolution = '2160p' | '1440p' | '1080p' | '720p' | '576p' | '480p' | '360p';

export type HdrFormat = 'DV' | 'HDR10+' | 'HDR10' | 'HDR' | 'HLG';

export type VideoCodec = 'AV1' | 'HEVC' | 'H.264' | 'VP9' | 'MPEG-2' | 'VC-1' | 'XviD';

export type AudioFormat =
  | 'Atmos'
  | 'TrueHD'
  | 'DTS:X'
  | 'DTS-HD MA'
  | 'DTS-HD'
  | 'DTS'
  | 'DD+'
  | 'DD'
  | 'AAC'
  | 'FLAC'
  | 'Opus'
  | 'MP3'
  | 'PCM';

export type Channels = '7.1' | '5.1' | '2.0' | '1.0';

/** Where the release came from, best first. CAM to SCR are recorded in cinemas. */
export type ReleaseSource =
  'REMUX' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'DVD' | 'SCR' | 'TC' | 'TS' | 'CAM';

export type Container = 'mkv' | 'mp4' | 'webm' | 'ts' | 'm3u8' | 'mpd' | 'avi' | 'mov';

export interface StreamFacts {
  resolution?: Resolution;
  /** Every HDR format named, best first. Dolby Vision streams often carry an HDR10 base layer too. */
  hdr: HdrFormat[];
  videoCodec?: VideoCodec;
  /** 10 for "10bit", "Main10", "HDR"; 8 when stated; otherwise unknown. */
  bitDepth?: 8 | 10 | 12;
  /** Every audio format named, best first. */
  audio: AudioFormat[];
  /**
   * The first audio codec named, Atmos aside (it rides on TrueHD or DD+).
   * Release names list the default track first, so this is the track the TV
   * plays unless the viewer picks another.
   */
  mainAudio?: AudioFormat;
  channels?: Channels;
  releaseSource?: ReleaseSource;
  /** From "💾 4.2 GB", "Size: 1.2GB", "4.2 GiB" and the like. */
  sizeBytes?: number;
  /** From "👤 123", "Seeders: 12", "S: 12". */
  seeders?: number;
  /**
   * Debrid cache state: true for "⚡", "+", "[RD+]", "Instant" and similar,
   * false for an explicit "download" or "uncached" marker, undefined when the
   * addon says nothing.
   */
  cached?: boolean;
  /** The debrid service the link goes through, as addons abbreviate it: RD, PM, AD, TB … */
  service?: string;
  /** ISO 639-1 codes from flags and words ("🇬🇧", "ENG", "French"), plus "multi" for "Multi". */
  languages: string[];
  /** From the file name or URL path. */
  container?: Container;
  /** The group that made the release ("framestor", "flux"), lower case, from a release name. */
  releaseGroup?: string;
  /** Named a sample, trailer, teaser or featurette: a short clip, not the video. */
  sample?: boolean;
}

/** What the TV can play, as far as BannerTV can tell. null means unknown. */
export interface TvCapabilities {
  /** The webOS TV release: 5, 6, 22, 23 … null off the TV. */
  webOS: number | null;
  /** A 4K panel and decoder. */
  uhd: boolean | null;
  hdr10: boolean | null;
  dolbyVision: boolean | null;
  hevc: boolean | null;
  av1: boolean | null;
  /** DTS audio. LG left it out of its 2020 to 2022 TVs and again from 2025. */
  dts: boolean | null;
  /** Dolby TrueHD audio. In none of LG's format tables, so false unless the TV says otherwise. */
  truehd: boolean | null;
  /**
   * The player can send an addon's request headers with the link (Android's
   * player). Left out where it cannot: webOS's `<video>` sends none of its own.
   */
  requestHeaders?: boolean;
}

/** Why a stream may not play well on this TV. Each becomes one plain sentence in the picker. */
export type StreamWarning =
  /** Dolby TrueHD: the TV can pass it to a receiver but not decode it itself. */
  | 'truehd'
  | 'dts'
  | 'av1'
  | 'hevc'
  /** Dolby Vision on a TV without it, with an HDR10 base layer: plays as HDR10. */
  | 'dolby-vision-as-hdr10'
  /** Dolby Vision on a TV without it and no HDR10 base layer named: colours may be wrong. */
  | 'dolby-vision-only'
  | 'uhd-on-hd-tv'
  | 'hdr-on-sdr-tv'
  /** AVI and other old containers the webOS pipeline handles poorly. */
  | 'old-container'
  /** Recorded in a cinema. */
  | 'cam'
  /** A debrid link the service has not cached: it would have to download first. */
  | 'uncached';

/** What pressing a stream does. */
export type StreamAction =
  | { kind: 'play' }
  | { kind: 'youtube' }
  | { kind: 'external' }
  | {
      kind: 'unavailable';
      /** torrent: needs a streaming server. proxy-headers: needs headers the player can't send. */
      reason: 'torrent' | 'proxy-headers';
    };

export interface StreamAssessment {
  action: StreamAction;
  warnings: StreamWarning[];
}

/** One stream in the picker, with everything worked out about it. */
export interface StreamEntry {
  stream: Stream;
  /** The addon's manifest id, for remembering which sources worked. */
  addonId: string;
  /** Position of its addon in the collection, 0 first. */
  addonRank: number;
  /** Position in its addon's answer, 0 first. */
  rank: number;
  facts: StreamFacts;
  assessment: StreamAssessment;
}

/**
 * quality: the best picture this TV plays well, first. fast: what starts
 * quickest (cached, 1080p and smaller files) first. addon: the addons'
 * priority, then each addon's own order, as Stremio lists them.
 */
export type StreamOrder = 'quality' | 'fast' | 'addon';

export interface OrderOptions {
  /** How often streams from an addon played before, 0 to 1 (0.5 when unknown). Breaks ties. */
  addonScore?: (addonId: string) => number;
  /**
   * The highest average bitrate, in bits per second, this TV's connection is
   * expected to keep up with. Streams estimated above it rank below every
   * stream within it, in the quality and fast orders. No limit when unset.
   */
  maxBitrate?: number;
  /** The video's running time in seconds, for estimating bitrates from file sizes. */
  runtimeSeconds?: number;
  /**
   * The audio language wanted, as the engine or the profile names it ("eng",
   * "es-MX"). In the quality and fast orders, streams that name only other
   * languages rank below the rest. Unset: none chosen, and streams that name
   * only languages other than English rank below the rest.
   */
  audioLanguage?: string;
  /**
   * The highest picture wanted first (a profile's Settings). Streams known to
   * be above it rank below the rest in the quality and fast orders.
   */
  maxResolution?: Resolution;
  /** HDR streams rank below the rest in the quality and fast orders (a profile's Settings). */
  avoidHdr?: boolean;
}

/** One line of the player's Quality menu: the best stream at that resolution. */
export interface QualityChoice {
  /** Undefined for streams whose resolution the addon did not say. */
  resolution: Resolution | undefined;
  entry: StreamEntry;
  /** ISO 639-1 codes, when the stream names only audio languages other than the one heard now. */
  otherLanguages?: string[];
}

/** What plays now: the Quality menu and a step-down look for the stream closest to it. */
export interface QualityReference {
  entry: StreamEntry;
  /** The playing audio track's language as the engine names it ("eng", "es-MX"), when known. */
  audioLanguage?: string;
  /**
   * The measured length of what plays now, in seconds, to tell clips by their
   * size. Undefined while live or unknown; never the title's running time.
   */
  lengthSeconds?: number;
}

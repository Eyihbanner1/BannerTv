import type { TvCapabilities } from '@bannertv/core';
import { parseChromiumMajor, webOSReleaseForChromium, webOSReleaseForSdkVersion } from './engine';
import { isWebOS, lunaCall } from './webos';

const UNKNOWN: TvCapabilities = {
  webOS: null,
  uhd: null,
  hdr10: null,
  dolbyVision: null,
  hevc: null,
  av1: null,
  dts: null,
  truehd: null,
};

/** Luna answers flags as booleans on some releases and as "true" / "false" on others. */
function flag(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 'TRUE') return true;
  if (value === false || value === 'false' || value === 'FALSE') return false;
  return null;
}

/** MSE answers for codecs are dependable on webOS, unlike canPlayType for containers (ADR 0001). */
function decodes(type: string): boolean | null {
  if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported) return null;
  if (MediaSource.isTypeSupported(type)) return true;
  const video = document.createElement('video');
  return video.canPlayType(type) !== '' ? true : false;
}

/** The webOS release, from the SDK version when the TV answers, else from the web engine. */
function releaseNumber(sdkVersion: unknown): number | null {
  const release =
    typeof sdkVersion === 'string'
      ? webOSReleaseForSdkVersion(sdkVersion)
      : (() => {
          const chromium = parseChromiumMajor(navigator.userAgent);
          return chromium === null ? null : webOSReleaseForChromium(chromium);
        })();
  const number = release === null ? NaN : Number(release);
  return isFinite(number) ? number : null;
}

/** LG dropped DTS from its 2020 to 2022 TVs, brought it back for 2023 and 2024, and dropped it again in 2025. */
function dtsByRelease(webOS: number | null): boolean | null {
  if (webOS === null || webOS === 23 || webOS === 24) return null;
  return false;
}

async function detect(): Promise<TvCapabilities> {
  // Off the TV (a laptop, Playwright) nothing is known, so no stream gets a TV warning.
  if (!isWebOS()) return UNKNOWN;
  const [system, configs] = await Promise.all([
    lunaCall<Record<string, unknown>>('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
      keys: ['UHD', 'sdkVersion'],
    }).catch(() => ({}) as Record<string, unknown>),
    lunaCall<{ configs?: Record<string, unknown> }>('luna://com.webos.service.config/getConfigs', {
      configNames: [
        'tv.model.supportHDR',
        'tv.config.supportDolbyHDRContents',
        'tv.model.edidType',
      ],
    }).catch(() => ({}) as { configs?: Record<string, unknown> }),
  ]);
  const c = configs.configs ?? {};
  const webOS = releaseNumber(system.sdkVersion);
  // The audio formats the TV declares, as Stremio reads them: "dts", "truehd" and so on.
  const edid =
    typeof c['tv.model.edidType'] === 'string' ? c['tv.model.edidType'].toLowerCase() : '';
  return {
    webOS,
    uhd: flag(system.UHD),
    hdr10: flag(c['tv.model.supportHDR']),
    dolbyVision: flag(c['tv.config.supportDolbyHDRContents']),
    // Main profile at level 4.1 (1080p): asking for 4K levels would fail on Full HD TVs that do decode HEVC.
    hevc: decodes('video/mp4; codecs="hvc1.1.6.L123.B0"'),
    av1: decodes('video/mp4; codecs="av01.0.08M.08"'),
    dts: edid ? edid.includes('dts') : dtsByRelease(webOS),
    // TrueHD is in none of LG's format tables.
    truehd: edid ? edid.includes('truehd') : false,
  };
}

let cached: Promise<TvCapabilities> | undefined;
let known: TvCapabilities = UNKNOWN;

/** What this TV can play. Asked once per launch; never rejects. */
export function tvCapabilities(): Promise<TvCapabilities> {
  if (!cached) {
    cached = detect().catch(() => UNKNOWN);
    void cached.then((caps) => (known = caps));
  }
  return cached;
}

/** The answer if it has arrived (unknown until then), for code that cannot wait. */
export function knownCapabilities(): TvCapabilities {
  void tvCapabilities();
  return known;
}

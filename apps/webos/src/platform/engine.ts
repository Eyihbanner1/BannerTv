/**
 * Which webOS release a TV runs, worked out from its web engine. Pure
 * functions, so they are tested off-device.
 *
 * Source: https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
 */

/** webOS 5.0, the oldest release BannerTV supports. index.html has the same check in ES5. */
export const MIN_CHROMIUM = 68;

/** Newest first: the first Chromium major that shipped with each webOS TV release. */
const RELEASES: ReadonlyArray<readonly [chromium: number, webos: string]> = [
  [132, '26'],
  [120, '25'],
  [108, '24'],
  [94, '23'],
  [87, '22'],
  [79, '6'],
  [68, '5'],
  [53, '4'],
  [38, '3'],
];

export function parseChromiumMajor(userAgent: string): number | null {
  // webOS 1 and 2 spell it "Chr0me".
  const match = /Chr[o0]me\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/** The webOS TV release that ships this Chromium, or null for anything older than webOS 3. */
export function webOSReleaseForChromium(major: number): string | null {
  for (const [chromium, webos] of RELEASES) {
    if (major >= chromium) return webos;
  }
  return null;
}

/**
 * Maps `platformVersion` from PalmSystem.deviceInfo (for example "7.6.0") to the
 * marketing name. From 2022 LG named releases by year: platform 7 is webOS 22.
 */
export function webOSReleaseForPlatformVersion(platformVersion: string): string | null {
  const major = Number(platformVersion.split('.')[0]);
  if (!Number.isInteger(major) || major < 1) return null;
  return major >= 7 ? String(major + 15) : String(major);
}

export function isSupportedEngine(userAgent: string): boolean {
  const major = parseChromiumMajor(userAgent);
  return major !== null && major >= MIN_CHROMIUM;
}

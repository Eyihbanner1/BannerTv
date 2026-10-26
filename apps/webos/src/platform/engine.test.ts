import { describe, expect, it } from 'vitest';
import {
  isSupportedEngine,
  parseChromiumMajor,
  webOSReleaseForChromium,
  webOSReleaseForPlatformVersion,
} from './engine';

const WEBOS_22 =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager';
const WEBOS_5 =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager';
const WEBOS_4 =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager';
const WEBOS_2 =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/538.2 (KHTML, like Gecko) Large Screen Chr0me/34.0.1847.131 Safari/538.2 WebAppManager';

describe('parseChromiumMajor', () => {
  it('reads the Chromium major version', () => {
    expect(parseChromiumMajor(WEBOS_22)).toBe(87);
    expect(parseChromiumMajor(WEBOS_2)).toBe(34);
  });

  it('returns null without a Chrome token', () => {
    expect(
      parseChromiumMajor('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Firefox/140.0'),
    ).toBeNull();
  });
});

describe('webOSReleaseForChromium', () => {
  it.each([
    [132, '26'],
    [120, '25'],
    [108, '24'],
    [94, '23'],
    [87, '22'],
    [79, '6'],
    [68, '5'],
    [53, '4'],
    [38, '3'],
    [34, null],
  ])('Chromium %i is webOS %s', (chromium, webos) => {
    expect(webOSReleaseForChromium(chromium)).toBe(webos);
  });

  it('treats patch-level engine bumps as the same release', () => {
    expect(webOSReleaseForChromium(91)).toBe('22');
  });
});

describe('webOSReleaseForPlatformVersion', () => {
  it.each([
    ['5.5.0', '5'],
    ['6.3.1', '6'],
    ['7.6.0', '22'],
    ['8.0.0', '23'],
    ['9.2.0', '24'],
    ['10.1.0', '25'],
    ['', null],
  ])('platform %s is webOS %s', (platform, webos) => {
    expect(webOSReleaseForPlatformVersion(platform)).toBe(webos);
  });
});

describe('isSupportedEngine', () => {
  it('accepts webOS 5 and newer', () => {
    expect(isSupportedEngine(WEBOS_5)).toBe(true);
    expect(isSupportedEngine(WEBOS_22)).toBe(true);
  });

  it('rejects webOS 4 and older', () => {
    expect(isSupportedEngine(WEBOS_4)).toBe(false);
    expect(isSupportedEngine(WEBOS_2)).toBe(false);
  });
});

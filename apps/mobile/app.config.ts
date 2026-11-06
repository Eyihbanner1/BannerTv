import type { ExpoConfig } from 'expo/config';
import appInfo from '../webos/webos-meta/appinfo.json';

/**
 * The phone app (ADR 0007). Its version is the LG app's, from appinfo.json, so the three apps
 * never drift apart. Until the store listing is decided this is a test build that installs
 * beside "BannerTV test" (the Android TV app on a phone) instead of over it.
 */
const PACKAGE = 'com.bannertv.app.phonetest';
const BACKGROUND = '#0B0815';

function versionCode(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

const config: ExpoConfig = {
  name: 'BannerTV phone test',
  slug: 'bannertv-phone',
  version: appInfo.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'bannertv',
  userInterfaceStyle: 'dark',
  backgroundColor: BACKGROUND,
  android: {
    package: PACKAGE,
    versionCode: versionCode(appInfo.version),
    adaptiveIcon: {
      backgroundColor: '#1B1430',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-foreground.png',
    },
    // No cloud backup: storage holds addon addresses that can carry debrid keys, and Trakt tokens.
    allowBackup: false,
    // Addon install links: Stremio's own (stremio://host/path/manifest.json, as an addon's
    // settings page gives them), and an address shared from another app ("Share to BannerTV").
    // Both open Addons to ask before adding, for grown-ups only (src/nav/addon-links.ts); the
    // share is read by modules/banner-share.
    intentFilters: [
      { action: 'VIEW', category: ['DEFAULT', 'BROWSABLE'], data: [{ scheme: 'stremio' }] },
      { action: 'SEND', category: ['DEFAULT'], data: [{ mimeType: 'text/plain' }] },
    ],
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: './assets/images/icon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: BACKGROUND, image: './assets/images/splash-icon.png', imageWidth: 96 },
    ],
    'expo-sqlite',
    ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    [
      'expo-font',
      {
        android: {
          fonts: [
            {
              fontFamily: 'Urbanist',
              fontDefinitions: [
                { path: './assets/fonts/Urbanist_500Medium.ttf', weight: 500 },
                { path: './assets/fonts/Urbanist_600SemiBold.ttf', weight: 600 },
                { path: './assets/fonts/Urbanist_700Bold.ttf', weight: 700 },
                { path: './assets/fonts/Urbanist_800ExtraBold.ttf', weight: 800 },
              ],
            },
          ],
        },
        ios: {
          fonts: [
            './assets/fonts/Urbanist_500Medium.ttf',
            './assets/fonts/Urbanist_600SemiBold.ttf',
            './assets/fonts/Urbanist_700Bold.ttf',
            './assets/fonts/Urbanist_800ExtraBold.ttf',
          ],
        },
      },
    ],
    [
      'expo-build-properties',
      // Addons and streams can be plain http, servers on the home network included.
      { android: { usesCleartextTraffic: true } },
    ],
  ],
  experiments: {
    typedRoutes: true,
    // Off: the shared screens' hooks read their stores during render (the TV runs no compiler),
    // and the compiler would keep the first answer, a stale profile or My List button.
    reactCompiler: false,
  },
};

export default config;

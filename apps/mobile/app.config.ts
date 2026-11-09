import type { ExpoConfig } from 'expo/config';
import appInfo from '../webos/webos-meta/appinfo.json';
import { hasUpdatesCertificate, UPDATES_CERTIFICATE, updatesChannel } from './build/updates';

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

/**
 * Over-the-air updates (ADR 0007): Expo's own client, expo-updates, asks BannerTV's updates
 * Worker for new JavaScript and images, and takes only what the publish workflow signed. Expo
 * checks by itself at each launch (ON_LOAD), so a broken update can always be replaced by the
 * next one, even if it breaks the app's own checks (src/runtime/app-updates.ts). It never waits
 * for the network at launch: what it downloads starts when the app starts again.
 *
 * Only an APK of main's own code takes updates, from main's channel: one from a run of CI started
 * by hand on main. A pull request's or the combined test build's APK keeps the JavaScript it was
 * built with, the code being tested, and takes none (build/updates.js says how it knows).
 *
 * Fail closed: with no certificate to check signatures against, expo-updates would take an
 * update nobody signed. So a build without certs/certificate.pem takes no updates at all and
 * runs only the JavaScript inside its APK. Updates begin with the first APK of main built after
 * the certificate is committed.
 */
const CHANNEL = updatesChannel();
const UPDATES: NonNullable<ExpoConfig['updates']> = {
  url: 'https://updates.bannertv.workers.dev/expo/manifest',
  checkAutomatically: 'ON_LOAD',
  fallbackToCacheTimeout: 0,
  ...(CHANNEL && hasUpdatesCertificate()
    ? {
        requestHeaders: { 'expo-channel-name': CHANNEL },
        codeSigningCertificate: UPDATES_CERTIFICATE,
        codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
      }
    : { enabled: false }),
};

const config: ExpoConfig = {
  name: 'BannerTV phone test',
  slug: 'bannertv-phone',
  version: appInfo.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'bannertv',
  userInterfaceStyle: 'dark',
  backgroundColor: BACKGROUND,
  // An update reaches only the APKs it fits: those with the same native fingerprint, worked out
  // with fingerprint.config.js as CI's decision to build an APK is. So new JavaScript never lands
  // on an APK that lacks the native code it needs.
  runtimeVersion: { policy: 'fingerprint' },
  updates: UPDATES,
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
    ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: true }],
    [
      // Match reminders are local notifications: nothing is pushed, so no push service is set up.
      'expo-notifications',
      {
        icon: './assets/images/android-icon-foreground.png',
        color: '#6A3BF0',
        enableRemoteNotifications: false,
      },
    ],
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

import type { ExpoConfig } from 'expo/config';
import appInfo from '../webos/webos-meta/appinfo.json';

/**
 * The native Android TV and Fire TV app (ADR 0008). A test build: it installs beside "BannerTV"
 * (com.bannertv.app, the web app in a WebView) under its own id, never over it. Its version is
 * the LG app's, from appinfo.json, as the phone app's is.
 */
const PACKAGE = 'com.bannertv.app.tvnative';
const BACKGROUND = '#0B0815';
const FONTS = '../mobile/assets/fonts';

function versionCode(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

const config: ExpoConfig = {
  name: 'BannerTV native test',
  slug: 'bannertv-tv-native',
  version: appInfo.version,
  orientation: 'landscape',
  icon: '../mobile/assets/images/icon.png',
  backgroundColor: BACKGROUND,
  android: {
    package: PACKAGE,
    versionCode: versionCode(appInfo.version),
    adaptiveIcon: {
      backgroundColor: '#1B1430',
      foregroundImage: '../mobile/assets/images/android-icon-foreground.png',
    },
    // No cloud backup: storage holds addon addresses that can carry debrid keys, and Trakt tokens.
    allowBackup: false,
    predictiveBackGestureEnabled: false,
    // Left in by the Expo template; nothing here draws over other apps, vibrates or reads files.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    [
      '@react-native-tvos/config-tv',
      {
        isTV: true,
        // The banner the Android TV launcher shows for the WebView app: 320x180.
        androidTVBanner: '../androidtv/app/src/main/res/drawable-xhdpi/banner.png',
      },
    ],
    ['expo-splash-screen', { backgroundColor: BACKGROUND }],
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
                { path: `${FONTS}/Urbanist_500Medium.ttf`, weight: 500 },
                { path: `${FONTS}/Urbanist_600SemiBold.ttf`, weight: 600 },
                { path: `${FONTS}/Urbanist_700Bold.ttf`, weight: 700 },
                { path: `${FONTS}/Urbanist_800ExtraBold.ttf`, weight: 800 },
              ],
            },
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
    // Off, as in the phone app: the shared hooks read their stores during render.
    reactCompiler: false,
    // metro.config.js does the aliases: tsconfig.json's paths are for the type checker only.
    tsconfigPaths: false,
  },
};

export default config;

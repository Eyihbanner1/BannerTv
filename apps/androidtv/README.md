# BannerTV for Android TV

The Android app for Android TV, Google TV, Fire TV (Fire OS 6 and later) and phones. It is a thin Kotlin shell around the same web build the LG app ships (`apps/webos/dist`):

- The web build is packed into the APK and served from `https://appassets.androidplatform.net/assets/web/index.html` by androidx.webkit's `WebViewAssetLoader`.
- Video plays in a native Media3 ExoPlayer `PlayerView` that sits under the transparent, full-screen WebView.
- The page talks to the app through `window.BannerAndroid` (protocol version 1), set out in [ADR 0005](../../docs/adr/0005-android-tv-app.md). The Kotlin side is `Protocol.kt` and the classes beside it; the page's side is `apps/webos/src/platform/android.ts` and the Android player engine. The stream helper's server and rules are in `helper-core/`, which the phone app builds too. Installing on devices: [docs/ANDROID_TV_SETUP.md](../../docs/ANDROID_TV_SETUP.md).

This is a plain Gradle build with no `package.json`, so `pnpm -r` skips it and the web build never needs the Android SDK.

## Build it

You need JDK 17 or newer and the Android SDK (API 37). Android Studio brings both; on the command line, point `ANDROID_HOME` at the SDK or put `sdk.dir` in `local.properties`.

1. Build the web app first, from the repo root: `pnpm install && pnpm build`. The Android build copies `apps/webos/dist` into the APK and stops with a clear message if it is missing.
2. Build the APK, from `apps/androidtv`: `./gradlew assembleDebug` (or open `apps/androidtv` in Android Studio).
3. The APK lands in `app/build/outputs/apk/debug/app-debug.apk`. Install it with `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

`./gradlew testDebugUnitTest` runs the JVM unit tests. `./gradlew assembleRelease` writes `app/build/outputs/apk/release/app-release.apk`.

The debug build installs beside the real app as `com.bannertv.app.debug`, named "BannerTV test", and its WebView can be inspected from `chrome://inspect`.

## Version

The version comes from `"version"` in `apps/webos/webos-meta/appinfo.json`, which must be `major.minor.patch`. The versionCode is `major * 1000000 + minor * 1000 + patch`, so 0.1.0 is 1000.

## Signing

Release builds are signed with the release key when all four of these environment variables are set:

| Variable | Value |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | Absolute path to the keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore's password |
| `ANDROID_KEY_ALIAS` | The key's alias |
| `ANDROID_KEY_PASSWORD` | The key's password |

Without all four, release builds fall back to the debug key. That is fine for testing but not for anything people install: every machine has its own debug key, and Android refuses an update signed with a different key unless the old app is uninstalled first, which wipes its data. Keep the release keystore backed up and out of the repo; losing it means nobody can update the app again.

## Never change the origin

localStorage and IndexedDB belong to the page's origin. Never change `https://appassets.androidplatform.net`, the `/assets/web/` path or the application ID `com.bannertv.app` after the first release, or every user loses their addons, profiles and progress.

## Icons

The launcher icons and the 320 by 180 TV banner are drawn from the brand SVGs. After a change to the brand, run `node apps/androidtv/tools/render-icons.mjs` from the repo root (it needs Playwright and Chromium).

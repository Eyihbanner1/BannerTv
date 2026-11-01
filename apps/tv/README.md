# BannerTV native TV app

The Android TV and Fire TV screens drawn natively with React Native for TV
([react-native-tvos](https://github.com/react-native-tvos/react-native-tvos)), instead of the LG
app's web page inside a WebView. Why, and what is shared, is in
[ADR 0008](../../docs/adr/0008-native-tv-app.md).

This is a test build: `com.bannertv.app.tvnative`, "BannerTV native test". It installs beside the
Android TV app and does not replace it.

## What is here

- `src/nav`: the screen stack the remote's Back walks down, and the remote's keys.
- `src/ui`: the focus ring, tiles, rows, buttons, sheets and the 1920 to device scale. Sizes,
  colours, motion and easing come from `brand/tokens/design.json`; `pnpm tokens` rebuilds the CSS
  and TypeScript made from it.
- `src/screens`: Home, title details, All streams, My List, Settings, "Who's watching?" and the
  welcome. Search, Discover and Sports say they are coming, in this build.
- `src/player`: the player's controls, tracks and quality sheets, Up Next and "Still watching?".
  The playback session, stream finder, subtitles and scrobbling are the LG app's, unchanged.

Below the screens it uses the LG app's data layer (`apps/webos/src`, as `@tv/*`) and the phone
app's browser stand-ins and expo-video bridge (`apps/mobile/src`, as `@phone/*`), as ADR 0007
describes.

## Installing

The app installs with npm on its own, not with pnpm, so the workspace's lockfile stays as it is
(`pnpm-workspace.yaml` leaves `apps/tv` out). Install the workspace first, because Metro reads
`@bannertv/core` and `@bannertv/protocol` through `apps/webos`.

```sh
pnpm install
cd apps/tv
npm install --no-audit --no-fund
```

`.npmrc` turns on `legacy-peer-deps`: packages ask for React Native `0.88.0`, and the TV fork's
`0.88.0-0` is a prerelease that does not satisfy that range, so npm would otherwise install a
second, phone React Native beside it. One consequence is that npm adds no peer dependencies
itself, so peers such as `vite` (for Vitest) are listed in `package.json`.

## Checks

```sh
npm run typecheck
npm test
EXPO_TV=1 CI=1 npx expo export --platform android   # bundles the JavaScript
```

The repository's `pnpm lint` and `pnpm format:check` cover these files too.

## Building the APK

CI's `TV APK (React Native)` job builds it and uploads `bannertv-tv-native-apk`. By hand, with a
JDK 17 and the Android SDK:

```sh
EXPO_TV=1 CI=1 npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
```

`EXPO_TV=1` makes `@react-native-tvos/config-tv` write the TV manifest: the Leanback launcher, the
TV banner, and no touch screen required.

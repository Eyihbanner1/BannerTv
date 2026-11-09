# BannerTV for phones

The phone app: React Native through Expo, upright and touch-first, on the same data layer as the LG and Android TV apps. The design is in [ADR 0007](../../docs/adr/0007-phone-app.md).

## Layout

- `src/app`: the screens' routes (expo-router). `(tabs)` holds Home, Search, Sports (shown only with a sports addon), My List and Settings.
- `modules/banner-relaunch`: a small native module that reports a launcher tap on the running app.
- `modules/banner-share`: a small native module that hands the app text shared to BannerTV, such as an addon's address.
- `modules/stream-helper`: runs the stream helper for an LG on the home network, with the Android TV app's server from `apps/androidtv/helper-core`.
- `modules/banner-cues`: a small native module that hands over the lines of the subtitles inside the file, so they are drawn in the profile's subtitle style.
- `src/screens`, `src/ui`: the phone's screens and their parts. Colours, type sizes and touch sizes come from `brand/tokens/design.json` (imported as `@brand/tokens/design`), the same tokens the TV apps use; change them there and run `node tools/scripts/build-tokens.mjs`.
- `src/player`: the player. `phone-host.ts` is the Android TV app's bridge over expo-video, so the TV's playback session runs unchanged.
- `src/runtime`, `src/shims`, `build/`: the browser stand-ins the shared code needs (storage, crypto, events).
- `@tv/*` imports come from `apps/webos/src`; nothing there changes for the phone.

## Commands

```sh
pnpm --filter @bannertv/mobile typecheck
pnpm --filter @bannertv/mobile test          # unit tests
pnpm --filter @bannertv/mobile export:web    # the web build the journeys use
pnpm --filter @bannertv/mobile e2e           # touch journeys on the web build
pnpm --filter @bannertv/mobile start         # Expo's dev server, for a phone with a dev build
```

The APK is built in CI only, on a full build or for the `phone-apk` label (the root README says when): the `Phone APK` job, artifact `bannertv-phone-apk`, for 64-bit Arm phones. A `full-ci` pull request that changes nothing the Android build reads gets no APK: Expo's native fingerprint decides (`fingerprint.config.js`, and the job's comments in `.github/workflows/ci.yml`). The `phone-apk` label builds a pull request's APK on its own, without the TV jobs; the combined test build and a run started by hand always build one too. The test APK skips R8 code shrinking, resource shrinking and lint vital to save build time, so turn them back on before any store build. It installs as "BannerTV phone test" beside the Android TV app's test build. Once `certs/certificate.pem` is committed, an APK of main built after it (a run started by hand on main) also takes signed over-the-air updates from the `updates` Worker, and only a native change needs a new APK. A pull request's or the combined test build's APK takes none, so it keeps running the code it was built to test (ADR 0007, decision 11).

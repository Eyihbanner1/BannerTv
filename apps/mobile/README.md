# BannerTV for phones

The phone app: React Native through Expo, upright and touch-first, on the same data layer as the LG and Android TV apps. The design is in [ADR 0007](../../docs/adr/0007-phone-app.md).

## Layout

- `src/app`: the screens' routes (expo-router). `(tabs)` holds Home, Search, Sports (shown only with a sports addon), My List and Settings.
- `modules/banner-relaunch`: a small native module that reports a launcher tap on the running app.
- `modules/banner-share`: a small native module that hands the app text shared to BannerTV, such as an addon's address.
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

The APK is built in CI only, on a full build (the root README says when one runs): the `Phone APK` job, artifact `bannertv-phone-apk`, for 64-bit Arm phones. It installs as "BannerTV phone test" beside the Android TV app's test build.

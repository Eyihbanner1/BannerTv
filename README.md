# BannerTV

A media center for LG webOS TVs that plays content from Stremio-compatible addons, built for the LG remote and Magic Remote.

BannerTV hosts no content of its own, apart from the BannerTV Demo addon (`services/demo`): three Creative Commons films from the Blender Foundation, preinstalled so a new TV has something to play. Users add addon URLs, and BannerTV browses, resolves and plays what those addons return.

## Status

Phase 1 (browse), in progress. Phase 0 put the app shell, remote navigation, packaging, CI and the spike screens in place; the first run on the webOS 22 TV is recorded in ADR 0001. Phase 1 so far: the Stremio addon protocol, an addon client with a two-tier cache, Cinemeta and OpenSubtitles v3 preinstalled, a Netflix-style Home built from addon catalogs with "See all", Details with seasons, episodes and trailers, Search across addons, Discover with type, catalog and genre pickers, and the Addons screen, where an addon can be sent from a phone by QR code, and its settings changed on the phone, through a small pairing relay (`services/pair`), and a first-run welcome (ADR 0002). That completes Phase 1 in code; its TV checks are listed in the pull request. Nothing plays yet: that is Phase 2.

- [Project plan](docs/PLAN.md): scope, addon protocol, webOS specifics, architecture, stack, UX, player, repository layout, milestones, testing, LG Content Store submission and risks.
- [TV setup](docs/TV_SETUP.md): Developer Mode, installing on the TV, and running the spikes.
- [ADR 0001](docs/adr/0001-react-norigin-classic-bundle.md): why React, Norigin and one classic ES2017 script, and the spike results.
- [ADR 0002](docs/adr/0002-addon-client-and-browse.md): how BannerTV reads addons, caches them, and builds Home and Details.
- [ADR 0003](docs/adr/0003-playback.md): playback, automatic stream choice and subtitles.
- [ADR 0004](docs/adr/0004-library-profiles-trakt.md): library, household profiles, Trakt and TMDB.
- [ADR 0005](docs/adr/0005-android-tv-app.md): the Android TV app, its player and the bridge between the two.
- [ADR 0006](docs/adr/0006-account-and-sync.md): the BannerTV account, how screens sync through it, and the `sync` Worker.
- [Android setup](docs/ANDROID_TV_SETUP.md): installing the Android app on a phone, an Android TV, a Fire TV or the emulator.

## At a glance

| | |
| --- | --- |
| Platform | LG webOS TV, packaged web app (.ipk), webOS 5.0 (2020) and newer. Android TV, Google TV and Fire TV (.apk), Android 7.1 and newer, from Phase 5 |
| Stack | TypeScript, React, Vite, Norigin Spatial Navigation |
| App ID | `com.bannertv.app` |
| Launch | United Kingdom, English, LG Content Store |
| Model | Free, optional donations |

## Getting started

Needs Node.js 22 and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev          # the app in a desktop browser at 1920x1080; arrows, Enter and Escape act as the remote
pnpm test         # unit tests
pnpm build        # apps/webos/dist, one classic ES2017 script
pnpm e2e          # remote journeys against the production build, loaded from file://
pnpm package      # out/com.bannertv.app_<version>_all.ipk
pnpm tv:install   # build, check, package, install and open on the TV
```

The Android app (`apps/androidtv`) is built by CI from the same `apps/webos/dist` on a full build (below); its APK is the run's `bannertv-apk` artifact. Building it locally needs Android Studio or the Android SDK and JDK 17 or newer: `pnpm build`, then `./gradlew assembleDebug` in `apps/androidtv`.

`pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm check:bundle` run in CI's quick check, with the unit tests and the build, on every push. `check:bundle` fails when the bundle uses syntax or built-ins newer than webOS 5.0's Chromium 68, or grows past its budget.

The journeys, the `.ipk`, the Android TV APK and the phone APK run only on a full build: every push to the combined test build (`test/all-together`), once each time the `full-ci` label is added to a pull request, or a run started by hand (Actions, CI, Run workflow). That keeps CI inside the 2,000 minutes a month GitHub Free gives this private repository. Pushes that change only Markdown or `docs/` run no CI.

## Layout

| Path | What lives there |
| --- | --- |
| `apps/webos` | The webOS app: React UI, remote navigation, webOS platform calls, `appinfo.json` |
| `packages/protocol` | Stremio addon protocol v3: types, lenient parsing of addon responses, request URLs and routing rules |
| `packages/core` | Framework-free TypeScript shared by any future client: addon collection, addon client, request limiter, cache, Home rows |
| `brand` | Logo, icons, splash, palette and type tokens |
| `tools/scripts` | Bundle, CSS and version checks, and the `tv:*` commands |
| `docs` | Plan, TV setup and architecture decision records |

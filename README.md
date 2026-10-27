# BannerTV

A media center for LG webOS TVs that plays content from Stremio-compatible addons, built for the LG remote and Magic Remote.

BannerTV hosts no content. Users add addon URLs, and BannerTV browses, resolves and plays what those addons return.

## Status

Phase 0 (foundations). The app shell, remote navigation, packaging and CI are in place, and a diagnostics screen and playback lab answer the plan's three spikes on a real TV. The first run on the webOS 22 TV is recorded in ADR 0001. No addons yet: Home shows sample tiles.

- [Project plan](docs/PLAN.md): scope, addon protocol, webOS specifics, architecture, stack, UX, player, repository layout, milestones, testing, LG Content Store submission and risks.
- [TV setup](docs/TV_SETUP.md): Developer Mode, installing on the TV, and running the spikes.
- [ADR 0001](docs/adr/0001-react-norigin-classic-bundle.md): why React, Norigin and one classic ES2017 script, and the spike results.

## At a glance

| | |
| --- | --- |
| Platform | LG webOS TV, packaged web app (.ipk), webOS 5.0 (2020) and newer |
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

`pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `pnpm check:bundle` run in CI with the rest. `check:bundle` fails when the bundle uses syntax or built-ins newer than webOS 5.0's Chromium 68, or grows past its budget.

## Layout

| Path | What lives there |
| --- | --- |
| `apps/webos` | The webOS app: React UI, remote navigation, webOS platform calls, `appinfo.json` |
| `packages/core` | Framework-free TypeScript shared by any future client. Addons, caching and user data arrive in Phase 1 |
| `brand` | Logo, icons, splash, palette and type tokens |
| `tools/scripts` | Bundle, CSS and version checks, and the `tv:*` commands |
| `docs` | Plan, TV setup and architecture decision records |

# BannerTV: webOS Streaming Platform Plan

Oct 26, 2026 · @Eyitayo

> Exported from the BannerTV plan doc. The doc is the living version; this file is refreshed when the plan changes.

## Summary

BannerTV is a webOS-native media center that plays content from Stremio-compatible addons, with Nuvio-style extras (Trakt sync, profiles, a customizable home screen) built for the LG remote from day one. It hosts no content of its own, apart from the BannerTV Demo addon's three Creative Commons films: users install addon URLs, and BannerTV browses, resolves and plays what those addons return.

**Goals**

- Full compatibility with the Stremio addon protocol, so every existing addon (catalogs, metadata, streams, subtitles) works without changes.
- A 10-foot interface that feels native on LG TVs: instant focus movement, Magic Remote pointer support, the Back key always does the expected thing, and smooth scrolling on 2020+ hardware.
- Playback that uses the TV's hardware decoders through the webOS media pipeline, including 4K HDR, HEVC and Dolby audio where the TV supports them.
- Watch progress, library and settings that survive reinstalls and sync across devices.
- Shipping in the LG Content Store, with a sideload (Developer Mode / Homebrew) build as the fallback channel.

**Non-goals for v1**

- Hosting, indexing or curating any media.
- A built-in torrent engine on the TV (see Risks). Torrent-based addons work only through a streaming server the user runs elsewhere.
- Samsung Tizen, Android TV or mobile apps. The core is kept platform-neutral so these can follow.

**Key decisions at a glance**

| Decision | Choice |
| --- | --- |
| App type | Packaged webOS web app (.ipk), plus a small JS service only if a feature needs it |
| Language and UI | TypeScript, React, Vite |
| Remote navigation | Norigin Spatial Navigation, with webOS key codes mapped centrally |
| Content model | Stremio addon protocol v3 (manifest, catalog, meta, stream, subtitles) |
| Player | Native HTML5 video on the webOS media pipeline first, hls.js or Shaka only as fallbacks |
| Accounts and sync | Local-first storage, optional Trakt, optional BannerTV sync backend in a later phase |
| Minimum platform | webOS 5.0 (2020 TVs) and newer. 2018 to 2019 TVs (webOS 4.x) are not supported |
| Repository | `Eyihbanner1/BannerTv` (private), a pnpm monorepo |
| App ID | com.bannertv.app (confirmed, permanent once uploaded) |
| Launch market | United Kingdom, English only |
| Business model | Free, with optional donations; no in-app payments |
| Primary test TV | LG 65NANO766QA, webOS 22 (7.6.0) |
| LG seller account | Individual seller in LG Seller Lounge |
| Logo | Prism Play: a play button cut into three violet facets, with an Urbanist wordmark. Files and colour tokens live in `brand/` in the repo |

## Product scope and feature parity

BannerTV reaches Stremio parity on browsing, addons and playback by the end of Phase 2, and picks up Nuvio's differentiators (profiles, Trakt-first Up Next, home customization) in Phases 3 and 5. Phases are defined under Milestones. Stremio and Nuvio columns come from the [ElfHosted Nuvio vs Stremio comparison](https://docs.elfhosted.com/nuvio/nuvio-vs-stremio/) and the community [Nuvio settings guide](https://nuvio-wiki.duckdns.org/settings/).

| Area | Feature | Stremio | Nuvio | BannerTV |
| --- | --- | --- | --- | --- |
| Addons | Install addon by manifest URL | Yes | Yes, same addons and config | Phase 1. Typed on screen, or sent from a phone via QR pairing |
| Addons | Configurable addons (settings page per addon) | Yes, opens a web page | Yes | Phase 1. Show the addon's configure URL as a QR code, phone returns the configured manifest URL |
| Addons | Preinstalled defaults | Cinemeta, OpenSubtitles, more | Its own defaults | Phase 1. Cinemeta and OpenSubtitles v3; PR #8 adds BannerTV Demo first. All removable |
| Addons | Addon catalogs (browse community addons) | Yes | Plugin repos by URL or QR | Phase 3 |
| Addons | Scraper plugins outside the addon protocol | No | Yes | Not planned. Addon protocol only, which keeps the store review simple |
| Browse | Home board, one row per catalog | Yes | Yes, plus Modern, Grid and Classic layouts | Phase 1 rows with a hero banner. Phase 3 reorder and hide rows |
| Browse | Discover with type, catalog and genre filters | Yes | Yes | Phase 1 |
| Browse | Search across all addons | Yes | Yes | Phase 1, on-screen keyboard plus webOS voice input |
| Browse | Details page, seasons and episodes, trailers | Yes | Yes, plus TMDB cast, networks, countdowns | Phase 1. TMDB enrichment in Phase 3 |
| Streams | Stream list grouped by addon | Yes | Yes, plus regex and first-source modes | Phase 2, as the "All streams" escape hatch, with parsed quality, size and codec badges |
| Streams | Reuse last link, auto-pick | Partial | Yes | Phase 2: Watch picks a working stream itself and plays it (see Choosing a stream). Per-title "reuse last link" in Phase 3 |
| Streams | Torrent streams (infoHash) | Local streaming server | P2P toggle | Phase 5, only through a streaming server the user runs on a PC or NAS |
| Streams | Debrid (Real-Debrid, TorBox, Premiumize) | Through addons | TorBox and Premiumize built in | Through addons in v1. Phase 4: link a debrid account by code from the TV, with an optional referral link (see Debrid accounts and referral links). Built-in debrid is a Phase 5 option |
| Player | Internal player | Yes | ExoPlayer or libmpv | Phase 2, HTML5 video on the webOS media pipeline |
| Player | Subtitles from addons, styling | Yes | Yes, plus libass for ASS | Phase 2 SRT and VTT with styling. ASS in Phase 5 |
| Player | Embedded audio and subtitle tracks | Yes | Yes, per-title memory | Phase 2. Audio through `audioTracks`; embedded subtitles are not exposed on webOS 22 and need a spike (see Player) |
| Player | Resume, next-episode autoplay, binge groups | Yes | Yes, plus "Still watching?" | Phase 2 |
| Player | Skip intro and outro | No | IntroDB, AniSkip | Phase 5 |
| Library | Save to library, continue watching | Yes | Yes | Phase 2 Continue Watching row on Home, kept on the TV (moved from Phase 3 on 27 October 2026). Phase 3 library, and Trakt sync of the same progress |
| Library | Calendar and new-episode alerts | Yes | Release countdowns | Phase 5 |
| Accounts | Trakt sync and scrobbling | Yes | Yes, plus Simkl and MDBList | Phase 3 Trakt. Simkl and MDBList in Phase 5 |
| Accounts | Profiles | No free profiles | Free profiles with cloud sync | Phase 3 local profiles. Cloud sync in Phase 5 |
| Accounts | Cross-device sync | Stremio account | Nuvio account | Phase 5, optional BannerTV sync service |
| Safety | Adult content and parental controls | Hides adult addons | Content warnings | Phase 3, profile PIN and adult-addon filter |
| Polish | Themes and languages | Many languages | Accent colours, true black, many languages | Phase 4, English first with i18n wired from Phase 0 |
| Polish | Backup and restore settings | Through account | Export and import | Phase 3, export via QR to phone |
| Apps | Phone companion app | No | No | Phase 5 option: browse and pick on the phone with touch, play on the TV, no focus navigation |

Nuvio also ships a Tizen and webOS smart-TV build ([NuvioTVSmart release notes](https://newreleases.io/project/github/NuvioMedia/NuvioTVSmart/release/0.3.20-beta)), so BannerTV needs a clear edge: native webOS feel, store availability and speed on older LG sets.

## Addon protocol and data compatibility

BannerTV implements the Stremio addon protocol v3 over HTTPS exactly as published, so an addon that works in Stremio works in BannerTV with no changes. The protocol is plain JSON over GET requests, which suits a TV web app well. Reference: the [Stremio addon SDK protocol](https://huggingface.co/spaces/no1b4me/hytranslator/blob/main/node_modules/stremio-addon-sdk/docs/protocol.md) and the [stremio-core resource types](https://mintlify.wiki/Stremio/stremio-core/addons/resources).

**Endpoints the client calls**

| Resource | Path (relative to the addon base URL) | Response | When BannerTV calls it |
| --- | --- | --- | --- |
| Manifest | `/manifest.json` | Manifest object | On install, then refreshed once a day |
| Catalog | `/catalog/{type}/{catalogId}.json` or `/catalog/{type}/{catalogId}/{extra}.json` | `{ metas: MetaPreview[] }` | Home rows, Discover, Search (`search=`), paging (`skip=`), genre filter (`genre=`) |
| Meta | `/meta/{type}/{id}.json` | `{ meta: MetaDetail }` | Details page, first addon whose `idPrefixes` match |
| Stream | `/stream/{type}/{videoId}.json` | `{ streams: Stream[] }` | Stream picker, fan-out to every matching addon |
| Subtitles | `/subtitles/{type}/{videoId}/{extra}.json` | `{ subtitles: Subtitle[] }` | Player start, with `videoHash` and `videoSize` when known |
| Addon catalog | `/addon_catalog/{type}/{catalogId}.json` | `{ addons: [...] }` | Phase 3 addon browser |

The base URL is the manifest URL with `/manifest.json` removed. Extra arguments are one path segment, query-string encoded, for example `search=game%20of%20thrones&skip=100`. Series videos use `{imdbId}:{season}:{episode}`, for example `tt0944947:1:1`. Other ID prefixes (such as `kitsu:` or `tmdb:`) are routed only to addons that declare them in `idPrefixes`.

**Request routing rules**

1. Keep the addon collection as an ordered list. Order decides which addon wins for `meta` and the order of rows on Home.
2. Only call an addon for a resource, type and ID prefix its manifest declares. Never guess.
3. Catalog and meta requests are sequential by priority with a 10 second timeout. Stream and subtitle requests fan out in parallel with a 15 second timeout per addon, and results render as each addon answers.
4. Cap concurrent requests at 6 and fetch only rows near the viewport. TV network stacks and CPUs are slow, and image decoding competes with JSON parsing.

**Caching**

- Honour `cacheMaxAge`, `staleRevalidate` and `staleError` from responses (seconds). Serve stale data instantly and refresh in the background.
- Two tiers: an in-memory LRU for the session and IndexedDB for catalogs, meta and manifests across launches. The webOS engine clears its HTTP cache when the app closes, so the IndexedDB tier is what makes the second launch fast.
- Never cache stream responses for more than a few minutes. Debrid links expire.

**Parsing and validation**

- Shared TypeScript types for `Manifest`, `MetaPreview`, `MetaDetail`, `Video`, `Stream`, `Subtitle`, validated with lenient Zod schemas. A bad item is dropped and logged, never the whole response.
- Support `posterShape` (`poster`, `square`, `landscape`), `links`, `trailers`, `behaviorHints.defaultVideoId` and `hasScheduledVideos`.
- Stream sources: `url` (play), `ytId` (trailer only, through the YouTube app or embed), `externalUrl` and `webosUrl` (open via the app manager), `infoHash` (needs a streaming server, Phase 5). Archive sources (`rarUrls` and similar) are ignored in v1.
- `behaviorHints.notWebReady` is **not** treated as unplayable. The webOS media pipeline plays MKV, HEVC and AC-3 that a desktop browser cannot, so BannerTV tries native playback first and explains failures clearly.
- `behaviorHints.proxyHeaders` streams need request headers that a `<video>` element cannot send. They are shown greyed out unless a streaming server is configured to proxy them.
- `bingeGroup` drives next-episode stream matching. `countryWhitelist`, `filename`, `videoHash` and `videoSize` feed filtering and subtitle matching.

**Integrations around the protocol**

- **Trakt**: device-code OAuth, which is built for TVs (show a code and URL, poll for the token). Scrobble start, pause and stop. Pull watched history and Up Next.
- **TMDB**: optional enrichment for artwork, textless backdrops, cast and episode stills. Needs a BannerTV API key and TMDB attribution on the About screen.
- **Stremio account import** (stretch goal): read a user's addon collection from their Stremio account so switching takes one step. This uses Stremio's unofficial API, so it stays optional.

**Security**

- Addons return data only. Never evaluate addon content, strip HTML from descriptions, and allow only `https:` and `http:` URLs for media and images.
- Store addon URLs carefully: configured addon URLs often embed the user's debrid API key, so they are never logged or sent to analytics.

## webOS platform specifics

BannerTV ships as a packaged webOS web app (.ipk): the UI runs in the TV's Chromium-based web engine and video plays through the TV's native media pipeline behind a standard `<video>` element. webOS 5.0 (Chromium 68, 2020 TVs) is the build baseline.

**Version support**

| webOS TV | Released | Web engine | BannerTV support |
| --- | --- | --- | --- |
| 26 | 2026 | Chromium 132 | Full |
| 25 | 2025 | Chromium 120 | Full |
| 24 | 2024 | Chromium 108 | Full |
| 23 | 2023 | Chromium 94 | Full |
| 22 | 2022 | Chromium 87 | Full |
| 6.x | 2021 | Chromium 79 | Full |
| 5.x | 2020 | Chromium 68 | Full, the build target |
| 4.x | 2018 to 2019 | Chromium 53 | Not supported (dropped) |
| 3.x and older | 2016 to 2017 | Chromium 38 or WebKit | Not supported, show a compatibility screen |

Source: [LG Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine). Chromium 68 rules out several modern features without transpiling or fallbacks: optional chaining (Chrome 80), flexbox `gap` (84), `aspect-ratio` (88), `:focus-visible` (86) and `backdrop-filter` (76). The build transpiles to ES2017 and the design system avoids those CSS features.

**Packaging and appinfo.json**

```json
{
  "id": "com.bannertv.app",
  "version": "0.1.0",
  "vendor": "BannerTV",
  "type": "web",
  "main": "index.html",
  "title": "BannerTV",
  "icon": "icon_80.png",
  "largeIcon": "icon_130.png",
  "splashBackground": "splash_1920x1080.png",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true,
  "handlesRelaunch": true
}
```

- `id`, `title`, `type`, `main`, `icon` and `version` are required for LG Apps. The `id` can never change after publishing, so it must be chosen before the first store upload.
- `version` is strictly `major.minor.patch` and a version number can be uploaded only once.
- Icons are 80x80 and 130x130 PNG, the splash is 1920x1080 PNG. Web apps render at 1920x1080 at most; 4K video still plays at full resolution in the video plane. Reference: [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json).

**Developer tooling**

- webOS TV CLI (`ares-*` commands, installed from npm): `ares-setup-device` registers the TV, `ares-novacom --getkey` pulls its key, `ares-package` builds the .ipk, `ares-install` and `ares-launch` deploy and start it, `ares-inspect` opens Chrome DevTools against the running app. Reference: [CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide).
- Developer Mode app on the TV: needed for real-device testing, lasts 1000 hours before sideloaded apps are removed (reset from the app), and one LG developer account can be active on one TV at a time ([webOS Brew](https://www.webosbrew.org/devmode/)).
- webOS TV Simulator per version for fast UI work on a laptop. Playback and performance must be checked on real TVs.

**Remote control input**

| Key | keyCode | BannerTV behaviour |
| --- | --- | --- |
| Arrows | 37, 38, 39, 40 | Spatial navigation |
| OK | 13 | Activate focused item |
| Back | 461 | Close overlay, then go back a screen, then exit on the root screen |
| Red, Green, Yellow, Blue | 403, 404, 405, 406 | Shortcuts, for example Yellow = add to library, Blue = subtitle menu in the player |
| Play, Pause, Stop | 415, 19, 413 | Player transport |
| Fast forward, Rewind | 417, 412 | Seek plus or minus 10 seconds, hold to accelerate |

Source: [Magic Remote guide](https://webostv.developer.lge.com/develop/guides/magic-remote).

- **Back key**: with `disableBackHistoryAPI: true` the app's router owns key 461. On the root screen, call `webOS.platformBack()`, which shows the system exit prompt on webOS 6+ and returns to Home on 5.x, matching LG's rules ([Back button guide](https://webostv.developer.lge.com/develop/guides/back-button)). A long press always exits to Home.
- **Magic Remote pointer**: pointer mode behaves like a mouse, so hover moves focus and the wheel scrolls rows. Pressing an arrow switches to 5-way mode and hides the pointer, signalled by the `cursorStateChange` event. Every feature must work in both modes.
- **Text input**: use the system on-screen keyboard on focused inputs. Long text (addon URLs) also gets phone entry through a QR pairing page.

**Lifecycle**

- `webOSLaunch` on first start and `webOSRelaunch` when the icon is pressed while running. `handlesRelaunch: true` lets BannerTV route deep links before coming to the foreground ([App lifecycle](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)).
- `visibilitychange` to hidden means another app took over: pause playback, save progress, stop timers. The user can terminate a suspended app with no warning, so progress is also saved every 10 seconds during playback.
- Packaged apps run from `file://`: cookies are not supported and the HTTP cache is cleared on exit. Settings go in localStorage, data and caches in IndexedDB.

**Luna services (through webOSTV.js)**

| Need | Service or API |
| --- | --- |
| Model, firmware, 4K and HDR capability | `webOS.deviceInfo()` and `com.webos.service.tv.systemproperty` |
| Open trailers in YouTube, open a URL in the browser | `com.webos.applicationManager` launch |
| Network up or down | `com.webos.service.connectionmanager` |
| UI language, audio output | `com.webos.settingsservice` |
| Exit or return to Home | `webOS.platformBack()` |

Exact method names and permissions get confirmed in the Phase 0 spike. A webOS JS service (Node.js running beside the app) is avoided in v1. It adds memory pressure and review risk, and nothing in the v1 scope needs it.

**Media pipeline facts that shape the player**

- Containers: MP4, MKV, TS and more. Video: H.264, HEVC Main and Main10 up to 4K60, VP9 (MKV) and AV1 up to 4K60 on webOS 6.0. Audio: AAC, Dolby Digital and Dolby Digital Plus, DTS listed for MKV on 6.0 (varies by model year). Source: [AV formats on webOS TV 6.0](https://webostv.developer.lge.com/develop/specifications/video-audio-60).
- HLS plays natively (v7 on webOS 5+). DASH is not listed for the native player, so DASH streams go through MSE with Shaka Player. MSE and EME follow the W3C recommendations from webOS 5.0. HTTP/2 needs webOS 5.0. Source: [Streaming protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).
- Native subtitle support is WebVTT only, so BannerTV renders SRT and VTT itself in an overlay.
- The `mediaOption` parameter on the `<source>` type passes a resume position and adaptive-streaming limits to the native player ([mediaOption parameters](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter)).
- Native HLS does not support playback speeds other than 1.0. BannerTV offers a speed only where Settings > Lab measured this TV keeping it, with sound, for that kind of stream.

## Architecture

BannerTV is split into a thin React app that only draws screens and handles the remote, and a framework-free core that owns addons, caching, user data and playback decisions. The core never touches the DOM, so it is unit-tested on a laptop and can be reused for a Tizen or web build.

![BannerTV architecture: app, core, outside services](images/architecture.png)

Screens send actions down to the core and subscribe to its state; only the core talks to addons, Trakt, TMDB and the video element.

**What happens when the user presses Play**

1. The Details screen asks the core for streams for a video ID such as `tt0944947:1:1`.
2. The addon client calls every addon whose manifest declares `stream` for that type and ID prefix, in parallel, and pushes results into the store as each addon answers.
3. The user picks a stream. The playback controller chooses the engine (native, Shaka or hls.js), loads saved progress and sets the start position through `mediaOption`.
4. The player UI draws the overlay and subtitles. Progress is written to user data every 10 seconds and scrobbled to Trakt.
5. Near the end, the controller finds the next episode from the series meta and the stream with the same `bingeGroup`.

**State management**

- The core exposes plain observable stores: addons, catalogs, meta, streams, library, progress, settings, profiles.
- React reads them through small Zustand bindings (`useSyncExternalStore` under the hood), so a screen re-renders only when its slice changes.
- Focus memory and the Back stack live in the app layer, because they are about the remote, not the data.

**Storage**

| Data | Where | Notes |
| --- | --- | --- |
| Settings, active profile | localStorage | Small, read synchronously at boot |
| Addon collection and manifests | IndexedDB | Per profile |
| Catalog and meta cache | IndexedDB | Expiry from `cacheMaxAge`, capped at 50 MB with least-recently-used eviction |
| Library, progress, history | IndexedDB | Per profile, exportable for sync |
| Trakt tokens, configured addon URLs | IndexedDB | Contain secrets, never logged or sent to crash reports |

**Background work**

There is no background service in v1. Manifest refresh and prefetching of the first two Home rows run at launch and when the UI is idle. The only server pieces are the phone-pairing relay (Phase 1) and the optional sync API (Phase 5), which uses last-write-wins per item with timestamps.

## Tech stack recommendation

Use TypeScript, React 18 and Vite, with Norigin Spatial Navigation for the remote and a framework-free core package for everything that is not UI. This keeps the hard logic (addons, library, sync, player state) testable on a laptop and portable to Tizen or the web later, while the UI stays fast on a 2020 TV.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, strict mode | One type model shared by core, UI and the later sync service |
| UI | React 18.3 | Large ecosystem, works on Chromium 68 with transpiling; React 19 can follow later, since webOS 4.x is dropped |
| Remote navigation | `@noriginmedia/norigin-spatial-navigation` | Proven on Smart TVs, focus trees per screen, works with the Magic Remote pointer |
| State | Zustand for UI and session state, plain TypeScript stores in core | Small, no provider tree, easy to persist |
| Data validation | Zod, lenient schemas | Addon responses vary wildly in quality |
| Storage | `idb` over IndexedDB, localStorage for small settings | Survives restarts; the webOS HTTP cache does not |
| Styling | CSS Modules plus design tokens as CSS custom properties | No CSS-in-JS runtime cost on slow CPUs |
| Lists | Hand-rolled virtual rows and grids | Only render tiles near the viewport; posters are the main memory cost |
| Player | Native `<video>` first, Shaka Player for DASH, hls.js for HLS with alternate renditions or when native fails | Hardware decoding through the webOS pipeline wherever possible; webOS 22 hides HLS alternates from the native player |
| Subtitles | Own SRT and VTT parser and renderer, JASSUB (libass in WebAssembly) later for ASS | Native support is WebVTT only |
| i18n | i18next | Strings externalized from day one |
| Build | Vite with a classic (non-module) script bundle, ES2017 target. One bundle only, since webOS 4.x is dropped | Module scripts loaded from `file://` can be blocked by CORS in Chromium; verify in Phase 0 |
| Tests | Vitest, Testing Library, Playwright with arrow-key journeys, MSW for addon mocks | Most bugs are focus and data bugs, which these catch off-device |
| Monorepo | pnpm workspaces | Shared core, app and tools packages |
| CI | GitHub Actions: lint, test, build, `ares-package`, attach .ipk to releases | Every merge yields an installable build |
| Crash reporting | Sentry browser SDK, opt-in | Real-device errors are otherwise invisible |
| Sync service (Phase 5) | Hono on Node with Postgres, hosted on Render or Cloudflare | Small API for profiles, library and progress |

**Alternatives considered**

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Enact (LG's React framework with Spotlight and Sandstone) | Official, spatial navigation and TV-tuned virtual lists built in, native webOS look | Tied to LG's look and tooling, smaller community, harder to port to Tizen | Runner-up. Revisit if Norigin focus handling struggles in Phase 1 |
| Lightning JS or Solid with Lightning (WebGL canvas UI) | Best frame rates on weak TVs | No DOM or CSS, harder accessibility and text input, steep learning curve | Not for v1 |
| Preact or plain JavaScript | Smallest bundle | More infrastructure to build by hand | Preact can swap in via `preact/compat` if bundle size hurts |
| Reuse stremio-core compiled to WebAssembly (as Stremio Web does) | Proven behaviour, identical models to Stremio | Couples BannerTV to Stremio's API and accounts, no WebAssembly path on old engines, license review and a Rust toolchain needed | Not chosen. BannerTV's own core mirrors the same semantics |

## UX and navigation

Every screen is designed for a 5-way remote first and a pointer second, viewed from 3 metres away, and the Back key always closes the topmost thing on screen. A collapsed left rail (Home, Search, Discover, Library, Addons, Settings) is the only global navigation.

**Screens**

| Screen | Purpose | Key elements | Phase |
| --- | --- | --- | --- |
| First run | Get to a playable catalog in under a minute | Welcome, default addons preinstalled, optional "add addons from your phone" QR, optional Trakt link | 1 |
| Home | Lean-back browsing | Hero banner for the focused title, Continue Watching row, one row per addon catalog | 1 (Continue Watching in 2) |
| Discover | Filtered browsing | Type, catalog and genre pickers, poster grid with paging | 1 |
| Search | Find a title fast | On-screen keyboard, recent searches, results grouped by type then addon | 1 |
| Details | Decide what to watch | Backdrop, logo, synopsis, rating, cast, trailer, season tabs, episode list with watched marks, library toggle | 1 |
| Stream picker | Choose a source | Streams grouped by addon, quality, size, codec and HDR badges, sort and filter, "remember choice" | 2 |
| Player | Watch | Minimal overlay, seek bar with thumbnails when available, audio and subtitle menus, Up Next card at the end | 2 |
| Library | Saved titles and history | Tabs for Movies, Series and History, sort by recently watched or added | 3 |
| Addons | Manage addons | Installed list with reorder, configure, remove; install by URL, QR or addon catalog | 1, catalog in 3 |
| Settings | Preferences | Playback, Subtitles, Appearance, Integrations, Profiles, About and licenses | 1 to 4 |
| Profile picker | Multi-user households | Avatars, optional PIN, kids profile | 3 |

**Spatial navigation rules**

1. Each screen owns a focus tree. When a screen is reopened, focus returns to the last focused element.
2. Each row remembers its own last focused tile. Moving up or down lands on that tile, not on column 0.
3. Rows scroll so the focused tile stays at a fixed anchor position near the left. This reduces motion and keeps the hero banner meaningful.
4. Left from the first tile opens the rail. Up from the top row reaches the hero. No dead ends and no focus traps.
5. Back order: close a menu or dialog, then leave the player, then go to the previous screen, then return to Home's first row, then exit via `webOS.platformBack()`.
6. Holding an arrow repeats at one move per 100 ms at most, so the UI never builds a backlog of key events.
7. In pointer mode, hover moves focus, the wheel scrolls rows, and paging arrows appear at row edges. They are hidden in 5-way mode.
8. Overlays (stream picker, menus) are focus-isolated layers; focus cannot leak to the screen underneath.

**10-foot design system**

- Canvas 1920x1080 with a 5% safe area (96 px left and right, 54 px top and bottom).
- Type scale: body 24 px minimum, row titles 32 px, screen titles 48 px, hero title 64 px. One bundled font with a Latin subset to keep the package small.
- Dark theme by default, near-black background rather than pure black for LCD panels, with a true-black option for OLED. Text contrast at least 4.5:1.
- Tiles: poster 2:3 at 220x330, landscape 16:9 at 384x216, square at 240x240. Image requests sized to the tile, never full-size artwork.
- Focus: 1.08 scale plus a 4 px accent ring. The ring is not colour-only, so it works for colour-blind users.
- Motion: transform and opacity only, 150 to 200 ms. A low-power mode (auto-enabled on webOS 5.x) drops the hero video, blur and scaling.

**Accessibility**

- Support LG Audio Guidance by setting `accessibility.supportsAudioGuidance` in appinfo.json and labelling every focusable element with ARIA.
- Subtitle size, colour, background and position settings. A larger-text option for the whole UI.
- Never rely on colour keys alone: every colour-key shortcut also exists as a visible button.

## Player and playback

One playback controller in the core drives three interchangeable engines, and the native webOS pipeline is always tried first because it is the only path with full hardware decoding, HDR and Dolby audio. A failed or stalled stream never strands the user: the controller offers the next best stream in one press. Phase 2's choices are recorded in [ADR 0003](adr/0003-playback.md).

**Engine selection**

| Stream type | Engine | Notes |
| --- | --- | --- |
| Progressive MP4, MKV, WebM, TS over HTTPS | Native `<video>` | Most debrid and direct links. Hardware HEVC, AV1, HDR10 and Dolby Vision where the TV supports them |
| HLS (`.m3u8`) | Native `<video>` | hls.js over MSE when the master playlist has alternate audio or subtitle renditions (native lists only one audio track and no subtitles on webOS 22), or when native fails. hls.js fetches every segment itself, so a host that blocks it before the first picture hands the link back to native |
| DASH (`.mpd`) | Shaka Player 5 over MSE | Not listed for the native player |
| YouTube (`ytId`) | Launch the YouTube app | Trailers only |
| `externalUrl`, `webosUrl` | Launch via the application manager | Opens the target app or browser |
| Torrent (`infoHash`) | User's streaming server, then native | Phase 5 |
| Streams with `proxyHeaders` | User's streaming server proxy, then native | Phase 5 |

**Choosing a stream**

Most people should never see a list of links. Watch picks a stream that will play and starts it, the way Netflix's Play button does; the list stays one press away for those who want it.

1. **Ask early.** All stream addons are asked in parallel when focus rests on a title's Watch button or an episode for 1.5 seconds, never on Home and never during playback. The answers are kept, so Watch starts at once.
2. **Read and rank.** Each stream's name and description are parsed for resolution, HDR type, codec, audio, size, seeders and debrid-cached markers. Torrents and links that need proxy headers are left out. Streams that would likely give no picture or no sound (DTS or TrueHD on TVs without them, Dolby Vision with no HDR10 base on a TV without it, HEVC or AV1 without a decoder, 4K on an HD TV, uncached debrid links) go to the back, tried only when nothing else is left. The rest are ranked by the resolution the TV can show, cached state, HDR, release source, which addons have played on this TV before (a per-addon tally of plays and failures, never the links themselves), seeders, then the addons' own order; camcorder copies go last. "Fastest start" puts cached 1080p and smaller files first. In both, a file too big for the connection (its size over the running time, against a limit that starts at 40 Mbit/s and learns from what this TV has played) comes after every file within it, so a 4K web release beats an 80 GB disc remux that would keep buffering.
3. **Test the best link.** One hidden video element loads just the metadata of the top candidates, one at a time with a 2 second cap, on Details only after the focus rest, and stops when focus moves or the player opens (most LG TVs have one video decoder).
4. **Play and fail over.** If a stream fails before or during playback, the next one starts at the same position, with a short "trying another" note. If it keeps stopping to buffer, a lighter one starts at the same position and the limit is lowered for next time. A stream picked by hand from the list does not fail over, and one picked in the Quality menu is not swapped for a lighter one.
5. **Choices.** The player's Quality menu switches between 4K, 1080p and 720p at the same position. "All streams" lists everything, best first, with badges and the reason any stream cannot play. Settings has "Best quality" or "Fastest start", and link testing on, off or automatic.
6. **Lite mode.** On webOS 5, automatic means no link testing until it is measured on the floor TV.
7. **While it starts,** the title's backdrop and logo show under a shimmer, not a spinner with text.

**Tracks and subtitles**

Phase 0 results on webOS 22 (details in [ADR 0001](adr/0001-react-norigin-classic-bundle.md)): `audioTracks` lists both audio tracks of an MKV, `textTracks` lists none of its 8 subtitle tracks, and native HLS lists one audio track and no subtitles for a stream that has alternates.

- Audio tracks, direct play: `HTMLMediaElement.audioTracks`, exposed on webOS 22, and switching is audible. The webOS 5 floor TV gets the same check. Where it is missing, show the default track and point users to a stream with their language.
- Audio and subtitle renditions, HLS: hls.js, which reads the renditions from the playlist itself, whenever the master playlist declares alternates.
- Embedded subtitles, direct play: not exposed through `textTracks` on webOS 22. The webOS media pipeline's own Luna API (`com.webos.media`: `subscribe` for the track list, `setSubtitleEnable` and `selectTrack` keyed by the video element's `mediaId`) is used by Lampa, Stremio and Nuvio but is unofficial, and has frozen playback on webOS 25. On the webOS 22 TV (two runs on 28 October 2026) its calls answered OK and listed the tracks but drew no subtitle, so the player does not use it and the subtitle menu offers addon subtitles.
- Addon subtitles are the main subtitle path: they always work because BannerTV renders them itself, so OpenSubtitles v3 stays a default addon.
- Addon subtitles (OpenSubtitles v3 and others): asked with the stream's file name, hash and size so they match the release, fetched with `fetch` (webOS appears to relax CORS for packaged apps; checked on the TV in Phase 2), gunzipped when needed, and decoded after detecting the text encoding (byte-order mark, then strict UTF-8, then the language's code page such as Windows-1251 or 1256).
- Subtitles are grouped by language, the last chosen language first; each language's versions (the stream's own tracks first, then each addon's files) are listed beside it. A file that cannot be read is replaced by the next one in the same language, and its row says so.
- Renderer: SRT, VTT and ASS/SSA (as styled text) parsed into cues, drawn in an overlay above the video plane. Settings for size, colour, background and vertical position, and a timing offset in 0.1 and 0.5 second steps kept for each subtitle file. Cues from hls.js and Shaka go through the same renderer.
- When the remembered audio language has two tracks, the one whose stream marks it, or whose name says it, is a commentary gives way to the other (the playing track stays if it is not a commentary, or if every track in that language is one; "No commentary" is not one). On sport, whose main sound is often named "commentary", only the stream's own mark counts.
- ASS and SSA styling through JASSUB is a Phase 5 item for webOS 6+; until then ASS is shown as plain text.

**Progress, resume and next episode**

- Save the position every 10 seconds, on pause and when the app is hidden. Mark as watched at 90% (configurable).
- Resume with "Resume from 42:10" or "Start over" once 30 seconds have played, but not in the last minute. A rewatch resumes too, unless it stopped past 90%. A series offers its latest episode as "Resume S1:E3". The resume position is passed to the native player with `mediaOption` so the TV starts at the right spot instead of seeking after load. On webOS 22 this works for HLS and MP4. With `mediaOption`, `currentTime` reads 0 at the first `playing` event and the real position about 55 ms later, so progress is only saved once the clock has moved past the resume point, never from that first 0.
- Playback health: `getVideoPlaybackQuality()` reports no frames at all on webOS 22, so dropped frames cannot be counted. Stall detection and the "try the next stream" offer use `waiting` and `stalled` events and a timer.
- Up Next card in the last 30 seconds, counting down to the real end of the episode so nothing is cut. It shows only over the picture alone and never takes focus from the controls, a sheet or a skip; with the controls up, the Next episode button counts instead. Rewinding into the last 30 seconds brings it back. An end held by a sheet counts 10 seconds once the sheet goes. The next video ID comes from the series meta, and the stream is the one with the same `bingeGroup` from the same addon, falling back to the automatic choice.
- "Still watching?" in place of the third episode in a row to start by itself with nothing pressed, or after 90 minutes without a key (Settings can turn it off).
- Sleep timer, in the Info sheet: 15, 30, 45, 60 or 90 minutes, or the end of the episode or film. A minute before, a card in the corner offers 15 minutes more or turning it off; then the video pauses under a dark screen.
- Trakt scrobble start, pause and stop events (Phase 3).

**Player controls**

| Input | Action |
| --- | --- |
| OK | Play or pause, and show the controls; land a skip on its way at once. With the Magic Remote pointer on the picture, show or hide the controls instead, unless the wheel has moved focus or brought the controls up since the pointer last moved: then OK is the focused control's (Pause, after a notch with the controls hidden) |
| Left, Right | Skip 10 seconds a press, 30 then 60 while held; the total lands 0.8 seconds after the last press |
| Up, Down, wheel | Show the controls, on Pause. Down from the transport reaches the tools, Up from the tools comes back to Pause, Up again reaches the bar; with the controls up, the wheel moves a row a notch the same way, stopping at the bar as Up does (a notch with focus still on the picture, as the pointer leaves it, goes to Pause). The wheel never skips (Eyitayo, 30 October 2026) |
| Blue | Open or close the audio and subtitle sheet |
| Play, Pause, Stop | Mapped to transport; Stop leaves the player |
| Fast forward, Rewind | The same 10 second skips as Left and Right; on a live broadcast they jump at once |
| Back | Cancel a skip, hide the controls, then leave the player (progress saved); just after the controls fade by themselves, ask again first |
| Magic Remote pointer | Moving shows the controls; a click on the picture shows or hides them, or presses the focused control after the wheel moved focus (the Magic Remote's OK is a click alone while the pointer shows, as the TV check found); a click on the bar jumps there; the back arrow at the top left leaves |

The controls are two tiers over the bottom of the picture, from the redesign Eyitayo picked on 29 October 2026 (built in four steps, each tried on the TV first):

- Top: a back arrow for the pointer, the title, three facts (resolution, HDR, sound), the clock and "Ends at".
- The bar: time played, then the bar, then time left ("−12:40"). On a broadcast LIVE takes the place of the time played, with a red dot while it plays live; behind live the dot goes grey, the time on the right says how far behind ("−0:42"), and the bar is what the broadcast keeps.
- Transport, icons with their names under them, in fixed places: Start over, Back 10 s, Play or Pause (larger, in the middle), Forward 10 s, then Next episode (anything with an episode list) or, on a broadcast, Go to live.
- Tools, as chips saying what is on now: Audio & subtitles (the subtitle language, with the Blue key's dot), Quality (the resolution playing), Sources, Episodes (anything with an episode list) and Info (the sleep timer, when one is set).
- Nothing comes or goes while the video plays. A control that can't be used now stays in its place, dimmed, and says why (an icon under it when focused, a chip in place of its value): Start over on a broadcast, Next episode with no next one (last, not out yet, or no episode list), Quality with one quality found, Episodes with no list, and Forward 10 s and Go to live while a broadcast plays live.
- The controls win over Up Next: its card shows only over the picture alone, and the Next episode button counts down while the controls are up.

The audio and subtitle sheet (step 3) rises from the bottom over the lower half of the picture. The picture above stays bright, the controls make way for it, and the subtitle line sits just above it, so a style or timing change shows as it is made.

- Tabs along its top say what is on now: Subtitles (the language, or Off), Audio ("English 5.1"), Timing ("+0.5 s"), Style ("Large, yellow"). Left and Right move along them; each shows its choices below as it takes focus. The pointer passing over a tab does not switch it: a click does.
- Subtitles: Off and the languages on the left, the language in focus's versions on the right (with the pointer, the language clicked). Versions are named by source, numbered where a source sent several ("OpenSubtitles v3 2"), with the release name when the addon sends one. A version says "Loading…" until its first line is ready, "Couldn't load" (or "Couldn't load, skipped" once another took over) when it can't be read, and "Matches your video" when its release name agrees with the stream's on at least two of episode, resolution, source and group, and differs on none (a best guess, shown only when both names exist). The stream's own subtitles are one more version of their language, listed first. Pressing a language picks its first version that loads; pressing the language showing goes to its version.
- Audio: one row per track, with its format and channels when the engine gives them (hls.js and Shaka do; the TV's own player gives only the language and the name inside the file) and the track's own name when it says more.
- Timing: −0.5 s, −0.1 s, +0.1 s, +0.5 s and Reset, said as "Subtitles 0.5 s later" or "earlier", kept for that subtitle file (as a hash: never a link) and for at most 300 files.
- Style: each choice shown as it looks (Aa at each size, colour swatches, Aa on each background, a picture of each position) and Reset to default. A sample line shows above the sheet while nobody speaks. Settings opens the same choices in the same sheet.
- Back goes from a tab's choices to the tabs, then closes the sheet onto the controls; Blue or a click above it closes it where it was opened. The controls can't fade behind it, and rows keep their places while more addons answer.

Step 4 made the other tools sheets of the same kind, over the picture, which keeps playing:

- Sources: every stream the addons offered, in the same order as All streams, with the one playing ticked. Back goes back to the film, where it was, on the same stream.
- Episodes: seasons on the left, the season in focus's episodes on the right.
- Info: what plays (the addon, the release, its size, picture, sound and how it is played) and what it is, then tabs for Speed and the sleep timer. The plan's "More" chip became these tabs, so the tools row keeps five chips.
- Speed: Normal and the speeds Settings > Lab passed on this TV for the kind of stream playing (the TV's player on a file or on HLS, hls.js, Shaka), each measured against the clock and checked for sound by the tester. The tab shows only once any speed has passed, and in the Lab, where it runs the test. Diagnostics lists what each kind passed.
- Quality keeps to streams in the audio language playing and of about the same length, so a switch never lands on a dub, a trailer or a sample.

**Known limits to explain in the UI**

- Audio passthrough (Atmos, TrueHD) is decided by the TV's sound output settings and eARC, not by the app.
- Dolby Vision profile 7 (Blu-ray remux) often plays as the HDR10 base layer only.
- Native HLS has no playback speed control, so Speed shows only where the Lab passed it.
- Media errors are mapped to plain messages, for example "This TV can't decode TrueHD audio. Try a stream with DD+ audio.", with a "Try next stream" button.

**Resource hygiene**

- Reuse one `<video>` element. On exit, clear `src` and call `load()` so the hardware decoder is released.
- While the player is open, drop poster images from Home rows to free memory, and restore them on return.

**Debrid**

In v1, debrid works through addons: the user configures an addon with their Real-Debrid, AllDebrid, TorBox or Premiumize key, and the addon returns plain HTTPS links that play natively. Phase 4 adds linking a debrid account from the TV and an optional referral link (see Debrid accounts and referral links). BannerTV itself resolving streams through a linked account is a Phase 5 option.

## Repository structure

The code lives in one pnpm monorepo at [Eyihbanner1/BannerTv](https://github.com/Eyihbanner1/BannerTv), a private repository. This plan is kept there as `docs/PLAN.md`.

```text
bannertv/
├── apps/
│   ├── webos/                 TV app: React UI and webOS glue
│   └── androidtv/             Android TV app: Kotlin shell showing the same build, with ExoPlayer (Phase 5)
│       ├── webos-meta/        appinfo.json, icons, splash
│       ├── src/
│       │   ├── app/           shell, router, back stack, providers
│       │   ├── screens/       Home, Discover, Search, Details, Streams, Player, Library, Addons, Settings
│       │   ├── components/    Tile, Row, Grid, Rail, Dialog, Keyboard, Badge
│       │   ├── navigation/    spatial navigation setup, key map, focus memory
│       │   ├── platform/      webOSTV.js wrappers, Luna calls, capability detection
│       │   ├── player/        engines (native, Shaka, hls.js), subtitle renderer, overlay
│       │   └── styles/        design tokens, global CSS
│       ├── index.html
│       └── vite.config.ts
├── brand/                     logo, webOS icons, store images, colour tokens
├── packages/
│   ├── protocol/              Stremio addon types and Zod schemas
│   ├── core/                  addon client, cache, library, progress, settings, profiles (no DOM, no React)
│   └── integrations/          Trakt, TMDB, OpenSubtitles helpers
├── services/
│   ├── pair/                  tiny relay for "send addon URL from phone" (Phase 1)
│   └── sync/                  profiles, library and progress sync API (Phase 5)
├── tools/
│   └── scripts/               ares-cli wrappers, release and version scripts
├── docs/
│   ├── PLAN.md                this plan
│   ├── adr/                   architecture decision records
│   └── store/                 UX scenario document, self-checklist, screenshots
├── .github/workflows/         ci.yml, release.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

**Conventions**

- `main` is protected and only changes through pull requests with green CI.
- Conventional Commits (`feat:`, `fix:`, `chore:`), short-lived branches named `feat/...` or `fix/...`.
- Git tags `vX.Y.Z` always equal the `version` in appinfo.json, enforced by a script in CI.
- Each big decision gets a one-page ADR in `docs/adr` (for example "0001 React and Norigin over Enact").
- Secrets (TMDB key, Trakt client ID, Sentry DSN) are injected at build time from GitHub Actions secrets and never committed.

**CI and release pipelines**

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Every pull request | Install, typecheck, lint, unit tests, build, Playwright journeys at 1920x1080 with arrow keys, `ares-package`, upload the .ipk as an artifact |
| `release.yml` | Tag `v*` | Build, package, attach the .ipk to a GitHub Release, publish a Homebrew Channel repository manifest for sideload users |
| `services.yml` | Changes under `services/` | Test and deploy the pairing relay, later the sync API |

The phone pairing feature needs the small `pair` relay because a webOS web app cannot listen for connections: the TV shows a QR code with a short code, the phone page posts the addon URL to the relay, and the TV polls for it. Entries expire after 10 minutes and nothing else is stored.

## Milestones and phases

A private beta that browses and plays is ready at the end of week 10, and the store launch follows around week 18 if one developer works on it full time. Each phase ends at a gate that must pass before the next starts.

![BannerTV roadmap: 6 phases, 5 gates](images/roadmap.png)

Phase 4 also includes the optional debrid account step (see Debrid accounts and referral links), which isn't on the roadmap image.

Phases 0 to 2 are the minimum product; if time runs short, Phase 3's profiles and TMDB enrichment slip, never the Phase 2 playback gate.

On 27 October 2026 the Continue Watching row moved from Phase 3 into Phase 2, since resuming from Home is part of playing. It reads the progress the player saves on the TV: the first row on Home shows what was left part-way, most recent first, with a progress bar and the episode, and OK goes straight back into the player (or into the next episode after a finished one). Phase 3 keeps the library, profiles and Trakt, which will sync the same progress.

On 28 October 2026 Phase 3 started before PR #4 and PR #6 merged, built on the playback branch the way Phase 2 was built on Phase 1 (design in [ADR 0004](adr/0004-library-profiles-trakt.md)). Built so far:

- [x] Local profiles, up to six: "Who's watching?" at launch, an avatar in the rail to switch, a four-digit PIN that locks for 30 seconds after five wrong tries, and kids profiles with a highest UK rating that see only Family titles, no Addons and a short Settings
- [x] My List on Details, and a Library section with My List and History
- [x] Home rows: show, hide and move each row, per profile
- [x] Audio and subtitle languages remembered per title
- [x] BannerTV's API Worker (`services/api`), which holds the Trakt and TMDB keys so the app and the repository never do
- [x] Trakt: sign-in with a code entered at trakt.tv, sync of paused progress, watched ticks and My List both ways, and scrobbling from the player
- [x] TMDB on Details: UK rating, studio or network, cast photos, episode stills and summaries, and a logo and backdrop where the addon has none; a kids profile cannot play a title rated above its rating
- [ ] Deploy the API Worker and put its secrets, `TRAKT_CLIENT_ID` and `TMDB_API_KEY` (plus `TRAKT_CLIENT_SECRET` only for a Trakt app that has one; Trakt issues none to apps made since October 2026), as Eyitayo, from the laptop: see `services/api/README.md`. Until then Trakt and TMDB stay hidden in the app
- [ ] Try Trakt and TMDB on the TV once the Worker is up

Still to come, as ADR 0004 lists: settings backup to a phone, the addon catalog browser, per-title reuse of the last link, and the sports organisation that the sports thread plans in PR #7.

On 30 October 2026 Phase 5 started, with Phase 4 (the LG Content Store) on hold, because BannerTV is for every screen, not only LG. It runs in this order:

- [x] Android TV app: the same build in a Kotlin WebView shell, with video in Android's ExoPlayer under the page (design in [ADR 0005](adr/0005-android-tv-app.md), setup in [ANDROID_TV_SETUP.md](ANDROID_TV_SETUP.md)). Built by CI as an APK
- [ ] Try it on Eyitayo's Android phone, then on an Android TV or Fire TV device
- [ ] A BannerTV account, so profiles, addons, My List, Continue Watching and settings follow a person between the LG and Android: sign-in with an account code and no email, data encrypted on the device before it is sent, and a small `sync` Cloudflare Worker that Eyitayo deploys
- [ ] Phone apps (Android, then iOS), sharing `packages/core`

**Phase 0 tasks to start with**

- [x] Eyitayo creates the `Eyihbanner1/BannerTv` repository and confirms the app ID
- [x] Scaffold the monorepo: pnpm, TypeScript, Vite, ESLint, Vitest, and a CI job that outputs an .ipk
- [ ] Enable Developer Mode on the LG 65NANO766QA (webOS 22) and register it with `ares-setup-device`. The first install used the rooted TV's own install service instead, so this path is untested
- [x] Spike 1 on webOS 22: the classic script bundle loads from `file://`. webOS 5 waits for the floor TV
- [x] Spike 2: `audioTracks` lists MKV audio tracks; `textTracks` lists no embedded subtitles; native HLS hides alternate renditions
- [ ] Spike 3: `mediaOption` start position works for HLS and MP4; HDR10 file not tested yet. This TV has no Dolby Vision, so profile 8 waits for a TV that has it
- [x] Spatial navigation skeleton: rail, two rows of tiles, Back key handling
- [x] Record the spike results in ADR 0001 and adjust this plan where they differ
- [ ] Buy a used 2020 LG TV on webOS 5 as the performance floor, before the end of Phase 1

## Testing, QA and performance

Most bugs are caught off-device in CI, but no release ships until it passes a real-TV checklist on at least three model years, with the 2020 low-end TV as the performance floor.

**Test layers**

| Layer | Tool | Covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Protocol parsing, routing, caching, stream badge parsing, subtitle parsing, progress maths | Every pull request |
| Component | Vitest and Testing Library | Focus behaviour of Row, Grid, Rail, Dialog, Keyboard | Every pull request |
| Addon contract | Recorded fixtures from about 20 popular addons, plus a live smoke run | Compatibility with real-world addon responses | Fixtures per pull request, live nightly |
| End to end | Playwright, Chromium at 1920x1080, keyboard only, webOS key codes | First run, browse to play with a test file, Back stack, search | Every pull request |
| Simulator | webOS TV Simulator per version | Layout and engine differences | Weekly |
| Device | Real TVs via `ares-install` and `ares-inspect` | Playback matrix, performance, memory, soak | Before every release |

**Device matrix (minimum)**

- webOS 5.x, a 2020 entry-level LG UHD LCD. This is the performance floor. Not owned yet; buy a used one before the end of Phase 1.
- webOS 22: Eyitayo's LG 65NANO766QA (webOS 22, 7.6.0, Chromium 87). This is the primary development TV from day one.
- webOS 24 or newer, ideally an OLED for Dolby Vision and Atmos checks.

**Playback matrix**

Built from legal test media (Blender open movies and public codec samples), each file played through the full stream path on every device in the matrix:

- MP4, H.264 and AAC, 1080p
- MKV, HEVC 10-bit HDR10 with DD+, 4K
- MKV, HEVC Dolby Vision profile 8, 4K
- MKV, AV1, 4K
- MKV with DTS audio, and MKV with TrueHD Atmos (expected: warning or graceful failure)
- HLS with multiple audio renditions; DASH via Shaka
- External SRT in Windows-1252 and UTF-8; VTT with styling
- Resume at 1 hour into a 2 hour file; next-episode handoff

**Performance budgets (measured on the webOS 5.x floor TV)**

| Metric | Budget |
| --- | --- |
| Cold start to interactive Home, with cache | 3 s or less |
| First launch, no cache | 6 s or less |
| Key press to visible focus change, p95 | 100 ms or less |
| Holding an arrow across a row | 30 fps or better on 5.x, 60 fps on webOS 22+ |
| Initial JavaScript, gzipped (Shaka and hls.js lazy-loaded) | 600 KB or less |
| JavaScript heap on Home | 150 MB or less |
| DOM nodes on Home | 3,000 or fewer |
| Stream selected to first frame, debrid HTTPS link | 4 s or less on a good connection |
| .ipk size | 15 MB or less |

Performance marks feed a hidden debug overlay (opened with a colour-key sequence) so testers can read numbers on the TV without a laptop attached.

**Release QA checklist**

- [ ] Back key correct on every screen, exit prompt on the root screen
- [ ] Every control reachable by 5-way and by pointer
- [ ] Network cable pulled during playback and during browsing: clear message, recovery on reconnect
- [ ] App hidden and relaunched during playback: paused, progress saved, resumes cleanly
- [ ] 4 hour playback soak with no crash or memory growth
- [ ] Empty states: no addons, every addon offline, no streams found
- [ ] Long titles, right-to-left text in metadata, missing artwork
- [ ] Language switch and subtitle styling persist after restart
- [ ] LG self-checklist items filled with real results

## Packaging, deployment and LG Content Store

BannerTV ships through two channels: the LG Content Store for everyone, and GitHub Releases for beta testers and sideloading. Each store submission, including every update, goes through LG review, so plan about three weeks per submission and keep urgent fixes on the beta channel until approved.

**Store submission steps**

1. Create an LG account and register in [LG Seller Lounge](https://webostv.developer.lge.com/distribute/app-ecosystem) as an individual seller (decided). Your personal name is shown as the Seller ID. A corporate account is only worth it if BannerTV ever takes payments.
2. Register the App ID. It is permanent and must equal `id` in appinfo.json.
3. Upload the production .ipk built by `release.yml`. The version must be new; a version number can be uploaded only once.
4. Upload store assets: icon 400x400 or larger, tile colour as an exact hex, a primary screenshot at 1280x720, 2 to 5 more screenshots, launcher and splash backgrounds at 1920x1080, plus name and description for each language ([Brightcove's LG submission guide](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html)).
5. Fill in Test Info: the App Self Checklist with real results (an empty or thin checklist is an automatic rejection) and the UX scenario document describing every screen and flow ([App approval process](https://webostv.developer.lge.com/distribute/app-approval-process)).
6. Fill in Service Info: countries, category (Entertainment), age rating.
7. Submit. LG runs a pretest (submitted information), a function test (no errors) and a content test (no inappropriate content). Fix the listed issues and resubmit if rejected.

**Making the app reviewable**

BannerTV has no content of its own, so a tester who opens it needs something legal to play. The store build preinstalls a small first-party "BannerTV Demo" addon, first in the list, with three Creative Commons films from the Blender Foundation, then Cinemeta for metadata and OpenSubtitles v3 for subtitles. The Demo is described in `docs/DEMO_ADDON.md` (PR #8). The UX scenario document walks the tester through browsing, playing, subtitles and adding an addon by URL.

**Store build rules**

- No third-party stream addons preinstalled or promoted. Users add addons by URL themselves, the same model Stremio uses in the LG store.
- A first-run notice that, apart from BannerTV Demo, BannerTV hosts no content and that users are responsible for the addons they install.
- The adult-content filter is on by default.
- No debrid screens in the first store submission: it is built with `debrid=off`. Link only can follow in an update after LG has answered question 11. The referral screen comes only after LG has answered in writing, the provider has agreed in writing and the legal review is done (see Debrid accounts and referral links).

**UK launch, donations and domain**

- Launch in the United Kingdom only, in English. Adding countries later is a Service Info change in Seller Lounge, not a new build.
- Donations: a QR code on the About screen that opens an external page such as Ko-fi or GitHub Sponsors. With no in-app payments, an individual Seller Lounge account is enough. Check the Seller Lounge guide on external payment links before submitting; if they are not allowed in the app, keep the link on the website only.
- No domain is needed for the app ID. The submission still needs a privacy policy URL and a deep-link test URL you control, so host both on GitHub Pages until a domain (for example bannertv.co.uk) is bought.

**Beta and sideload channel**

- Every tagged release attaches the .ipk to GitHub Releases.
- Testers install through Developer Mode with webOS Dev Manager or `ares-install`. Developer Mode installs disappear after 1000 hours unless the timer is reset.
- Rooted TVs can install and auto-update through a Homebrew Channel repository manifest published by the release workflow.

**Release train**

- Monthly store releases after launch, with beta builds weekly.
- `version` in appinfo.json and the git tag move together; patch versions for fixes, minor versions for features.

## Debrid accounts and referral links (Phase 4)

Eyitayo added this to Phase 4 on 27 October 2026. BannerTV gets an optional step for linking a debrid account. A user without an account sees a provider's details and a QR code to Eyitayo's referral link, opens it on their phone and buys their own account there. They then link that account to the TV with a code. Anyone can link an account they already have, and nothing in BannerTV ever depends on having one.

Bundling a debrid account behind a BannerTV subscription was considered and ruled out. All four providers below limit an account to personal use by its holder. Real-Debrid, Premiumize and TorBox forbid reselling or giving others access without their written permission, and AllDebrid only allows its accredited voucher resellers. TorBox and Premiumize do license resellers. Even so, bundling would turn BannerTV from a neutral player into a seller of access to streams, which is the step the legal notes below warn against.

**What the research found** (27 October 2026; details and sources below)

- **The reward is free premium days, not money.**
  - TorBox pays in premium days, and so does Real-Debrid according to a 2024 copy of its FAQ.
  - AllDebrid's referral scheme was reported closed in 2026; even while it ran, a referral was worth about one or two days.
  - Premiumize's terms stopped mentioning referrals in April 2026. It now agrees deals with established sites case by case, which might include money.
  - So the referral mostly pays for Eyitayo's own subscription.
- **Linking from the TV works for all four.** Each has a code flow: the TV shows a short code and the user enters or approves it on their phone.
  - For AllDebrid, Premiumize and TorBox, a QR code can fill the code in. Real-Debrid's QR code can only open the page.
  - AllDebrid may first email the user to approve a new location.
  - For Real-Debrid, BannerTV would have to be open source to use the shared client ID. Any other route means shipping a secret inside the app, and Real-Debrid says it must stay secret.
- **Two providers need written permission first.**
  - TorBox's API terms require written authorisation for any public app and for using its name. Its partner pages treat integrations as partner-programme territory. That programme is application-only, takes no projects with zero users and screens out "sketchy, illegal" ones.
  - Premiumize's terms forbid commercial use, earning money from the service and using its marks without written permission.
  - Real-Debrid's and AllDebrid's referral rules are behind a login, so Eyitayo needs to read them while signed in and ask in writing.
- **The biggest risk is the store, not the code.**
  - No rule on this was found in LG's public pages. The full self-checklist ZIP couldn't be downloaded, and the app policy LG's content test applies isn't published. That test rejects content that aims to commit a crime or helps someone do so. Changes after approval need another review.
  - Stremio's store listings never mention debrid.
  - Google suspended Stremio for 19 days over the 2025–26 new year without giving a reason. In 2026 it reportedly suspended Nuvio, another client for Stremio addons, after a DMCA complaint from the Motion Picture Association. Nuvio had reportedly already removed its built-in TorBox integration in May 2026, citing the risk.
  - Apple and Amazon removed Stremio in January 2026.
  - A referral screen also earns the developer a reward for each sign-up to a stream-access service. That weakens the neutral-client position the store build relies on.

**Decision** (Eyitayo, 27 October 2026). Build the step in Phase 4 behind a build switch. The first store submission is built with the step off. Each part reaches a public build only once its conditions are met. Beta builds on GitHub Releases are public too.

- **Linking.** A provider's link screen appears in beta builds once that provider has agreed in writing. Linking joins the store build in an update once LG has also clearly approved it in writing (STORE.md, question 11).
- **Referral screen.** It needs the provider's written agreement and a short legal review before it appears in any build. It needs LG's clear written approval as well before it reaches the store build.
- **What counts as approval.** An LG reply that doesn't clearly approve the screen, such as "it will be checked in QA", counts as no.

This protects the first approval, which is the Phase 4 gate. LG locks an app out for three months after a fifth function-test rejection in a row, or a third round rejected for the same issue as the first two (STORE.md). A lock-out also stops bug-fix updates. If LG rejects an update over the referral screen, resubmit with link only or with the step off, never with the same screen.

**Providers compared**

| | Real-Debrid | AllDebrid | Premiumize | TorBox |
| --- | --- | --- | --- | --- |
| Run by | XT Network SAS, France | Vulnerator SARL, France | Meta Connect Ltd, Labuan, Malaysia (Malaysian law); servers and data in the EU | TorBox, a UAE company since July 2026 |
| Referral reward | 5 premium days and 50 points when a new user follows the link before paying. The 15-day plan, reseller vouchers and reseller payments don't count, and the bonus can't be added after payment. Users reported points vanishing in mid-2026 (all reported; from a July 2024 copy of the FAQ, as the official page returned 403) | About 5 points per referral (10 for a plan of 90 days or more), first purchase only; 150 points = 30 days, so roughly 1 to 2 days a referral. Programme reported discontinued in 2026 (reported; the rate page dates from 2020) | Terms no longer mention a referral programme since April 2026 (probably ended; unconfirmed, as the account area needs a login). The webmaster programme offers free days, trial vouchers or "even money" to established sites by arrangement | 7 days per month bought, for both people, on the first purchase only. The referrer must have a paid plan, or the new user gets nothing either. The link only counts if the user is signed in on the phone and accepts TorBox's popup before paying; support won't add a missed code. No cash |
| Link from the TV | Device code typed at real-debrid.com/device (a QR code can only open the page). Shared client ID for open-source apps only | 4-character PIN, with a QR link that fills it in. No app registration. A new location may need the user to approve an email | Device code with a QR link that fills it in. BannerTV must register its own client on a page that needs a login | 6-digit code with a QR link. No registration; the app passes its name. The token appears to be the account's main API key, so unlinking one TV may mean resetting it for every app |
| Permission | No API or referral rules published (the referral page needs a login). The terms forbid reproducing site content, so no logos without permission | Same as Real-Debrid | Written permission for commercial use and for the name or logo | Written authorisation for a public app and for the name or logo; it can audit or disable an integration without notice |
| Price, as listed | €3 for 15 days, €4 for 30, €9 for 90, €16 for 180, one-off in EUR (reported by three third-party sources, latest September 2026; the official page returned 403) | €2.99 per 30 days as a card-only subscription that renews, or one-off from €3.99 for 30 days to €24.99 for 300; some payment methods cost more | €9.99 a month or €69.99 a year; "VAT may apply depending on your region" | Free plan (1 download a day, 10 a month: enough to test linking, not to watch); Essential $3, Standard $5, Pro $10 a month |
| Watch out for | Since November 2024, filters after a notice from French film distributors, the cache check removed and a stated aim (reported) to block "counterfeit Kodi / Stremio applications". Since May 2026, files removed by keyword, so cached files can disappear. One IP at a time (reported) | In November 2024 it reportedly refunded new subscribers and dropped a feature used through third-party apps. It refuses link unlocking from server IPs, so addons that resolve links on a server fail. Old API versions get switched off. One IP at a time (reported) | Rebranded as "personal cloud storage" in April 2026, but its API still offers torrent cache and direct links, including Rapidgator, 1fichier and Streamtape, which are on the USTR 2025 Notorious Markets List. Household use allowed; unapproved third-party apps are at the user's risk | API terms ban using its tools for any catalogue or workflow for infringing content |

**Which providers.** Approach TorBox and Premiumize first. Both have code flows built for TVs and a channel for asking. A provider that doesn't agree in writing gets no screens at all. Real-Debrid and AllDebrid stay as they are today, with their keys entered in addons, unless their written terms allow more. Real-Debrid linking also needs BannerTV's source to be published.

**How it works on the TV**

1. **Where it appears.** Settings, then Integrations, then **Linked services**, next to Trakt, with each provider listed by name. Store builds add nothing to the welcome screen. Beta builds may offer an optional **Link an account** button there, and skipping it never brings it back as a prompt. The screens never appear in a kids profile, and sit behind the profile PIN where one is set.
2. **Have an account?** Choose the provider, then **Link this TV**.
   - BannerTV starts the provider's code flow. It shows the code, the plain address to type it at, and a QR code that fills the code in where the provider supports it.
   - It checks back at the interval the provider gives. When the code runs out, **New code** gets another.
   - A linked account shows the plan, the expiry date and **Unlink**.
   - The screen says what linking does: "Linking shows your plan and expiry date in BannerTV. BannerTV doesn't use the account for anything else yet. Addons that support TorBox take your key in their own settings."
3. **Need an account?** This opens a list labelled **Ad**, which says: "These services give BannerTV's developer a reward when you sign up through BannerTV." Providers are listed alphabetically, focus starts on Back, and there's no "recommended" badge. Each provider then gets its own screen:
   - An **Ad** label at the top, before the QR code, in a colour that contrasts with the background.
   - The provider's name as text (logos only with permission), who sells it, and a factual line on what it is, for example: "TorBox is a paid cloud download and storage service, sold by TorBox. Some addons can use a TorBox account. BannerTV works without one."
   - The disclosure, which must match the provider's actual deal. For TorBox: "If you buy TorBox through this QR code, BannerTV's developer gets extra days on the developer's own TorBox plan. On your first purchase, TorBox also gives you 7 extra days for each month you buy. You pay the same price either way. TorBox sells and runs this service, not BannerTV."
   - The price, only under the rules below; otherwise "See the current price on TorBox's site".
   - A QR code to the referral link, with the address printed underneath.
   - **Link this TV** for after they've signed up, and Back to leave.
4. **Saying no is easy.** There's no countdown, no pre-selected provider and no reminder later. While an account is linked, the **Need an account?** screens aren't offered.
5. **What linking does in Phase 4.** BannerTV shows the account's status and expiry. It keeps the token, encrypted, only to refresh that status, and deletes it on Unlink. Addons keep their own debrid keys, set on the addon's own settings page as today.
   - Built-in debrid stays in Phase 5: BannerTV itself sending addons' torrent hashes to a provider and playing the result.
   - It needs its own legal review, and TorBox's terms bear directly on it.

**Rules to build to**

- **Advertising (UK).** A referral screen is advertising, and BannerTV's developer and the provider share responsibility for it (ASA).
  - CAP rule 2.1 requires it to be obviously identifiable as advertising, and rule 2.3 requires its commercial intent to be clear.
  - The ASA suggests "Ad", placed before the QR code and in a colour that contrasts with the background (Card Factory).
  - It ruled "affiliate" on its own not clear enough (Asos, 2020) and found a "may earn a commission" disclaimer ambiguous (MailOnline, 2022). ASA and CMA guidance advise against "#aff".
  - Free premium days count as a reward (CMA).
  - Under the DMCC Act 2024, failing to identify commercial intent is a misleading omission (section 227). Paid promotion presented as editorial content without making the payment clear is banned in all circumstances (Schedule 20, paragraph 12).
  - A screen that shows a price and a way to buy is an invitation to purchase (section 230). It must then also show who sells the service, their business address, its main characteristics and the total price.
  - The CMA can fine up to £300,000 or 10% of global turnover, whichever is higher. These rules have applied since 6 April 2025.
- **Prices.** The price must be accurate when seen, and that stays the developer's responsibility even though the provider sets it (CAP 3.17 and 3.18, ASA guidance on prices set by others). No public page gives the total a UK buyer pays: VAT, payment-method surcharges and currency fees vary.
  - Show a price only if it was checked against the provider's UK checkout, while signed in, in the last 7 days. It must include VAT and any fee most buyers pay.
  - With the price, show the currency, whether it renews, the seller's name and business address, and the date it was checked. For example: "$5 a month, renews until you cancel. Charged in US dollars; your bank may add a conversion fee. Sold by TorBox, [address]. Checked 20 October 2026."
  - Otherwise show no price, only the link to the provider's site. That is the default.
  - Prices live in a small JSON file on the BannerTV website. For each provider it holds the price, currency, renewal terms and checked-on date, plus a flag that can hide that provider's referral screen but never show one.
  - Providers, referral links and disclosure text are compiled into the build. The file can never switch the step on.
- **Claims and wording.** Facts, not performance claims. No "instant streams", "faster" or "more reliable": each would need evidence (CAP 3.7), and Real-Debrid's filters make some untrue. Never mention films, series, sport, free content, torrents, Stremio or any addon by name on these screens, in the store listing or in screenshots.
  - Before a provider gets a referral screen, check that the page its QR code opens doesn't mention those either. If it does, that provider gets no screen.
  - Show the TorBox line about what the new user gets only while TorBox's referral page still promises it and the developer's paid TorBox plan is active. If either stops, hide that provider's referral screen.
- **Copyright (UK, not legal advice).** BannerTV's defence is that it is a neutral player and users choose their own addons. A reward for each sign-up to a stream-access service weakens that.
  - Newzbin was held to have authorised infringement.
  - The CJEU treats profit as relevant (Filmspeler) and presumes knowledge when someone links for profit (GS Media). The Court of Appeal declined to depart from that case law in TuneIn v Warner Music (2021).
  - In the Popcorn Time case (Twentieth Century Fox v Sky, 2015), the app's suppliers were held jointly liable with the host sites.
  - UK prosecutions of app and add-on suppliers have mostly been brought as fraud. For example, a developer whose Kodi build promoted add-ons got 30 months in 2021. A cash reward would also meet the "gain" element of the s.107(2A) offence.
  - No UK case naming a debrid service was found.
  - The legal review covers civil and criminal exposure, for beta and store builds, before any build carries a referral screen.
- **LG.**
  - LG may test the referral screen under the self-checklist's Advertisement item, so Back must always leave it.
  - Third-party guides say Seller Lounge's Test Info form asks about "In-App Ad" and "Paid Content" (reported; check in the form). Declare the screen there and in the UX scenario.
  - Read the full self-checklist ZIP before building the screen.
  - Never switch the step on remotely after approval: a change without review can get the app removed.
- **Provider terms.**
  - Get written permission where the terms ask for it, and keep the emails. Describe BannerTV as it is: a player for addons that users add themselves using the Stremio protocol, with a code-flow link screen and a referral screen labelled Ad. Ask for the public app, the provider's name, the referral link and the code flow, in beta and store builds.
  - Never call TorBox's "add referral" API: the only referral is the QR code on a screen labelled Ad.
  - Never store a developer key or client secret in the app.
  - Treat a revoked token as a normal "link again" state. Real-Debrid reportedly revokes app access after a sharing warning, and TorBox rotates keys after abuse warnings.
- **Privacy.** Use a fixed referral link with no per-TV or per-user tracking ID, and store nothing on the TV for the referral screens. That means no shown, skipped or dismissed flags, no counters, and fetching the price file when the screen opens without saving it. The screens are offered or hidden only on state the TV keeps for another reason, such as a linked account. That way nothing on the TV needs PECR consent, which the ICO requires for any advertising purpose. The provider's own site sets its cookies on the phone.
  - The token is stored encrypted and deleted on Unlink.
  - The privacy policy gains a debrid section: the token stays on the TV, the TV talks directly to the provider, and the provider sees the TV's IP address and what is requested. If the price file is used, the TV also contacts the BannerTV website.
- **Tax.** HMRC's guidance on online income counts gifts and services received for promoting products as income, so premium days may count at their value, not only cash. Referral rewards share one £1,000 trading and miscellaneous allowance with any other side income, possibly including donations.
  - Above the allowance, trading income means registering for Self Assessment by 5 October after the tax year.
  - Miscellaneous income between £1,000 and £2,500 means contacting HMRC; above £2,500, registering.
  - Keep a record of the days received and their list price, and check with HMRC or an accountant before the first reward arrives.

**Phase 4 work**

- [ ] Eyitayo reads Real-Debrid's and AllDebrid's referral terms while signed in, and asks TorBox and Premiumize for written permission (see Provider terms above)
- [ ] Ask LG question 11 (STORE.md) and keep the answer
- [ ] Read the full LG self-checklist ZIP for content and advertising items
- [ ] Decide whether to publish BannerTV's source, which Real-Debrid linking needs
- [ ] Build switch `debrid` with three settings: off; link only (link screens, with no sign-up screens or sign-up links of any kind); link and referral. Referral codes are build-time values, as in the Hydra launcher
- [ ] Code flows for the approved providers, with fake-provider tests for expiry, denial, slow_down and revoked tokens; encrypted token storage
- [ ] The Linked services screens, the Ad-labelled list and provider screens, and the price file on the website
- [ ] For each provider with a referral screen, check the UK checkout total while signed in before publishing a price
- [ ] Legal review before any build carries a referral screen
- [ ] Beta release for the providers that have agreed in writing, then a store update once the conditions in the decision are met
- [ ] When it ships in a store build: update the store docs as listed in data-safety.md, "Pending policy changes"

**Open questions for Eyitayo**

- [x] Store timing: the first store submission goes without it, and it's added in a later update (decided 27 October 2026)
- [ ] Which providers to approach first (TorBox and Premiumize recommended)?
- [ ] Publish BannerTV's source so Real-Debrid accounts can be linked?
- [ ] Pull built-in debrid forward from Phase 5, so a linked account does more than show its status?

**Sources for this section**

- **Providers**
  - Real-Debrid: [API](https://api.real-debrid.com/), [terms](https://real-debrid.com/terms), [referral FAQ copy, July 2024](https://github.com/debridmediamanager/awesome-debrid/discussions/7), [filters, November 2024](https://torrentfreak.com/real-debrid-implements-extreme-anti-piracy-filters-to-appease-film-companies-241122/), [filters, May 2026](https://torrentfreak.com/real-debrids-renewed-piracy-crackdown-follows-corporate-restructuring/).
  - AllDebrid: [API](https://docs.alldebrid.com/), [terms](https://alldebrid.com/tos/), [prices](https://alldebrid.com/offer/), [fidelity points](https://help.alldebrid.com/en/faq/fidelity-points), [referral closure (reported)](https://referraldrop.com/en/drop/alldebrid/2).
  - Premiumize: [API](https://www.premiumize.me/api), [terms](https://www.premiumize.me/legal), [webmasters](https://www.premiumize.me/webmasters), [prices](https://www.premiumize.me/premium), [supported hosts](https://www.premiumize.me/api/services/list).
  - TorBox: [API terms](https://www.torbox.app/policies/api-developer-terms), [acceptable use](https://www.torbox.app/policies/acceptable-use), [referrals](https://support.torbox.app/en/articles/9875657-how-does-the-torbox-referral-system-work), [device code](https://www.postman.com/torbox/torbox-api/request/ezu2ude/start-device-code-authorization-process), [account restrictions](https://support.torbox.app/en/articles/9836418-account-restrictions), [prices](https://torbox.app/pricing).
  - Other: [USTR 2025 Notorious Markets List](https://ustr.gov/sites/default/files/files/Press/Releases/2026/2025%20Notorious%20Markets%20List%20(final).pdf).
- **UK rules**
  - Advertising: [CAP Code section 2](https://www.asa.org.uk/type/non_broadcast/code_section/02.html) and [section 3](https://www.asa.org.uk/type/non_broadcast/code_section/03.html), [ASA on affiliate marketing](https://www.asa.org.uk/advice-online/affiliate-marketing.html), [ASA ruling on "affiliate" labels (Asos)](https://www.asa.org.uk/rulings/asos-com-ltd-a19-1025856-asos-com-ltd.html).
  - Consumer law: [DMCC Act 2024 Schedule 20](https://www.legislation.gov.uk/ukpga/2024/13/schedule/20), [CMA unfair commercial practices guidance](https://www.gov.uk/government/publications/unfair-commercial-practices-cma207/unfair-commercial-practices), [CMA on hidden advertising](https://www.gov.uk/government/publications/social-media-endorsements-guidance-for-content-creators/social-media-endorsements-being-transparent-with-your-followers).
  - Copyright: [Filmspeler, CJEU C-527/15](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A62015CJ0527), [TuneIn v Warner Music, Court of Appeal 2021](https://www.wiggin.co.uk/insight/court-of-appeal-upholds-tunein-hyperlinking-decision-and-declines-to-depart-from-eu-retained-law/).
  - Privacy: [ICO on storage and access exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/).
  - Tax: [HMRC trading allowance](https://www.gov.uk/guidance/tax-free-allowances-on-property-and-trading-income), [HMRC on income from online platforms](https://www.gov.uk/guidance/check-if-you-need-to-tell-hmrc-about-your-income-from-online-platforms).
- **Stores and precedent**
  - LG: [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist), [in-app purchase guide](https://webostv.developer.lge.com/develop/guides/in-app-purchase).
  - Stremio: [back on LG, August 2026](https://blog.stremio.com/stremio-for-lg-tv-is-back-2020-models-including-2026-models/), [back on Google Play](https://blog.stremio.com/were-back-on-google-play/).
  - Nuvio: [its Play Store removal](https://nuvio.wiki/installation/android-mobile), [its linked services](https://github.com/NuvioMedia/NuvioTV/blob/main/app/src/main/res/values/strings.xml).
  - Referral links in other apps: [Hydra's optional referral build variable](https://github.com/hydralauncher/hydra/blob/main/src/renderer/src/pages/settings/settings-real-debrid.tsx), [Comet's referral links](https://github.com/g0ldyy/comet/blob/main/comet/templates/index.html).

## Risks, legal and open questions

The two risks that could sink the project were LG rejecting the app in its content test and webOS not exposing audio and subtitle tracks for direct-play files. The first is handled by how the store build is shaped. Phase 0 settled most of the second on webOS 22: audio tracks are exposed, embedded subtitles are not, and addon subtitles cover the gap.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| LG rejects BannerTV as a piracy tool | Medium | High | Demo addon with legal content, no third-party stream addons preinstalled or promoted, first-run disclaimer, adult filter on; sideload channel as fallback |
| Embedded subtitles not available for MKV direct play | Confirmed on webOS 22 | Medium | Addon subtitles rendered by BannerTV as the main path; Phase 2 spike on the webOS media pipeline API; clear UX when a track cannot be changed. Audio track switching is exposed on webOS 22 |
| Slow UI on 2020 low-end TVs | Medium | High | Performance budgets, virtual lists, low-power mode, floor TV bought by the end of Phase 1, development on the webOS 22 TV meanwhile |
| One-person team runs out of time | High | High | Strict phase gates, MVP cut at Phase 2, everything optional pushed to Phase 5 |
| Store review takes about 3 weeks per update | High | Medium | Monthly store releases, weekly beta builds, batch fixes |
| Addon breakage: CORS, `proxyHeaders`, malformed JSON | Medium | Medium | Lenient parsing, addon contract fixtures, clear per-addon errors, streaming-server proxy later |
| API keys and Trakt client secret extractable from the app bundle | Medium | Medium | Restricted keys, rotation, move token exchange behind the sync service in Phase 5 |
| Module scripts or other engine quirks under `file://` | Low | Medium | Phase 0 packaging spike, classic script bundle |
| Developer Mode expiry interrupts testing | High | Low | Reset the timer weekly, keep test TVs logged in |
| Stremio's unofficial API changes (account import) | Medium | Low | Feature stays optional |
| "BannerTV" name conflicts with an existing trademark | Low | Medium | Trademark search before store submission; never use Stremio or Nuvio branding |
| The debrid referral screen is read as promoting piracy, by LG, rights holders or other app stores | Medium | High | Out of the first store submission (built with `debrid=off`); LG asked in writing first; providers' written permission; "Ad" label and neutral wording; legal review; build switch to ship without it |

**Legal considerations** (not legal advice)

- BannerTV is a neutral client, like a browser or Stremio itself. Legal exposure rises sharply if the project ships or promotes addons that point to infringing content, runs peer-to-peer on the TV, or charges for access to content. v1 does none of these.
- Publish terms of use and a privacy policy before store launch (the store listing and the Trakt and TMDB integrations need them).
- Respect TMDB and Trakt API terms, including attribution and rate limits.
- Get a short legal review before adding payments, a hosted sync service or the debrid referral screen. A referral earns the developer a reward (premium days) for each sign-up to a stream-access service, which weakens the neutral-client position.
- UK launch: rights holders and anti-piracy groups in the UK actively pursue apps and sellers that promote infringing streams. Keep the store listing, screenshots, demo addon and donation page free of copyrighted titles and of any mention of third-party stream addons.

**Open questions for Eyitayo**

- [x] Repository: created as `Eyihbanner1/BannerTv`, private. No licence is needed while it stays private.
- [x] App ID: `com.bannertv.app` confirmed. No domain yet, which is fine for the ID (see the Store section).
- [x] LG Seller Lounge: register as an individual seller.
- [x] Test TVs: LG 65NANO766QA on webOS 22. A used 2020 webOS 5 TV is still needed as the performance floor.
- [x] 2018 to 2019 TVs (webOS 4.x): dropped. The minimum is webOS 5.0 (2020 TVs).
- [x] Business model: free, with optional donations.
- [x] Launch: United Kingdom, English only.
- [x] Logo: Prism Play (concept 10 on the [logo concepts canvas](https://claude.ai/artifact/44B7TcVyefmheVMSe1E8JX)). The brand kit (logo files, webOS icons, splash, store images, colour and type tokens) is in [`brand/`](../brand/README.md) in the repo.

## Sources

- [Stremio addon SDK protocol](https://huggingface.co/spaces/no1b4me/hytranslator/blob/main/node_modules/stremio-addon-sdk/docs/protocol.md)
- [stremio-core addon resources](https://mintlify.wiki/Stremio/stremio-core/addons/resources)
- [Nuvio vs Stremio, ElfHosted](https://docs.elfhosted.com/nuvio/nuvio-vs-stremio/)
- [Nuvio settings guide (community)](https://nuvio-wiki.duckdns.org/settings/)
- [NuvioTVSmart 0.3.20-beta release notes](https://newreleases.io/project/github/NuvioMedia/NuvioTVSmart/release/0.3.20-beta)
- [webOS TV Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
- [webOS TV appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json)
- [webOS TV CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide)
- [webOS TV Back button guide](https://webostv.developer.lge.com/develop/guides/back-button)
- [webOS TV Magic Remote guide](https://webostv.developer.lge.com/develop/guides/magic-remote)
- [webOS TV app lifecycle](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)
- [webOS TV 6.0 audio and video formats](https://webostv.developer.lge.com/develop/specifications/video-audio-60)
- [webOS TV streaming protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [webOS TV mediaOption parameters](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter)
- [webOS TV app approval process](https://webostv.developer.lge.com/distribute/app-approval-process)
- [webOS TV app ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem)
- [Submitting apps to the LG store, Brightcove](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html)
- [webOS Brew, Developer Mode](https://www.webosbrew.org/devmode/)
- [Moonfin smart TV playback notes](https://github.com/Moonfin-Client/Smart-TV/wiki/Playback-and-Codecs)

# ADR 0002: Addon client, cache and the Netflix-style Home

- Status: accepted for Phase 1; to be checked on the webOS 22 TV
- Date: 27 October 2026

## Context

Phase 1 turns the Phase 0 shell into a browser for real addons: Home rows and Details pages filled from Stremio addons, starting with Cinemeta. The plan sets the rules (addon protocol v3 exactly as published, request routing, a 6-request cap, timeouts, a two-tier cache that honours the addon's cache hints). Eyitayo asked on 27 October 2026 for Home to look more like Netflix than Stremio.

## Decision

1. **Packages.** `packages/protocol` holds the protocol: types, parsing, request URLs and the "does this addon answer this request" rule. `packages/core` holds the addon collection, the addon client, the request limiter, the cache and the list of Home rows. Neither touches the DOM; the app hands the core a `fetchJson` function and its storage.
2. **Parsing without Zod.** The plan named Zod. Zod 4 uses `globalThis`, `Object.fromEntries` and `Array.prototype.flatMap`, which Chromium 68 (webOS 5) lacks, so it would need polyfills. Small hand-written readers (`packages/protocol/src/lenient.ts`) do the same job: a bad item is dropped and counted, never the whole response; numbers sent as strings are accepted; legacy fields (`genre`, `year`, `extraSupported`, `director`, `trailers`) fold into the current ones; artwork must be an `http` or `https` URL; descriptions lose their HTML.
3. **Request rules.** Catalog and meta requests time out after 10 seconds, and at most 6 addon requests run at once. Meta asks each addon that declares `meta` for the type and ID prefix, in collection order, until one knows the title. Home only fetches rows within two of the focused row.
4. **Cache.** Each request is a query keyed by its URL. A copy is fresh for the addon's `cacheMaxAge` (defaults: 1 hour for catalogs, 12 hours for meta), then shown at once while a new copy loads for `staleRevalidate` (3 and 14 days), then kept only as a fallback when the addon fails for `staleError` (14 and 60 days). Copies live in memory and in IndexedDB, capped at 400 entries with the oldest removed first, so the second launch draws Home before any request answers.
5. **Default addons.** Cinemeta and OpenSubtitles v3 are installed on first launch, both removable. Their manifests ship with the app (from `Stremio/stremio-official-addons`), so the first catalog requests do not wait for a manifest; each manifest is refreshed once a day, five seconds after launch. An empty collection stays empty.
6. **Artwork.** When an IMDb title comes without a backdrop or logo, BannerTV uses Metahub's URL for it, the same image service Cinemeta points to. An image that fails to load falls back to the title as text.
7. **Home, Netflix-style.** A large hero shows the focused title's backdrop (with a slow pan, off in low-power mode), title logo, facts, genres and synopsis. Every addon catalog that needs no extra becomes a row; catalogs named Featured, Trending or similar get wide backdrop tiles with the title logo, the rest get posters. Genre rows (Action, Crime, Comedy, Drama, Sci-Fi, Animation) come from the first addon whose catalogs can filter by genre. Rows show the first 40 titles. Empty rows disappear; a row whose addon fails says why and offers Try again. In pointer mode, arrows at the row edges page through it.
8. **Details.** Backdrop, logo, facts, genres, synopsis, cast and directors on the left. A series gets seasons (Specials last) and episodes in a panel on the right; the season switches as focus moves along the season tabs. Watch and the episodes say that choosing a stream arrives in Phase 2.
9. **Drawing less.** Rows and episode lists draw only the items near the view (absolutely positioned, so spatial navigation still measures them correctly), and Home draws far rows as empty boxes of the same height.

## Consequences

- Addon URLs, which can carry debrid keys, are only used as request and cache keys. No error message or log names them.
- The hero pan and Metahub images are untested on the TV. Images may look soft at the TV's device pixel ratio of 2 (ADR 0001); the poster size can move from Metahub's `small` to `medium` if they do.
- The plan's stack table still says Zod; this ADR replaces that line.
- Still to come in Phase 1: Search with an on-screen keyboard, Discover, the Addons screen (install by URL, QR from a phone, remove, reorder), "See all" from a row, trailers, and the first-run screen.

# ADR 0009: The Samsung TV app

- Status: proposed, first test build on the branch `claude/project-thread-wp8xdj`
- Date: 22 November 2026

## Context

On 22 November 2026 Eyitayo asked for BannerTV on Samsung TVs, starting with a sideloadable test build for his own set, a UE50RU7470 (2019, Tizen 5.0). No store submission yet.

Four facts shaped the design:

- Samsung TVs run Tizen, whose apps are packaged web apps (`.wgt`) in the TV's own Chromium, much as webOS apps are. Almost all of BannerTV (ADR 0005 counts it) is plain TypeScript and React with nothing of webOS in it.
- Tizen's `<video>` plays through the TV's own media pipeline, as webOS's does: Matroska, MP4, HLS, HEVC and HDR10 included, which is why Jellyfin's Tizen client plays direct through it. Samsung's other player, AVPlay, draws video on a plane of its own under the page and has its own track and subtitle API: more reach, and a second engine to keep.
- Tizen 5.0's engine is Chromium 63, older than webOS 5.0's 68 that the build is checked against. It parses the same ES2017 and has the ES2018 built-ins, but lacks `AbortController` (66), which every addon request uses for its timeout, and ignores `focus({ preventScroll })` (64), which spatial navigation relies on while rows move by transform. Without the first nothing loads; without the second each row jumps as focus moves along it. Both are checked by the Samsung journeys (`e2e/samsung.spec.ts`), which fail without them.
- A retail Samsung TV installs only a `.wgt` signed with a Samsung certificate made for that TV (its DUID), from a Samsung account. A certificate cannot be made in CI for a TV CI has never seen.

## Decision

1. **One app, the same build.** `apps/tizen` packages `apps/webos/dist` as a `.wgt`: the web files, `config.xml` and an icon, zipped by a small Node script (`wgt.mjs`, no Tizen Studio). The LG's own files (`appinfo.json`, its icons and splash) stay out. `index.html` gains one line, Samsung's `$WEBAPIS/webapis/webapis.js`, before the loader, so the product API is there when the app first asks; the build's own `index.html` is unchanged, and the LG and Android never see it.
2. **The application id never changes.** `BannerTv01.BannerTV` (package `BannerTv01`, Tizen's ten letters and digits). The TV keeps the app's storage under it, so a new id would lose every addon, profile and bit of progress, as moving the Android app's address would (ADR 0005, decision 1). The widget id is `https://bannertv.workers.dev/tizen`, an address the project holds; nothing loads from it.
3. **Public privileges only.** `internet`, `tv.inputdevice`, `application.launch` (the YouTube app) and Samsung's `productinfo`. A certificate from any Samsung account covers them; a partner privilege would need Samsung's approval. `required_version` is 3.0, so older Tizen TVs install and then get the "not supported" screen with a Samsung sentence, from `index.html`'s ES5 check for Tizen 5.0.
4. **Unsigned in CI.** The full CI build's `tv` job makes `bannertv-wgt` after the journeys pass, as it does the `.ipk`. Whoever installs it signs it for their TV: Apps2Samsung (a community tool that makes the Samsung certificate with one sign-in and reuses it) or Tizen Studio (`docs/SAMSUNG_TV_SETUP.md`). An update installs over the app and keeps its data only when the same certificate signs it.
5. **The TV's own `<video>`, as on webOS.** The native engine plays every stream. The webOS-only parts stay webOS-only: the resume position in `mediaOption`, the 4K lift for adaptive streams, the Luna media calls. hls.js and Shaka still take what they take on the LG (HLS with alternate audio or subtitles, DASH). AVPlay is left for when the TV shows what `<video>` cannot play.
6. **Older engines filled in, where they need it.** `platform/legacy.ts` runs second in `main.tsx`, before any other module, and installs a stand-in `AbortController` (whose `fetch` rejects with an `AbortError` when its signal aborts; the old engine cannot stop the request itself) and a `focus()` that puts back any scroll it moved when asked for `preventScroll`. Each goes in only where the engine lacks it, so on the LG, Android and newer Samsung TVs nothing changes.
7. **Samsung's remote, pressed as LG keys.** `platform/tizen.ts` asks Tizen for the media, colour and digit keys (the arrows, OK and Back always come), which then arrive under the LG's codes. Samsung's own codes are caught on `window` before anything else and pressed as LG keys, as the Android bridge does: Back (10009) as Back, the single Play/Pause button (10252) as Play or Pause from the player's state, the on-screen keyboard's Done (65376) as OK, which ends typing, and its Cancel (65385) as Back, with a Back right after a Cancel taken as the same press.
8. **Leaving, relaunching, trailers.** Back on Home's first row leaves through `tizen.application.getCurrentApplication().exit()`. Tizen's `appcontrol` event (the app opened again while running) asks "Who's watching?" again, as webOSRelaunch does. Trailers open Samsung's YouTube app (`111299001912`) with a `PAYLOAD` of `{"values":"v=<id>"}`, the form its deep links are thought to take; no Samsung document confirms it, so the first TV round does, and a refusal shows the same message as a trailer the LG cannot open.
9. **What the TV can play.** `webapis.productinfo.isUdPanelSupported()` (and `is8KPanelSupported()`) for 4K and `webapis.avinfo.isHdrTvSupport()` for HDR10; HEVC and AV1 from the decoder, as on the LG. No Samsung TV plays Dolby Vision or decodes TrueHD. Samsung left DTS out of its 2018 to 2022 TVs (Tizen 4.0 to 6.5), so DTS is false there and unknown otherwise. A call that throws, or a TV that did not load Samsung's script, leaves the fact unknown.
10. **Careful on the 2019 and 2020 sets.** Tizen before 6.0 gets the low-power look. The link test is off under "auto" on Samsung until it has been measured there: its hidden `<video>` shares the TV's decoder. hls.js is not told to trust MediaCapabilities, as on the LG.
11. **Updates by reinstalling, for now.** The LG's Homebrew Channel and signed in-app updates are webOS-only (`updatesHere` in `src/shell/main.ts` needs webOS). A test build is a public pre-release (`samsung-test`) that Apps2Samsung installs from a link that stays the same.

## Consequences

- One codebase for the LG, Android and Samsung: every screen and fix lands on all three. Samsung-only code is `platform/tizen.ts`, `platform/legacy.ts` (for any old engine) and `apps/tizen`.
- Streams that need an addon's request headers go through the stream helper on a phone, as on the LG: Tizen's `<video>` sends none of its own.
- Diagnostics shows a Samsung TV section: model, firmware, Tizen release, panel and HDR, and whether Samsung's script loaded.
- Not yet: in-app updates on Samsung, AVPlay, Samsung's Smart Hub preview row, voice search, and a Samsung Seller Office submission (which needs a store icon of 512 x 423, an age rating, and Samsung's review of the app's content sources).
- Measured on a real Samsung TV: nothing yet. The journeys stand in for Tizen 5.0's engine (no `AbortController`, a `focus()` that scrolls), and its user agent, `tizen` and `webapis`; the first TV round checks the rest.

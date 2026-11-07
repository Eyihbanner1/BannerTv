# ADR 0005: The Android TV app

- Status: accepted, built for Phase 5 on the branch `claude/project-thread-c4lj9d`
- Date: 31 October 2026

## Context

Phase 5 takes BannerTV past LG. On 30 October 2026 Eyitayo asked for an Android TV app first (Google TV, Android TV boxes, the Nvidia Shield and Fire TV), then a BannerTV account so profiles, addons, My List and Continue Watching follow a person between the LG and Android, then phone apps. This ADR covers the Android TV app; the account gets its own ADR.

Four facts shaped the design:

- The LG app is a web app, and almost all of it (addons, Home, Details, Search, profiles, Trakt, the player's session, controls and subtitles) is plain TypeScript and React with nothing of webOS in it. webOS appears only in `src/platform` and the native player engine.
- Android's WebView is a current Chromium, so the same build runs in it unchanged. Its `<video>` element is not good enough for BannerTV's streams: it plays no Dolby Digital, DTS or TrueHD sound, cannot pass sound through to a receiver, plays HEVC and HDR only where the device's browser decoders allow, and has no Matroska support to speak of. On the LG those files play because the TV's own media pipeline plays them.
- Media3 ExoPlayer, Android's own player library, plays Matroska, MP4, HLS and DASH, uses the device's hardware decoders for HEVC, HDR10 and Dolby Vision, and passes Dolby and DTS sound through HDMI. Kodi, Stremio and Nuvio all play through it or something like it on Android TV.
- Fire OS 6 (2018 Fire TV Sticks) is Android 7.1, API 25. Fire OS 7 is API 28 and Fire OS 8 is API 30.

## Decision

1. **One app, the same build.** `apps/androidtv` is a small Kotlin app, package `com.bannertv.app`, that shows `apps/webos/dist` in a full-screen WebView. The build is copied into the APK's assets and served by androidx.webkit's `WebViewAssetLoader` at `https://appassets.androidplatform.net/assets/web/index.html`. That address never changes after the first release, because localStorage and IndexedDB belong to it: moving it would lose every addon, profile and bit of progress. The app's version comes from `apps/webos/webos-meta/appinfo.json`, with `versionCode = major × 1,000,000 + minor × 1,000 + patch` (so `check-version` keeps minor and patch below 1,000).
2. **Android's player under the page.** Video plays in a Media3 ExoPlayer `PlayerView` (a SurfaceView) placed under the WebView, which has a transparent background. While a stream plays, the web app makes `html`, `body` and its own `<video>` element transparent (the `android-video` class), so the picture shows through and the controls, subtitles and panels draw over it as on the TV.
3. **A small bridge.** The page talks to Android through `window.BannerAndroid` and Android answers through `window.__bannerAndroid.event(…)`, as set out under "Protocol" below. The page treats itself as on Android only when `BannerAndroid.protocol()` exists, so a browser and the LG never take that path.
4. **The Android engine is one more player engine.** `src/player/engines/android.ts` joins native, hls.js and Shaka; `chooseEngine` picks it for every stream on Android, and there is nothing to fall back to. It makes the page's `<video>` element tell Android's clock, pause state and events (`currentTime`, `duration`, `paused`, `seeking`, `readyState`, `play()`, `pause()`, and the `play`, `playing`, `pause`, `waiting`, `seeking`, `seeked`, `timeupdate`, `durationchange` and `ended` events), so the session, the subtitles, Continue Watching, Trakt and the controls work unchanged and need no Android code. It runs the clock between Android's readings (every 250 ms), holds it at the target while a seek runs, and lets a play or pause the viewer has just asked for outrank older news from Android for two seconds. When the player closes it takes all of that off the element again.
5. **Remote keys.** The WebView passes the arrows, OK and digits to the page as it does on the LG. It never passes Back, so Android catches Back (`OnBackPressedDispatcher`, which also catches a phone's back gesture) and the page presses the LG Back key (461) where focus is. Media keys and the four colour keys are caught by the activity and pressed as the LG codes the app already answers; a remote's single Play/Pause button becomes Play or Pause from the player's state. Android never leaves the app on Back by itself: Back on Home's first row asks the page, which calls `exit()`, as `platformBack` does on the TV.
6. **Subtitles.** Subtitles from addons are drawn by the web app as on the TV. Subtitles inside the file (SRT, ASS and PGS in Matroska, HLS and DASH subtitle tracks) are listed in the audio and subtitles panel and, once chosen, drawn by Android under the page. No cues reach the page in this first version.
7. **What the device can play.** `capabilities()` reports 4K, HDR10, Dolby Vision, HEVC, AV1, DTS and TrueHD from Android's display modes, HDR types, decoders and HDMI audio encodings, in the shape `TvCapabilities` already has, so stream ranking prefers what the device and the TV behind it can play. A fact Android cannot read is left unknown.
8. **No link testing by default.** The link test loads a link's metadata into a hidden `<video>`, which on Android is the WebView's player, not ExoPlayer, and would fail Matroska and Dolby links ExoPlayer plays. Under "auto" it is off on Android; the viewer can still turn it on.
9. **Trailers** open in the YouTube app (or a browser) through `openExternal`.
10. **Android 7.1 and newer.** `minSdk` 25 covers Fire OS 6 and every Android TV still in use; `targetSdk` is 36 and `compileSdk` 37 (AndroidX core 1.19 needs it). The app declares itself a TV app (Leanback launcher, banner, no touchscreen required) and also runs on phones and tablets in landscape, where taps work as the Magic Remote's clicks do. There the 1920x1080 layout is scaled to fit and centred, measured on the root element (`clientWidth`), since a phone's WebView widens `innerWidth` to the page, and the page is held to the screen's size so it never pans.
11. **Built in CI only.** The CI's new `android` job takes the web build from the `build` job, runs the Kotlin unit tests and builds a debug APK (`com.bannertv.app.debug`, so it can sit beside a release build). With the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets set, it also builds a signed release APK. Both are uploaded as the `bannertv-apk` artifact. The key itself is never in the repository.
12. **Android TV's own "Continue watching" row.** On Android TV and Google TV from Android 8, the app puts the profile in use's Continue Watching on the system's Watch Next row ("Continue watching" on Google TV), through androidx.tvprovider 1.1.0. The page works out the cards (`apps/webos/src/data/watch-next.ts`) from the same progress and played cards as Home's row, with the kids filter, and sends the whole list with `watchNext(json)`. Android replaces BannerTV's cards with it: it writes only the cards that changed and takes off those that left. The page sends a list once Continue Watching has stayed the same for 10 seconds (while a film plays, its progress is saved every few seconds, so nothing goes out until it stops), and within a second of the player closing or the app leaving the screen. A list the same as the last one is not sent again.
    - The row belongs to the whole device and anyone at the TV sees it, so it holds one profile's titles at a time. While "Who's watching?" waits for an answer, the row keeps what it had. A profile with a PIN empties it at once. A switch of profile reloads the app, which replaces the row with the new profile's titles.
    - A card the person takes off the row (the provider marks it not browsable) stays off until the title is watched again.
    - Cards hold ids, names and http or https artwork addresses only, never an addon's address. An addon's address can carry its user's keys in its path, and artwork an addon serves itself can carry them too, so artwork from the host of an addon whose address holds more than its host is left off the card.
    - A film or episode left part way is a "continue" card with its place and length. The next episode of a series, which starts from the beginning, is a "next" card.
    - Fire TV's home screen has no Watch Next row and a phone has no TV home screen, so the app writes nothing on either. It writes only where the device has `FEATURE_LEANBACK` and not `amazon.hardware.fire_tv`.
13. **Links to a title.** Each card opens `bannertv://open?type=…&meta=…&video=…`, which carries ids only. The card's intent is held to the app's own package, because the phone app answers `bannertv://` links too and a debug build sits beside the release one. The intent filter is not `BROWSABLE`, so a web page cannot send one.
    - The activity takes the link both when the app was closed and when it was running. It keeps the link until the page takes it with `takeLink()`, and while the app runs it tells the page with `{ "type": "open" }`. An activity that Android restores, or reopens from the recent apps, is handed the intent it first started with, so that link is not opened a second time.
    - The page takes the link only once someone is watching, so a link survives the reload that asks "Who's watching?". It asks first by the rule a relaunch from the launcher follows: with more than one profile, when the profile in use has a PIN or the picker shows at launch.
    - The page then opens the title's Details over Home, with Resume focused, so the person sees what plays before it does. Back goes to Home. A link never starts a stream by itself.
    - Another app on the device can send such a link, so both sides check it: a short lowercase type and ids of 1 to 300 characters with no control characters. Nothing else in the link is read.

## Protocol (version 1)

### Page to Android: `window.BannerAndroid`

| Method | Returns | Meaning |
| --- | --- | --- |
| `protocol()` | `"1"` | The protocol version. |
| `hostInfo()` | JSON | `appVersion`, `versionCode`, `sdk`, `release`, `manufacturer`, `model`, `webView`, `tv`, `fireTv`, `lowRam`. A low-memory device turns on the app's low-power mode. |
| `capabilities()` | JSON | `uhd`, `hdr10`, `dolbyVision`, `hevc`, `av1`, `dts`, `truehd`, each true, false or null. |
| `exit()` | | Leaves the app. |
| `openExternal(url)` | | Opens an `https:` address in another app. Anything else is ignored. |
| `player(json)` | | One player command, below. |
| `watchNext(json)` | | `{ "cards": [ … ] }`: every card for the Watch Next row, below. It replaces BannerTV's cards there, and an empty list empties the row. Ignored where the device has no row. Added later (see "Additions"). |
| `takeLink()` | string | The link the app was opened with, as JSON (`{ "type", "meta", "video" }`), once; `""` when there is none. Added later. |

Player commands:

```text
{ "op": "load", "id": 7, "url": "https://…", "startAt": 0, "mime": "" }
    id numbers each load; mime names HLS or DASH, else ""
{ "op": "play" }   { "op": "pause" }   { "op": "seek", "position": 123.4 }
{ "op": "audio", "id": "1:0" }   { "op": "text", "id": "2:0" }   { "op": "text", "id": null }
{ "op": "release" }                                              stop, and free the decoder
```

A Watch Next card, newest first by `watchedAt`:

```text
{ "type": "series", "meta": "tt8000001", "video": "tt8000001:1:2",
  "title": "Morevna Project S1:E2", "episodeTitle": "…", "season": 1, "episode": 2,
  "description": "…", "landscape": "https://…", "poster": "https://…",
  "position": 0, "duration": 0, "next": true, "watchedAt": 1730000000000 }
    position and duration in seconds, 0 while unknown; watchedAt in milliseconds since 1970;
    episodeTitle, season, episode, description, landscape and poster only where known
```

### Android to page: `window.__bannerAndroid.event(object)`

```text
{ "type": "key", "key": "Back" | "MediaPlayPause" | "MediaPlay" | "MediaPause" | "MediaStop"
                 | "MediaFastForward" | "MediaRewind" | "Red" | "Green" | "Yellow" | "Blue", "repeat": false }
{ "type": "keyboard", "visible": true }       the on-screen keyboard opened or closed
{ "type": "relaunch" }                        opened again from the launcher while running
{ "type": "open" }                            opened from a link while running: takeLink() has it
{ "type": "player", "event": "state", "playWhenReady", "playing", "buffering", "ready", "ended",
  "position", "duration", "live" }            duration: seconds, null while unknown, -1 when live
{ "type": "player", "event": "time", "position", "duration" }    every 250 ms while playing
{ "type": "player", "event": "seeked", "position" }
{ "type": "player", "event": "tracks", "audio": [ … ], "text": [ … ] }
    each track: id ("<group>:<track>"), lang, label, active, supported, and channels, mime,
    codecs, commentary, forced where known
{ "type": "player", "event": "error", "kind": "format" | "network" | "decode" | "other",
  "message", "detail" }                       detail names ExoPlayer's error code, never the link
```

Every player event also carries `"load"`, the id of the load command it is about. Android's player can send news about a stream just as the page moves on to another (an error, the end, its track list), so the page drops news whose id is not the latest.

Android's error codes map to the kinds the session already acts on: network errors (2xxx) to `network`; malformed files and decoder failures (3001, 3002, 4001 to 4003) to `decode`; unsupported containers, formats beyond the device, audio output failures and DRM (3003, 3004, 4004, 4005, 5xxx, 6xxx) to `format`; anything else to `other`. Falling behind a live window (1002) is recovered by Android without telling the page. A link of no known kind (3003) is tried once more as HLS, since IPTV and proxy links often leave out `.m3u8`; if that fails too, the first error is reported. A video track no decoder on the device can show, which ExoPlayer would play as sound alone, is reported as `format` with the detail `VIDEO_UNSUPPORTED (<mime>)`.

`live` is true only on a real live timeline. While a stream opens ExoPlayer stands in a placeholder timeline that has no length and could pass for a broadcast, and the session clears a film's resume point for a broadcast, so the page also takes `live` only from a state that is `ready`. A file whose length Android cannot read reads as `Infinity` once it plays, as on the TV, so its progress is kept against the film's running time.

### Additions

`watchNext(json)`, `takeLink()` and the `open` event came after version 1 first shipped, and joined it without a new version number. A method added later is optional. The page checks that it is there before calling it (`typeof BannerAndroid.watchNext === 'function'`), so an older app keeps working, and so does the phone app's player, which speaks the same protocol (`apps/mobile/src/player/phone-host.ts`) without these methods. The page ignores an event it does not know. The version number changes only when something already in the protocol changes its meaning.

## Consequences

- One codebase for the LG and Android: every screen, fix and addon feature lands on both. Android-only code is the Kotlin shell, `platform/android.ts` and the Android engine.
- Streams the LG plays through its own pipeline (Matroska, Dolby sound, HEVC, HDR) play on Android through ExoPlayer, with sound passed through to a receiver where the device allows.
- Subtitles inside a file follow Android's own style, not the app's subtitle style setting, until cues are sent to the page.
- The APK cannot be built on the cloud machines that write the code (Google's Maven is not reachable there), so every Kotlin change is checked by CI.
- The system's "Continue watching" row shows one profile's titles, those of the profile last in use, to anyone at the TV. A profile with a PIN keeps its titles off the row.
- Not in this first version: a Play Store or Amazon Appstore listing, Android TV's home-screen channels (rows of the app's own beside Watch Next), voice search, picture-in-picture, and downloads (phones only, later).

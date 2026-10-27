# ADR 0003: Playback, automatic stream choice and subtitles

- Status: accepted for Phase 2; to be checked on the webOS 22 TV
- Date: 27 October 2026

## Context

Phase 2 makes BannerTV play. The plan asked for a stream picker, a remote-driven player, subtitles, audio switching, resume and plain error messages. ADR 0001 set the ground rules from the first TV runs on the LG 65NANO766QA (webOS 22, Chromium 87): the TV's own player lists MKV audio tracks but no embedded subtitles, native HLS hides alternate audio and subtitles, and with `mediaOption` the clock reads 0 at the first `playing` event. On 27 October 2026 Eyitayo asked for Watch to pick a working stream itself, the way Netflix's Play button does, instead of showing a list of links to people who do not know what they mean. The research behind this ADR (webOS media APIs, what addons send, hls.js and Shaka on the TV) was checked a second time against primary sources; its corrections are folded in below.

## Decision

1. **Three engines, the TV's own first.** The native `<video>` element plays files and plain HLS: it is the only path with full hardware decoding, HDR and Dolby audio. hls.js 1.7.3 takes HLS whose master playlist has a subtitle rendition, two audio renditions in one group, or audio in two languages (`needsHlsJs`, an RFC 8216 attribute parser). Shaka Player 5.3.2 (the DASH-only build) takes DASH. If the playlist cannot be read, native gets it. Before the first picture, a failure in one HLS engine hands the link to the other, which also covers hosts that block hls.js's own segment requests (CORS): native needs no CORS.
2. **Engines as separate scripts.** hls.js and Shaka are copied into `vendor/` at build time (`apps/webos/build/vendor-scripts.ts`) and loaded with a `<script>` tag the first time a stream needs them; the app imports their types only. A dynamic `import()` would have pulled Vite's preload helper, which needs `import.meta.url`, into the classic bundle. The app bundle stays under its 600 KB budget (155 KB gzipped); the two players have their own 450 KB budget (393 KB). Both pass the ES2017 syntax check; the ES2018 feature check skips them, since they guard their newer calls.
3. **Engine settings from the checks.**
   - hls.js: buffer limits in seconds (15, at most 30, and 10 behind), since hls.js never caps by bytes and shortens them itself when the TV's buffer fills. No MediaCapabilities filter on the TV, which misreports and would drop the 4K, HDR and 5.1 levels (Shaka turns it off on webOS too). Tracks are told apart by language and name, because hls.js renumbers ids within each group. TS E-AC-3, append and codec errors count as "format" at once; other media errors get at most two recoveries, five seconds apart. A worker that fails after starting makes the engine start again without one.
   - Shaka: only `bufferBehind` is lowered (10 s); its forward buffer is already small. Shaka 4 differs in text selection and preferences, so it is not a drop-in swap. Subtitle cues are walked recursively, since TTML nests.
   - Native: on the TV a resume uses `mediaOption` (`transmission.playTime.start`), and on a UHD TV HLS and DASH also lift `adaptiveStreaming` to 3840x2160 (its default caps at 1080p). Off the TV it seeks after `loadedmetadata`.
4. **Watch picks the stream.**
   - Every installed stream addon is asked in parallel, once focus has rested for 1.5 s on Watch, Resume or an episode on Details. Home never asks, and nothing is asked during playback. Answers are kept for five minutes, so the player usually starts without asking again.
   - Each stream is read for resolution, HDR type, video codec, audio format and channels, size, seeders, debrid service and cached state (`packages/core/src/streams/facts.ts`), then judged against the TV: `tv.model.edidType` for DTS and TrueHD, the webOS version where that is missing, and `deviceInfo` for UHD, HDR10 and Dolby Vision.
   - Torrents, links that need proxy headers (Chromium overwrites the TV's own request headers), YouTube and web links never auto-play. Streams that would likely give no picture or no sound (DTS or TrueHD the TV lacks, HEVC or AV1 without a decoder, Dolby Vision with no HDR10 base on a TV without it, 4K on an HD TV, uncached debrid links) go to the back.
   - "Best quality" ranks by the resolution the TV can show, cached state, HDR, release source, the addon's record on this TV, seeders and the addons' order; camcorder copies go last. "Fastest start" puts cached 1080p and smaller files first. Ties keep the addons' order with an explicit index, because Chromium 68 does not sort stably.
   - The player waits until every addon has answered, or two seconds after the first playable stream arrives.
5. **One link test at a time.** On Details, after the rest, up to three top candidates are opened on one hidden, muted video element for their metadata only, with a two-second cap each, so a dead link is skipped before Watch is pressed. Moving focus or opening the player stops it and releases the decoder: most LG TVs have one. Settings has link testing on, off or automatic; automatic is off on webOS 5 until the floor TV is measured.
6. **Failing over.** A stream that errors, does not start within 30 s, or stalls for 20 s mid-play is marked failed, and the next candidate starts at the same position with a short "trying another" note, at most three times. A stream picked by hand from All streams does not fail over. After 30 s of playback the addon counts as having worked.
7. **Which addons work, remembered.** `createSourceMemory` keeps a halving tally of plays and failures per addon id, at most 100 addons, in IndexedDB, and ranks with a Laplace score. It never stores a stream link, which can carry a debrid key.
8. **Ways out.** The player's Quality menu offers the best stream at each resolution (4K, 1080p, 720p) and switches at the same position. "All streams" (from Details, the player and the problem screen) lists every stream with badges, "Tested: plays", and the reason a stream cannot play here; it can be sorted by quality, fastest start or addon. When nothing plays, the problem screen says why in plain words and offers another stream, All streams, Try again and Back.
9. **Subtitles are drawn by BannerTV.** Every source ends as cues in one renderer: addon files (SRT, VTT, ASS/SSA as styled text), hls.js cues and Shaka cues. Addons are asked with the stream's file name, hash and size so they can match the release. Files are capped at 5 MB, gunzipped where the engine can (Chromium 80 and later), and decoded after a byte-order mark, a strict UTF-8 check and the language's code page. The six most recent files stay parsed.
10. **Choosing subtitles.** The panel (Blue, or the player's Audio and subtitles button) groups subtitles by language, the last chosen first. Pressing the language already showing moves to its next version, the usual fix for subtitles out of step; a file that cannot be read gives way to the next in its language. Each stream starts with the last chosen language: the stream's own track first, since it is always in step, then the first addon file. Timing moves in 0.1 s steps. Size, colour, background and position are in Subtitle style, also in Settings.
11. **Audio.** The TV's `audioTracks` (direct play) or hls.js and Shaka's own lists. The language picked becomes the preference, and the next stream starts in it.
12. **Resume and progress.** The position is saved every 10 s, on pause, when the app is hidden and on leaving. A title resumes once 30 s have played, but not in the last minute; a rewatch resumes unless it stopped past 90%. The clock is only trusted once it has moved past the resume point, never from the 0 that webOS reports first. Details offers "Resume from 42:10" and "Start over", and a series its latest episode. Episodes show a progress bar or a watched tick.
13. **Up Next.** In the last 30 seconds, or at the end, a card offers the next aired episode with a 10 s countdown, starting the same release (`bingeGroup`) from the same addon, else the automatic choice.
14. **Remote controls.** OK plays or pauses and shows the controls. Left and Right scrub 10 s, then 30 s and 60 s as presses repeat, and seek when they stop. Up and Down show the controls. Play, Pause, Stop, Fast forward (+30 s) and Rewind (−10 s) work everywhere. Back cancels a scrub, hides the controls, then leaves.
15. **The picture for the LG store.** The video element sits in the page body, outside the app root that `main.tsx` scales on small windows, at 0,0 and the window's full size with no transform: LG's store rule, without which webOS starts its screensaver over a playing video.
16. **Keys stay private.** Stream links and addon addresses can carry debrid or API keys, so they never appear in focus keys, error messages, logs or stored data; streams are keyed by addon id and position.

## Consequences

- Most viewers press Watch and get a picture. When the guess is wrong, the next stream starts by itself, and All streams is one press away.
- Asking addons on a focus rest costs requests the viewer may never use. The rest delay, the five-minute cache and the never-on-Home rule keep that small; the link test is the costly part and is the first thing to turn off if the floor TV struggles.
- Embedded subtitles in direct-play files are still missing. The Lab has a test of the webOS media pipeline's Luna calls (`subscribe` for the track list, `setSubtitleEnable` and `selectTrack` by `mediaId`), which Lampa, Stremio and Nuvio use. LG does not document them, and on webOS 25 selecting a text track has frozen HLS playback, so the player uses them only if the TV run shows they are safe.
- ASS styling, positioning and karaoke are Phase 5 (JASSUB on webOS 6+). Torrents and proxy-header streams wait for the Phase 5 streaming server.
- The LG demo addon's adaptive HLS needs nothing special: the TV's player takes it, and hls.js takes over if it has subtitle or audio renditions.

## To check on the TV

1. hls.js and Shaka load from `vendor/` and play: the Apple bipbop HLS (alternate audio, subtitles) and a DASH stream.
2. Subtitle fetches from `subs5.strem.io` and other hosts work from the packaged app (webOS appears to relax CORS for apps loaded from `file://`).
3. `tv.model.edidType` names DTS and TrueHD support; a DTS or TrueHD stream ranks low when it does not.
4. A resume with `mediaOption` starts at the right place for MP4 and HLS, and progress is not saved from the first 0.
5. On a UHD stream, HLS reaches 2160p with the lifted `adaptiveStreaming` cap.
6. The link test does not disturb Details (focus, scrolling) and stops when the player opens.
7. The screensaver does not start during playback.
8. Lab, "Test embedded subtitles (Luna)" on the test5 MKV: the track list in `sourceInfo`, whether `selectTrack` shows a subtitle, and whether the clock keeps moving after each call.
9. On webOS 5 (floor TV, when bought): hls.js with its worker, Shaka, and whether link testing can be turned on.

# ADR 0001: React and Norigin, shipped as one classic ES2017 script

- Status: accepted. Spikes run and re-run on the webOS 22 TV on 27 October 2026; HDR10 and the webOS 5 floor are still open (below)
- Date: 26 October 2026, results added 27 October 2026, decision 10 added 9 November 2026

## Context

BannerTV is a packaged webOS web app. The oldest TV it supports runs webOS 5.0, whose web engine is Chromium 68. Packaged apps load from `file://`, where Chromium can refuse module scripts and CORS-mode requests. The plan's Phase 0 asks to prove the stack on a real TV before Phase 1 builds on it.

## Decision

1. **UI**: React 18.3 with Norigin Spatial Navigation (`@noriginmedia/norigin-spatial-navigation` 3.x). Enact stays the runner-up if focus handling struggles in Phase 1.
2. **Core**: `packages/core` is plain TypeScript with no DOM types and no React, enforced by its tsconfig (`lib` without DOM) and ESLint. Phase 0 puts only the observable store in it; addons, caching and user data follow in Phase 1.
3. **Bundle**: Vite builds one IIFE script with `build.target: es2017`. A small Vite plugin (`apps/webos/build/webos-package.ts`) turns the entry tag into `<script defer>`, strips `crossorigin`, and copies `appinfo.json`, the icons and the splash next to `index.html`. CSS is injected by the script, and every URL is relative.
4. **No polyfill bundle**: `tools/scripts/check-bundle.mjs` runs es-check twice: ES2017 for syntax, and ES2018 with feature detection for built-ins. Today nothing newer than ES2018 is used, so core-js is not shipped. A dependency that starts using one fails CI, and the specific polyfill gets added then.
5. **CSS floor**: `tools/scripts/check-css.mjs` rejects CSS that Chromium 68 cannot render (flex `gap`, `aspect-ratio`, `inset`, `:focus-visible`, `min()` and others).
6. **Old TVs**: an inline ES5 script in `index.html` shows "This TV is not supported" when the engine is older than Chromium 68, before the bundle fails to parse.
7. **webOS APIs**: instead of bundling LG's webOSTV.js, `src/platform/webos.ts` calls the same globals it uses (`webOSSystem` or `PalmSystem`, `PalmServiceBridge`) for `platformBack`, device info, Luna calls and relaunch. `appinfo.json` declares `requiredACG: ["systemconfig.query"]` for `getSystemInfo`, which webOS 26 checks when present and webOS 27 requires.
8. **Back key**: `disableBackHistoryAPI: true`. Back handlers sit in layers (overlay, then screen, then router). The order is: close an overlay, close the top screen, return to Home, return to Home's first row, then `platformBack()`.
9. **Focus**: Norigin moves real DOM focus with `preventScroll`, so LG Audio Guidance can read `aria-label`s. Rows and the Home rows area scroll by transform. They slide only in 5-way mode; in pointer mode they hold still, so a tile never slides under a resting pointer and steals focus.
10. **Updates over the air, through Homebrew Channel first, for the rooted test TV only.** On 9 November 2026 Eyitayo chose to update the LG app over the air through Homebrew Channel (webosbrew, 0.7.3) on his rooted 65NANO766QA, where BannerTV is a Developer Mode install of `com.bannertv.app`, and to build signed updates inside the app later, as separate work. The updates Worker (`services/updates`, ADR 0007 decision 11) serves a Homebrew Channel repository at `https://updates.bannertv.workers.dev/webos/repo.json`, one package at main's last publish, and the `.ipk` and icon it names by their SHA-256. The **Publish LG update** workflow, started by hand on main, builds the app with a version of its own (`appinfo.json`'s major.minor, and a patch one above both its own and the highest published, stamped in the build and never committed), so each publish is higher than the last; `rollback-previous` points the repository at the build before. The reasons: Homebrew Channel, which rooted LG TVs usually have, installs over a Developer Mode install, so the TV can take main's builds without a laptop and `ares-install`; and its repository is plain JSON and two files, which the phone's Worker can serve with the same secret hygiene. Because Homebrew Channel never says when there is something new, the app's Settings has an Updates part on the LG (behind the build switch `HOMEBREW_UPDATES_IN_BUILD`): it reads the repository once a visit, says when a newer build is there, and opens Homebrew Channel, adding the repository the first time (`docs/TV_SETUP.md`). What it does not do: Homebrew Channel never looks for updates by itself, so Update is pressed on the TV, and it checks only the SHA-256 the repository gives, with nothing signed, so it is for a rooted test TV and never the store build. Details in `services/updates/README.md`.

## What Phase 0 already proved off the TV

- The production build loads from `file://` in Chromium as a classic script, with the bundled font, `localStorage` and IndexedDB working (Playwright, every pull request).
- Remote journeys pass at 1920x1080 with webOS key codes, including Back as key 461 and `platformBack` on the root screen.
- Initial JavaScript is 89 KB gzipped against a 600 KB budget, and the `.ipk` is about 0.7 MB against 15 MB.
- Desktop Chromium plays the Matroska test file but exposes no `audioTracks` and no in-band text tracks for it, and ignores `mediaOption`. These are exactly the questions only the TV can answer.

## Things learned while building it

- Norigin 3.x queues `addFocusable`, `removeFocusable` and `setFocus` in one task queue. A focusable registered during a key press is not visible to `doesFocusableExist` straight away, but a `setFocus` issued after it runs after it. Screens therefore call `setFocus` on mount without checking existence first.
- Norigin measures with `offsetLeft` and `offsetTop`, so transforms do not move the navigation geometry. The rail's layout box stays collapsed when it opens (only its backdrop and items grow), so "right of the rail" always means the content.

## Spike results

Run on 27 October 2026 on the LG 65NANO766QA (webOS 22, SDK 7.6.0, firmware 04.60.91, Chromium 87), first with the CI build of PR #3 at commit `14c0fdd`, then re-run with the fixes below at `5dd4330`. Eyitayo checked by hand what needs the physical remote and ears. The `.ipk` was installed through the TV's own developer install service, which works on this TV because it is rooted. **Neither `pnpm tv:install` nor the Developer Mode and `ares-*` path in [TV setup](../TV_SETUP.md) has been tested yet.** The full test report is kept with the project files, outside this repository.

| Spike | Question | webOS 22 (65NANO766QA) | webOS 5 floor TV |
| --- | --- | --- | --- |
| 1 | Classic bundle runs from `file://`; font, localStorage, IndexedDB work | **Pass.** `file:` origin, classic script, Urbanist loaded, both stores work | Not bought yet |
| 1 | Remote: arrows, OK, Back, pointer, wheel | **Pass.** 12 scripted 5-way checks pass. The first run found two pointer bugs (fixed below); on the re-run the physical Magic Remote's hover and click both work. Back takes 74 to 93 ms (median 80 ms) from key event to painted frame, and Eyitayo calls it "faster and smooth". The wheel works with synthetic events; the physical wheel is not confirmed | |
| 1 | Back on Home shows the TV's exit prompt | **Pass.** The prompt appears and can be cancelled | |
| 2 | `audioTracks` for MKV direct play | **Exposed and working.** 2 tracks listed; switching 1 → 2 → 1 changes the sound audibly | |
| 2 | Embedded subtitles through `textTracks` | **Not exposed.** 0 text tracks for an MKV with 8 subtitle tracks | |
| 2 | HLS alternate audio and subtitle renditions | **Not exposed.** Native HLS plays (adapts up to 1920x1080) but lists 1 audio and 0 text tracks | |
| 3 | `mediaOption` start position | **Works for HLS and MP4.** Playback starts near 30 s. With `mediaOption` on MP4, `currentTime` reads 0 at the first `playing` event and 29.35 s at the first `timeupdate` 55 ms later; seeking after `loadedmetadata` reads 30.0 s straight away | |
| 3 | 4K HEVC HDR10 plays with the HDR badge | Not tested (no HDR10 file supplied yet). The TV reports HDR10 support | |
| 3 | Dolby Vision profile 8 | Not testable on this TV: it reports no Dolby Vision support | |
| – | `getSystemInfo` and `getConfigs` | **Answer.** UHD true, HDR10 true, Dolby Vision false, UD LCD panel, 1.5 GB memory | |

Other observations:

- The web app runs at 1920x1080 CSS pixels with a device pixel ratio of 2 on this 4K panel, so the engine draws at 3840x2160. Text is sharp, and images look soft unless they are 2x.
- `canPlayType` says "no" for `video/x-matroska`, yet MKV plays. The stream picker cannot use `canPlayType` to decide whether a container plays.
- `getVideoPlaybackQuality()` reports 0 frames, both total and dropped, while playing natively. The app cannot count dropped frames on this TV, so playback health has to come from `waiting` and `stalled` events.
- Because of the late clock with `mediaOption`, the player must not save progress from the first `playing` event: it would overwrite a resume point with 0.

Fixed after the test, in PR #3:

1. The MP4 test link pointed at a ZIP and returned 404. It now uses a streamable 60 second Big Buck Bunny MP4.
2. A failed load in "seek to 30 s" mode left its seek waiting, and the next load in "from the beginning" mode started at 30 s. Each load now sets its own seek target. A Playwright test reproduces the old failure.
3. Diagnostics labelled firmware 04.60.91 as "webOS 4". deviceInfo's `platformVersion` is the firmware version on webOS 22, so the release now comes from `sdkVersion`.
4. Pointer: the first mouse move after the arrows entered a tile before pointer mode switched on, so hover did nothing until the pointer left and came back. Pointer mode is now set in the capture phase and tiles react to moves, not only to entering. A click also records the clicked tile as the one Back returns to, since Norigin moves focus asynchronously. Both have Playwright tests that failed before the fix.
5. Back: returning to Home remounted the rows and slid them into the remembered position over 180 ms. Screens now appear already in place. Diagnostics shows the last five Back timings (key event to painted frame) so the remaining delay can be measured on the TV.
6. The lab says "frame counts not reported" instead of "0 dropped of 0".
7. After the re-run: the lab showed "Started playing at 0.0 s" for a `mediaOption` start that really began near 30 s. It now shows the clock at the `playing` event and at the first `timeupdate` after it, with the delay between them, instead of one number that looks like a first-frame time.

Re-run of 5dd4330: fixes 1 to 6 confirmed on the TV.

Still open: a real 4K HEVC HDR10 file (needs a legal test file and a local build with `lab-sources.local.json`), the physical wheel, the webOS 5 floor TV, and the Developer Mode install path.

How to run them: [TV setup](../TV_SETUP.md).

## Consequences

- The stack stands: the packaged classic bundle, Norigin and the native player all work on webOS 22.
- Subtitles cannot rely on the TV. Addon subtitles, rendered by BannerTV, become the main subtitle path, and embedded MKV subtitles need their own Phase 2 spike. HLS streams with alternate renditions need hls.js to switch them. [PLAN.md](../PLAN.md) is updated to match.
- One script means no lazy loading. When Shaka Player and hls.js arrive in Phase 2, they load as separate classic scripts injected on demand, or the bundle moves to SystemJS chunks. That is decided then, against the 600 KB budget.
- If a spike fails, the plan changes where it depends on that result, and this ADR records the change.

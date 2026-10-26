# ADR 0001: React and Norigin, shipped as one classic ES2017 script

- Status: accepted for Phase 0, spike results pending
- Date: 26 October 2026

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

## What Phase 0 already proved off the TV

- The production build loads from `file://` in Chromium as a classic script, with the bundled font, `localStorage` and IndexedDB working (Playwright, every pull request).
- Remote journeys pass at 1920x1080 with webOS key codes, including Back as key 461 and `platformBack` on the root screen.
- Initial JavaScript is 89 KB gzipped against a 600 KB budget, and the `.ipk` is about 0.7 MB against 15 MB.
- Desktop Chromium plays the Matroska test file but exposes no `audioTracks` and no in-band text tracks for it, and ignores `mediaOption`. These are exactly the questions only the TV can answer.

## Things learned while building it

- Norigin 3.x queues `addFocusable`, `removeFocusable` and `setFocus` in one task queue. A focusable registered during a key press is not visible to `doesFocusableExist` straight away, but a `setFocus` issued after it runs after it. Screens therefore call `setFocus` on mount without checking existence first.
- Norigin measures with `offsetLeft` and `offsetTop`, so transforms do not move the navigation geometry. The rail's layout box stays collapsed when it opens (only its backdrop and items grow), so "right of the rail" always means the content.

## Spike results (to fill in on the TV)

| Spike | Question | webOS 22 (65NANO766QA) | webOS 5 floor TV |
| --- | --- | --- | --- |
| 1 | Classic bundle runs from `file://`; font, localStorage, IndexedDB work | Pending | Not bought yet |
| 1 | Back, pointer, wheel and exit prompt behave as designed | Pending | |
| 2 | `audioTracks` exposed for MKV direct play; switching changes audio | Pending | |
| 2 | Embedded subtitle tracks exposed through `textTracks` | Pending | |
| 2 | HLS alternate audio and subtitle renditions exposed | Pending | |
| 3 | `mediaOption` start position honoured (first frame near 30 s) | Pending | |
| 3 | 4K HEVC HDR10 plays with the HDR badge, no dropped frames | Pending | |
| 3 | Dolby Vision profile 8 plays (HDR10 base layer or DV) | Pending | |
| – | `getSystemInfo` and `getConfigs` answer; HDR10 and Dolby Vision flags | Pending | |

How to run them: [TV setup](../TV_SETUP.md).

## Consequences

- One script means no lazy loading. When Shaka Player and hls.js arrive in Phase 2, they load as separate classic scripts injected on demand, or the bundle moves to SystemJS chunks. That is decided then, against the 600 KB budget.
- If a spike fails, the plan changes where it depends on that result, and this ADR records the change.

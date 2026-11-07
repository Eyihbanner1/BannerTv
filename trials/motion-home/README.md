# Motion trial: Home on a WebGL renderer

A throwaway test app, not part of BannerTV. It answers one question on the real LG: **can Home have Netflix-style motion (sliding rows, a growing focused tile, a fading hero) and stay smooth if it is drawn by a WebGL renderer instead of HTML?**

The shipping app is smooth today because the TV comparisons of 28 to 30 October 2026 turned that motion off (`apps/webos/src/platform/tuning.ts`). This trial turns it back on and draws the same Home three ways:

| Mode | What draws it |
| --- | --- |
| Lightning, sharp | [Lightning 3](https://github.com/lightning-js/renderer) on one WebGL canvas at the TV's own pixel ratio (2 on the 65NANO766QA, so 3840x2160) |
| Lightning, lighter | The same, drawn at 1920x1080 and upscaled by the TV: a quarter of the pixels |
| HTML, same motion | Plain HTML with transforms and CSS transitions, done carefully: the fair comparison |

All three share the layout, focus rules, motion timings and art (`src/model.ts`, `src/data.ts`), so only the drawing differs.

## What it measures

**Run all three tests** walks Home by itself in each mode, the same way, and times every frame:

1. **First walk down**: Down through every row once, pausing 0.7 s on each, so every row's art is seen for the first time (the known 0.3 to 0.45 s hitch on the LG today).
2. **Browsing**: along rows at a press every 0.2 s, back up, and down again over rows already seen.

For each it reports the 95th percentile and worst gap between frames (17 ms is smooth at 60 Hz, over 33 ms a frame was missed, over 100 ms anyone sees a stutter), the JavaScript heap, Lightning's texture memory, and how long Home took to come up. Results stay on the TV (Show results) and are printed to the console as `[motion-trial]` lines for the inspector.

Art comes from Cinemeta's public catalogs and Metahub, at the sizes the app uses on a 4K TV. With no network, or with "Pictures: made-up", the trial draws its own art instead. No private addon is read.

## Deciding

Lightning is worth adopting for the browsing screens if, on the LG, with motion on:

- browsing has a p95 frame gap of 20 ms or less and no stutters,
- the first walk down is clearly better than the HTML mode (p95 at most half),
- texture memory stays under its 160 MB budget, and
- Eyitayo prefers how it feels.

Things the trial also settles: whether Metahub's images load into WebGL from a packaged app (they need CORS; failures are counted), and whether the sharp mode is worth its cost over the lighter one.

Known gaps, by design: no rail, no Continue Watching, and no Audio Guidance (WebGL draws pixels, so screen-reader labels would have to be added separately).

## Running it

```sh
cd trials/motion-home
npm install
npm run dev                 # in a browser: http://localhost:5180/?fixture=1
npm test                    # unit tests
npm run build && npm run e2e
npm run package             # out/com.bannertv.sandbox_0.1.0_all.ipk
```

CI builds the `.ipk` as the `motion-trial-ipk` artifact. It installs as `com.bannertv.sandbox` ("BannerTV motion trial"), beside BannerTV and never in place of it. Remote: arrows and OK; Back returns to the menu; 0 runs the walk in a Try.

It lives outside the pnpm workspace on purpose, with its direct dependencies pinned exactly and no lockfile, so nothing here changes how the app installs or builds.

# ADR 0008: The native TV app

- Status: proposed, first test build on the branch `claude/tv-native`
- Date: 1 November 2026

## Context

On 1 November 2026 Eyitayo asked for the TV to feel as native as Netflix, "even if it does mean
rewriting in a whole different language", with premium, quiet player controls and settings, and
approved a redesign for TV and phone, choosing to try two things at once: the Android TV and Fire
TV screens drawn natively, and a two-week WebGL trial for the LG's Home (PR #21).

Four facts shaped the design:

- The Android TV app (ADR 0005) is the LG app's web page in a WebView. Focus moves, row scrolling
  and the hero crossfade all run on the page's single JavaScript thread, through the WebView's
  layout and paint, on TV chips far slower than a phone's. That is where it stops feeling native.
- React Native for TV (the `react-native-tvos` fork) draws with Android's own views, moves focus
  with Android's focus engine, and runs animations on the UI thread through the native driver.
- The phone app (ADR 0007) already runs the LG app's whole data layer and player session inside
  React Native, through browser stand-ins and an expo-video bridge. The TV app can reuse all of
  it, so nothing below the screens is written twice.
- The LG cannot run React Native. Its app stays web, and its native feel is PR #21's question.

## Decision

1. **React Native for TV through Expo.** `apps/tv` is an Expo SDK 58 app on `react-native-tvos`
   0.88 with React 19. `@react-native-tvos/config-tv` writes the TV manifest (Leanback launcher,
   banner, no touch screen required) when `EXPO_TV=1`. The native project is generated in CI from
   `app.config.ts`, as for the phone. The version is the LG app's, from `appinfo.json`.
2. **Everything below the screens is shared.** Screens import `apps/webos/src` as `@tv/*` and the
   phone's stand-ins, shims, expo-video bridge and a few pure helpers from `apps/mobile/src` as
   `@phone/*`. Metro resolves React, React Native, Expo and i18next from `apps/tv`, so one copy of
   each runs.
3. **Installed with npm, outside the workspace.** The workspace's `pnpm-lock.yaml` can only be
   changed with care, and the TV fork must not meet the phone's React Native in one
   `node_modules`. So `pnpm-workspace.yaml` leaves `apps/tv` out, it pins exact versions and
   installs with npm, and `.npmrc` turns on `legacy-peer-deps` so npm does not add a second React
   Native for packages that ask for `0.88.0`.
4. **Native focus and motion.** Focus is Android's: `Pressable` and `TVFocusGuideView`, with
   `hasTVPreferredFocus` to land on a screen. The focus ring, tile scale and hero fade are
   `Animated` values on the native driver. Rows are `FlatList`s with fixed item sizes that scroll
   the focused tile into place. Home's backdrop is `expo-image`, which crossfades and caches
   natively, and waits a moment before changing so holding an arrow does not decode every picture.
5. **One set of design tokens.** `brand/tokens/design.json` holds the redesign's colours, type,
   spacing, radii, focus, motion, easing and TV and player sizes. `tools/scripts/build-tokens.mjs`
   makes CSS variables (`design.css`) for the web apps and typed constants (`design.ts`) for React
   Native, and `pnpm lint` fails if they are stale. The TV app draws at the canvas's 1920 width and
   scales to the device (`src/ui/scale.ts`).
6. **Screens.** Home (hero, Continue Watching and the addons' rows), title details with seasons
   and episodes, All streams, My List, Settings (Playback and Subtitles change here, the rest show
   what is set and point to the LG app or phone), "Who's watching?" and the welcome. Screens under
   the top one stay mounted and hidden, so Back returns to the same place.
7. **The player.** The LG app's playback session drives expo-video through the phone's bridge. The
   controls fade in on a key and out after four seconds, seek ten seconds a press on left and right
   (repeating while held), and keep audio, subtitles and their style, quality and the stream list in
   sheets, with Up Next and "Still watching?" as on the LG.
   - The video file's own text subtitles are drawn by the app in the viewer's style, as addon
     files are: the phone's `modules/banner-cues` is linked in too (ADR 0007), so Android hands
     their lines over through the phone's bridge and hides Media3's own subtitle view for them.
     Picture subtitles (PGS, DVB) Media3 still draws itself. With the style at the top, every
     line goes there, as on the phone.
   - The tracks sheet has a Timing column between Subtitles and Style, as the LG's Timing tab:
     the offset and which way, steps of 0.1 s, 0.5 s and 5 s each way, Reset, and the drift fix
     for a file timed for another frame rate, each kept for the file; its heading says the offset
     and whether the file was lined up or its drift fixed. Only a press changes them. As ADR
     0005 decision 6 says, Android's own lines can be shown later but not earlier: a line comes
     as it starts, with no end of its own.
     Above the steps, Match a line (ADR 0003, item 10): the lines around now as options, the one
     on screen marked, and OK on the line just heard sets the timing to it, reading the video's
     clock at the press; a second press much later in the film fixes a drift too, and Undo comes
     after Reset while a press is the last change. The option with focus stays in the list as
     the lines move on, and focus starts on the line last shown. Above that, last episode's
     timing for the same release is offered ("Use it", with focus first, and "No thanks"), with
     a toast for 8 s as the episode starts. What takes focus is decided once, as the sheet
     opens: a line starting, or a line or an offer that comes later, never takes it from
     wherever the viewer is. A picture track says only that its timing can't be changed.
8. **A test package.** `com.bannertv.app.tvnative`, "BannerTV native test", installs beside the
   Android TV app. CI's `TV APK (React Native)` job type-checks, tests and builds a release APK
   signed with the Expo template's debug key, and uploads it as `bannertv-tv-native-apk`.
9. **SubDL, read only.** The Subtitles section says on grown-ups' profiles whether SubDL subtitles are on, off or the key was not accepted (`src/screens/settings/subdl-row.ts`), and that the key is added or changed on the phone or the LG, signed in to the same account (ADR 0003, Step D). There is no text entry: typing a long key with the remote is what the phone is for.

## Consequences

- Focus, scrolling and animation leave the JavaScript thread, which is the native feel asked for.
  Whether it is enough on the slowest Fire TV sticks is for the first TV round to show.
- A change to the shared data layer reaches the LG, the phone and the native TV app, and the TV
  app's typecheck catches one that breaks it.
- Two Android TV apps exist while this is tried. Whether the native app later replaces the
  WebView app under its package is decided after the TV rounds.
- The TV app is not in the workspace's `pnpm install`, `pnpm typecheck` or `pnpm test`. CI runs
  its own checks, and its versions are pinned by hand.
- Not yet in this build: Search, Discover, Sports, making or joining an account, Trakt sign-in,
  editing profiles, home row settings and parental controls on the TV itself.

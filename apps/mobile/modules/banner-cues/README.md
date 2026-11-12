# banner-cues

A local Expo module (autolinked from `modules/`) that hands the shared code the lines of the subtitle track inside the file, as they show, so the phone draws them in the profile's subtitle style instead of Media3's fixed look.

expo-video plays through Media3's ExoPlayer but tells JS nothing about cues. This module listens on the ExoPlayer inside expo-video's `VideoPlayer` (`Player.Listener.onCues`) and sends `cues` with `at` (seconds on the player's clock) and the lines (`text` with `<b>`, `<i>` and `<u>`, and `&`, `<` and `>` escaped; `top` for a line placed at the top). `src/player/phone-host.ts` passes it on to the shared code as the Android bridge's `{ "type": "player", "event": "cues" }`, exactly as the Android TV app sends it (ADR 0005, decision 6).

- `watch(player)`: the player phone-host.ts makes once and keeps.
- `draw(on)`: sent with each subtitle choice. While on, Media3's own subtitle view is hidden for text lines. Picture subtitles (PGS, DVB) still show there, and the shared code gets an empty group for them.

Media3's content frame, and the subtitle view inside it, is the picture's whole frame. Past fit (the player's Picture size at Fill, or any size pinched) it is larger than the screen, and moved, it sits off centre. The module pads that view down to the whole frame fitted in the screen and centred (`ScreenFit.kt`, which needs nothing from Android), so the subtitles Media3 draws stay on the screen where they would be with the picture fitted, never cut off or stretched, at any size and place. The screen is the content view of the window the player is in, which the player screen fills, drawn edge to edge with the system bars hidden; in picture-in-picture it is the small window. It is measured again just before each frame the window draws, since moving the picture moves the subtitle view without laying it out again, and the padding is set only when it changes.

`Cues.kt` is the same code as the Android TV app's `apps/androidtv/app/src/main/java/com/bannertv/app/Cues.kt`, where JUnit tests cover it. Change both together.

The module depends on expo-video through `expoModule.getExpoDependency("expo-video")`, which names its source project or the prebuilt library autolinking chose for it, and on Media3 at expo-video's own version (1.9.1). Update that version when expo-video moves.

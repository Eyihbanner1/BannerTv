# banner-cues

A local Expo module (autolinked from `modules/`) that hands the shared code the lines of the subtitle track inside the file, as they show, so the phone draws them in the profile's subtitle style instead of Media3's fixed look.

expo-video plays through Media3's ExoPlayer but tells JS nothing about cues. This module listens on the ExoPlayer inside expo-video's `VideoPlayer` (`Player.Listener.onCues`) and sends `cues` with `at` (seconds on the player's clock) and the lines (`text` with `<b>`, `<i>` and `<u>`, and `&`, `<` and `>` escaped; `top` for a line placed at the top). `src/player/phone-host.ts` passes it on to the shared code as the Android bridge's `{ "type": "player", "event": "cues" }`, exactly as the Android TV app sends it (ADR 0005, decision 6).

- `watch(player)`: the player phone-host.ts makes once and keeps.
- `draw(on)`: sent with each subtitle choice. While on, Media3's own subtitle view is hidden for text lines. Picture subtitles (PGS, DVB) still show there, and the shared code gets an empty group for them.

`Cues.kt` is the same code as the Android TV app's `apps/androidtv/app/src/main/java/com/bannertv/app/Cues.kt`, where JUnit tests cover it. Change both together.

The module depends on expo-video through `expoModule.getExpoDependency("expo-video")`, which names its source project or the prebuilt library autolinking chose for it, and on Media3 at expo-video's own version (1.9.1). Update that version when expo-video moves.

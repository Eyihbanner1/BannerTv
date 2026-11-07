# stream-helper

A local Expo module (autolinked from `modules/`) that runs the stream helper for an LG on the home network, as the Android TV app does (ADR 0005, decision 13). Some add-on streams need request headers the LG's player can't send; while the helper is on, the LG plays them through this phone.

- The web server and its rules are not copied here. `android/build.gradle` adds `apps/androidtv/helper-core/src/main/java` as a source folder, so the phone and the Android TV app build the same `com.bannertv.helper` code, and its unit tests run in the Android TV app's `testDebugUnitTest`.
- `StreamHelper.kt` and `HelperService.kt` are the Android TV app's shells with this module's notification strings and icon, the app's own version in the User-Agent, and the app's launcher activity as the notification's tap.
- `AndroidManifest.xml` brings the permissions and the `specialUse` foreground service, which merge into the app's manifest.
- The JavaScript module is `BannerStreamHelper`: `state()` returns the same JSON as the Android TV app's `helperState()`, and `command(name)` takes `"start"`, `"stop"` or `"forget"`. `src/player/phone-host.ts` puts them on the bridge as `helperState()` and `helper()`, so the shared `androidHelperState()` works unchanged. The web build has no module, so Settings hides the helper there.

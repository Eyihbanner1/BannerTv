# banner-relaunch

A local Expo module (autolinked from `modules/`) that sends `relaunch` when the app is opened again from the launcher while it is running. `src/player/phone-host.ts` passes it on to the shared code as the Android bridge's `{ "type": "relaunch" }`, so "Who's watching?" is asked again when a profile has a PIN or "Ask at launch" is on, as on the Android TV app.

It also stands every new activity upright before anything is drawn (`UprightStartPackage.kt`). Android keeps the player's sideways lock with the activity's record, so without this the app would open sideways on Home after Android closed it in the background during a video, until the JavaScript asks for upright (`src/player/orientation.ts`).

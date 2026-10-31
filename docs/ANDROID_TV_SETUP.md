# Running BannerTV on Android

How to put a test build of the Android app (`apps/androidtv`, ADR 0005) on an Android phone, an Android TV or Google TV device, a Fire TV, or the Android TV emulator. The app is the LG app's own build inside an Android shell, with Android's player for video, so everything but playback looks and works as on the TV.

## Get the APK

Every CI run builds it; nothing needs installing on a computer.

1. On GitHub, open the repository's **Actions** tab, then the latest **CI** run for the branch (or for `main`).
2. Under **Artifacts**, download **bannertv-apk**. It is a zip; inside is `bannertv-<version>-debug.apk`, and `bannertv-<version>-release.apk` once the release key is set up.

The debug build installs as **BannerTV test** (`com.bannertv.app.debug`), beside any release build, with its own data. A newer debug build installs over it and keeps its addons and profiles. CI keeps the debug key in its cache, which GitHub empties after a week without a run. A branch's builds share one key, and every branch can read `main`'s, but `main` cannot read a branch's, so the first build from `main` after a merge has a key of its own. If Android refuses an update ("App not installed" or "package conflicts"), uninstall the old build first, which clears its data.

## On an Android phone

1. Download **bannertv-apk** in the phone's browser (signed in to GitHub), or copy the APK over from the computer.
2. Open the zip in **Files**, then open the APK. Android asks to let Files (or the browser) install unknown apps: allow it, then **Install**.
3. Open BannerTV. It runs in landscape, at the TV's layout scaled to the screen.
   - A tap works as a Magic Remote click; the back gesture or button is Back.
   - A Bluetooth keyboard's arrows and Enter work as the remote's arrows and OK.
   - To use the computer's keyboard as the remote and see the phone on the computer, use [scrcpy](https://github.com/Genymobile/scrcpy): turn on **USB debugging** (Settings, About phone, tap **Build number** seven times, then Settings, System, Developer options), plug the phone in and run `scrcpy`. Arrows and Enter are the remote, right-click or Ctrl+B is Back.

## On Android TV and Google TV

1. Turn on developer options: Settings, System, About, then press OK on **Android TV OS build** seven times.
2. Either:
   - **With a computer:** in Developer options turn on **USB debugging** (and, on Android 11 or newer, **Wireless debugging**, then pair with `adb pair <ip>:<port>` from that screen). Then `adb connect <device-ip>:5555` (or the port Wireless debugging shows) and `adb install -r bannertv-<version>-debug.apk`.
   - **Without a computer:** install **Downloader** from the Play Store, allow it in Settings, Apps, Security, **Install unknown apps**, and open a link to the APK in it. GitHub's artifact links need a sign-in, so this needs the APK put somewhere Downloader can reach.
3. BannerTV appears in the apps row with its banner.

## On Fire TV

1. Settings, My Fire TV, About: press OK on the device name seven times. **Developer options** appears under My Fire TV.
2. In Developer options turn on **ADB debugging**, then from the computer run `adb connect <fire-tv-ip>` and `adb install -r bannertv-<version>-debug.apk`. Or turn on **Apps from Unknown Sources** (Fire OS 6) or allow **Downloader** under **Install unknown apps** (Fire OS 7 and 8) and use Downloader as above.

## On the Android TV emulator

1. Install [Android Studio](https://developer.android.com/studio), open **Device Manager**, and create a device: **TV**, **Television (1080p)**, with a Google TV system image of API 34.
2. Start it and drag the APK onto its window.
3. The computer's arrows and Enter are the remote. The emulator's extended controls have a D-pad, Back and media keys.

Video in the emulator uses software decoders, so it shows whether a stream starts and the controls work, not how 4K, HDR or Dolby sound play on a real device.

## Looking inside

- **The web app:** the debug build lets Chrome on the computer inspect the WebView. With the device connected over adb, open `chrome://inspect` in Chrome and choose BannerTV's page.
- **Android's side:** `adb logcat` shows the shell and the player; `adb logcat | grep -i -E "bannertv|exoplayer"` narrows it.
- **In the app:** Settings, Diagnostics shows the Android section: device, Android version, app version, WebView and what the device reports it can play.

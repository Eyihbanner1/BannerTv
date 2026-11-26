# Running BannerTV on a Samsung TV

How to put a test build of the Samsung app (`apps/tizen`, ADR 0009) on a Samsung TV. The app is the LG app's own build, packaged for Tizen, Samsung's TV system, so it looks and works as on the LG. It runs on Samsung TVs from 2019 (Tizen 5.0) on. A Samsung TV's year is the letter after the screen size in its model number: R is 2019 (UE50**R**U7470), T 2020, A 2021, B 2022, C 2023, D 2024. Older sets (N, M, K) show "This TV is not supported".

## Get the app

The app is a `.wgt` file.

- **Test builds from a pull request's branch** go on the public pre-release `samsung-test`, at a link that never changes: <https://github.com/Eyihbanner1/BannerTv/releases/download/samsung-test/bannertv.wgt>. Each new build replaces the file behind it.
- **Any full CI build** (the README says when one runs) has it too: open the run in the repository's **Actions** tab and download **bannertv-wgt**, a zip with `bannertv_<version>.wgt` inside. That needs a GitHub sign-in.
- **On a computer with the repository:** `pnpm build`, then `pnpm package:tizen`, which writes `out/bannertv_<version>.wgt`.

The `.wgt` is unsigned. A Samsung TV installs only apps signed with a certificate made for that TV, from a Samsung account, so the tool that installs it signs it first.

## 1. Put the TV in Developer Mode

Once per TV. The TV then accepts installs from one computer or phone, named by its address on your Wi-Fi.

1. Find the address of the computer (or phone) you will install from. On Windows: **Settings, Network & internet, Wi-Fi**, your network's **Properties**, and the **IPv4 address**, such as `192.168.1.23`. The TV and the computer must be on the same network.
2. On the TV, open **Apps** (press Home, then **Apps** on the bar).
3. On the Apps screen, press **1 2 3 4 5** on the remote. On the Smart Remote, which has no digits, press the **123** button (or the button with four coloured dots) to bring up the number pad.
4. A **Developer Mode** box opens. Turn it **On**, type the computer's address under **Host PC IP**, and choose **OK**.
5. Restart the TV: hold the **Power** button until the Samsung logo shows again (or unplug it for 30 seconds). **Developer Mode** now shows at the top of the Apps screen.

If the computer's address changes later (routers hand them out afresh), repeat steps 2 to 5 with the new one.

## 2. Install with Apps2Samsung

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is a free community tool (formerly the Jellyfin Samsung installer) that finds the TV, makes the certificate and installs, with no Tizen Studio. It is not Samsung's.

1. On Windows, open **Terminal** and run `winget install Apps2Samsung.Apps2Samsung`, or download the `-win-x64.zip` from its [releases](https://github.com/Apps2Samsung/Apps2Samsung/releases). It also runs on macOS, Linux and Android.
2. Open Apps2Samsung and pick the TV. If it says the TV is not ready (Developer Mode off, the Host PC IP pointing elsewhere, a restart needed), fix what it names.
3. Choose to install your own app, and give it the link above (or the `.wgt` you downloaded). Then **Install**.
4. The first install opens the Samsung account sign-in in the browser. Sign in (any Samsung account; a new one is free). Apps2Samsung makes a certificate for this TV and keeps it for every later install.
5. BannerTV appears in the TV's **Apps**, and Apps2Samsung can open it. To keep it on the Home bar, open its options in Apps and choose **Add to Home**.

Apps2Samsung also has a command line, `apps2samsung-cli`, with the same steps (`apps2samsung-cli --help`).

## Updates

Install the new build the same way, from the same link. It installs over the old one and keeps its addons, profiles and progress, as long as the same certificate signs it, which Apps2Samsung sees to. There is no in-app update on Samsung yet: the LG's (Homebrew Channel and the signed updates) work on webOS only.

## Removing it

On the TV: **Apps**, the settings gear at the top right, **BannerTV**, **Delete**. Apps2Samsung can uninstall it too. Developer Mode can be turned off again in the same box as step 4; BannerTV stays installed.

## With Tizen Studio instead

Samsung's own route, for a developer machine: install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) with the **TV Extensions** and **Samsung Certificate Extension**, connect the TV in **Device Manager**, make a **Samsung** certificate profile in **Certificate Manager** (which reads the TV's DUID while it is connected), then from a terminal:

```sh
tizen package -t wgt -s <profile-name> -- bannertv_<version>.wgt
tizen install -n bannertv_<version>.wgt -t <tv-name>
```

A certificate from Tizen's own authority, with no Samsung account, installs on the emulator only.

## Checking a build

Settings, Diagnostics shows a **Samsung TV** section: the model, Tizen release, 4K panel, HDR and whether Samsung's product API loaded. To debug the page from a computer, Apps2Samsung can open the app for `chrome://inspect`, or with Tizen Studio run `sdb shell 0 debug BannerTv01.BannerTV` and open the port it prints.

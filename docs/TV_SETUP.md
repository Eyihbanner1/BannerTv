# Running BannerTV on the development TV

How to put a development build on the LG 65NANO766QA (webOS 22) and run the three Phase 0 spikes. Allow about 30 minutes the first time; after that, `pnpm tv:install` does it in one step.

## What you need

- The TV and a computer on the same home network.
- On the computer: [Node.js 22](https://nodejs.org/), git, and pnpm (run `corepack enable` once after installing Node).
- A free LG developer account from [webostv.developer.lge.com](https://webostv.developer.lge.com/). Only one TV can use Developer Mode per account at a time.

## 1. Turn on Developer Mode (once)

1. On the TV, open the **LG Content Store**, search for **Developer Mode** and install it.
2. Open **Developer Mode** and sign in with the LG developer account.
3. Turn on **Dev Mode Status** and let the TV restart.
4. Open **Developer Mode** again and turn on **Key Server**. Keep this screen open: it shows the passphrase you need in step 3.
5. Note the TV's IP address. If the Developer Mode app does not show it, find it in the TV's network settings.

A Developer Mode session lasts 1000 hours. Sideloaded apps disappear when it runs out, so open the app and press **Extend** every week or so.

## 2. Get the code (once)

```sh
git clone https://github.com/Eyihbanner1/BannerTv.git
cd BannerTv
pnpm install
```

Until the Phase 0 pull request is merged, also run `git checkout claude/project-thread-68pjnd`.

## 3. Register the TV with LG's tools (once)

The webOS CLI (`ares-*` commands) is installed with the project. `pnpm ares` runs it. Replace the IP address with your TV's:

```sh
pnpm ares ares-setup-device -a tv -i "username=prisoner" -i "host=192.168.1.50" -i "port=9922"
pnpm ares ares-novacom --getkey -d tv
```

The second command asks for the passphrase from the Developer Mode screen. It is case-sensitive. Then check the connection:

```sh
pnpm ares ares-device -i -d tv
```

It should print the TV's model and webOS version.

## 4. Install and open BannerTV

```sh
pnpm tv:install
```

This builds the app, checks it for webOS 5.0, packages `out/com.bannertv.app_0.1.0_all.ipk`, installs it on the TV and opens it. BannerTV also appears in the TV's app list.

A full CI build also makes the `.ipk` (the README says when one runs). To install that one instead, download the **bannertv-ipk** artifact from the run's checks, unzip it, and run:

```sh
pnpm ares ares-install -d tv path/to/com.bannertv.app_0.1.0_all.ipk
```

`pnpm tv:inspect` opens Chrome DevTools for the running app, which shows its console.

### Updates through Homebrew Channel

On a TV with [Homebrew Channel](https://www.webosbrew.org/), BannerTV can be updated from the sofa, with no computer. The updates Worker (`services/updates`) serves BannerTV's own Homebrew Channel repository at `https://updates.bannertv.workers.dev/webos/repo.json`, with the newest build of main in it. Homebrew Channel sees BannerTV because it is a Developer Mode install of `com.bannertv.app`.

1. In BannerTV, open **Settings**. **Updates** says which build this TV has and, when the repository has a newer one, "BannerTV 0.2.0 is ready in Homebrew Channel" (or "You have the latest build"). It reads the repository once each time Settings opens, without holding the screen up, and when there is no answer it says nothing more.
2. Choose **Get updates in Homebrew Channel**. The first time, Homebrew Channel opens on its Add repository dialog with BannerTV's address filled in. Choose **Add repository**, then press Back to reach its list of apps.
3. Choose **BannerTV**, then **Update**. Homebrew Channel downloads the `.ipk`, checks its SHA-256 and installs it over the one on the TV. Installs over the top on the test TV have kept BannerTV's profiles, addons and settings so far.

After the first time, the button asks first: **Open Homebrew Channel**, or **Add BannerTV's repository again**. Homebrew Channel does not notice a repository it has already, and confirming the dialog a second time lists it twice. That is harmless but untidy: select the extra copy in Homebrew Channel's Settings to remove it. Add it again only when BannerTV is missing from Homebrew Channel's apps, because the dialog was closed without adding it or the repository was removed. If Homebrew Channel is not on the TV, the line above the button says so.

Homebrew Channel never looks for updates by itself, and its Update button is on whenever the installed version differs from the repository's, even when the repository's is older. Settings says when that is so: "This build is newer than Homebrew Channel's 0.1.0".

None of this shows in the Android app or in a browser. `HOMEBREW_UPDATES_IN_BUILD` in `apps/webos/src/app/features.ts` turns it off for an LG Content Store build, where the store updates the app.

## 5. Run the spikes

All three spikes live under **Settings** in the app. Take a photo of each result screen, or copy the console lines from `pnpm tv:inspect`.

### Spike 1: does the packaged app run properly?

Open **Settings → Diagnostics**. Expected on this TV:

| Row | Expected |
| --- | --- |
| Loaded from | `file:` |
| Bundle | classic script |
| Font | Urbanist loaded |
| localStorage, IndexedDB | works |
| Chromium | 87 |
| webOS release | 22 |
| SDK version | 7.6.0 (webOS 22) |
| Firmware | 04.60.91, or newer after a TV update |

Anything different is a finding. The **Media** column shows which codecs the TV's own player (left) and MSE (right) accept. The **TV** column shows whether the TV reports HDR10 and Dolby Vision support.

Also try the remote on every screen: arrows, OK, Back, the Magic Remote pointer (hover and click) and its wheel. On Home, Back should first jump to the first row and then show the TV's exit prompt.

To measure the Back delay: on Home, open a title with OK and press Back, five times. Then open **Settings → Diagnostics**: **Back response** lists the last five times, in milliseconds, from the key press to the screen showing the result.

### Spike 2: can we switch audio and subtitle tracks?

Open **Settings → Playback lab**, leave **Start** on "from the beginning", and play **MKV, 2 audio + 8 subtitle tracks**.

- **Audio row**: does it list 2 tracks, or say audioTracks is not exposed? If it lists them, pick the second and listen for a change.
- **Subtitles row**: how many tracks appear? Pick one: does text appear on the video?

Repeat with **HLS, alternate audio and subtitles**.

### Spike 3: start position and HDR

1. Press **Start** until it reads "30 s via mediaOption", then play **MP4, H.264 360p, 1 minute**. **Clock at start** shows the position at the first `playing` event and at the first `timeupdate` after it. On webOS 22 the first reads 0.0 s and the second about 29.3 s, 55 ms later: the clock catches up late, but playback really starts near 30 s.
2. Switch to "30 s by seeking" and play it again, for comparison.
3. For 4K HEVC HDR10 and Dolby Vision profile 8, add your own files (next section), play them, and note whether the TV shows its HDR or Dolby Vision badge and whether the picture stutters. The 65NANO766QA has no Dolby Vision, and it does not report frame counts, so the **Video** line says "frame counts not reported" there.

**Full screen** shows the video at 1920x1080; Back leaves full screen. The remote's play and pause keys work in the lab.

## 6. Your own test files

The lab can play any URL the TV can reach. To add some:

1. Copy `apps/webos/lab-sources.example.json` to `apps/webos/lab-sources.local.json` and put your URLs in it. That file is never committed.
2. To play files from your computer, serve their folder: `npx http-server path/to/videos -p 8080 --cors`, and use `http://<your computer's IP>:8080/<file name>`.
3. Run `pnpm tv:install` again.

Do not share an `.ipk` built with private links in it: debrid links contain your account key.

## 7. Report back

Post the photos or console output in the BannerTV project thread. The results go into [ADR 0001](adr/0001-react-norigin-classic-bundle.md), and the plan is adjusted wherever they differ from what it assumes.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ares-novacom --getkey` fails | Key Server must be on in the Developer Mode app, and the passphrase is case-sensitive |
| `ares-install` cannot connect | Developer Mode may have expired or the TV's IP changed. Open the Developer Mode app, then `pnpm ares ares-setup-device -m tv -i "host=<new IP>"` |
| The app opens to a black screen | Run `pnpm tv:inspect` and look for errors in the console |
| "This TV is not supported" | The TV runs webOS 4 or older (Chromium below 68), which BannerTV does not support |

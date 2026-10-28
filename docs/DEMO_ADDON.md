# BannerTV Demo addon

BannerTV has no films of its own, so a new viewer, and LG's testers, would open an empty app. The BannerTV Demo addon fixes that with three Creative Commons films from the Blender Foundation, served by BannerTV itself and preinstalled next to Cinemeta and OpenSubtitles v3 (PLAN.md, store section). It is a normal Stremio-protocol addon: any Stremio client can install it from `https://demo.bannertv.workers.dev/manifest.json`.

The code is in `services/demo`. This page covers what it serves and why, how the films are encoded, where it is hosted, what it costs, and how to deploy it.

## The films

| Film              | Year | Length | Director          | Licence   | Credit line used                                                 |
| ----------------- | ---- | ------ | ----------------- | --------- | ---------------------------------------------------------------- |
| Big Buck Bunny    | 2008 | 9:56   | Sacha Goedegebure | CC BY 3.0 | (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org    |
| Spring            | 2019 | 7:44   | Andy Goralczyk    | CC BY 4.0 | © Blender Foundation \| cloud.blender.org/spring                 |
| Wing It!          | 2023 | 3:58   | Rik Schutte       | CC BY 4.0 | (CC) Blender Foundation \| studio.blender.org                    |

All three are suitable for all ages and have no dialogue. The licences and credit lines are the ones on each film's official page (peach.blender.org for Big Buck Bunny; the About and Licensing pages on studio.blender.org for the others). Sintel, which has official subtitles in nine languages, is left out because a dragon is stabbed on screen (roughly 12+); it can be added to `films.json` later.

Everything about a film lives in `services/demo/films.json`: its text, credit, licence, source addresses, and the frames chosen for its artwork. The Worker builds the addon's answers from that file and the media script encodes what it lists. `pnpm --filter @bannertv/demo test` checks it.

**What the licences ask, and where BannerTV does it.** CC BY needs the credit, a link to the licence, and a note of any changes. The credit and licence are on the first line of each stream in the picker, in the Details description ("Licensed under CC BY 4.0; re-encoded for streaming by BannerTV"), and on the addon's own page at `https://demo.bannertv.workers.dev/`, which links each licence and says the Blender Foundation does not endorse BannerTV. The store listing should credit them too.

**Title artwork.** Blender's licensing pages exclude their logos and title treatments from the CC licence. So each film's title is set in Urbanist, BannerTV's own typeface, by `scripts/render-art.mjs`, and the PNGs are committed in `services/demo/static/art`. Posters and backdrops are made from frames of the films themselves (see Deploying, step 4).

## What the addon answers

| Request                                           | Answer                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/manifest.json`                                  | `com.bannertv.demo`, movies only, ids starting `bannertv:`                                        |
| `/catalog/movie/blender.json`                     | The three films, with poster, backdrop, title logo, description, year, runtime and genres        |
| `/catalog/movie/blender/search=….json`            | Films whose title, director, genre or year match every word typed                                 |
| `/meta/movie/bannertv%3A<film>.json`              | Details, with the credit sentence. `{"meta": null}` for anything else                            |
| `/stream/movie/bannertv%3A<film>.json`            | Two entries: the adaptive HLS stream and an identical backup. `{"streams": []}` for anything else |
| `/`                                               | The credits page                                                                                  |
| `/media/…`, `/art/…`                              | Static files: playlists, segments, subtitles, artwork                                             |

These choices come from how the TV app reads addons:

- **First in the list.** Home loads catalog rows in addon order, and the first row also fills the hero. The Demo goes first in `DEFAULT_ADDONS` so its films are what a new viewer sees.
- **Every catalog item is complete.** The hero shows catalog data only, so each item carries its own artwork and text. Our own id prefix means Cinemeta and OpenSubtitles are never asked about these films.
- **Posters carry the title.** Poster tiles hide their caption once the image loads.
- **No genre list.** A catalog that lists genres would take Home's genre rows from Cinemeta. Search is answered, so the films turn up when someone searches for them.
- **The stream name is never shown.** The picker shows the description, so the credit goes on its first line. The description also avoids words the stream ranker reads as facts ("TS", sizes, release names).
- **A backup copy.** The player moves to the next stream if one stalls for 20 seconds. The second entry is the same files under another address (`?b=1`), so a hiccup on one request does not end playback.
- **Subtitles.** The films have no dialogue, so each has two clearly labelled test tracks, English and Korean, with a numbered line every 30 seconds ("Subtitle check 3 of 20 / This line uses your subtitle size and colour"). They let a tester check that subtitles, their size and colour settings work (LG self-check item 48). Subtitles are off until the viewer picks a track.

`src/contract.test.ts` reads every answer through the app's own parser (`@bannertv/protocol`) and stream ranker (`@bannertv/core`), for a webOS 22 4K TV, a webOS 5 Full HD TV and a browser: both copies must be playable without a warning, ranked primary first, and offered as one 1080p choice in the Quality menu.

## Encoding

LG's self-check item 43 plays a title at 512 kbps, 1 Mbps, 7 Mbps and 17.5 Mbps, twice each, and over IPv6, and expects the picture to adapt without constant buffering. Each film is therefore one adaptive HLS stream with five sizes. The figures below were measured on a hard-to-compress test film; real films hit the same averages, since the encoder aims at an average bitrate.

| Size  | Picture   | Video target / peak | Audio    | H.264 level | Measured peak (whole stream) |
| ----- | --------- | ------------------- | -------- | ----------- | ---------------------------- |
| 288p  | 512×288   | 200 / 220 kbps      | 64 kbps  | 3.0         | 313 kbps                     |
| 360p  | 640×360   | 400 / 440 kbps      | 64 kbps  | 3.0         | 533 kbps                     |
| 540p  | 960×540   | 1100 / 1320 kbps    | 128 kbps | 3.1         | 1353 kbps                    |
| 720p  | 1280×720  | 2800 / 3360 kbps    | 128 kbps | 3.1         | 3158 kbps                    |
| 1080p | 1920×1080 | 5000 / 6000 kbps    | 128 kbps | 4.0         | about 5.3 Mbps               |

At each of LG's four speeds the best size that leaves a fifth of the link spare is a different one: 288p, 360p, 720p and 1080p. The 288p size also keeps playing when Korean traffic is routed through the United States (see Hosting).

What the webOS player needs, from LG's streaming and video specifications and its developer forum:

- MPEG-TS segments, four seconds each. Older webOS releases handle fMP4 HLS poorly.
- H.264 High at level 4.0 or lower, AAC-LC stereo at 48 kHz muxed into every size. No separate audio or subtitle renditions, which would make the app hand the stream to hls.js.
- Every size cut at the same times. A fixed two-second closed GOP at a constant 24 fps (`-g 48 -keyint_min 48 -sc_threshold 0`, no open GOP) puts keyframes at the same timestamps everywhere.
- A master playlist that lists the smallest size first, says `BANDWIDTH` (the measured peak), `AVERAGE-BANDWIDTH`, `CODECS`, `RESOLUTION` and `FRAME-RATE`, and leaves out `EXT-X-INDEPENDENT-SEGMENTS`, which LG lists as unsupported. ffmpeg's own master understates the peaks, so `scripts/lib/playlists.mjs` writes ours from the real segment sizes.
- Every film fitted inside 1920×1080 and padded to 16:9 with square pixels, so all sizes share one shape. The scope films (2.39:1) keep their black bars.

Sources: [LG streaming protocols](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm), [LG video and audio formats (webOS 5)](https://webostv.developer.lge.com/develop/specifications/video-audio-50), [LG HLS troubleshooting](https://webostv.developer.lge.com/faq/streaming-http-live-streaming-hls-troubleshooting), [Apple HLS authoring specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices), [ffmpeg hlsenc](https://ffmpeg.org/ffmpeg-formats.html#hls-2).

## Hosting

One Cloudflare Worker named `demo`, on the same personal account as the pairing relay, at `https://demo.bannertv.workers.dev`. The films, artwork and subtitles are uploaded with it as static assets; the Worker code answers only the addon's JSON.

- **Why static assets, not R2.** Requests for static assets are free and unlimited and never run the Worker, so a viewer's hundreds of segment requests don't count toward the account's 100,000 Worker requests a day, which the pairing relay shares. Cloudflare caches them and sends the right types (`video/mp2t`, `application/vnd.apple.mpegurl`, `text/vtt`). R2 would add a bucket, keys and a per-request cost, and its development addresses are rate-limited and were once blocked in Korea.
- **Limits.** 20,000 files per deployment and 25 MiB per file on the free plan. The three films come to about 1,700 files and 1.7 GB. `pnpm --filter @bannertv/demo media -- --check` checks both before a deploy.
- **Headers.** `static/_headers` opens every file to other pages (CORS) and sets caching: segments for a year, as they never change; playlists for an hour; subtitles and artwork for a day. Leave out a `[cache]` block in `wrangler.toml`: with Workers Cache on, static asset requests are billed too.
- **No logs.** Observability, logs, traces and Logpush are all off in `wrangler.toml`. The Worker writes nothing anywhere. Search words reach it as part of the address and are only used to filter the three films.
- **IPv6.** workers.dev addresses answer over IPv6 as well as IPv4; `check:live` checks it.
- **Korea.** LG's testers are in Korea. Cloudflare has a Seoul data centre, but free-plan traffic from Korea is often served from the US west coast, with high latency. That is why the smallest size is so small. Test from Korea before submitting (Deploying, step 7).
- **Terms.** Cloudflare's terms say video must be served from one of its developer services, which Workers is. Whether a $0 account counts as a paid service is not spelled out. Workers Paid ($5 a month) removes that doubt; it is optional and Eyitayo's call.

Sources: [static asset limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets), [billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [headers](https://developers.cloudflare.com/workers/static-assets/headers/), [Workers Cache](https://developers.cloudflare.com/workers/cache/), [observability settings](https://developers.cloudflare.com/workers/wrangler/configuration/#observability), [service terms](https://www.cloudflare.com/service-specific-terms-application-services/).

## Costs

$0 on the Workers free plan: no R2, no domain, no paid encoding. The optional Workers Paid plan is $5 a month. Encoding runs on the laptop.

## Deploying

Everything below runs on Eyitayo's Windows laptop, which can reach blender.org and is signed in to Cloudflare. **Ask Eyitayo before deploying.** Claude cannot delete anything on Cloudflare; Eyitayo does that in the dashboard.

1. **Install ffmpeg** (once): `winget install Gyan.FFmpeg`, then open a new terminal and check `ffmpeg -version`.
2. **Get the code:** in the repo, `git fetch origin` and check out the branch with this addon, then `pnpm install`.
3. **Check the film addresses:** `pnpm --filter @bannertv/demo media -- --sources`. Each film should print a working address.
4. **Encode and draw:** `pnpm --filter @bannertv/demo media`. It downloads each film to `services/demo/.work` (about 1 GB), checks it is the film `films.json` describes, encodes all five sizes into `services/demo/public`, writes the subtitles, and builds the poster and backdrop. Expect 10 to 30 minutes a film with the default `slow` preset; a finished film is skipped next time, so it can be stopped and started again. Then open `services/demo/review`: `<film>-frames.jpg` shows the twelve candidate frames and `<film>-frames.txt` which two were used. To use other frames, put their times in `films.json` (`art.background`, `art.poster`, `art.posterFocus`) and run the command again; only the artwork is redone.
5. **Deploy:** from `services/demo`, `npx wrangler@4 login` (already done for the relay), then `npx wrangler@4 deploy`. Only new or changed files upload. If it stops with "Upload took too long", run it again and it carries on.
6. **Check it:** `pnpm --filter @bannertv/demo check:live` fetches every film, every size's first and last segment, the subtitles and artwork, and tries IPv6.
7. **Check from Korea:** open `https://check-host.net/check-http?host=https://demo.bannertv.workers.dev/manifest.json` and look at the Korean nodes, or ask someone there to play a film.
8. **Let the preinstall merge:** the app puts the Demo first in `DEFAULT_ADDONS` (the last commit of the Demo's pull request), so that commit must not reach a TV build before the Demo answers.

**Changing the manifest** (its version, name or catalog): copy the new one into `packages/core/src/addons/bannertv-demo.manifest.json`, which the app ships so Home can ask for the Demo's row before the live manifest arrives. A test fails until the two match.

**Changing a film's video** later: raise its `media` number in `films.json`, delete its old folder under `public/media/<film>/`, encode and deploy. The new number gives new addresses, so TVs never mix cached old segments with new ones. Artwork and subtitles can change in place.

**Taking it down:** delete the `demo` Worker in the Cloudflare dashboard (Workers & Pages). Then remove it from `DEFAULT_ADDONS` in the next app release, or TVs show a failing row.

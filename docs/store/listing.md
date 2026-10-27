# LG Content Store listing (draft)

The text and images for BannerTV's Seller Lounge entry, ready to paste: English only, for the United Kingdom. Seller Lounge's own form is the final word on every limit below; see [STORE.md](../STORE.md) for where each figure comes from.

## Rules for everything on this page

These keep the listing inside LG's content test and away from the UK anti-piracy complaints the plan warns about.

- No film or series titles, posters, stills or logos that BannerTV doesn't own. Screenshots use the BannerTV Demo addon's Blender open movies only (Creative Commons Attribution).
- No names of third-party stream addons, debrid services, torrents or "free films". BannerTV is described as a player for addons the user adds.
- No "LG", "webOS" or "Stremio" in the app name, icon or screenshots. The long description names the addon format once, in plain text.
- No claims that need proof, such as "the fastest" or "every addon".
- The listing must match the submitted build exactly: LG's pretest compares the screenshots, splash and UX scenario with the app.

## Display info (one entry, English)

Seller Lounge asks for an App Title and a Description for each display language. Third-party guides give limits of 50 to 95 characters for the title and 2,500 to 4,000 for the description; the text below fits the smallest of each.

### App title

> BannerTV

The same as `title` in appinfo.json, which LG caps at 20 characters.

### Description

> BannerTV is a media centre for LG TVs. It brings films and series from the addons you choose into one place, designed for the LG remote and the Magic Remote.
>
> - A Home screen built from your addons, with large artwork and quick rows
> - Search all your addons at once, by keyboard or by voice
> - Discover titles by type, catalogue and genre
> - Details, cast, seasons and episodes, and trailers
> - Plays on your TV's own video player, with subtitles, audio track choice and resume
> - Add an addon by typing its address, or send it from your phone with a QR code
> - Built for LG TVs with webOS 5.0 or newer, including most 2020 models
>
> BannerTV works with addons that use the Stremio addon format. It doesn't host or provide any films or series: everything comes from the addons you add, and you're responsible for making sure you have the right to watch what they offer. Cinemeta, for titles and artwork, is included to get you started.
>
> Free, with no adverts and no account.

About 900 characters. Notes:

- The playback line describes Phase 2. Remove it if the first store build ships before the player.
- When Trakt sign-in ships, add this line before "Free, with no adverts": "BannerTV uses Trakt but is not endorsed or certified by Trakt." Trakt's API Use Policy asks for it in the store description.
- "Stremio addon format" names the format, the way an app says it opens PDF files. Stremio itself is in the LG store, rated 16+, described as "aggregated by an addon system". If LG objects to the name, use "BannerTV works with community addons that you add by address."

### Launcher description (optional)

If the app threads add `appDescription` to appinfo.json (60 characters at most, and not the same as the title):

> Films and series from your addons, made for the LG remote

### Tag keywords

> media centre, media center, addons, player, films, movies, series, TV shows, subtitles, trailers

### Note for Tester (Test Info)

> BannerTV is a media centre that plays what addons return; apart from its demo addon, it hosts no content of its own. Cinemeta (titles and artwork), OpenSubtitles v3 (subtitles) and BannerTV Demo (Blender open movies under Creative Commons Attribution licences) come preinstalled, so playback can be tested without adding anything: open Home, find the BannerTV Demo row and play any film. No account or payment is needed. The About screen has an optional donation QR code that opens an external page on a phone and unlocks nothing. Full steps are in the UX scenario.

Add a line for each optional feature the submitted build has (Trakt sign-in with the test account, profiles and the PIN, the adult filter, which is on by default).

## Service info

| Field | Value | Notes |
| --- | --- | --- |
| Service country | United Kingdom only | Untick anything else Seller Lounge pre-selects; never "Select All" |
| App service language | English | |
| Display language on TV | English | One entry, with the title and description above |
| Category | Entertainment | The UK store files media players under Entertainment; pick a Video or Media option if the dropdown has one |
| App rating | 16+ if offered, otherwise the nearest rating below 18 | Matches Stremio's listing. Above 18 is rejected at pre-review |
| Content rating (adult content) | See STORE.md, "Age rating" | Depends on the PIN gate for the adult filter |
| App version | Same as appinfo.json `version` | Must go up on every upload, including fixes after a rejection |
| Customer support email | `SUPPORT_EMAIL` | Shown on the TV |
| Representative URL | The website's address (see STORE.md, "Website") | |
| DIAL | Empty | |
| UK data collection | See [data-safety.md](data-safety.md) | Mandatory for UK apps |
| In-app ads | Not applicable | |
| Billing / paid content | Not applicable | Ask in 1:1 Q&A first; see STORE.md |
| Tile colour | `#1B1430` | Same as `iconColor` in appinfo.json and the icon backgrounds |

## Images

All source files are in [`brand/`](../../brand/README.md). Checked on 27 October 2026: every PNG is RGB with no transparency, and the icons have a solid `#1B1430` background with the mark well inside the 5 px padding LG asks for.

| Asset | File | Size | LG's figures (third-party guides) | Status |
| --- | --- | --- | --- | --- |
| Store icon | `brand/store/icon_400.png` | 400 x 400 | 400 x 400 or larger, square, opaque, no gradient, same colour as the tile, 5 MB | Ready |
| Package icons | `brand/webos/icon_80.png`, `icon_130.png` | 80 x 80, 130 x 130 | Required in appinfo.json | Ready, in appinfo.json |
| Splash | `brand/webos/splash_1920x1080.png` | 1920 x 1080 | 1920 x 1080, not black, little text, 10 MB | Ready (dark violet, not black) |
| Launcher background | `brand/store/launcher_bg_1920x1080.png` | 1920 x 1080 | 1920 x 1080, 10 MB | Ready |
| Primary screenshot | `docs/store/screenshots/01-home.png` | 1280 x 720 | 960 x 540 or 1280 x 720, 5 MB | Not taken yet |
| More screenshots | `docs/store/screenshots/02-...png` | 1280 x 720 | 2 to 5 more | Not taken yet |

### Screenshot shot list

Take these on the TV, or from `pnpm dev` at 1920 x 1080 and scale to 1280 x 720 PNG, with **only the BannerTV Demo addon installed** (Cinemeta removed) so no third-party artwork appears. They need the Demo addon and the Phase 2 player, so they're the last thing made before submitting.

1. **Home** (primary). Hero on a Blender open movie such as Sintel, a row of demo titles under it, focus visible on a tile.
2. **Details.** A demo title with backdrop, synopsis and the Watch button focused.
3. **Player.** A frame of a demo film with the controls showing and an English subtitle on screen.
4. **Search.** The TV keyboard and results for a demo title.
5. **Discover.** The poster grid of demo titles with the type and genre pickers.
6. **Add an addon.** The dialog with the six-character code and QR code. Show a placeholder address, never a real addon's.

## Credits the About screen must show

- The Blender open movies in the Demo addon: each film's own credit line as Blender Studio publishes it (for example "© copyright Blender Foundation | www.sintel.org") and its Creative Commons Attribution licence. Check each film's licence before adding it.
- Urbanist font, SIL Open Font License 1.1.
- TMDB, when enrichment ships: an approved TMDB logo, smaller than BannerTV's, and "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB."
- Trakt, when sign-in ships: "BannerTV uses Trakt but is not endorsed or certified by Trakt." The Trakt logo is optional and follows Trakt's branding guide.
- The privacy policy: a short summary, the address and a QR code to the full policy. LG asks for the policy inside the app as well as on the store page.

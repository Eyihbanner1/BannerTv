# BannerTV: webOS Streaming Platform Plan

Oct 26, 2026 · @Eyitayo

> Exported from the BannerTV plan doc. The doc is the living version; this file is refreshed when the plan changes.

## Summary

BannerTV is a webOS-native media center that plays content from Stremio-compatible addons, with Nuvio-style extras (Trakt sync, profiles, a customizable home screen) built for the LG remote from day one. It hosts no content itself: users install addon URLs, and BannerTV browses, resolves and plays what those addons return.

**Goals**

- Full compatibility with the Stremio addon protocol, so every existing addon (catalogs, metadata, streams, subtitles) works without changes.
- A 10-foot interface that feels native on LG TVs: instant focus movement, Magic Remote pointer support, the Back key always does the expected thing, and smooth scrolling on 2020+ hardware.
- Playback that uses the TV's hardware decoders through the webOS media pipeline, including 4K HDR, HEVC and Dolby audio where the TV supports them.
- Watch progress, library and settings that survive reinstalls and sync across devices.
- Shipping in the LG Content Store, with a sideload (Developer Mode / Homebrew) build as the fallback channel.

**Non-goals for v1**

- Hosting, indexing or curating any media.
- A built-in torrent engine on the TV (see Risks). Torrent-based addons work only through a streaming server the user runs elsewhere.
- Samsung Tizen, Android TV or mobile apps. The core is kept platform-neutral so these can follow.

**Key decisions at a glance**

| Decision | Choice |
| --- | --- |
| App type | Packaged webOS web app (.ipk), plus a small JS service only if a feature needs it |
| Language and UI | TypeScript, React, Vite |
| Remote navigation | Norigin Spatial Navigation, with webOS key codes mapped centrally |
| Content model | Stremio addon protocol v3 (manifest, catalog, meta, stream, subtitles) |
| Player | Native HTML5 video on the webOS media pipeline first, hls.js or Shaka only as fallbacks |
| Accounts and sync | Local-first storage, optional Trakt, optional BannerTV sync backend in a later phase |
| Minimum platform | webOS 5.0 (2020 TVs) and newer. 2018 to 2019 TVs (webOS 4.x) are not supported |
| Repository | `Eyihbanner1/BannerTv` (private), a pnpm monorepo |
| App ID | com.bannertv.app (confirmed, permanent once uploaded) |
| Launch market | United Kingdom, English only |
| Business model | Free, with optional donations; no in-app payments |
| Primary test TV | LG 65NANO766QA, webOS 22 (7.6.0) |
| LG seller account | Individual seller in LG Seller Lounge |
| Logo | Prism Play: a play button cut into three violet facets, with an Urbanist wordmark. Files and colour tokens live in `brand/` in the repo |

## Product scope and feature parity

BannerTV reaches Stremio parity on browsing, addons and playback by the end of Phase 2, and picks up Nuvio's differentiators (profiles, Trakt-first Up Next, home customization) in Phases 3 and 5. Phases are defined under Milestones. Stremio and Nuvio columns come from the [ElfHosted Nuvio vs Stremio comparison](https://docs.elfhosted.com/nuvio/nuvio-vs-stremio/) and the community [Nuvio settings guide](https://nuvio-wiki.duckdns.org/settings/).

| Area | Feature | Stremio | Nuvio | BannerTV |
| --- | --- | --- | --- | --- |
| Addons | Install addon by manifest URL | Yes | Yes, same addons and config | Phase 1. Typed on screen, or sent from a phone via QR pairing |
| Addons | Configurable addons (settings page per addon) | Yes, opens a web page | Yes | Phase 1. Show the addon's configure URL as a QR code, phone returns the configured manifest URL |
| Addons | Preinstalled defaults | Cinemeta, OpenSubtitles, more | Its own defaults | Phase 1. Cinemeta and OpenSubtitles v3, both removable |
| Addons | Addon catalogs (browse community addons) | Yes | Plugin repos by URL or QR | Phase 3 |
| Addons | Scraper plugins outside the addon protocol | No | Yes | Not planned. Addon protocol only, which keeps the store review simple |
| Browse | Home board, one row per catalog | Yes | Yes, plus Modern, Grid and Classic layouts | Phase 1 rows with a hero banner. Phase 3 reorder and hide rows |
| Browse | Discover with type, catalog and genre filters | Yes | Yes | Phase 1 |
| Browse | Sports addons by competition: Live now, Today, fixtures, team search | No, one flat list per catalog | No, one flat list per catalog | Phase 3, see Sports addons |
| Browse | Search across all addons | Yes | Yes | Phase 1, on-screen keyboard plus webOS voice input |
| Browse | Details page, seasons and episodes, trailers | Yes | Yes, plus TMDB cast, networks, countdowns | Phase 1. TMDB enrichment in Phase 3 |
| Streams | Stream list grouped by addon | Yes | Yes, plus regex and first-source modes | Phase 2, with parsed quality, size and codec badges |
| Streams | Reuse last link, auto-pick | Partial | Yes | Phase 3 |
| Streams | Torrent streams (infoHash) | Local streaming server | P2P toggle | Phase 5, only through a streaming server the user runs on a PC or NAS |
| Streams | Debrid (Real-Debrid, TorBox, Premiumize) | Through addons | TorBox and Premiumize built in | Through addons in v1. Built-in debrid is a Phase 5 option |
| Player | Internal player | Yes | ExoPlayer or libmpv | Phase 2, HTML5 video on the webOS media pipeline |
| Player | Subtitles from addons, styling | Yes | Yes, plus libass for ASS | Phase 2 SRT and VTT with styling. ASS in Phase 5 |
| Player | Embedded audio and subtitle tracks | Yes | Yes, per-title memory | Phase 2. Audio through `audioTracks`; embedded subtitles are not exposed on webOS 22 and need a spike (see Player) |
| Player | Resume, next-episode autoplay, binge groups | Yes | Yes, plus "Still watching?" | Phase 2 |
| Player | Skip intro and outro | No | IntroDB, AniSkip | Phase 5 |
| Library | Save to library, continue watching | Yes | Yes | Phase 3 |
| Library | Calendar and new-episode alerts | Yes | Release countdowns | Phase 5 |
| Accounts | Trakt sync and scrobbling | Yes | Yes, plus Simkl and MDBList | Phase 3 Trakt. Simkl and MDBList in Phase 5 |
| Accounts | Profiles | No free profiles | Free profiles with cloud sync | Phase 3 local profiles. Cloud sync in Phase 5 |
| Accounts | Cross-device sync | Stremio account | Nuvio account | Phase 5, optional BannerTV sync service |
| Safety | Adult content and parental controls | Hides adult addons | Content warnings | Phase 3, profile PIN and adult-addon filter |
| Polish | Themes and languages | Many languages | Accent colours, true black, many languages | Phase 4, English first with i18n wired from Phase 0 |
| Polish | Backup and restore settings | Through account | Export and import | Phase 3, export via QR to phone |

Nuvio also ships a Tizen and webOS smart-TV build ([NuvioTVSmart release notes](https://newreleases.io/project/github/NuvioMedia/NuvioTVSmart/release/0.3.20-beta)), so BannerTV needs a clear edge: native webOS feel, store availability and speed on older LG sets.

## Addon protocol and data compatibility

BannerTV implements the Stremio addon protocol v3 over HTTPS exactly as published, so an addon that works in Stremio works in BannerTV with no changes. The protocol is plain JSON over GET requests, which suits a TV web app well. Reference: the [Stremio addon SDK protocol](https://huggingface.co/spaces/no1b4me/hytranslator/blob/main/node_modules/stremio-addon-sdk/docs/protocol.md) and the [stremio-core resource types](https://mintlify.wiki/Stremio/stremio-core/addons/resources).

**Endpoints the client calls**

| Resource | Path (relative to the addon base URL) | Response | When BannerTV calls it |
| --- | --- | --- | --- |
| Manifest | `/manifest.json` | Manifest object | On install, then refreshed once a day |
| Catalog | `/catalog/{type}/{catalogId}.json` or `/catalog/{type}/{catalogId}/{extra}.json` | `{ metas: MetaPreview[] }` | Home rows, Discover, Search (`search=`), paging (`skip=`), genre filter (`genre=`) |
| Meta | `/meta/{type}/{id}.json` | `{ meta: MetaDetail }` | Details page, first addon whose `idPrefixes` match |
| Stream | `/stream/{type}/{videoId}.json` | `{ streams: Stream[] }` | Stream picker, fan-out to every matching addon |
| Subtitles | `/subtitles/{type}/{videoId}/{extra}.json` | `{ subtitles: Subtitle[] }` | Player start, with `videoHash` and `videoSize` when known |
| Addon catalog | `/addon_catalog/{type}/{catalogId}.json` | `{ addons: [...] }` | Phase 3 addon browser |

The base URL is the manifest URL with `/manifest.json` removed. Extra arguments are one path segment, query-string encoded, for example `search=game%20of%20thrones&skip=100`. Series videos use `{imdbId}:{season}:{episode}`, for example `tt0944947:1:1`. Other ID prefixes (such as `kitsu:` or `tmdb:`) are routed only to addons that declare them in `idPrefixes`.

**Request routing rules**

1. Keep the addon collection as an ordered list. Order decides which addon wins for `meta` and the order of rows on Home.
2. Only call an addon for a resource, type and ID prefix its manifest declares. Never guess.
3. Catalog and meta requests are sequential by priority with a 10 second timeout. Stream and subtitle requests fan out in parallel with a 15 second timeout per addon, and results render as each addon answers.
4. Cap concurrent requests at 6 and fetch only rows near the viewport. TV network stacks and CPUs are slow, and image decoding competes with JSON parsing.

**Caching**

- Honour `cacheMaxAge`, `staleRevalidate` and `staleError` from responses (seconds). Serve stale data instantly and refresh in the background.
- Two tiers: an in-memory LRU for the session and IndexedDB for catalogs, meta and manifests across launches. The webOS engine clears its HTTP cache when the app closes, so the IndexedDB tier is what makes the second launch fast.
- Never cache stream responses for more than a few minutes. Debrid links expire.

**Parsing and validation**

- Shared TypeScript types for `Manifest`, `MetaPreview`, `MetaDetail`, `Video`, `Stream`, `Subtitle`, validated with lenient Zod schemas. A bad item is dropped and logged, never the whole response.
- Support `posterShape` (`poster`, `square`, `landscape`), `links`, `trailers`, `behaviorHints.defaultVideoId` and `hasScheduledVideos`.
- Stream sources: `url` (play), `ytId` (trailer only, through the YouTube app or embed), `externalUrl` and `webosUrl` (open via the app manager), `infoHash` (needs a streaming server, Phase 5). Archive sources (`rarUrls` and similar) are ignored in v1.
- `behaviorHints.notWebReady` is **not** treated as unplayable. The webOS media pipeline plays MKV, HEVC and AC-3 that a desktop browser cannot, so BannerTV tries native playback first and explains failures clearly.
- `behaviorHints.proxyHeaders` streams need request headers that a `<video>` element cannot send. They are shown greyed out unless a streaming server is configured to proxy them.
- `bingeGroup` drives next-episode stream matching. `countryWhitelist`, `filename`, `videoHash` and `videoSize` feed filtering and subtitle matching.

**Integrations around the protocol**

- **Trakt**: device-code OAuth, which is built for TVs (show a code and URL, poll for the token). Scrobble start, pause and stop. Pull watched history and Up Next.
- **TMDB**: optional enrichment for artwork, textless backdrops, cast and episode stills. Needs a BannerTV API key and TMDB attribution on the About screen.
- **Stremio account import** (stretch goal): read a user's addon collection from their Stremio account so switching takes one step. This uses Stremio's unofficial API, so it stays optional.

**Security**

- Addons return data only. Never evaluate addon content, strip HTML from descriptions, and allow only `https:` and `http:` URLs for media and images.
- Store addon URLs carefully: configured addon URLs often embed the user's debrid API key, so they are never logged or sent to analytics.

## Sports addons

Sports addons show up in Stremio and Nuvio as one flat list per catalog. In Phase 3, BannerTV turns them into a Sports screen with Live now, Today, a row per competition and search by team. The plan below comes from the catalogs of five sports addons, including the one Eyitayo uses, plus the manifests or source code of seven more, read on 27 October 2026. The full findings report is in the project files (`sports-addons/findings.md`).

**What sports addons actually send**

- **No common league field.** Some addons send no league at all. The rest put it in free text (a `League: X` line, a `Competition: Home vs Away` name, a second genre, a genre option, an id in an artwork URL), spelled differently from addon to addon.
- **Teams only in the title**, mostly `Home vs Away`, sometimes `Away at Home`. Sport tags are often wrong: an EFL Trophy tie was tagged Tennis by two addons.
- **Kick-off in many forms**: ISO `released` (sometimes a fetch time, or midnight for a date only), other ISO keys (one an hour early), `28 Oct 2026 · 20:00 UTC`, a clock time in the name, a clock time with no date in a zone set in the addon's settings, a date only, or nothing.
- **No reliable live or finished state.** "LIVE" labels switch on early and stay on for hours after full time, and finished matches stay listed for the rest of the day or for weeks. No scores were seen, though two addons' code can append one.
- **Custom types and paging quirks.** Types (`sport`, `sports`, `tv`, `channel`) do not say "this is sport". One addon leaves matches out when paged the Stremio way, and one caps pages at 100 without declaring `skip`.

**Detection**

1. A catalog is a sports catalog when its name or id names a sport (football, soccer, NBA, F1, UFC, cricket and so on), or when it names a sports view (live, today, upcoming, replays, recaps) and most of its first page are matches (`A vs B`, `A at B`) or carry live markers. Only pages already fetched for Home or Discover are checked; detection never makes a request of its own.
2. Within it, items are events, channels or replays. Channels: ids or labels such as `leaf:`, `_ch_`, `ttv:`, `releaseInfo` "24/7", genre "NETWORKS", or a catalog named TV, Channels or 24/7. Replays: a catalog named replays or recaps, or "Recap" and "Replay" markers. Placeholder items ("no streams today", "private manifest required") are dropped.
3. Addons settings get a per-addon "Show in Sports: automatic, yes, no", for when detection gets it wrong.
4. Nothing about sport depends on an addon's name or URL. The rules work on what any addon sends.
5. Sports catalogs leave Home's board and Search's addon fan-out: Home shows only the Live sport row for them, and Search answers from the local index. Discover keeps them, so every catalog stays reachable. "Show in Sports: no" puts an addon back on Home and in Search.

**Grouping, in order**

Each event goes through these layers and stops at the first one that names a competition. Each result records where it came from. A row is named after a competition only when an addon said so or a fixture list confirmed it; a team match on its own gives a country group, never a guessed league.

1. **What the addon declares.** A catalog per sport gives the sport, unless the team dictionary says otherwise. A genre option that matches a known competition name gives a whole competition row from one request.
2. **What the item's text says.** In this order: a `League:`, `Competition:` or `Tournament:` line in the description; a `Competition: Home vs Away` or `Country - Competition : Home vs Away` name; a ` - Competition` suffix, used only after a `vs` or `at` pair and only when the suffix is in the competition dictionary (` - 3rd T20I` is a stage); a second genre that is not the sport; a `league`, `lg` or `competition` parameter in the poster URL; a SofaScore `unique-tournament/<n>` id in `background` or `poster`, through an id column in the competition dictionary. The string is normalised through the competition dictionary (country prefixes, aliases, sponsor names such as Carabao Cup for the EFL Cup; a bare "League Cup" is the EFL Cup only when both teams are English).
3. **The built-in team matcher and league calendars.** Both team names are looked up in the team dictionary.
   - If the league calendar (see Matcher data) has this pair within a day of the match, it is that league.
   - Otherwise the match goes in the teams' country group ("German football"), because a team pair alone cannot tell a league game from a cup tie: Hamburg vs Eintracht Frankfurt on 27 October was a DFB-Pokal tie, not Bundesliga.
   - Two clubs from different countries go in "European football", unless both are in the same UEFA competition this season, which then names it (a hand-checked list of league-phase clubs ships with the dictionary).
   - In closed leagues (NFL, NBA, NHL, MLB), two of their teams name the league.
   - A senior side against a youth or reserve side goes in the senior side's country group; two youth sides go in "Youth football". Women's sides get their own groups.
4. **An optional online fixtures lookup** (see Matcher data), which can name cup ties and leagues the calendars do not cover.
5. **Other.** "Other football", "Other basketball" and so on, then "Other sport".

**Event model**

One normalised record per event, built in `packages/core/src/sports/`: sport, competition (with its source and confidence), country, home and away (as sent and normalised), kick-off (UTC instant or day only, with its source and whether it is sure), state, kind (event, channel, replay), and every source item it was merged from (the addon's place in the collection and manifest id, never its URL; type, id, name, poster).

**Time, live and finished**

- Kick-off, best first:
  - `released` with a time (one with seconds or milliseconds set is a fetch time; midnight on a replay is a date only);
  - dated text with UTC, GMT, an offset or a named zone (other abbreviations count as unsure);
  - a clock time in the item's name (`⏰ 19:45 - 27/10`);
  - other ISO keys, checked against a clock time in the same item's name or description and dropped when they disagree (one addon's `eventStart` is an hour early, and a day early after midnight);
  - epoch numbers from a named time field;
  - a clock time with no date, in the zone the addon's install address names. When none can be read, no zone is assumed (one addon defaults to UTC-3): the item takes a sure time from a merged copy, or shows "time unknown" and stays out of Live now. The date is the addon's current day in that zone, rolled to the next day where a list in time order wraps past midnight;
  - a date only.

  Numbers inside ids are never read as times: some are first-seen stamps, and some dates are a day off.
- A day is a local calendar day, worked out with local dates, never by adding 24 hours, so the clock-change Sundays group correctly. Times are shown as 24-hour local time. Phase 3 checks on webOS 5 and 22 that the TV's time zone and summer time reach `Date`, and that `Intl.DateTimeFormat` knows named zones; if not, the zone comes from a Luna call found in that check.
- A kick-off once seen is kept, because one addon replaces it with "LIVE" in the catalog. Kick-offs go into a small store of id and kick-off kept for two days, not the shared cache. Until an item's meta gives one, the kick-off is estimated from its neighbours in a catalog sorted by kick-off. Metas are read for live items on screen first, at most 20 per addon per refresh, two at a time.
- BannerTV works out the state itself:
  - upcoming;
  - starting soon (within 15 minutes, listed in Live now as "Starting soon");
  - live, from kick-off until a per-sport window ends. Windows: football and rugby 2.5 hours (stretched to 3 while an addon still marks the match live, for extra time and penalties); basketball and ice hockey 3; baseball 3.5; American football, tennis, motor racing and darts 4; boxing 5; MMA and golf 6; cricket 8; others 3;
  - ended, when the window is over or a replay of the same match has appeared.

  An addon's "LIVE" label counts only inside the window. A LIVE item whose kick-off cannot be found or estimated goes in "Live, time unknown" at the end of Live now, for at most the UTC day it was first seen. Items with no kick-off, no date and no live label never enter Live now or a day; they sit at the end of their competition's row (or Other) as "Time not given", and drop out after BannerTV has seen them for two days.
- Ended matches leave Live now at once and drop to an "Earlier today" group at the end of Today.

**Merging**

- The same match is one event when it has the same two teams in either order (after normalising), and kick-offs within 15 minutes when both are sure, within 90 minutes when either is unsure, or on the same or a neighbouring date when one side has a date only. This merges copies across Live, Today and sport catalogs, across sources inside one addon, and across addons.
- When both teams are in the team dictionary, the dictionary's sport wins over the addon's tag. Names that carry a game or day number (Game 2, Day 3) merge only with the same number.
- A merged event shows the kick-off of its best-ranked time source, and on a tie the first addon in the collection's order. Home and away follow an `at` or `@` name first, then that same source.
- Items with no teams (a competition name such as "Copa del Rey", or "Formula 1") do not merge, and repeats of the same name are listed once.

**Play and playback**

- Meta and stream requests for a sports item go to the addon that listed it, never to another addon that declares the same id prefix.
- Play asks for streams once per distinct source (addon, type, id) of the event. One stream finder serves the whole event, keyed by the event, and its streams are keyed by source as well as by addon, then handed to Phase 2's automatic stream choice. The event page asks only after the usual focus rest on Play; tiles and rows never ask.
- Live playback comes from Phase 2 (ADR 0003 item 12): a broadcast the player reports as live saves no progress and no Continue Watching card, has no Up Next or Start over, and every other stream of it (failover, Quality, Other streams, Try again) starts at the live edge. Replays behave like any other video. The player's live flag says what is playing now, never the schedule: Live now comes from kick-off times. Sports items never go to Trakt, which has no entry for them.

**Fetching and paging**

- Sports catalogs are fetched only while the Sports screen or the Live sport row is visible, and only for the day on screen. Live catalogs come first, then catalogs named Today, Upcoming or similar, then per-sport catalogs. Replay catalogs get their first page only (with `skip=0` when the addon marks it required), and replay hub metas are never opened automatically.
- Sports catalogs page by events: the next request asks for `skip` = the events received so far (channels not counted) minus 2, and repeated ids are dropped. This also works for addons that count everything, at the cost of a few repeats. (`createCatalogPager` gets a `nextSkip` option.)
- A catalog stops paging for the day when a page brings no event that addon has not already sent, when kick-offs pass the end of the day (only while its items come in kick-off order), or at a cap set from its page size so that one day fits. Later days are fetched when the viewer moves to them.
- A catalog that does not declare `skip` but returns a full page (one addon caps at 100) is asked once with `skip`; if that brings new ids, it is paged. Where it offers genre options, BannerTV also asks per genre for the day on screen. A genre page that is still full shows "More may exist in this addon".
- Sports requests use at most 2 of the 6 request slots, and queued ones are dropped when the screen closes. Pages after the first are kept for the session only, like search, so they never push Home's rows out of storage.
- Sports catalogs without cache hints count as fresh for 2 minutes (live catalogs) or 15 minutes (the rest), and are not shown after 6 hours. While the Sports screen or the Live sport row is visible, live catalogs are asked again when their copy stops being fresh, no more often than every 2 minutes. States are worked out again once a minute from the clock, with no request.

**Screens**

| Screen or row | What it shows |
| --- | --- |
| Rail entry "Sports" | Between Discover and Library, only while an installed addon has sports catalogs. If the last one is removed, the Sports screen gives way to Home |
| Sports screen | A day strip (Live now, Today, Tomorrow, then the next five days), then rows for the chosen day: one row per competition in priority order, the country groups, "Other", then Replays. Back first returns the day strip to Today, then goes Home |
| Fixture tile | Drawn by BannerTV as text only: competition, home and away, local kick-off or a LIVE pill, and how many sources have it. The Sports screen shows no images |
| Event page | Teams, competition, local kick-off, state, sources, the addon's background, and team badges when the addon sends them. Play uses the automatic stream choice across every source; All streams lists them by addon |
| Home | One "Live sport" row, third on Home, fetched like any row near focus, shown when something is live and the viewer has not hidden it |
| Search | Team search runs on BannerTV's own index of cached sports events, including team aliases (Man Utd, Spurs), and shows a Sports group in Search results. "Search sports addons" at the end of the group asks the addons for anything the index lacks |

Competition headings show a live count ("Premier League · 2 live of 5"). A cup round is shown only when the addon sends one, as "Competition · Round". A country is added only to tell apart competitions with the same name (Premier League in England and in Wales). Sports items typed `tv` open the event page, never the series page. Channels are not shown on the Sports screen; they stay in their addon's catalogs in Discover.

Priority order for competition rows starts with UK football (Premier League, Champions League, Championship, FA Cup, EFL Cup, Scottish Premiership, the EFL leagues), then the biggest European leagues and cups, then everything else by number of matches.

Later, not Phase 3: a full-screen fixtures list per day (it repeats the rows), following teams and competitions (with Phase 3 profiles, or after them if profiles slip), and channel rows with a programme guide.

**Matcher data**

- Competition rows in Phase 3 cover football and the four US leagues (NFL, NBA, NHL, MLB); every other sport is grouped by sport (Eyitayo, 28 October 2026). Cricket, rugby, motor racing and fight sports can get competition rows later.
- A competition dictionary (an estimated 100 to 200 entries, generated from Wikidata and checked by hand: the English pyramid to the National League, UK cups, UEFA and FIFA competitions, the top two divisions and main cup of about 30 countries, MLS, NFL, NBA, NHL and MLB) with aliases, country, sport, gender and age group, SofaScore ids, and the BannerTV priority. American football that is not NFL goes in "Other American football".
- A team dictionary with aliases and each team's country, sport and usual league: about 700 teams from 35 competitions in the core set, about 1,800 from 70 in the full set.
- A league calendar check: openfootball's public-domain fixture lists for the top divisions of England (two tiers), Germany, Spain, Italy, France, the Netherlands and Portugal. The lists can lag behind rescheduled games, so a pair with no fixture goes to its country group rather than being called a cup tie.
- Only public-domain (CC0) data is bundled: names, aliases and facts from Wikidata and openfootball, built by a script in CI. No club crests or logos are bundled.
- Delivery: no server in Phase 3. The dictionaries, the UEFA club list and the calendars are one file, loaded only when the first sports catalog is detected and refreshed with each app release. Measured: 781 clubs with 1,795 aliases is 15 KB gzipped; the whole file is estimated at 70 to 90 KB gzipped. A stale calendar fails safely into a country group.
- Name matching lowercases, folds accents (NFD plus a small table for ß, ø, æ, ł, đ and ı), removes emoji, flags and tag characters by explicit code-point ranges (not `\p{}` classes, which are ES2018 syntax), drops FC, AFC, CF and similar and a trailing sport word both teams share (`Cricket`, `Basketball`, `Rugby League`), and maps Utd, St and & before the lookup. Teams split on ` vs `, ` vs. ` or ` v `; then on ` @ ` or ` at ` (away first, only for US sports or when both sides are known teams); and on ` - ` only when none of those is present.
- An online fixtures lookup is optional and decided after the first build (Eyitayo, 28 October 2026), by measuring how many matches still land in a country group or Other. Of the sources BannerTV may use, only TheSportsDB named both test matches (an EFL Trophy tie with an under-21 side, and a DFB-Pokal tie between two Bundesliga clubs). Its free key may not be used in an app-store app, so this means the paid tier (about $9 a month) behind a BannerTV Worker in `services/`, crediting TheSportsDB as the source in the app. The TV would fetch one file per day from that Worker, so nothing about the viewer's addons or matches leaves the TV. ESPN's unofficial API, MLB's API, API-Football's free tier and Jolpica's F1 data are ruled out by their terms or coverage.

**Performance**

- All parsing, matching and merging is plain functions in `packages/core`, run once per catalog response, never on a key press, and in chunks so a refresh never blocks input for more than one frame. Target on the webOS 5 floor TV: about 3,000 items grouped in under 100 ms in total.
- Dictionary lookups are `Map`s of normalised names, built once. Fixture tiles are text, so the Sports screen decodes no images.

**Store and privacy**

- The Sports screen appears only because of an addon the user installed. No sports addon is preinstalled, suggested or named in the app or its store listing; tests and the gate use a test sports addon, and store screenshots never show the Sports screen with third-party content. Sports ships in the sideload build only at first (Eyitayo, 28 October 2026). The LG store build leaves it out until BannerTV is approved and stable, and a later store update adds it.
- Configured addon URLs often carry a personal key. Test fixtures are captured from public, unconfigured installs only, and nothing logs addon URLs. A time zone is read from an install address as one `timezone` value only; the rest of the decoded settings is never kept or logged.
- Removing an addon, or clearing data in Settings, removes its events and kick-offs.
- Any BannerTV Worker the TV fetches from is added to `docs/store/data-safety.md`, the privacy policy and the Seller Lounge answers before the build that uses it ships.

**Phase 3 tasks**

- [ ] Before building: call `/stream/` on the public free tiers (never a configured URL) for a few events and channels, and record how many answers are plain `url` links, need `proxyHeaders`, or are `externalUrl` or web pages (the shape only, not the links). If most need headers, Sports waits for the Phase 5 streaming server. Re-check the test addons' catalogs at the same time, since their data changes.
- [ ] `packages/core/src/sports/`: detection, text parsing (teams, separators, prefixes, time formats), state, merging and grouping, with tests built from captured public catalogs
- [ ] Competition and team dictionaries from CC0 sources, the UEFA club list, the league calendars, and the build script for the bundled file
- [ ] Event paging, the `skip` probe and per-genre fetching, the request-slot limit and the refresh rules for sports catalogs
- [ ] Take sports catalogs out of Home's board and Search's addon fan-out (Detection rule 5)
- [ ] Sports screen, day strip, fixture tiles, event page and Replays row; the Live sport row on Home
- [ ] Team search on the local index, and a Sports group in Search
- [ ] "Show in Sports" per addon in Addons settings
- [ ] Check the TV's time zone and summer time on webOS 5 and 22
- [ ] Measure grouping time and memory on the webOS 5 floor TV, and how many matches end up in country groups or Other, then decide on the paid fixtures lookup

**Gate**

Part of the Phase 3 gate, but Sports may slip to Phase 5 without blocking it. On a Tuesday or Saturday evening with a test sports addon installed:

- every match that kicked off at least 5 minutes ago is in Live now, and none is still there 30 minutes after its real full time, checked against a scores site;
- a spot check of 50 matches finds none under the wrong competition;
- at least 80% of UK and top-five-league football matches sit under their competition or country;
- the Sports screen draws cached rows within 1 second and live rows within 3 seconds on the floor TV, with grouping under 100 ms.

**Open questions**

- [ ] Eyitayo: is a "Sports" rail entry right, or should sport live on Home only?
- [x] Eyitayo: which sports get competition rows first? Football and the four US leagues (28 October 2026).
- [x] Eyitayo: a paid fixtures lookup (about $9 a month)? Decide after measuring the free layers on the TV (28 October 2026).
- [x] Eyitayo: Sports in the LG store build, or sideload only at first? Sideload only at first (28 October 2026).
- [ ] Is one `skip` probe acceptable for catalogs that do not declare `skip` (request routing rule 2 says "never guess" for resources, not extras), so that one addon shows more than its first 100 events?

## webOS platform specifics

BannerTV ships as a packaged webOS web app (.ipk): the UI runs in the TV's Chromium-based web engine and video plays through the TV's native media pipeline behind a standard `<video>` element. webOS 5.0 (Chromium 68, 2020 TVs) is the build baseline.

**Version support**

| webOS TV | Released | Web engine | BannerTV support |
| --- | --- | --- | --- |
| 26 | 2026 | Chromium 132 | Full |
| 25 | 2025 | Chromium 120 | Full |
| 24 | 2024 | Chromium 108 | Full |
| 23 | 2023 | Chromium 94 | Full |
| 22 | 2022 | Chromium 87 | Full |
| 6.x | 2021 | Chromium 79 | Full |
| 5.x | 2020 | Chromium 68 | Full, the build target |
| 4.x | 2018 to 2019 | Chromium 53 | Not supported (dropped) |
| 3.x and older | 2016 to 2017 | Chromium 38 or WebKit | Not supported, show a compatibility screen |

Source: [LG Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine). Chromium 68 rules out several modern features without transpiling or fallbacks: optional chaining (Chrome 80), flexbox `gap` (84), `aspect-ratio` (88), `:focus-visible` (86) and `backdrop-filter` (76). The build transpiles to ES2017 and the design system avoids those CSS features.

**Packaging and appinfo.json**

```json
{
  "id": "com.bannertv.app",
  "version": "0.1.0",
  "vendor": "BannerTV",
  "type": "web",
  "main": "index.html",
  "title": "BannerTV",
  "icon": "icon_80.png",
  "largeIcon": "icon_130.png",
  "splashBackground": "splash_1920x1080.png",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": true,
  "handlesRelaunch": true
}
```

- `id`, `title`, `type`, `main`, `icon` and `version` are required for LG Apps. The `id` can never change after publishing, so it must be chosen before the first store upload.
- `version` is strictly `major.minor.patch` and a version number can be uploaded only once.
- Icons are 80x80 and 130x130 PNG, the splash is 1920x1080 PNG. Web apps render at 1920x1080 at most; 4K video still plays at full resolution in the video plane. Reference: [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json).

**Developer tooling**

- webOS TV CLI (`ares-*` commands, installed from npm): `ares-setup-device` registers the TV, `ares-novacom --getkey` pulls its key, `ares-package` builds the .ipk, `ares-install` and `ares-launch` deploy and start it, `ares-inspect` opens Chrome DevTools against the running app. Reference: [CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide).
- Developer Mode app on the TV: needed for real-device testing, lasts 1000 hours before sideloaded apps are removed (reset from the app), and one LG developer account can be active on one TV at a time ([webOS Brew](https://www.webosbrew.org/devmode/)).
- webOS TV Simulator per version for fast UI work on a laptop. Playback and performance must be checked on real TVs.

**Remote control input**

| Key | keyCode | BannerTV behaviour |
| --- | --- | --- |
| Arrows | 37, 38, 39, 40 | Spatial navigation |
| OK | 13 | Activate focused item |
| Back | 461 | Close overlay, then go back a screen, then exit on the root screen |
| Red, Green, Yellow, Blue | 403, 404, 405, 406 | Shortcuts, for example Yellow = add to library, Blue = subtitle menu in the player |
| Play, Pause, Stop | 415, 19, 413 | Player transport |
| Fast forward, Rewind | 417, 412 | Seek plus or minus 10 seconds, hold to accelerate |

Source: [Magic Remote guide](https://webostv.developer.lge.com/develop/guides/magic-remote).

- **Back key**: with `disableBackHistoryAPI: true` the app's router owns key 461. On the root screen, call `webOS.platformBack()`, which shows the system exit prompt on webOS 6+ and returns to Home on 5.x, matching LG's rules ([Back button guide](https://webostv.developer.lge.com/develop/guides/back-button)). A long press always exits to Home.
- **Magic Remote pointer**: pointer mode behaves like a mouse, so hover moves focus and the wheel scrolls rows. Pressing an arrow switches to 5-way mode and hides the pointer, signalled by the `cursorStateChange` event. Every feature must work in both modes.
- **Text input**: use the system on-screen keyboard on focused inputs. Long text (addon URLs) also gets phone entry through a QR pairing page.

**Lifecycle**

- `webOSLaunch` on first start and `webOSRelaunch` when the icon is pressed while running. `handlesRelaunch: true` lets BannerTV route deep links before coming to the foreground ([App lifecycle](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)).
- `visibilitychange` to hidden means another app took over: pause playback, save progress, stop timers. The user can terminate a suspended app with no warning, so progress is also saved every 10 seconds during playback.
- Packaged apps run from `file://`: cookies are not supported and the HTTP cache is cleared on exit. Settings go in localStorage, data and caches in IndexedDB.

**Luna services (through webOSTV.js)**

| Need | Service or API |
| --- | --- |
| Model, firmware, 4K and HDR capability | `webOS.deviceInfo()` and `com.webos.service.tv.systemproperty` |
| Open trailers in YouTube, open a URL in the browser | `com.webos.applicationManager` launch |
| Network up or down | `com.webos.service.connectionmanager` |
| UI language, audio output | `com.webos.settingsservice` |
| Exit or return to Home | `webOS.platformBack()` |

Exact method names and permissions get confirmed in the Phase 0 spike. A webOS JS service (Node.js running beside the app) is avoided in v1. It adds memory pressure and review risk, and nothing in the v1 scope needs it.

**Media pipeline facts that shape the player**

- Containers: MP4, MKV, TS and more. Video: H.264, HEVC Main and Main10 up to 4K60, VP9 (MKV) and AV1 up to 4K60 on webOS 6.0. Audio: AAC, Dolby Digital and Dolby Digital Plus, DTS listed for MKV on 6.0 (varies by model year). Source: [AV formats on webOS TV 6.0](https://webostv.developer.lge.com/develop/specifications/video-audio-60).
- HLS plays natively (v7 on webOS 5+). DASH is not listed for the native player, so DASH streams go through MSE with Shaka Player. MSE and EME follow the W3C recommendations from webOS 5.0. HTTP/2 needs webOS 5.0. Source: [Streaming protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm).
- Native subtitle support is WebVTT only, so BannerTV renders SRT and VTT itself in an overlay.
- The `mediaOption` parameter on the `<source>` type passes a resume position and adaptive-streaming limits to the native player ([mediaOption parameters](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter)).
- Native HLS does not support playback speeds other than 1.0.

## Architecture

BannerTV is split into a thin React app that only draws screens and handles the remote, and a framework-free core that owns addons, caching, user data and playback decisions. The core never touches the DOM, so it is unit-tested on a laptop and can be reused for a Tizen or web build.

![BannerTV architecture: app, core, outside services](images/architecture.png)

Screens send actions down to the core and subscribe to its state; only the core talks to addons, Trakt, TMDB and the video element.

**What happens when the user presses Play**

1. The Details screen asks the core for streams for a video ID such as `tt0944947:1:1`.
2. The addon client calls every addon whose manifest declares `stream` for that type and ID prefix, in parallel, and pushes results into the store as each addon answers.
3. The user picks a stream. The playback controller chooses the engine (native, Shaka or hls.js), loads saved progress and sets the start position through `mediaOption`.
4. The player UI draws the overlay and subtitles. Progress is written to user data every 10 seconds and scrobbled to Trakt.
5. Near the end, the controller finds the next episode from the series meta and the stream with the same `bingeGroup`.

**State management**

- The core exposes plain observable stores: addons, catalogs, meta, streams, library, progress, settings, profiles.
- React reads them through small Zustand bindings (`useSyncExternalStore` under the hood), so a screen re-renders only when its slice changes.
- Focus memory and the Back stack live in the app layer, because they are about the remote, not the data.

**Storage**

| Data | Where | Notes |
| --- | --- | --- |
| Settings, active profile | localStorage | Small, read synchronously at boot |
| Addon collection and manifests | IndexedDB | Per profile |
| Catalog and meta cache | IndexedDB | Expiry from `cacheMaxAge`, capped at 50 MB with least-recently-used eviction |
| Library, progress, history | IndexedDB | Per profile, exportable for sync |
| Trakt tokens, configured addon URLs | IndexedDB | Contain secrets, never logged or sent to crash reports |

**Background work**

There is no background service in v1. Manifest refresh and prefetching of the first two Home rows run at launch and when the UI is idle. The only server pieces are the phone-pairing relay (Phase 1), the optional sports fixtures lookup (Phase 3, only if chosen) and the optional sync API (Phase 5), which uses last-write-wins per item with timestamps.

## Tech stack recommendation

Use TypeScript, React 18 and Vite, with Norigin Spatial Navigation for the remote and a framework-free core package for everything that is not UI. This keeps the hard logic (addons, library, sync, player state) testable on a laptop and portable to Tizen or the web later, while the UI stays fast on a 2020 TV.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, strict mode | One type model shared by core, UI and the later sync service |
| UI | React 18.3 | Large ecosystem, works on Chromium 68 with transpiling; React 19 can follow later, since webOS 4.x is dropped |
| Remote navigation | `@noriginmedia/norigin-spatial-navigation` | Proven on Smart TVs, focus trees per screen, works with the Magic Remote pointer |
| State | Zustand for UI and session state, plain TypeScript stores in core | Small, no provider tree, easy to persist |
| Data validation | Zod, lenient schemas | Addon responses vary wildly in quality |
| Storage | `idb` over IndexedDB, localStorage for small settings | Survives restarts; the webOS HTTP cache does not |
| Styling | CSS Modules plus design tokens as CSS custom properties | No CSS-in-JS runtime cost on slow CPUs |
| Lists | Hand-rolled virtual rows and grids | Only render tiles near the viewport; posters are the main memory cost |
| Player | Native `<video>` first, Shaka Player for DASH, hls.js for HLS with alternate renditions or when native fails | Hardware decoding through the webOS pipeline wherever possible; webOS 22 hides HLS alternates from the native player |
| Subtitles | Own SRT and VTT parser and renderer, JASSUB (libass in WebAssembly) later for ASS | Native support is WebVTT only |
| i18n | i18next | Strings externalized from day one |
| Build | Vite with a classic (non-module) script bundle, ES2017 target. One bundle only, since webOS 4.x is dropped | Module scripts loaded from `file://` can be blocked by CORS in Chromium; verify in Phase 0 |
| Tests | Vitest, Testing Library, Playwright with arrow-key journeys, MSW for addon mocks | Most bugs are focus and data bugs, which these catch off-device |
| Monorepo | pnpm workspaces | Shared core, app and tools packages |
| CI | GitHub Actions: lint, test, build, `ares-package`, attach .ipk to releases | Every merge yields an installable build |
| Crash reporting | Sentry browser SDK, opt-in | Real-device errors are otherwise invisible |
| Sync service (Phase 5) | Hono on Node with Postgres, hosted on Render or Cloudflare | Small API for profiles, library and progress |

**Alternatives considered**

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Enact (LG's React framework with Spotlight and Sandstone) | Official, spatial navigation and TV-tuned virtual lists built in, native webOS look | Tied to LG's look and tooling, smaller community, harder to port to Tizen | Runner-up. Revisit if Norigin focus handling struggles in Phase 1 |
| Lightning JS or Solid with Lightning (WebGL canvas UI) | Best frame rates on weak TVs | No DOM or CSS, harder accessibility and text input, steep learning curve | Not for v1 |
| Preact or plain JavaScript | Smallest bundle | More infrastructure to build by hand | Preact can swap in via `preact/compat` if bundle size hurts |
| Reuse stremio-core compiled to WebAssembly (as Stremio Web does) | Proven behaviour, identical models to Stremio | Couples BannerTV to Stremio's API and accounts, no WebAssembly path on old engines, license review and a Rust toolchain needed | Not chosen. BannerTV's own core mirrors the same semantics |

## UX and navigation

Every screen is designed for a 5-way remote first and a pointer second, viewed from 3 metres away, and the Back key always closes the topmost thing on screen. A collapsed left rail (Home, Search, Discover, Sports when a sports addon is installed, Library, Addons, Settings) is the only global navigation.

**Screens**

| Screen | Purpose | Key elements | Phase |
| --- | --- | --- | --- |
| First run | Get to a playable catalog in under a minute | Welcome, default addons preinstalled, optional "add addons from your phone" QR, optional Trakt link | 1 |
| Home | Lean-back browsing | Hero banner for the focused title, Continue Watching row, one row per addon catalog | 1 |
| Discover | Filtered browsing | Type, catalog and genre pickers, poster grid with paging | 1 |
| Search | Find a title fast | On-screen keyboard, recent searches, results grouped by type then addon | 1 |
| Details | Decide what to watch | Backdrop, logo, synopsis, rating, cast, trailer, season tabs, episode list with watched marks, library toggle | 1 |
| Stream picker | Choose a source | Streams grouped by addon, quality, size, codec and HDR badges, sort and filter, "remember choice" | 2 |
| Player | Watch | Minimal overlay, seek bar with thumbnails when available, audio and subtitle menus, Up Next card at the end | 2 |
| Library | Saved titles and history | Tabs for Movies, Series and History, sort by recently watched or added | 3 |
| Sports | Matches from installed sports addons | Day strip, Live now, a row per competition, text fixture tiles, team search. Shown only when an addon has sports catalogs (see Sports addons) | 3 |
| Addons | Manage addons | Installed list with reorder, configure, remove; install by URL, QR or addon catalog | 1, catalog in 3 |
| Settings | Preferences | Playback, Subtitles, Appearance, Integrations, Profiles, About and licenses | 1 to 4 |
| Profile picker | Multi-user households | Avatars, optional PIN, kids profile | 3 |

**Spatial navigation rules**

1. Each screen owns a focus tree. When a screen is reopened, focus returns to the last focused element.
2. Each row remembers its own last focused tile. Moving up or down lands on that tile, not on column 0.
3. Rows scroll so the focused tile stays at a fixed anchor position near the left. This reduces motion and keeps the hero banner meaningful.
4. Left from the first tile opens the rail. Up from the top row reaches the hero. No dead ends and no focus traps.
5. Back order: close a menu or dialog, then leave the player, then go to the previous screen, then return to Home's first row, then exit via `webOS.platformBack()`.
6. Holding an arrow repeats at one move per 100 ms at most, so the UI never builds a backlog of key events.
7. In pointer mode, hover moves focus, the wheel scrolls rows, and paging arrows appear at row edges. They are hidden in 5-way mode.
8. Overlays (stream picker, menus) are focus-isolated layers; focus cannot leak to the screen underneath.

**10-foot design system**

- Canvas 1920x1080 with a 5% safe area (96 px left and right, 54 px top and bottom).
- Type scale: body 24 px minimum, row titles 32 px, screen titles 48 px, hero title 64 px. One bundled font with a Latin subset to keep the package small.
- Dark theme by default, near-black background rather than pure black for LCD panels, with a true-black option for OLED. Text contrast at least 4.5:1.
- Tiles: poster 2:3 at 220x330, landscape 16:9 at 384x216, square at 240x240. Image requests sized to the tile, never full-size artwork.
- Focus: 1.08 scale plus a 4 px accent ring. The ring is not colour-only, so it works for colour-blind users.
- Motion: transform and opacity only, 150 to 200 ms. A low-power mode (auto-enabled on webOS 5.x) drops the hero video, blur and scaling.

**Accessibility**

- Support LG Audio Guidance by setting `accessibility.supportsAudioGuidance` in appinfo.json and labelling every focusable element with ARIA.
- Subtitle size, colour, background and position settings. A larger-text option for the whole UI.
- Never rely on colour keys alone: every colour-key shortcut also exists as a visible button.

## Player and playback

One playback controller in the core drives three interchangeable engines, and the native webOS pipeline is always tried first because it is the only path with full hardware decoding, HDR and Dolby audio. A failed or stalled stream never strands the user: the controller offers the next best stream in one press.

**Engine selection**

| Stream type | Engine | Notes |
| --- | --- | --- |
| Progressive MP4, MKV, WebM, TS over HTTPS | Native `<video>` | Most debrid and direct links. Hardware HEVC, AV1, HDR10 and Dolby Vision where the TV supports them |
| HLS (`.m3u8`) | Native `<video>` | hls.js over MSE when the master playlist has alternate audio or subtitle renditions (native lists only one audio track and no subtitles on webOS 22), or when native fails |
| DASH (`.mpd`) | Shaka Player over MSE | Not listed for the native player |
| YouTube (`ytId`) | Launch the YouTube app | Trailers only |
| `externalUrl`, `webosUrl` | Launch via the application manager | Opens the target app or browser |
| Torrent (`infoHash`) | User's streaming server, then native | Phase 5 |
| Streams with `proxyHeaders` | User's streaming server proxy, then native | Phase 5 |

**Stream picker logic**

1. Collect streams from all matching addons in parallel and show them as they arrive.
2. Parse each stream's name and description for resolution, HDR type (HDR10, HDR10+, Dolby Vision), video codec (HEVC, AV1, H.264), audio (Atmos, DD+, DTS, TrueHD), size and debrid-cached markers.
3. Check against the TV's capabilities from `webOS.deviceInfo()` and the webOS version. Warn on likely failures, for example TrueHD audio or AV1 on a TV without an AV1 decoder.
4. Sort by the user's preferences: maximum resolution, prefer HDR when the TV supports it, preferred audio language, size cap.
5. Phase 3 adds "auto-play best match" and "reuse last link" per title.

**Tracks and subtitles**

Phase 0 results on webOS 22 (details in [ADR 0001](adr/0001-react-norigin-classic-bundle.md)): `audioTracks` lists both audio tracks of an MKV, `textTracks` lists none of its 8 subtitle tracks, and native HLS lists one audio track and no subtitles for a stream that has alternates.

- Audio tracks, direct play: `HTMLMediaElement.audioTracks`, exposed on webOS 22, and switching is audible. The webOS 5 floor TV gets the same check. Where it is missing, show the default track and point users to a stream with their language.
- Audio and subtitle renditions, HLS: hls.js, which reads the renditions from the playlist itself, whenever the master playlist declares alternates.
- Embedded subtitles, direct play: not exposed through `textTracks` on webOS 22. A Phase 2 spike looks at the webOS media pipeline's own Luna API (`com.webos.media`, keyed by the video element's media ID), which may list and select embedded tracks; this is unverified. Until then the subtitle menu offers addon subtitles and says that embedded ones are not available on this TV.
- Addon subtitles are the main subtitle path: they always work because BannerTV renders them itself, so OpenSubtitles v3 stays a default addon.
- Addon subtitles (OpenSubtitles v3 and others): fetched with `fetch`, which needs CORS on the subtitle host. Detect the text encoding (many SRT files are Windows-1252, 1256 or similar) before decoding.
- Renderer: SRT and VTT parsed into cues, drawn in an overlay above the video plane. Settings for size, colour, background, outline, vertical position and a timing offset adjustable in 100 ms steps.
- ASS and SSA styling through JASSUB is a Phase 5 item for webOS 6+; until then ASS is shown as plain text.

**Progress, resume and next episode**

- Save the position every 10 seconds, on pause and when the app is hidden. Mark as watched at 90% (configurable).
- Resume with "Resume from 42:10" or "Start over". The resume position is passed to the native player with `mediaOption` so the TV starts at the right spot instead of seeking after load. On webOS 22 this works for HLS and MP4. With `mediaOption`, `currentTime` reads 0 at the first `playing` event and the real position about 55 ms later, so progress is only saved once the clock has moved past the resume point, never from that first 0.
- Playback health: `getVideoPlaybackQuality()` reports no frames at all on webOS 22, so dropped frames cannot be counted. Stall detection and the "try the next stream" offer use `waiting` and `stalled` events and a timer.
- Up Next card in the last 30 seconds or at 95%, with a 10 second countdown. The next video ID comes from the series meta, and the stream is the one with the same `bingeGroup` from the same addon, falling back to the stream picker.
- Trakt scrobble start, pause and stop events (Phase 3).

**Player controls**

| Input | Action |
| --- | --- |
| OK | Show overlay, then play or pause |
| Left, Right | Seek 10 seconds, holding accelerates |
| Up | Audio and subtitle menu |
| Down | Title info and stream details |
| Play, Pause, Stop, Fast forward, Rewind | Mapped to transport |
| Back | Hide overlay, then leave the player (progress saved) |

**Known limits to explain in the UI**

- Audio passthrough (Atmos, TrueHD) is decided by the TV's sound output settings and eARC, not by the app.
- Dolby Vision profile 7 (Blu-ray remux) often plays as the HDR10 base layer only.
- Native HLS has no playback speed control.
- Media errors are mapped to plain messages, for example "This TV can't decode TrueHD audio. Try a stream with DD+ audio.", with a "Try next stream" button.

**Resource hygiene**

- Reuse one `<video>` element. On exit, clear `src` and call `load()` so the hardware decoder is released.
- While the player is open, drop poster images from Home rows to free memory, and restore them on return.

**Debrid**

In v1, debrid works through addons: the user configures an addon with their Real-Debrid, AllDebrid, TorBox or Premiumize key, and the addon returns plain HTTPS links that play natively. Built-in debrid accounts are a Phase 5 option.

## Repository structure

The code lives in one pnpm monorepo at [Eyihbanner1/BannerTv](https://github.com/Eyihbanner1/BannerTv), a private repository. This plan is kept there as `docs/PLAN.md`.

```text
bannertv/
├── apps/
│   └── webos/                 TV app: React UI and webOS glue
│       ├── webos-meta/        appinfo.json, icons, splash
│       ├── src/
│       │   ├── app/           shell, router, back stack, providers
│       │   ├── screens/       Home, Discover, Search, Details, Streams, Player, Library, Addons, Settings
│       │   ├── components/    Tile, Row, Grid, Rail, Dialog, Keyboard, Badge
│       │   ├── navigation/    spatial navigation setup, key map, focus memory
│       │   ├── platform/      webOSTV.js wrappers, Luna calls, capability detection
│       │   ├── player/        engines (native, Shaka, hls.js), subtitle renderer, overlay
│       │   └── styles/        design tokens, global CSS
│       ├── index.html
│       └── vite.config.ts
├── brand/                     logo, webOS icons, store images, colour tokens
├── packages/
│   ├── protocol/              Stremio addon types and Zod schemas
│   ├── core/                  addon client, cache, library, progress, settings, profiles (no DOM, no React)
│   └── integrations/          Trakt, TMDB, OpenSubtitles helpers
├── services/
│   ├── pair/                  tiny relay for "send addon URL from phone" (Phase 1)
│   └── sync/                  profiles, library and progress sync API (Phase 5)
├── tools/
│   └── scripts/               ares-cli wrappers, release and version scripts
├── docs/
│   ├── PLAN.md                this plan
│   ├── adr/                   architecture decision records
│   └── store/                 UX scenario document, self-checklist, screenshots
├── .github/workflows/         ci.yml, release.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

**Conventions**

- `main` is protected and only changes through pull requests with green CI.
- Conventional Commits (`feat:`, `fix:`, `chore:`), short-lived branches named `feat/...` or `fix/...`.
- Git tags `vX.Y.Z` always equal the `version` in appinfo.json, enforced by a script in CI.
- Each big decision gets a one-page ADR in `docs/adr` (for example "0001 React and Norigin over Enact").
- Secrets (TMDB key, Trakt client ID, Sentry DSN) are injected at build time from GitHub Actions secrets and never committed.

**CI and release pipelines**

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Every pull request | Install, typecheck, lint, unit tests, build, Playwright journeys at 1920x1080 with arrow keys, `ares-package`, upload the .ipk as an artifact |
| `release.yml` | Tag `v*` | Build, package, attach the .ipk to a GitHub Release, publish a Homebrew Channel repository manifest for sideload users |
| `services.yml` | Changes under `services/` | Test and deploy the pairing relay, later the sync API |

The phone pairing feature needs the small `pair` relay because a webOS web app cannot listen for connections: the TV shows a QR code with a short code, the phone page posts the addon URL to the relay, and the TV polls for it. Entries expire after 10 minutes and nothing else is stored.

## Milestones and phases

A private beta that browses and plays is ready at the end of week 10, and the store launch follows around week 18 if one developer works on it full time. Each phase ends at a gate that must pass before the next starts.

![BannerTV roadmap: 6 phases, 5 gates](images/roadmap.png)

Phases 0 to 2 are the minimum product; if time runs short, Phase 3's profiles and TMDB enrichment slip, never the Phase 2 playback gate.

**Phase 0 tasks to start with**

- [x] Eyitayo creates the `Eyihbanner1/BannerTv` repository and confirms the app ID
- [x] Scaffold the monorepo: pnpm, TypeScript, Vite, ESLint, Vitest, and a CI job that outputs an .ipk
- [ ] Enable Developer Mode on the LG 65NANO766QA (webOS 22) and register it with `ares-setup-device`. The first install used the rooted TV's own install service instead, so this path is untested
- [x] Spike 1 on webOS 22: the classic script bundle loads from `file://`. webOS 5 waits for the floor TV
- [x] Spike 2: `audioTracks` lists MKV audio tracks; `textTracks` lists no embedded subtitles; native HLS hides alternate renditions
- [ ] Spike 3: `mediaOption` start position works for HLS and MP4; HDR10 file not tested yet. This TV has no Dolby Vision, so profile 8 waits for a TV that has it
- [x] Spatial navigation skeleton: rail, two rows of tiles, Back key handling
- [x] Record the spike results in ADR 0001 and adjust this plan where they differ
- [ ] Buy a used 2020 LG TV on webOS 5 as the performance floor, before the end of Phase 1

## Testing, QA and performance

Most bugs are caught off-device in CI, but no release ships until it passes a real-TV checklist on at least three model years, with the 2020 low-end TV as the performance floor.

**Test layers**

| Layer | Tool | Covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Protocol parsing, routing, caching, stream badge parsing, subtitle parsing, progress maths | Every pull request |
| Component | Vitest and Testing Library | Focus behaviour of Row, Grid, Rail, Dialog, Keyboard | Every pull request |
| Addon contract | Recorded fixtures from about 20 popular addons, plus a live smoke run | Compatibility with real-world addon responses | Fixtures per pull request, live nightly |
| End to end | Playwright, Chromium at 1920x1080, keyboard only, webOS key codes | First run, browse to play with a test file, Back stack, search | Every pull request |
| Simulator | webOS TV Simulator per version | Layout and engine differences | Weekly |
| Device | Real TVs via `ares-install` and `ares-inspect` | Playback matrix, performance, memory, soak | Before every release |

**Device matrix (minimum)**

- webOS 5.x, a 2020 entry-level LG UHD LCD. This is the performance floor. Not owned yet; buy a used one before the end of Phase 1.
- webOS 22: Eyitayo's LG 65NANO766QA (webOS 22, 7.6.0, Chromium 87). This is the primary development TV from day one.
- webOS 24 or newer, ideally an OLED for Dolby Vision and Atmos checks.

**Playback matrix**

Built from legal test media (Blender open movies and public codec samples), each file played through the full stream path on every device in the matrix:

- MP4, H.264 and AAC, 1080p
- MKV, HEVC 10-bit HDR10 with DD+, 4K
- MKV, HEVC Dolby Vision profile 8, 4K
- MKV, AV1, 4K
- MKV with DTS audio, and MKV with TrueHD Atmos (expected: warning or graceful failure)
- HLS with multiple audio renditions; DASH via Shaka
- External SRT in Windows-1252 and UTF-8; VTT with styling
- Resume at 1 hour into a 2 hour file; next-episode handoff

**Performance budgets (measured on the webOS 5.x floor TV)**

| Metric | Budget |
| --- | --- |
| Cold start to interactive Home, with cache | 3 s or less |
| First launch, no cache | 6 s or less |
| Key press to visible focus change, p95 | 100 ms or less |
| Holding an arrow across a row | 30 fps or better on 5.x, 60 fps on webOS 22+ |
| Initial JavaScript, gzipped (Shaka and hls.js lazy-loaded) | 600 KB or less |
| JavaScript heap on Home | 150 MB or less |
| DOM nodes on Home | 3,000 or fewer |
| Stream selected to first frame, debrid HTTPS link | 4 s or less on a good connection |
| .ipk size | 15 MB or less |

Performance marks feed a hidden debug overlay (opened with a colour-key sequence) so testers can read numbers on the TV without a laptop attached.

**Release QA checklist**

- [ ] Back key correct on every screen, exit prompt on the root screen
- [ ] Every control reachable by 5-way and by pointer
- [ ] Network cable pulled during playback and during browsing: clear message, recovery on reconnect
- [ ] App hidden and relaunched during playback: paused, progress saved, resumes cleanly
- [ ] 4 hour playback soak with no crash or memory growth
- [ ] Empty states: no addons, every addon offline, no streams found
- [ ] Long titles, right-to-left text in metadata, missing artwork
- [ ] Language switch and subtitle styling persist after restart
- [ ] LG self-checklist items filled with real results

## Packaging, deployment and LG Content Store

BannerTV ships through two channels: the LG Content Store for everyone, and GitHub Releases for beta testers and sideloading. Each store submission, including every update, goes through LG review, so plan about three weeks per submission and keep urgent fixes on the beta channel until approved.

**Store submission steps**

1. Create an LG account and register in [LG Seller Lounge](https://webostv.developer.lge.com/distribute/app-ecosystem) as an individual seller (decided). Your personal name is shown as the Seller ID. A corporate account is only worth it if BannerTV ever takes payments.
2. Register the App ID. It is permanent and must equal `id` in appinfo.json.
3. Upload the production .ipk built by `release.yml`. The version must be new; a version number can be uploaded only once.
4. Upload store assets: icon 400x400 or larger, tile colour as an exact hex, a primary screenshot at 1280x720, 2 to 5 more screenshots, launcher and splash backgrounds at 1920x1080, plus name and description for each language ([Brightcove's LG submission guide](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html)).
5. Fill in Test Info: the App Self Checklist with real results (an empty or thin checklist is an automatic rejection) and the UX scenario document describing every screen and flow ([App approval process](https://webostv.developer.lge.com/distribute/app-approval-process)).
6. Fill in Service Info: countries, category (Entertainment), age rating.
7. Submit. LG runs a pretest (submitted information), a function test (no errors) and a content test (no inappropriate content). Fix the listed issues and resubmit if rejected.

**Making the app reviewable**

BannerTV has no content of its own, so a tester who opens it needs something legal to play. The store build preinstalls Cinemeta for metadata and a small first-party "BannerTV Demo" addon that streams public-domain and Creative Commons films (for example the Blender open movies). The UX scenario document walks the tester through browsing, playing, subtitles and adding an addon by URL.

**Store build rules**

- No third-party stream addons preinstalled or promoted. Users add addons by URL themselves, the same model Stremio uses in the LG store.
- A first-run notice that BannerTV hosts no content and that users are responsible for the addons they install.
- The adult-content filter is on by default.

**UK launch, donations and domain**

- Launch in the United Kingdom only, in English. Adding countries later is a Service Info change in Seller Lounge, not a new build.
- Donations: a QR code on the About screen that opens an external page such as Ko-fi or GitHub Sponsors. With no in-app payments, an individual Seller Lounge account is enough. Check the Seller Lounge guide on external payment links before submitting; if they are not allowed in the app, keep the link on the website only.
- No domain is needed for the app ID. The submission still needs a privacy policy URL and a deep-link test URL you control, so host both on GitHub Pages until a domain (for example bannertv.co.uk) is bought.

**Beta and sideload channel**

- Every tagged release attaches the .ipk to GitHub Releases.
- Testers install through Developer Mode with webOS Dev Manager or `ares-install`. Developer Mode installs disappear after 1000 hours unless the timer is reset.
- Rooted TVs can install and auto-update through a Homebrew Channel repository manifest published by the release workflow.

**Release train**

- Monthly store releases after launch, with beta builds weekly.
- `version` in appinfo.json and the git tag move together; patch versions for fixes, minor versions for features.

## Risks, legal and open questions

The two risks that could sink the project were LG rejecting the app in its content test and webOS not exposing audio and subtitle tracks for direct-play files. The first is handled by how the store build is shaped. Phase 0 settled most of the second on webOS 22: audio tracks are exposed, embedded subtitles are not, and addon subtitles cover the gap.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| LG rejects BannerTV as a piracy tool | Medium | High | Demo addon with legal content, no third-party stream addons preinstalled or promoted, first-run disclaimer, adult filter on; sideload channel as fallback |
| Embedded subtitles not available for MKV direct play | Confirmed on webOS 22 | Medium | Addon subtitles rendered by BannerTV as the main path; Phase 2 spike on the webOS media pipeline API; clear UX when a track cannot be changed. Audio track switching is exposed on webOS 22 |
| Slow UI on 2020 low-end TVs | Medium | High | Performance budgets, virtual lists, low-power mode, floor TV bought by the end of Phase 1, development on the webOS 22 TV meanwhile |
| One-person team runs out of time | High | High | Strict phase gates, MVP cut at Phase 2, everything optional pushed to Phase 5 |
| Store review takes about 3 weeks per update | High | Medium | Monthly store releases, weekly beta builds, batch fixes |
| Addon breakage: CORS, `proxyHeaders`, malformed JSON | Medium | Medium | Lenient parsing, addon contract fixtures, clear per-addon errors, streaming-server proxy later |
| API keys and Trakt client secret extractable from the app bundle | Medium | Medium | Restricted keys, rotation, move token exchange behind the sync service in Phase 5 |
| Module scripts or other engine quirks under `file://` | Low | Medium | Phase 0 packaging spike, classic script bundle |
| Developer Mode expiry interrupts testing | High | Low | Reset the timer weekly, keep test TVs logged in |
| Stremio's unofficial API changes (account import) | Medium | Low | Feature stays optional |
| "BannerTV" name conflicts with an existing trademark | Low | Medium | Trademark search before store submission; never use Stremio or Nuvio branding |

**Legal considerations** (not legal advice)

- BannerTV is a neutral client, like a browser or Stremio itself. Legal exposure rises sharply if the project ships or promotes addons that point to infringing content, runs peer-to-peer on the TV, or charges for access to content. v1 does none of these.
- Publish terms of use and a privacy policy before store launch (the store listing and the Trakt and TMDB integrations need them).
- Respect TMDB and Trakt API terms, including attribution and rate limits.
- Get a short legal review before adding payments or a hosted sync service.
- UK launch: rights holders and anti-piracy groups in the UK actively pursue apps and sellers that promote infringing streams. Keep the store listing, screenshots, demo addon and donation page free of copyrighted titles and of any mention of third-party stream addons.

**Open questions for Eyitayo**

- [x] Repository: created as `Eyihbanner1/BannerTv`, private. No licence is needed while it stays private.
- [x] App ID: `com.bannertv.app` confirmed. No domain yet, which is fine for the ID (see the Store section).
- [x] LG Seller Lounge: register as an individual seller.
- [x] Test TVs: LG 65NANO766QA on webOS 22. A used 2020 webOS 5 TV is still needed as the performance floor.
- [x] 2018 to 2019 TVs (webOS 4.x): dropped. The minimum is webOS 5.0 (2020 TVs).
- [x] Business model: free, with optional donations.
- [x] Launch: United Kingdom, English only.
- [x] Logo: Prism Play (concept 10 on the [logo concepts canvas](https://claude.ai/artifact/44B7TcVyefmheVMSe1E8JX)). The brand kit (logo files, webOS icons, splash, store images, colour and type tokens) is in [`brand/`](../brand/README.md) in the repo.

## Sources

- [Stremio addon SDK protocol](https://huggingface.co/spaces/no1b4me/hytranslator/blob/main/node_modules/stremio-addon-sdk/docs/protocol.md)
- [stremio-core addon resources](https://mintlify.wiki/Stremio/stremio-core/addons/resources)
- [Nuvio vs Stremio, ElfHosted](https://docs.elfhosted.com/nuvio/nuvio-vs-stremio/)
- [Nuvio settings guide (community)](https://nuvio-wiki.duckdns.org/settings/)
- [NuvioTVSmart 0.3.20-beta release notes](https://newreleases.io/project/github/NuvioMedia/NuvioTVSmart/release/0.3.20-beta)
- [Stremio addon SDK, programme guide (EPG)](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/epg.md)
- [TheSportsDB terms of use](https://www.thesportsdb.com/docs_terms_of_use.php)
- [openfootball football.json](https://github.com/openfootball/football.json) and [openfootball clubs](https://github.com/openfootball/clubs), both CC0
- [Wikidata licensing (CC0)](https://www.wikidata.org/wiki/Wikidata:Licensing)
- [webOS TV Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
- [webOS TV appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json)
- [webOS TV CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide)
- [webOS TV Back button guide](https://webostv.developer.lge.com/develop/guides/back-button)
- [webOS TV Magic Remote guide](https://webostv.developer.lge.com/develop/guides/magic-remote)
- [webOS TV app lifecycle](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management)
- [webOS TV 6.0 audio and video formats](https://webostv.developer.lge.com/develop/specifications/video-audio-60)
- [webOS TV streaming protocol and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [webOS TV mediaOption parameters](https://webostv.developer.lge.com/develop/guides/mediaoption-parameter)
- [webOS TV app approval process](https://webostv.developer.lge.com/distribute/app-approval-process)
- [webOS TV app ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem)
- [Submitting apps to the LG store, Brightcove](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html)
- [webOS Brew, Developer Mode](https://www.webosbrew.org/devmode/)
- [Moonfin smart TV playback notes](https://github.com/Moonfin-Client/Smart-TV/wiki/Playback-and-Codecs)

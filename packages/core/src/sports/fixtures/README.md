# Sports addon fixtures

Real catalog, manifest and meta responses from four sports addons, captured on
Wednesday 28 October 2026 between 03:59 and 04:16 UTC (late evening in the US, so
NBA and NHL games were live and European cup ties were listed for later that day).
They are test input for the parsers, matcher and grouping in
`packages/core/src/sports/` (docs/PLAN.md, "Sports addons").

## Rules for these files

- **Public, unconfigured installs only.** Every file comes from an addon's public base
  address with no configuration segment in the path. None of them came from a
  configured install, and none of them carries a personal key.
- **Test input only.** Nothing in the app reads these files, and they must never be
  bundled or shown to users.
- **Never replace them with data from a configured or personal addon link.** A
  configured install address can hold a paid key or personal settings in its path.
  To refresh a fixture, fetch the same path listed below from the addon's public base
  address again, put it through the same renaming (below), and record the new time
  here. The base addresses are kept in the project notes
  (`sports-addons/fixture-sources.md`), not in this public repository.
- **No streams.** No `/stream/` path was requested, and the files hold no stream links.
- **Bodies are kept as served, apart from three renamings.** Each `.json` file is the
  response body as the addon returned it (minified, same key order, same escapes),
  plus one trailing newline. On 11 November 2026, before the repository went public,
  three things were replaced, and nothing else: every image address on an addon's own
  servers is now an invented `https://images.example/<folder>/<hash>` one; every TV
  channel's name and id is now `Sports Network NN` (`📺 Sports Network 01`,
  `(FHD) : SPORTS NETWORK 03`, ids ending `network-NN`, the same channel getting the
  same number in every file); and the Nuvio and MeteGol manifest descriptions are
  shorter. Match names, teams, competitions, times, genres and the other ids are as
  served. Do not reformat or edit item content otherwise. Prettier would reformat them, so
  `packages/core/src/sports/fixtures/` needs to be listed in the root
  `.prettierignore`.

## How they were captured

The build container's proxy refuses connections to these addon hosts, so each
response was fetched with the Exa `web_fetch_exa` tool, which returns the raw body.
Small responses were copied from the tool's answer into the file; large ones were
saved by the tool to disk and cut out of that file with a script. Each file was then
parsed with `JSON.parse`, and items repeated across files were checked to be
identical. The time given is the `date -u` reading taken just before the request
batch.

File names: the request path after the base address, with `/` replaced by `__` and
`.json` kept. The `:` in Sports Streams meta ids is written `%3A` (its URL encoding),
because `:` is not allowed in Windows file names.

## Sports Streams (free tier)

Base: the addon's public address (manifest id `community.sports.fly`, version 1.3.0).
Folder: `sports-streams/`.

| File | Path | Fetched (UTC) | Items |
| --- | --- | --- | --- |
| `manifest.json` | /manifest.json | 03:59:30 | 17 catalogs |
| `catalog__sport__sports_live.json` | /catalog/sport/sports_live.json | 03:59:56 | 34 (18 channels, 16 events) |
| `catalog__sport__sports_today.json` | /catalog/sport/sports_today.json | 04:01:02 | 38 (18 channels, 20 events) |
| `catalog__sport__sports_today__skip=20.json` | /catalog/sport/sports_today/skip=20.json | 04:02:11 | 20 events |
| `catalog__sport__sports_football.json` | /catalog/sport/sports_football.json | 04:02:53 | 22 (2 channels, 20 events) |
| `catalog__sport__sports_football__skip=20.json` | /catalog/sport/sports_football/skip=20.json | 04:03:36 | 20 events |
| `catalog__sport__sports_football__skip=40.json` | /catalog/sport/sports_football/skip=40.json | 04:04:28 | 20 events |
| `catalog__sport__sports_basketball.json` | /catalog/sport/sports_basketball.json | 04:05:09 | 20 events |
| `catalog__sport__sports_hockey.json` | /catalog/sport/sports_hockey.json | 04:05:55 | 20 events |
| `catalog__sport__sports_cricket.json` | /catalog/sport/sports_cricket.json | 04:06:41 | 21 (1 channel, 20 events) |
| `catalog__sport__sports_motor_sports.json` | /catalog/sport/sports_motor_sports.json | 04:07:39 | 14 (2 channels, 12 sessions) |
| `catalog__sport__sports_fight.json` | /catalog/sport/sports_fight.json | 04:07:39 | 15 events |
| `catalog__sport__sports_tennis.json` | /catalog/sport/sports_tennis.json | 04:08:36 | 2 channels |
| `catalog__sport__sports_rugby.json` | /catalog/sport/sports_rugby.json | 04:08:36 | 22 (2 channels, 20 events) |
| `catalog__sport__sports_other.json` | /catalog/sport/sports_other.json | 04:08:36 | 0 |
| `meta__sport__streamed%3Abasketball-los-angeles-lakers-portland-trail-blazers-20754.json` | /meta/sport/streamed:basketball-los-angeles-lakers-portland-trail-blazers-20754.json | 04:09:28 | 1 (live) |
| `meta__sport__streamed%3Acricket-ban-wi-t1d1.json` | /meta/sport/streamed:cricket-ban-wi-t1d1.json | 04:09:28 | 1 (live) |
| `meta__sport__streamed%3Afootball-manchester-city-brighton-and-hove-albion-20754.json` | /meta/sport/streamed:football-manchester-city-brighton-and-hove-albion-20754.json | 04:09:28 | 1 (upcoming) |
| `meta__sport__streamed%3Afootball-freiburg-wolfsburg-20754.json` | /meta/sport/streamed:football-freiburg-wolfsburg-20754.json | 04:09:28 | 1 (upcoming) |

What these show, for writing tests:

- Pages hold 20 events. Page 1 adds the matching `leaf:` channels on top (18 in Live
  and Today, 2 in Football), and `skip` counts events only: Football `skip=20` starts
  at Pamplona vs Eibar, the 21st event.
- Unlike the premium install described in `sports-addons/findings.md`, this free tier
  now sends the competition as a second genre for most events (`["Football","EFL Cup"]`,
  `["Hockey","NHL"]`, `["Rugby","United Rugby Championship"]`). Most cricket items
  send `["Cricket"]` only. Channels send `[sport, channel code]`.
- Live labels disagree between catalogs: New York Knicks vs Detroit Pistons (kick-off
  00:00 UTC) is `LIVE` in Live and Today but `28 Oct 2026 · 00:00 UTC` in Basketball,
  four hours later. The meta of a live item still gives its kick-off
  (Lakers vs Trail Blazers, `28 Oct 2026 · 03:00 UTC`).
- Cricket repeats one match under two ids (`cricket-nz-ind-t20i4` and
  `cricket-new-zealand-cricket-india-cricket-20756`), and some ids carry no day number
  (`cricket-ban-wi-t1d1`). `Tri-Nation Series Final` has no teams in its name and
  `Pakistan vs TBC` in its description.
- Motor Sports and Fight items have no `A vs B` name (`Mexico City Grand Prix
  Qualifying`, `SmackDown #1419`), and their description is the time only.

## Nuvio Live Sports

Base: the addon's public address (manifest id `community.nuvio.live-sports`, version
3.1.3). Folder: `nuvio-live-sports/`.

| File | Path | Fetched (UTC) | Items |
| --- | --- | --- | --- |
| `manifest.json` | /manifest.json | 04:10:13 | 74 catalogs |
| `catalog__tv__nuvio_sports_live.json` | /catalog/tv/nuvio_sports_live.json | 04:11:18 (see note) | 100 (13 channels) |
| `catalog__tv__nuvio_sports_football.json` | /catalog/tv/nuvio_sports_football.json | 04:12:02 | 100 (97 channels, 3 live matches) |
| `catalog__tv__nuvio_sports_basketball.json` | /catalog/tv/nuvio_sports_basketball.json | 04:12:20 | 25 (9 channels, 16 games) |

Note: the first request for the Live catalog was cut off by the tool's length limit
and thrown away; the saved copy is the retry, made before 04:11:56.

What these show: a `🏆 League: X` line in `description`, `lg=` in the poster URL (as served; the renamed image addresses no longer carry it),
`team1`/`team2` and `cast`, `released` in ISO UTC, `releaseInfo` as a 12-hour clock
with no date (this install's time zone setting defaults to UTC), name prefixes
`🔴 LIVE: ` and `⏱️ `, channels marked by genre `NETWORKS` and `releaseInfo` `24/7`,
ids with a local date (`nuvio_sport_dami_nba_2026-10-28_ny-chi` kicks off
2026-10-29T00:00Z), an item two months out, and cache hints on every page
(`cacheMaxAge`, `staleRevalidate`, `staleError`). Pages stop at 100 items although
the Live and per-sport catalogs do not declare `skip`. The Soccer page is almost all
channels; upcoming football sits in `nuvio_sports_upcoming`, which was not captured. The manifest's Premier League catalog name holds an England flag
made of Unicode tag characters.

## MeteGol

Base: the addon's public address (manifest id `com.metegol.live.v5`, version
1.8.3). Folder: `metegol/`. The addon has a single catalog, so only that one was
saved.

| File | Path | Fetched (UTC) | Items |
| --- | --- | --- | --- |
| `manifest.json` | /manifest.json | 04:10:13 | 1 catalog |
| `catalog__tv__deportes.json` | /catalog/tv/deportes.json | 04:15:03 | 4 |

What these show: `Competition: Home vs Away` names, an `EN VIVO · ` prefix, a clock
time with no date in `releaseInfo` in the default zone Argentina (UTC-3): `23:00` is
02:00 UTC on 28 October, the same match Nuvio lists with `released`
2026-10-28T02:00:00.000Z. NHL games are tagged `Fútbol`.

## StremVerse

Base: the addon's public address (manifest id `com.stremverse.org`, version
3.0.0). Folder: `stremverse/`.

| File | Path | Fetched (UTC) | Items |
| --- | --- | --- | --- |
| `manifest.json` | /manifest.json | 04:10:13 | 5 catalogs |
| `catalog__tv__stremverse_live_events.json` | /catalog/tv/stremverse_live_events.json | 04:15:48 | 120 |
| `catalog__tv__stremverse_live_events__genre=Football.json` | /catalog/tv/stremverse_live_events/genre=Football.json | 04:15:48 | 79 |
| `catalog__tv__stremverse_xtra_events.json` | /catalog/tv/stremverse_xtra_events.json | 04:15:48 | 100 |

What these show: Live Events items have only `id`, `type`, `name`, `poster` and
`background`, with no time and no genre. Some are named after the competition
(`NHL`, `NBA`, `Primera A`, `ICC World Test Championship`), and the same match often
appears two or three times under different ids and spellings (`SC Paderborn 07 vs
VfB Stuttgart` and `Paderborn vs VfB Stuttgart`; `FC Bayern Munchen vs 1. FC Magdeburg`
and `Bayern München vs Magdeburg`; `SC Freiburg vs VfL Wolfsburg` twice). `background`
is a SofaScore `unique-tournament/<n>` image for 74 of the 120 items and a placeholder
(`o`, `null` or an empty string) for most others. Xtra items add one sport genre and a
date-only `releaseInfo` (`2026-10-27` or `2026-10-28`).

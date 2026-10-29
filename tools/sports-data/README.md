# Sports matcher data

`build.mjs` writes `packages/core/src/sports/data/sports-data.json`: the competitions, teams,
countries, UEFA club lists and league calendars the sports view uses to name and group matches
(docs/PLAN.md, "Matcher data"; the shape is `SportsData` in `packages/core/src/sports/types.ts`).

## Rebuild

```sh
node tools/sports-data/build.mjs                    # fetch openfootball, build, validate
node tools/sports-data/build.mjs --offline          # reuse tools/sports-data/.cache/, no network
node tools/sports-data/build.mjs --built=2026-10-28 # set the build date (default: today)
```

Other flags: `--season=2026-27` and `--year=2026` choose the openfootball folders (both
default from the build date; the season turns over in July), and `--strict` treats warnings as
errors. It needs Node 22 and nothing else. The same inputs and `--built` give the same file
byte for byte; `built` is the only date in it.

The script stops with a list of errors when the data does not hold together: duplicate ids or
SofaScore ids, two competitions or two teams of one sport with the same normalised name, an
alias ending in a year (the matcher strips years, so it could never match), a bare name the
plan reserves ("Premier League" is England's, "Serie A" is Italy's, nothing may be called
"League Cup"), a team whose league does not exist, a calendar or UEFA name that is not a team,
or a country code nobody defined. It prints the counts and the gzipped size, and keeps only the
top-division calendars if the file would pass 90 KB gzipped.

Every new season: run it once the openfootball files for the season appear, then update
`uefa.json` (the league-phase clubs) and any `teams.json` group whose league changed.

## Files

- `countries.json`: codes, names and adjectives ("German football").
- `competitions.json`: every competition, with its priority (UK football first), the names
  addons use for it, SofaScore tournament ids where known, and the women and youth flags.
- `teams.json`: `aliases` adds other names to openfootball's team names; `groups` lists the
  teams of leagues openfootball does not cover, and the NFL, NBA, NHL and MLB. A team's country
  is the country of the league it plays in (Toronto FC is listed under the United States,
  because it plays in MLS).
- `uefa.json`: this season's league-phase clubs of the Champions League, Europa League and
  Conference League, spelled as the team list spells them.

## Sources and licences

- League teams and fixtures for England (two tiers), Germany, Spain, Italy, France, the
  Netherlands, Portugal and Brazil come from openfootball's football.json
  (https://github.com/openfootball/football.json), which is public domain (CC0 1.0).
- Everything else is hand-curated: competition and team names, short names, league membership
  and the UEFA lists. These are facts, not creative work. Wikipedia was used only to check them
  (who plays in which league in 2026-27, who reached each UEFA league phase); no text was taken
  from it.
- No crests, logos, photos or descriptive text from any third party are bundled.

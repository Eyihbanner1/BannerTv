# BannerTV API

A Cloudflare Worker that lets the TV use Trakt and TMDB without their keys in the app package or in this repository, and read IntroDB's skip timings, which IntroDB does not open to browsers. See ADR 0004, items 9 and 13 (since 6 November 2026 Search may ask TMDB; Home and Discover still never do).

The Trakt client ID (and client secret, for a Trakt app old enough to have one) and the TMDB key are Worker secrets. The TV calls the Worker with simple requests (GET, or POST with a plain-text body), so browsers never send a preflight, and every answer carries `Access-Control-Allow-Origin: *`. The Worker passes on only the Trakt and TMDB calls BannerTV makes, adds the keys, and caches TMDB's answers for a day at the edge. Requests carry viewers' Trakt tokens, so it keeps no logs (observability is off in `wrangler.toml`), and no answer repeats a secret, a token or a request body.

## What the TV can ask

### `GET /status`

`{"trakt": true, "tmdb": true, "search": true}`: whether each service's keys are set (for Trakt, the client ID; the secret is optional). The app hides Trakt and TMDB until they are. `search` is true when the TMDB key is set and this Worker has the `/search` routes below; an app finding no `search` field (a Worker from before them) leaves Search to the addons.

### `POST /trakt`

The body is plain text holding JSON:

```json
{ "method": "GET", "path": "/sync/watchlist/movies?extended=full", "token": "<access token>" }
```

`method` is GET, POST or DELETE. `token` (the viewer's access token, at most 4 KB) and `body` (any JSON, sent to Trakt on a POST) are optional, and the whole request is at most 64 KB. The answer is HTTP 200 with

```json
{ "status": 200, "data": [], "retryAfter": 30 }
```

holding Trakt's status, Trakt's JSON body as `data` (null when it sent none), and `retryAfter` in seconds when Trakt sent Retry-After. So the TV reads Trakt's own refusals (401, 429, and 400 while device sign-in waits) from `status`. The Worker's own errors:

| Status | Body | When |
| --- | --- | --- |
| 400 | `{"error":"path"}` | a method, path or query parameter not on the list below, or a body that is not that JSON |
| 503 | `{"error":"unconfigured"}` | the Trakt client ID is not set |
| 502 | `{"error":"upstream"}` | Trakt did not answer within 30 seconds |

The calls passed on, matched on the path without its query. The query may hold only `extended`, `page` and `limit`.

- POST `/oauth/device/code`, `/oauth/device/token`, `/oauth/token`, `/oauth/revoke`
- GET `/users/settings`
- POST `/scrobble/start`, `/scrobble/pause`, `/scrobble/stop`
- GET `/sync/last_activities`
- GET `/sync/playback`, `/sync/playback/movies`, `/sync/playback/episodes`
- DELETE `/sync/playback/<id>`, where the id is Trakt's numeric playback id (1 to 12 digits), with no query; it removes one paused item, and no body is sent
- GET `/sync/watched/movies`, `/sync/watched/shows`
- GET `/sync/watchlist`, `/sync/watchlist/movies`, `/sync/watchlist/shows`
- POST `/sync/watchlist`, `/sync/watchlist/remove`
- POST `/sync/history`, `/sync/history/remove`

For the OAuth paths the Worker builds the body itself around the one field the TV sends, so the TV cannot change the app's keys or the grant:

| Path | The TV sends | The Worker adds |
| --- | --- | --- |
| `/oauth/device/code` | nothing | `client_id` |
| `/oauth/device/token` | `code` (the device code) | `client_id`, `client_secret` if set |
| `/oauth/token` | `refresh_token` | `client_id`, `client_secret` if set, `redirect_uri` `urn:ietf:wg:oauth:2.0:oob`, `grant_type` `refresh_token` |
| `/oauth/revoke` | `token` (the access token) | `client_id`, `client_secret` if set |

Trakt has issued no client secret to new apps since October 2026 (their sign-in uses PKCE, and the device sign-in needs only the client ID) and calls the secret deprecated, so the Worker sends it only when `TRAKT_CLIENT_SECRET` is set. Refresh tokens are single-use: each refresh answers with a new one, which the TV keeps in place of the old.

The OAuth paths go to Trakt's auth host, `https://auth.trakt.tv`, as Trakt asks, with `Content-Type: application/json` and `User-Agent: BannerTV/<version>`. Every other path goes to `https://api.trakt.tv` with `trakt-api-version: 2`, `trakt-api-key: <client ID>`, `Content-Type: application/json`, `User-Agent: BannerTV/<version>` and, when the TV sent a token, `Authorization: Bearer <token>`.

### `GET /tmdb/<path>?<query>`

Passes on `GET https://api.themoviedb.org/3/<path>?<query>` with the TMDB key added, and answers with TMDB's status and JSON body as they are. The paths passed on:

- `find/tt<digits>` with `external_source=imdb_id`
- `movie/<id>`, `tv/<id>`, `tv/<id>/season/<number>`
- `movie/<id>/external_ids`, `tv/<id>/external_ids`

The query may hold `append_to_response` (any of `images`, `credits`, `aggregate_credits`, `release_dates`, `content_ratings` and `external_ids`, comma-separated), `include_image_language`, `language` and `external_source`. Anything else is 400 `{"error":"path"}`. Without a key the answer is 503 `{"error":"unconfigured"}`, and when TMDB does not answer within 30 seconds, or answers with something that is not JSON, it is 502 `{"error":"upstream"}`.

TMDB's 200 answers are cached for a day in Cloudflare's edge cache (each data centre keeps its own), under the Worker's own address for the call with the query sorted, never the key, and are served with `Cache-Control: public, max-age=86400`. Everything else the Worker answers carries `Cache-Control: no-store`.

### `GET /search/<route>?<query>`

Search's rows from TMDB, answered with titles by IMDb id so the app opens them on Details as any other: `{"titles": [{"id": "tt0109830", "type": "movie", "name": "Forrest Gump", "year": "1994", "poster": "/abc.jpg", "genres": ["Comedy", "Drama"]}]}`. Each title's IMDb id costs one more TMDB call, so a route answers with at most 20 titles, asking TMDB at most 6 at a time: at most 22 TMDB calls and two edge-cache calls a request, under the free plan's 50. TMDB is always asked with the adult filter off, and titles it marks adult are left out. With `ratings=1` (or a `certification`) each title also carries `"certificates": {"GB": [...], "US": [...]}`, TMDB's UK and US ratings, for a kids profile to check.

| Route | Query | TMDB asked |
| --- | --- | --- |
| `discover` | `type` (`movie` or `series`); optional `genres` (all of), `any` (one of), `keywords` (any of), each up to a few TMDB ids, comma-separated; `language` (ISO 639-1), `country` (ISO 3166-1), `from` and `to` (years), `newest=1`, `certification` (`U`, `PG` or `12`) | `discover/movie` or `discover/tv`; films filtered by GB certificate, series by reading each one's ratings |
| `multi` | `query` | `search/multi`: answers `{"people": [...], "titles": [...]}` for suggestions, at most 5 people and 8 titles |
| `person` | `id` (TMDB's person id), `role` (`cast`, `directing`, `writing` or `any`), optional `ratings=1` | `person/<id>/combined_credits`, leaving out talk and news shows and appearances as themselves |
| `like` | `query`, optional `type`, optional `ratings=1` | `search/movie`, `search/tv` or `search/multi`, then the first title's `recommendations`; the answer adds `"like": {"name", "type", "year"}` |
| `titles` | `query`, optional `type`, optional `ratings=1` | `search/movie`, `search/tv` or `search/multi` |

The words are folded (trimmed, single spaces, lower case) and at most 100 characters. Anything else is 400 `{"error":"path"}`; without a key 503 `{"error":"unconfigured"}`; when TMDB fails 502 `{"error":"upstream"}`. Whole answers are cached for a day like TMDB's own; an answer missing some titles (a lookup failed) carries `"partial": true`, is served with `Cache-Control: no-store` and is not cached, so the next search asks again. A row needing some genres and one of several others (Comedy, and Family or Kids) is asked of TMDB once for each of those others, since one call cannot say both, and the lists are merged.

`TMDB_API_KEY` can be a v3 API key, which goes in the query as `api_key`, or a v4 read access token (it starts `eyJ`), which goes in `Authorization: Bearer`.

### `GET /introdb/segments?imdb_id=<id>&season=<n>&episode=<n>`

IntroDB's timings for one episode (its intro, recap, end credits and scene after them), for Skip intro, Skip recap and Up Next. IntroDB's reads need no key, but its answers name only `https://introdb.app` in `Access-Control-Allow-Origin`, so the TV's browser throws them away; the Worker asks `GET https://api.introdb.app/segments` with the same three parameters and answers with IntroDB's status and JSON body as they are, open to any origin. It needs no secret, so it answers whatever keys are set.

The query must hold exactly `imdb_id` (`tt` and 1 to 10 digits), `season` (1 to 4 digits, from 1) and `episode` (1 to 5 digits, from 1); anything else is 400 `{"error":"path"}`. When IntroDB does not answer within 30 seconds, or answers with something that is not JSON, it is 502 `{"error":"upstream"}`. IntroDB's 200 answers are cached for six hours at the edge under the Worker's own address with the query sorted, and served with `Cache-Control: public, max-age=21600`, since timings are added and corrected; its other answers are not cached. The app asks IntroDB itself when the Worker has no answer, which a phone can read.

## Deploy

First, the keys:

- **Trakt**: at app.trakt.tv, Settings, Your API Apps, create an app for BannerTV with the redirect URI `urn:ietf:wg:oauth:2.0:oob` (Trakt warns that it is not https, but saves it). It needs no CORS (JavaScript) origins, since the TV talks to this Worker and never to Trakt. The app's page shows its Client ID. An app made since October 2026 has no Client Secret ("Not issued. This app signs users in with PKCE."), and needs none; an older app's secret can still be put.
- **TMDB**: at themoviedb.org, Settings, API, either the API key or the API read access token.

Then, from this folder on the laptop:

```sh
npx wrangler@4 login    # already signed in from the pairing relay, so usually skipped
npx wrangler@4 deploy
npx wrangler@4 secret put TRAKT_CLIENT_ID
npx wrangler@4 secret put TMDB_API_KEY
npx wrangler@4 secret put TRAKT_CLIENT_SECRET   # only for a Trakt app that has one
```

Each `secret put` asks for the value and sends it straight to Cloudflare, so it never appears in the repository or in a chat. A secret takes effect as soon as it is put, with no new deploy.

Without the laptop, the **Deploy api Worker** workflow does the same deploy from main: in GitHub, Actions, Deploy api Worker, Run workflow. It runs the Worker's typecheck and unit tests, deploys with `wrangler@4 deploy` and then reads `/status`. It needs the repository secret `CLOUDFLARE_API_TOKEN`, a Cloudflare API token made from the "Edit Cloudflare Workers" template (Settings, Secrets and variables, Actions), and the repository variable `CLOUDFLARE_ACCOUNT_ID` only if that token reaches more than one account. It never touches the Worker's secrets, which stay as they were put.

To check, open <https://api.bannertv.workers.dev/status>. It shows `{"trakt":true,"tmdb":true,"search":true}`; a `false` means that service's key is missing (the Trakt client ID, or the TMDB key), so put it again.

The free Workers plan covers a household many times over: it allows 100,000 requests a day, and a TV makes a sync every 30 minutes, a few scrobbles per title watched, and a couple of TMDB requests per Details page.

## Tests

`pnpm --filter @bannertv/api test` runs the rules and the Worker end to end against a fake Trakt, TMDB and edge cache, with no network.

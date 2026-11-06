# BannerTV API

A Cloudflare Worker that lets the TV use Trakt and TMDB without their keys in the app package or in this repository. See ADR 0004, item 9.

The Trakt client ID (and client secret, for a Trakt app old enough to have one) and the TMDB key are Worker secrets. The TV calls the Worker with simple requests (GET, or POST with a plain-text body), so browsers never send a preflight, and every answer carries `Access-Control-Allow-Origin: *`. The Worker passes on only the Trakt and TMDB calls BannerTV makes, adds the keys, and caches TMDB's answers for a day at the edge. Requests carry viewers' Trakt tokens, so it keeps no logs (observability is off in `wrangler.toml`), and no answer repeats a secret, a token or a request body.

## What the TV can ask

### `GET /status`

`{"trakt": true, "tmdb": true}`: whether each service's keys are set (for Trakt, the client ID; the secret is optional). The app hides Trakt and TMDB until they are.

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

`TMDB_API_KEY` can be a v3 API key, which goes in the query as `api_key`, or a v4 read access token (it starts `eyJ`), which goes in `Authorization: Bearer`.

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

To check, open <https://api.bannertv.workers.dev/status>. It shows `{"trakt":true,"tmdb":true}`; a `false` means that service's key is missing (the Trakt client ID, or the TMDB key), so put it again.

The free Workers plan covers a household many times over: it allows 100,000 requests a day, and a TV makes a sync every 30 minutes, a few scrobbles per title watched, and a couple of TMDB requests per Details page.

## Tests

`pnpm --filter @bannertv/api test` runs the rules and the Worker end to end against a fake Trakt, TMDB and edge cache, with no network.

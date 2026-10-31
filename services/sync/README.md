# BannerTV account sync

A Cloudflare Worker with one D1 database that keeps each BannerTV account's documents, so a person's profiles, addons, My List, Continue Watching and settings follow them between screens. See ADR 0006.

Screens seal every document with keys derived from the account code before sending it. The code and the keys never reach the server, which keeps a random account id, a hash of the auth key and ciphertext it cannot read. The Worker has no secrets and keeps no logs (observability, traces and log pushes are off in `wrangler.toml`), and no error repeats what was sent.

## What the screens can ask

The address is `https://sync.bannertv.workers.dev`. Screens send simple requests (GET, or POST with a plain-text body holding JSON, and no credentials), so browsers never send a preflight; the Worker answers one anyway. Every answer is JSON with `now`, the server's time in milliseconds, and carries `Access-Control-Allow-Origin: *`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

`account` (the account id), document names and epochs are 22 base64url characters, `auth` (the auth key) is 43, and a sealed body is `1.`, the IV, a dot and the ciphertext, all base64url.

| Route | Request | Answer |
| --- | --- | --- |
| `GET /v1/status` | | `{ok: true, v: 1, now, create, pullMinutes}`: whether an account can be made now, and how often screens pull |
| `POST /v1/account/create` | `{account, auth}` | 201 `{now, epoch}`. 200 with the same epoch when the account exists with this auth key, for a create whose answer was lost |
| `POST /v1/pull` | `{account, auth, epoch?, have: {name: ver}, want: [name]}` | `{now, epoch, vers, docs, more}`: the version of every document in `vers`, and in `docs` `{ver, at, body}` for each wanted one whose version differs from `have`, up to 1,000,000 characters of bodies, with `more` when some were left for the next pull |
| `POST /v1/push` | `{account, auth, epoch, put: [{name, base, body}]}` | `{now, epoch, done: [{name, ver, at}], conflicts: [name]}` |
| `POST /v1/account/delete` | `{account, auth}` | `{now}`: the account and its documents are gone |

A push names the version each document started from as `base`, 0 for a new one, and a document is written only while that is still the stored version (compare and swap). Each document commits or conflicts on its own, and a screen that gets a conflict pulls, merges and pushes again. A push's documents, the account's daily write count and the day it was last used are written in one D1 batch, so they change together or not at all.

The errors are `{error, now}`:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `bad-request` | a field out of its form, or a body that is not JSON |
| 401 | `denied` | an unknown account or a wrong auth key: the two answers are the same |
| 403 | `closed` | a create while `MAX_ACCOUNTS` accounts exist |
| 404 | `not-found` | any other route |
| 409 | `exists` | a create for an account that exists with another auth key |
| 409 | `epoch` | a pull or push naming an epoch the account no longer has: it was deleted and made again |
| 413 | `too-big` | past a size limit below |
| 429 | `limit` | past the day's writes; `retryAfter` is the seconds to the next UTC midnight |
| 503 | `unavailable` | D1 failed |

The limits:

- a request: 1.1 MB, at most 12 documents in a push and 64 names in a pull's `want`;
- a body: 1,000,000 characters;
- an account: 120 documents, 10,000,000 characters of bodies, and 2,000 documents pushed a UTC day (a conflict counts too, since it costs D1 a statement). A screen pushes about 25 on a day of use.

## What the server keeps

- `accounts`: the account id, base64url SHA-256 of the auth key, the epoch (random, new at each create), the UTC day it was made and the day it was last used (day numbers, coarse on purpose), and the day's count of documents pushed.
- `docs`: for each document, the account id, its name (a keyed hash, which names neither a profile nor what the document holds), its version, the time that version was written, and the sealed body as the screen sent it.

It keeps no code, no keys, nothing readable from a document, no IP addresses and no request logs. What it can learn is how many documents an account has, their sizes (padded on the screen to a multiple of 1 KB, or 8 KB above 64 KB) and when they change.

Delete removes the account and its documents at once. D1 Time Travel keeps a restorable history of the database for 7 days on the free plan (30 on Workers Paid), so a deleted account's ciphertext can be restored by the operator for that long; nobody can read it without the code. Do not restore the database with Time Travel to undo a mistake: screens refuse a document version lower than one they have seen, so they would stop syncing until they leave the account and join again.

## Deploy

On the Windows laptop, open this folder (`services\sync`) in PowerShell. First the database, once:

```powershell
npx wrangler@4 login    # already signed in from the other Workers, so usually skipped
npx wrangler@4 d1 create bannertv-sync --location weur
```

Wrangler prints the new database's `database_id`. If it offers to add the database to the configuration itself, answer `n`. Open the configuration with `notepad wrangler.toml`, replace `PASTE-THE-DATABASE-ID-HERE` with the id, and save. The id is not a secret, so it can be committed.

Then deploy:

```powershell
npx wrangler@4 deploy
```

There are no secrets to put and no schema to apply: the Worker makes its two tables the first time it is used. Later deploys are just `npx wrangler@4 deploy` from this folder.

To check, ask for the status (`curl.exe`, since `curl` in Windows PowerShell is another command):

```powershell
curl.exe https://sync.bannertv.workers.dev/v1/status
```

It shows `{"ok":true,"v":1,"now":…,"create":true,"pullMinutes":30}`. `create` turns false once the account exists.

Two settings are in `[vars]` in `wrangler.toml`, and take effect at the next deploy:

- `MAX_ACCOUNTS`, `"1"`: how many accounts may exist. It stays at 1 until the ICO fee, the privacy notice, and delete and export in the app are in place, so only Eyitayo's account can exist; deleting it frees the place. Missing or unreadable, it closes account creation.
- `PULL_MINUTES`, `"30"`: how often screens pull, from 15 minutes to a day. Raising it slows every screen down without a release.

## Looking at the tables

`wrangler d1 execute` runs a query on the live database. Name the columns, and never ask for `body` or `SELECT *` from `docs`: the bodies are unreadable, but have no business in a terminal's history. For example:

```powershell
npx wrangler@4 d1 execute bannertv-sync --remote --command "SELECT created, seen, day, writes FROM accounts"
npx wrangler@4 d1 execute bannertv-sync --remote --command "SELECT COUNT(*) AS documents, SUM(LENGTH(body)) AS characters, MAX(at) AS last_write FROM docs"
```

## Capacity

The free plan allows 100,000 Worker requests a day, shared with `api` and `pair`, and 100,000 D1 rows written a day; a D1 database holds up to 500 MB. A screen on a day of use makes about 25 requests and writes about 25 rows.

## Tests

`pnpm --filter @bannertv/sync test` runs the rules and the Worker end to end against D1 stood in by Node's own SQLite (`node:sqlite`, in Node 22), so the statements, the compare and swap, the counters and the limits run on a real SQL engine, with no network.

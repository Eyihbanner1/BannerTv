# BannerTV account sync

A Cloudflare Worker with one D1 database that keeps each BannerTV account's documents, so a person's profiles, addons, My List, Continue Watching and settings follow them between screens. See ADR 0006.

Screens seal every document with keys derived from the account code before sending it. The code and the keys never reach the server, which keeps a random account id, a hash of the auth key and ciphertext it cannot read. The Worker's one secret is the setup key (`CREATE_KEY`), which only decides who may make an account. It keeps no logs (observability, traces and log pushes are off in `wrangler.toml`), and no error repeats what was sent.

## What the screens can ask

The address is `https://sync.bannertv.workers.dev`. Screens send simple requests (GET, or POST with a plain-text body holding JSON, and no credentials), so browsers never send a preflight; the Worker answers one anyway. Every answer is JSON with `now`, the server's time in milliseconds, and carries `Access-Control-Allow-Origin: *`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

`account` (the account id), document names and epochs are 22 base64url characters, `auth` (the auth key) is 43, and a sealed body is `1.`, the IV, a dot and the ciphertext, all base64url.

| Route | Request | Answer |
| --- | --- | --- |
| `GET /v1/status` | | `{ok: true, v: 1, now, create, key, pullMinutes}`: whether an account can be made now, whether making one needs the setup key, and how often screens pull |
| `POST /v1/account/create` | `{account, auth, key?}` | 201 `{now, epoch}`. 200 with the same epoch when the account exists with this auth key, for a create whose answer was lost. `key` is the setup key: needed while `CREATE_KEY` is set, a resumed create included, and left out otherwise |
| `POST /v1/pull` | `{account, auth, epoch?, have: {name: ver}, want: [name]}` | `{now, epoch, vers, docs, more}`: the version of every document in `vers`, and in `docs` `{ver, at, body}` for each wanted one whose version differs from `have`, up to 1,000,000 characters of bodies, with `more` when some were left for the next pull |
| `POST /v1/push` | `{account, auth, epoch, put: [{name, base, body}]}` | `{now, epoch, done: [{name, ver, at}], conflicts: [name], full: [name]}` |
| `POST /v1/account/delete` | `{account, auth}` | `{now}`: the account and its documents are gone |

A push names the version each document started from as `base`, 0 for a new one, and a document is written only while that is still the stored version (compare and swap) and while it fits the account's limits. Each document commits on its own, or comes back in `conflicts` or `full` with its version unchanged. A conflict means the document has moved on, so the screen pulls, merges and pushes again. `full` means it did not fit: a new document while the account holds 120, or a change that would take the account's bodies past 10,000,000 characters. A change that keeps a document's size or makes it smaller always fits, so an account over a limit can come back under it. The screen keeps a document that did not fit and sends it again once it changes, and also once on Sync now, once when a hold on its pushes ends, and once after a pull that brought other screens' changes, which may have made room: never in a loop, so a full account costs only a few of the day's writes.

A push's documents, the account's daily write count and the day it was last used are written in one D1 batch, so they change together or not at all. The limits are checked by the same statements that write, so pushes sent at once cannot pass them together.

The errors are `{error, now}`:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `bad-request` | a field out of its form, or a body that is not JSON |
| 401 | `denied` | an unknown account or a wrong auth key: the two answers are the same. Also a push that crossed the account's delete |
| 403 | `closed` | a create while `MAX_ACCOUNTS` accounts exist |
| 403 | `key` | a create without the setup key, or with another, while `CREATE_KEY` is set, and every create while it is set to something that is no key (see the setup key below). It comes before `closed`, so it says nothing about the place |
| 404 | `not-found` | any other route |
| 409 | `exists` | a create for an account that exists with another auth key |
| 409 | `epoch` | a pull or push naming an epoch the account no longer has: it was deleted and made again. Also a push that crossed that |
| 413 | `too-big` | a request past a limit below: its size, its number of documents or names, or a body. A full account is not this: its documents come back in `full` |
| 429 | `limit` | past the day's writes, which refuses the whole push; `retryAfter` is the seconds to the next UTC midnight |
| 503 | `unavailable` | D1 failed |

The limits:

- a request: 1.1 MB, at most 12 documents in a push and 64 names in a pull's `want`;
- a body: 1,000,000 characters;
- an account: 120 documents and 10,000,000 characters of bodies, past which a push's documents that do not fit come back in `full`; and 2,000 documents pushed a UTC day, past which a whole push is refused (a conflict, or a document that did not fit, counts too, since it costs D1 a statement). A screen pushes about 25 on a day of use.

The documents of a deleted profile stay on the server and count against the account's limits. A way for screens to drop them comes in PR B2.

## What the server keeps

- `accounts`: the account id, base64url SHA-256 of the auth key, the epoch (random, new at each create), the UTC day it was made and the day it was last used (day numbers, coarse on purpose), and the day's count of documents pushed.
- `docs`: for each document, the account id, its name (a keyed hash, which names neither a profile nor what the document holds), its version, the time that version was written, and the sealed body as the screen sent it.

It keeps no code, no keys, nothing readable from a document, no IP addresses and no request logs. What it can learn is how many documents an account has, their sizes (padded on the screen to a multiple of 1 KB, or 8 KB above 64 KB) and when they change.

Delete removes the account and its documents at once. D1 Time Travel keeps a restorable history of the database for 7 days on the free plan (30 on Workers Paid), so a deleted account's ciphertext can be restored by the operator for that long; nobody can read it without the code. Do not restore the database with Time Travel to undo a mistake: screens refuse a document version lower than one they have seen, so they would stop syncing until they leave the account and join again (see [If something goes wrong](#if-something-goes-wrong)).

## Deploy

Eyitayo deploys the Worker himself, from a fresh download of `services/sync`, in Windows PowerShell on the laptop. Open that folder (`services\sync`) in PowerShell and run every command below from there.

### Once: the database

```powershell
npx wrangler@4 login    # already signed in from the other Workers, so usually skipped
npx wrangler@4 d1 create bannertv-sync --location weur
```

Wrangler prints a snippet with the new database's id. There is nothing to paste: `wrangler.toml` names the database `bannertv-sync`, and wrangler finds it by that name at every deploy.

### Once: the first deploy and the setup key

```powershell
npx wrangler@4 deploy
```

There is no schema to apply: the Worker makes its two tables the first time it is used.

Then, before anyone makes the account, add the setup key, so that only someone who knows it can take the account's place:

1. Make up a key of at least 12 letters and numbers, and nothing else, used nowhere else. Capitals count. Keep it with the account code.
2. In the Cloudflare dashboard, open the `sync` Worker, then Settings, then Variables and Secrets, and choose Add.
3. Choose the type Secret, name it `CREATE_KEY`, type the key as its value, and deploy.

A `CREATE_KEY` that is blank, or set to anything but text or a whole number, is no key: every create is then refused, and the status still says `"key":true`, so a mistake there never opens the place to anyone.

Never put the key on a command line, in `wrangler.toml` or in a file in this folder. `wrangler secret put` takes the secret's name on the command line, not its value: an earlier try with the value there stored it as the name. Later deploys keep the secret as it is.

To check, ask for the status (`curl.exe`, since `curl` in Windows PowerShell is another command):

```powershell
curl.exe https://sync.bannertv.workers.dev/v1/status
```

It shows `{"ok":true,"v":1,"now":…,"create":true,"key":true,"pullMinutes":30}`. Wait for `"key":true` before making the account: without it, anyone with the app could take the place. `create` turns false once the account exists.

Then make the account on the first screen, in Settings, BannerTV account, Create an account. It asks for the setup key: type it there. Other screens join with the account code and never need the key.

### Later deploys

Download a fresh copy of `services/sync`, open it in PowerShell and run `npx wrangler@4 deploy`. The database, the setup key and the account stay as they are. A fresh copy has the settings in `[vars]` as the repository has them, so a setting changed by hand needs changing again before the deploy.

### Settings

Two settings are in `[vars]` in `wrangler.toml`, and take effect at the next deploy. Either form works, with quotes or without (`"30"` or `30`):

- `MAX_ACCOUNTS`, `"1"`: how many accounts may exist. It stays at 1 until the ICO fee, the privacy notice, and delete and export in the app are in place, so only Eyitayo's account can exist; deleting it frees the place. Missing or unreadable, it closes account creation.
- `PULL_MINUTES`, `"30"`: how often screens pull, from 15 minutes to a day. Raising it slows every screen down without a release.

## If something goes wrong

**Never point the Worker at another database.** Every screen holds the account by its id and auth key in `bannertv-sync`. A Worker on a new or empty database answers them all `denied`, and every screen leaves the account (each keeps what it has). So never delete or rename `bannertv-sync`, never make another database for this Worker, and keep `database_name = "bannertv-sync"` in `wrangler.toml`. To see the database and its id:

```powershell
npx wrangler@4 d1 info bannertv-sync
npx wrangler@4 d1 list
```

If `d1 info` says there is no such database, stop and do not deploy: wrangler would make a new, empty one under that name. Check that `npx wrangler@4 whoami` names the right Cloudflare account first.

**The account code is lost before another screen joined**, for example because the only screen in the account was reset. The account holds the only place and nobody can reach it, so status says `"create":false` on every screen. Delete it, which frees the place:

```powershell
npx wrangler@4 d1 execute bannertv-sync --remote --command "DELETE FROM docs; DELETE FROM accounts"
```

That deletes every account and all their documents. While `MAX_ACCOUNTS` is 1 that is only the lost one; never run it once anyone else has an account. Then make the account again on the first screen, with the setup key. The same frees the place if someone else took it before the setup key was in place. Raising `MAX_ACCOUNTS` to `"2"` and deploying also lets a new account in, but keeps the lost one.

**After a database restore** with Time Travel, the service holds older versions than the screens have seen, so every screen stops syncing. Every screen must leave the account and join again. First note the code from Show account code on one screen, then on each screen choose Leave this account on this screen, then Join with an account code.

## Looking at the tables

`wrangler d1 execute` runs a query on the live database. Name the columns, and never ask for `body` or `SELECT *` from `docs`: the bodies are unreadable, but have no business in a terminal's history. For example:

```powershell
npx wrangler@4 d1 execute bannertv-sync --remote --command "SELECT created, seen, day, writes FROM accounts"
npx wrangler@4 d1 execute bannertv-sync --remote --command "SELECT COUNT(*) AS documents, SUM(LENGTH(body)) AS characters, MAX(at) AS last_write FROM docs"
```

## Capacity

The free plan allows 100,000 Worker requests a day, shared with `api` and `pair`, and 100,000 D1 rows written a day; a D1 database holds up to 500 MB. A screen on a day of use makes about 25 requests and writes about 25 rows.

## Tests

`pnpm --filter @bannertv/sync test` runs the rules and the Worker end to end against D1 stood in by Node's own SQLite (`node:sqlite`, in Node 22), so the statements, the compare and swap, the counters and the limits run on a real SQL engine, with no network. The stand-in can make each call wait, as D1 over the network does, so pushes sent at once are tested against the limits too.

# BannerTV updates

A Cloudflare Worker that sends the phone app new JavaScript over the air, so most changes reach a phone without a new APK. The phone uses Expo's own update client (expo-updates), and this Worker speaks Expo's update protocol to it ([Expo Updates protocol, version 1](https://docs.expo.dev/technical-specs/expo-updates-1/)). It is not EAS: nothing goes through Expo's servers, there is no account or user limit, and every update is code signed.

The Worker holds no key and cannot write. The **Publish phone update** workflow exports the app's JavaScript and images, signs the manifest with a private key only GitHub holds, and uploads it all to Workers KV with wrangler. The Worker serves the manifest and its signature exactly as uploaded, and the phone checks the signature against the certificate built into the app, so a phone runs only what CI signed. It keeps no logs (observability, traces and log pushes are off in `wrangler.toml`), and it never reads the per-install id expo-updates sends (`eas-client-id`).

The same Worker also serves the LG TV's updates, for the rooted test TV only: a Homebrew Channel repository ([LG TV updates through Homebrew Channel](#lg-tv-updates-through-homebrew-channel)), and signed updates the app takes by itself ([In-app updates on the LG](#in-app-updates-on-the-lg)).

| Path | What it is |
| --- | --- |
| `src/protocol.ts` | The protocol's rules: reading a request, the multipart answer, the signature header, the KV keys |
| `src/webos.ts` | The LG repository's and in-app updates' rules: their KV keys, cache headers, and reading an index or an answer for `/status` |
| `src/worker.ts` | The routes, the phone's and the LG TV's |
| `scripts/publish.mjs` | Builds and signs a phone publish or a roll back, as `wrangler kv bulk put` files (the workflow runs it) |
| `scripts/lib/update.mjs` | What it does: the manifest, hashes, signing, the history |
| `scripts/runtime-version.mjs`, `scripts/lib/runtime.mjs` | Checks the runtime version expo-updates works out before a publish uses it |
| `scripts/webos.mjs`, `scripts/lib/webos.mjs` | The LG publish's steps: the version, the checks on the .ipk, the index, the in-app update and its signature, and the `wrangler kv bulk put` files for a publish or a roll back |
| `scripts/lg-key.mjs` | Makes the LG update key pair, once, on the laptop |
| `../../.github/workflows/deploy-updates.yml` | Deploys the Worker and makes its KV namespace |
| `../../.github/workflows/publish-phone-update.yml` | Publishes to phones, or rolls back |
| `../../.github/workflows/publish-lg-update.yml` | Publishes to the LG test TV, or rolls back |

```sh
pnpm --filter @bannertv/updates test        # the Worker, the publish scripts, and the two together
pnpm --filter @bannertv/updates typecheck
```

## What a phone asks

The address is `https://updates.bannertv.workers.dev`. Phones built from main send `expo-channel-name: main`.

### `GET /expo/manifest`

The request carries `expo-protocol-version: 1`, `expo-platform` (`android` or `ios`), `expo-runtime-version` and `expo-channel-name`, and `expo-expect-signature` when the app checks signatures. The runtime version is Expo's fingerprint of the APK's native side (`apps/mobile/fingerprint.config.js`), so a phone is only ever offered JavaScript built for the native code it has.

| Status | When |
| --- | --- |
| 200 | `multipart/mixed` with one part: `manifest` (the newest update for that channel, platform and runtime version) or `directive` (`rollBackToEmbedded`, see [Roll back](#roll-back)) |
| 204 | Nothing published for that channel, platform and runtime version: the protocol's "no update", which the phone reads as "keep what you have" |
| 400 | A protocol header missing or out of form: `{"error":"<header name>"}` |
| 406 | A protocol version other than 1, or an `Accept` without `multipart/mixed` (a directive cannot be sent as plain JSON) |
| 503 | Storage not bound or failing: `{"error":"unconfigured"}` or `{"error":"storage"}` |

Every answer carries `expo-protocol-version: 1`, `expo-sfv-version: 0` and `cache-control: private, max-age=0`. A part is `content-type: application/json; charset=utf-8`, and when the request asked for a signature it carries `expo-signature: sig="<base64>", keyid="main", alg="rsa-v1_5-sha256"`, made in CI over the part's exact bytes.

When both an update and a roll back are stored, the newer one is served, as the phone itself only takes something newer than what it runs.

### `GET /expo/assets/<hash>`

A file an update names, by its SHA-256 (base64url), with its type and `cache-control: public, max-age=31536000, immutable`: its address is its hash, so it can never change. A file not there (or not there yet) is a 404 that is not cached.

### `GET /status`

`{"storage": true, "protocol": 1}`: whether the KV namespace is bound. With `?channel=main&platform=android&runtimeVersion=<rv>` it also says what that runtime version gets: `update` (`{id, createdAt}` or null), `directive` (`{type, commitTime}` or null) and `serving` (`update`, `directive` or `none`). The workflows check it after a deploy or an upload. With `?channel=main&platform=webos` it says what the LG repository offers ([below](#what-the-tv-asks)).

Everything else is a 404, a `HEAD` too. There are no write routes.

## What the store keeps

One Workers KV namespace, titled `bannertv-updates`:

- `asset:<sha256>`: each file (the Hermes bundle, images), with its content type as metadata. Written once, never changed;
- `manifest:<update id>`: each manifest, exactly as signed, with the signature as metadata. Never changed;
- `index:<channel>:<platform>:<runtime version>`: which update that runtime version gets now, `{id, createdAt}`;
- `history:<channel>:<platform>:<runtime version>`: the last 20 publishes, newest first, for rollback-previous. The newest one is also the key's metadata, so one listing of a channel's history keys says which runtime versions have publishes and when each was last published to;
- `directive:<channel>:<platform>:<runtime version>`: a signed `rollBackToEmbedded`, when one was sent.

### How a publish fits KV's free plan

Workers KV is part of the Workers Free plan ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/kv/platform/limits/)); neither page mentions a card, unlike R2.

- **Value size, 25 MiB.** The phone's bundle is about 5 MB (5,030,421 bytes at 7ad03d0) and its images about 31 KB in all. The script refuses a file over the limit.
- **Writes, 1,000 a day.** Each key written counts, in a bulk upload too. The first publish writes 31 (28 files, the manifest, the index and the history). Later ones leave out files already stored (they are looked up first), so a JavaScript change is usually 4: the bundle, the manifest, the index and the history. A roll back is 3 or 1.
- **Reads, 100,000 a day.** A phone's check costs 2 reads (index and directive), 3 when there is an update, and each file it downloads 1.
- **Lists, 1,000 a day.** A publish lists twice, a roll back once or twice.
- **Storage, 1 GB.** Each publish with a new bundle adds about 5 MB, so about 200 fit. Files are never deleted, because the protocol says a file's address must not change or disappear while a phone may still want it. When it fills up, delete by hand the files of runtime versions no phone runs any more, or move to Workers Paid.
- **Requests.** Each check is one Worker request, from the account's 100,000 a day that api, pair and sync share (ADR 0006).

Wrangler sends at most 1,000 keys in one request, and the script keeps each upload file under 50 MB, well inside the KV bulk API's 100 MB a request.

KV is eventually consistent: "Changes may take up to 60 seconds or more to be visible in other global network locations" ([how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)). So the publish workflow uploads the files and the manifest first and the index last, in two uploads, and then waits up to three minutes for `/status` to show the new update.

## Once: the signing key pair

The key pair is made once, on the laptop, by expo-updates' own command. The **certificate** (public) is committed and built into the app; the **private key** becomes a GitHub secret and is never committed.

1. In PowerShell, in the repository's `apps\mobile` folder (after the phone app has expo-updates):

   ```powershell
   npx expo-updates codesigning:generate --key-output-directory ../../../bannertv-update-keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "BannerTV"
   ```

   It writes `certs\certificate.pem` in the app, and `private-key.pem` and `public-key.pem` in a `bannertv-update-keys` folder beside the repository, outside it, so the private key cannot be committed by mistake. Both folders must be new or empty. Skip the `codesigning:configure` step it suggests: `app.config.ts` already names the certificate.

2. Add the private key as a repository secret: GitHub, the repository, Settings, Secrets and variables, Actions, New repository secret. Name `EXPO_UPDATES_PRIVATE_KEY`, value the whole of `private-key.pem`, from `-----BEGIN RSA PRIVATE KEY-----` to `-----END RSA PRIVATE KEY-----`.

3. Keep a copy of `private-key.pem` somewhere safe (a password manager), then delete the folder. Losing the key means a new pair, and a new APK on every phone, since the certificate is part of the app.

4. Commit `apps/mobile/certs/certificate.pem`. An APK built before it has updates turned off, and so does any pull request's APK (the phone-apk or full-ci label), so install one APK from a CI run started by hand on main after the certificate is there (Actions, CI, Run workflow, on main); publishes reach the phone from then on.

The certificate is valid for the years given. Phones refuse updates once it has expired, so make a new pair and APK before then. Every publish checks that the secret belongs to the committed certificate, that the certificate is for code signing and that it is in date, and stops if not.

**With no certificate committed**, the phone app is built with updates turned off (that is the app's own config), so it never asks this Worker and runs only the JavaScript inside its APK. The publish workflow also refuses to run without the certificate.

## Once: the Cloudflare token

The repository secret `CLOUDFLARE_API_TOKEN` the api Worker uses was made from the "Edit Cloudflare Workers" template, which includes "Workers KV Storage Write" ([API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/)), so it can make the namespace and upload to it as it is. A token made by hand needs Account, Workers KV Storage, Edit as well as Workers Scripts, Edit. If the token reaches more than one Cloudflare account, set the repository variable `CLOUDFLARE_ACCOUNT_ID` too.

## Deploy

Actions, **Deploy updates Worker**, Run workflow, on main. It runs the tests, finds the KV namespace `bannertv-updates` by its title (making it on the first run), binds it as `UPDATES` in that run's copy of `wrangler.toml`, deploys, and checks that `/status` says `"storage": true`.

Deploy only through the workflow. Wrangler 4 can make a KV namespace by itself for a binding without an id, but it would call it `updates-updates` and find it again only through the deployed Worker's own binding, while the publish workflows need the id for every upload. A deploy from a laptop with the committed `wrangler.toml` leaves the binding out, and phones and the TV get 503 (they keep what they have) until the workflow deploys again.

## Publish

Actions, **Publish phone update**, Run workflow, on main, action `publish`, channel `main`.

It runs the phone checks on that commit itself (typecheck, unit tests and the phone journeys on the web build), because a commit on main may never have run the journeys. Then it works out the runtime version with expo-updates' own `runtimeversion:resolve`, the same fingerprint the APK build embeds; exports the Android bundle (`expo export --platform android`, no Gradle); signs; uploads; and waits for `/status` to show the new update. The run's summary gives the update id, runtime version and commit, and the runtime version the channel's last publish went to. It takes about as long as the journeys, plus a few minutes.

The runtime version only counts when the fingerprint has every source it should: the four CI's Native side step requires (`expoConfig`, `expoAutolinkingAndroid`, `rncoreAutolinkingAndroid`, `buildTools`) and every one `apps/mobile/fingerprint.config.js` adds, read from that file. When the file throws, Expo's fingerprint quietly leaves it out, and the APK would carry the same smaller fingerprint, so a later change to only what the file adds (the images, the stream helper's Kotlin core, the build tools) would reach phones whose APK does not have it. The publish stops instead.

The workflow is four jobs, so neither secret is ever in a job that also runs code from npm. A step can read the memory of the runner it runs on, which holds the secrets its job uses, and change what later steps in that job run, so a secret kept out of one step's settings is not safe from the others. **Build** installs and runs the app's whole dependency tree and has no secret. **Read the store** and **Upload** have the Cloudflare token and run wrangler, at an exact version. **Sign** has the private key and runs nothing but GitHub's own checkout, Node and artifact actions and the scripts here, from its own checkout, with no install and no cache. The jobs pass files to each other as run artifacts kept for a day: the export, what the store holds, and the signed update. None of them holds a secret.

A phone takes the update when it next checks: expo-updates downloads it in the background and runs it on the next launch (when exactly is the app's choice, `apps/mobile`). If an update crashes before its first screen, expo-updates marks it failed and goes back to the last one that worked, by itself.

Phones get only updates for their own runtime version. After a change to the native side, publishes go to the new runtime version, which only phones with the new APK have; phones on the older APK keep their last update.

## Roll back

The same workflow, with another action:

- **`rollback-previous`** goes back to the update before the current one. It publishes that update again under a new id and time, because a phone only takes an update newer than the one it runs, and drops the bad one from the history, so running it again steps back one more (up to 20). The files are stored already, so it uploads only a manifest.
- **`rollback-to-embedded`** sends phones back to the JavaScript inside their APK, with a signed `rollBackToEmbedded` directive. The next publish (or a `rollback-previous`) undoes it, being newer.

Both are for the runtime version main builds now. For an older APK's, give its runtime version (in the summary of the run that published to it) as `runtime_version`. Phones act on a roll back when they next check, like an update.

After a change to the native side has merged, main builds a runtime version no phone has until its new APK is installed, and the bad update is on the older one. So either roll back is refused for a runtime version nothing was published to, before anything is signed: the error lists the runtime versions that do have publishes on that channel, newest first, with when each was last published to and from which commit. Run it again with the right one as `runtime_version`.

## If something goes wrong

- **The publish stops at "Check the phone app takes updates".** The certificate is not committed, or the phone app does not have expo-updates yet.
- **"does not load" or "The fingerprint has no … source" at "Runtime version".** `apps/mobile/fingerprint.config.js` throws, often after an Expo upgrade moves a package it looks up. Fix the file (run `pnpm exec fingerprint fingerprint:generate --platform android` in `apps/mobile` to try it), merge, and install an APK built after the fix before publishing: the APKs built while it threw carry the smaller fingerprint.
- **"Nothing was published to runtime version …" at "Read the store".** A roll back of a runtime version no phone has an update for, usually the one main builds after a native change. Give one of the runtime versions the error lists as `runtime_version`.
- **"Add the repository secret …".** The secret is found missing only by the job that uses it, after Build: no secret is ever in Build's job.
- **"does not belong to apps/mobile/certs/certificate.pem".** The secret is from another key pair than the committed certificate. Put the matching key in the secret; never commit a new certificate without a new APK.
- **`/status` does not show the update after three minutes.** KV may be slow to reach the runner's location; the upload itself succeeded if the Upload step did. Run the check by hand: `https://updates.bannertv.workers.dev/status?channel=main&platform=android&runtimeVersion=<rv>`.
- **A phone never takes an update.** Its runtime version differs from the one published to (a different APK), or it was built without the certificate. The summary of each publish names the runtime version.
- **KV's daily writes are used up** (1,000, reset at 00:00 UTC). Further uploads fail until then; nothing already published changes.

The fingerprint hashes what the Android build reads, but not everything CI treats as native: a pnpm patch or override for a native package, Gradle flags in `ci.yml` or the app version leave the runtime version as it was. After such a change, install the new APK before publishing, so an update cannot reach an APK whose native side differs from the one it was tested with.

## Trying it locally

`pnpm --filter @bannertv/updates test` covers the protocol, the Worker over an in-memory KV, the publish script with a throwaway key pair, and a publish, roll back and republish served end to end, and the same for the LG TV ([below](#if-an-lg-publish-goes-wrong)). To run the Worker itself, copy this folder, add `[[kv_namespaces]]` with `binding = "UPDATES"` and any 32-hex-digit `id` to the copy's `wrangler.toml`, upload the script's files (or those `scripts/webos.mjs publish` writes) with `npx wrangler@4 kv bulk put <file> --local --namespace-id <id>`, and run `npx wrangler@4 dev --local`.

## LG TV updates through Homebrew Channel

On 9 November 2026 Eyitayo chose to update the LG app over the air through [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) first, for his rooted test TV only: the LG 65NANO766QA (webOS 22, Chromium 87), where BannerTV is a Developer Mode install of `com.bannertv.app` that Homebrew Channel sees and can install over. Signed updates from inside the app followed on 11 November ([In-app updates on the LG](#in-app-updates-on-the-lg), [ADR 0001](../../docs/adr/0001-react-norigin-classic-bundle.md), decisions 10 and 11).

So the Worker also serves a Homebrew Channel repository: an index listing one package, BannerTV, at the build main last published, and that build's `.ipk` and icon. The **Publish LG update** workflow builds the app, gives the build a version of its own, and uploads it.

What Homebrew Channel does with it (0.7.3, read in its source):

- **It never looks for updates by itself.** BannerTV's page in Homebrew Channel has a button that says Update and is on whenever the version installed differs from the index's, higher or lower, and pressing it is how an update arrives. Homebrew Channel reads the index when it opens, with ordinary HTTP caching, which is why the Worker sends the index with `cache-control: no-cache`.
- **It checks only the SHA-256 we publish.** Its own service downloads the `.ipk` from the index's `ipkUrl`, works out its SHA-256 and installs it only if that is exactly the index's `ipkHash.sha256` (lower-case hex), through the TV's developer installer, over the top. Nothing is signed: whoever can write to the KV namespace, which takes the `CLOUDFLARE_API_TOKEN` secret, could put any app on the TV, and the TV trusts the index because it comes over HTTPS from this Worker. That is one reason this is for the test TV only.
- Installs over the top have kept BannerTV's data (its IndexedDB and `localStorage`) on this TV so far.

### What the TV asks

Every answer to these routes carries `access-control-allow-origin: *` (Homebrew Channel reads the index from its own web page) and `x-content-type-options: nosniff`. Only `GET` is answered, as for the phone; a `HEAD` is a 404. Nothing here reads a request header, writes or logs.

| Route | Answer |
| --- | --- |
| `GET /webos/repo.json` | The index, exactly as the workflow stored it, `application/json; charset=utf-8`, `cache-control: no-cache`. Before the first publish, `{"packages":[]}`. 503 `{"error":"unconfigured"}` or `{"error":"storage"}` when storage is not bound or failing |
| `GET /webos/ipk/<sha256>.ipk` | The `.ipk` with that SHA-256 (64 lower-case hex digits), `application/octet-stream` with its `content-length` (Homebrew Channel's progress bar reads it), `cache-control: public, max-age=31536000, immutable`: its address is its hash, so it never changes. 404 with `no-store` when it is not there (or not there yet) |
| `GET /webos/icon/<sha256>.png` | The 130 px icon, `image/png`, cached the same way |
| `GET /status?channel=main&platform=webos` | `{"storage": true, "protocol": 1, "update": {...} or null, "serving": "update" or "none"}`, where `update` is `{version, sha256, ipkSize, commit, publishedAt, restoredAt}` from the stored index |

The index has the fields of webosbrew's [PackageInfo](https://github.com/webosbrew/apps-repo/blob/main/content/schemas/api/PackageInfo.json) with the [PackageManifest](https://github.com/webosbrew/apps-repo/blob/main/content/schemas/api/PackageManifest.json) inline, every URL absolute, and a few of ours beside them, which Homebrew Channel ignores (`channel`, `commit`, `publishedAt`, `restoredAt`). BannerTV's Settings reads `manifest.version` from it to say whether an update is ready.

```json
{
  "packages": [
    {
      "id": "com.bannertv.app",
      "title": "BannerTV",
      "iconUri": "https://updates.bannertv.workers.dev/webos/icon/81a179f1….png",
      "shortDescription": "BannerTV from main: version 0.1.1, commit ed387a1, published 2026-11-09 19:37 UTC.",
      "manifest": {
        "id": "com.bannertv.app",
        "version": "0.1.1",
        "type": "web",
        "title": "BannerTV",
        "appDescription": "BannerTV from main: version 0.1.1, commit ed387a1, published 2026-11-09 19:37 UTC.",
        "iconUri": "https://updates.bannertv.workers.dev/webos/icon/81a179f1….png",
        "ipkUrl": "https://updates.bannertv.workers.dev/webos/ipk/a170c7d1….ipk",
        "ipkHash": { "sha256": "a170c7d1…" },
        "ipkSize": 1269840,
        "rootRequired": false
      },
      "channel": "main",
      "commit": "ed387a1228288492187ba32540e721775a2f3292",
      "publishedAt": "2026-11-09T19:37:53.142Z",
      "restoredAt": null
    }
  ]
}
```

Homebrew Channel shows `shortDescription` on BannerTV's page, so the TV says which build it offers before Update is pressed.

### Once, on the TV

1. Deploy the Worker with these routes: Actions, **Deploy updates Worker**, Run workflow, on main.
2. On the TV, add the repository, in either of two ways:
   - in Homebrew Channel: Settings, Repositories, Add repository, type `https://updates.bannertv.workers.dev/webos/repo.json` and confirm;
   - or in BannerTV's own Settings, with the button that opens Homebrew Channel's Add repository dialog with the address filled in (it launches `org.webosbrew.hbchannel` with `{"launchMode": "addRepository", "url": "https://updates.bannertv.workers.dev/webos/repo.json"}`); confirm it there.

Until the first publish the repository lists nothing. After it, BannerTV shows in Homebrew Channel's list, and its page says Update, since the Developer Mode install has another version.

### Publishing to the TV

Actions, **Publish LG update**, Run workflow, on main, action `publish`. A run started from another branch does nothing.

1. **Read the store** lists everything under `webos/` and reads the history, then chooses the version (below), so a version that cannot be had stops the run before anything is built.
2. **Build** stamps that version into `apps/webos/webos-meta/appinfo.json` and `apps/webos/package.json` in its own checkout and holds them to `tools/scripts/check-version.mjs`, then runs the TV app's typecheck and unit tests, builds it, runs the webOS 5.0 check (`pnpm check:bundle`), packages it (`pnpm package`, ares-package) and works out the SHA-256 of the `.ipk` and of its 130 px icon. The journeys are not run again: they ran on the pull request's full build before it merged.
3. **Sign** signs the in-app update, when the build takes them ([In-app updates on the LG](#in-app-updates-on-the-lg)), and otherwise signs nothing.
4. **Upload** reads the history again and stops if it changed since step 1. It checks the `.ipk` once more (its SHA-256 is the one Build gave, and its control file and its `appinfo.json` both say `com.bannertv.app` at this version), uploads the `.ipk` and icon, then the history, and the index last. It waits up to three minutes for `https://updates.bannertv.workers.dev/webos/repo.json` to offer the new version, then downloads the `.ipk` from it as Homebrew Channel will and checks its SHA-256.

The run's summary gives the version, commit, SHA-256 and size, and what the TV was offered before. It takes a few minutes: no journeys and no Gradle.

Then, on the TV: open Homebrew Channel (close it first if it was open, so that it reads the repository again), choose BannerTV, check that its page says the new version, and press **Update**. If it still shows the old one, KV has not reached the Worker's location yet: wait a minute and open the page again.

The secrets are kept as in the phone's workflow: **Read the store** and **Upload** have the Cloudflare token and run nothing but wrangler, at the exact version the phone's workflows use, Node, and the scripts here from their own checkout, with no install and no cache. **Build** installs and runs the app's dependency tree and has no secret. The jobs hand each other files as run artifacts kept for a day: what the store holds, and the `.ipk` with what Build says it is. None of them holds a secret.

### The version

Homebrew Channel offers Update only when the version installed differs from the index's, and webOS may refuse to put a lower version over a higher one, so every publish gets a higher version than the last. The version is in the published `.ipk` only, and never committed:

- **major.minor** are `appinfo.json`'s;
- **patch** is one above both `appinfo.json`'s patch and the highest patch any earlier publish used on that major.minor, kept in the history as `highest`.

With `0.1.0` committed, publishes go `0.1.1`, `0.1.2`, `0.1.3`…; after `appinfo.json` moves to `0.2.0`, they go `0.2.1`, `0.2.2`…. So each publish is higher than the last, a roll back never lowers `highest`, and every publish is above the committed version, which is what a Developer Mode install of a CI build has. It keeps `check-version.mjs`'s rules (major.minor.patch, minor and patch below 1000, since Android's `versionCode` is made from them). Read the store refuses, before anything is built:

- when the patch would reach 1000: raise the minor version in `appinfo.json` and `apps/webos/package.json` on main (to `0.2.0` from `0.1.x`), then publish;
- when `appinfo.json`'s major.minor is below one already published: raise it to at least that.

The app shows the stamped version in its Settings and diagnostics, and webOS reports it as the version installed.

### Rolling the TV back

The same workflow, action **`rollback-previous`**: the index points at the build before the one offered now, whose `.ipk` and icon are stored already, so nothing is built or uploaded but the history and the index. The history drops the undone build, so running it again steps back one more, as far as the history goes (20 publishes). `highest` stays, so the next publish is still above the undone build.

The TV gets the earlier build with its own, lower version. Homebrew Channel offers Update all the same, as the two differ, and its page says the build was offered again by a roll back. **Whether webOS's developer installer puts a lower version over a higher one has not been tried on the TV.** If it refuses, revert the change on main and publish instead: a publish always goes up.

### Only main's builds

Only builds of main are published, on the one channel `main`. A pull request's `.ipk` (CI's `bannertv-ipk` artifact) carries the committed version, so when a tester installs one on the TV with `ares-install`, Homebrew Channel shows Update, and pressing it puts main's last publish back over the pull request's build. To keep testing a pull request's build, leave Update alone. A pull request that raises `appinfo.json`'s version above main's last publish would make that Update a downgrade (see [Rolling the TV back](#rolling-the-tv-back)).

### What the store keeps for the TV

In the same KV namespace as the phone's updates, under `webos/`, which no phone key starts with:

- `webos/ipk/<sha256>`: each `.ipk`, as built, with `{version, commit}` as metadata. Written once, never changed;
- `webos/icon/<sha256>`: the 130 px icon (`appinfo.json`'s `largeIcon`, from `brand/webos/icon_130.png`), read out of the `.ipk` itself. Written once; a publish leaves it out when it is stored already;
- `webos/history/main`: `{"highest": "<version>", "publishes": [...]}`, the publishes still offered or gone back to, newest first, at most 20, each with its version, SHA-256s, size, title, commit and time, which is everything the index is made from;
- `webos/repo/main`: the index, exactly as served. Written last.

### How it fits KV's free plan

- **Value size, 25 MiB.** The `.ipk` is about 1.3 MB (1,269,840 bytes at ed387a1, stamped `0.1.1`), and the Worker reads it whole to send its length. The scripts refuse an `.ipk` or icon over the limit.
- **Writes, 1,000 a day,** shared with the phone. A publish writes 3 keys (the `.ipk`, the history, the index), 4 the first time (the icon); a roll back 2.
- **Reads and lists.** A run reads the history twice and lists twice. On the TV, opening Homebrew Channel reads the index once, an Update reads the `.ipk` once, and the icon is read once and then cached.
- **Storage, 1 GB,** shared with the phone. Each publish adds about 1.3 MB, and nothing is deleted. An `.ipk` no longer in the history (older than the last 20 publishes) can be deleted by hand.
- **Requests.** Each is one Worker request, from the account's 100,000 a day.

KV is eventually consistent ("up to 60 seconds or more", [how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)), so the files go up first and the index last, and the run waits up to three minutes for the Worker to offer the new build before it downloads the `.ipk`.

### If an LG publish goes wrong

- **"The next LG publish would be …, and the patch must stay below 1000".** Raise the minor version on main, as the error says.
- **"appinfo.json says …, but … was published already".** The committed version went below a publish. Raise it to the major.minor the error names.
- **"Nothing has been published", "Only … is left in the LG history", or "no longer in the store" at Read the store.** There is no earlier build to go back to. Publish a fix instead.
- **"The LG history in the store changed since Read the store read it".** Another publish or roll back ran in between, or this run's Upload was started again later. Start the workflow again; nothing was written.
- **"… is version …, not …: was the version stamped before the build?".** The `.ipk` does not carry the version chosen, so the TV would offer Update for ever. Something in the build read the version before the Stamp step.
- **The index does not offer the version after three minutes.** As for the phone: the upload succeeded if the Upload step did. Open `https://updates.bannertv.workers.dev/status?channel=main&platform=webos` by hand.
- **Homebrew Channel says "Invalid file checksum".** The `.ipk` it downloaded is not the one the index names. That should not happen, since an `.ipk`'s address is its hash; publish again.

`pnpm --filter @bannertv/updates test` covers the LG routes over an in-memory KV, reading `.ipk` files laid out as ares-package writes them, the version scheme, the scripts, and a publish, roll back and publish served end to end and installed as Homebrew Channel would (the SHA-256 checked against the index, the version read back from the `.ipk`).

## In-app updates on the LG

On 11 November 2026 Eyitayo asked for the LG app to update itself, without Update in Homebrew Channel. So the app's `index.html` runs a loader (`apps/webos/src/shell`), which starts the app's script from the `.ipk` or from a signed update it downloaded, and the **Publish LG update** workflow signs every publish as such an update, beside the `.ipk` it puts in the Homebrew Channel repository. One publish reaches the TV both ways: Homebrew Channel for a new `.ipk`, the app for its scripts.

### What an update is

The scripts of a build of main, nothing else: the app's script (`assets/index-<hash>.js`, about 1.2 MB, every image and font inlined into it), the players (`vendor/hls.min.js`, `vendor/shaka-player.dash.js`) and the sports data (`data/sports-data.js`). `index.html` carries the shell config, which names each by its SHA-256 and size; the manifest names the same.

```json
{
  "type": "bannertv-lg-update",
  "id": "7b0d0f5e-…",
  "createdAt": "2026-11-11T12:00:00.000Z",
  "channel": "main",
  "platform": "webos",
  "runtime": "webos-1-0123456789abcdef",
  "version": "0.1.12",
  "commit": "ed387a1228288492187ba32540e721775a2f3292",
  "launch": "assets/index-a1b2c3d4.js",
  "files": { "assets/index-a1b2c3d4.js": { "sha256": "…", "size": 1150895 }, "…": {} }
}
```

**The runtime version** (`webos-1-` and 16 hex digits) is a hash of everything an update cannot change: the loader, `index.html` around the config, `appinfo.json` but its version, the app's IndexedDB version and the update key. An update reaches only the `.ipk`s built with the same; any change to those needs a new `.ipk` through Homebrew Channel, and the TV keeps the last update it could take until then.

**Going back** is a signed directive instead of a manifest (`"type": "bannertv-lg-built-in"`, with `createdAt`, `channel`, `platform` and `runtime`): TVs that run an update of that runtime go back to their `.ipk`'s own code.

### What the TV asks

As for Homebrew Channel, every answer carries `access-control-allow-origin: *` (the app runs from `file://`) and `x-content-type-options: nosniff`, and the loader sends plain GETs with no header of its own, so there is no preflight.

| Route | Answer |
| --- | --- |
| `GET /webos/update?channel=main&runtime=<runtime>` | `{"manifest": "<text>", "sig": "<base64>", "keyid": "lg-<16 hex>"}` (or `"directive"` for going back), exactly as the workflow stored it, `cache-control: no-store`. 204 when nothing was published for that runtime. 400 for another channel's form or a runtime that is not `webos-<n>-<16 hex>` |
| `GET /webos/file/<sha256>` | A script, `application/octet-stream` with its length, cached for a year (`immutable`): its address is its hash. 404 with `no-store` when it is not there (yet) |
| `GET /status?channel=main&platform=webos&runtime=<runtime>` | `{"storage": true, "protocol": 1, "update": {type, id, version, commit, createdAt, keyId} or null, "serving": "update", "built-in" or "none"}` |

### What the TV does with it

- **When it asks**: a minute after the app starts (so the launch has the network to itself), then every three hours while it runs, and each time Settings opens. Never more than once a minute.
- **What it takes**: an answer whose signature verifies with the key in its own `index.html` and whose key id is that key's, for its own channel, platform and runtime, published after its `.ipk` was built and after anything it took before (by the Worker's and CI's clocks, never the TV's), and not one it put aside. It downloads only the files its `.ipk` does not have, checks each one's size and SHA-256, and keeps them in an IndexedDB database of its own (`bannertv-ota`), never the app's.
- **When it starts it**: on Settings, 2.5 seconds after saying so; after the app has been off screen for a minute; or at the next start. Never on another screen.
- **Every start**: the signature and every file's SHA-256 are checked again before anything runs. A failed check runs the `.ipk`'s code in the same start.
- **A bad update**: one whose script throws before its end, that has not drawn and settled within 30 seconds of running, or that started twice without that (the TV turned off, say), is put aside for good, and the page starts again from the `.ipk`'s code. Settings says "BannerTV 0.1.12 didn't start on this TV, so it runs the build installed here."
- **A new `.ipk`** (from Homebrew Channel or `ares-install`) drops what an earlier one stored, and runs its own code until a newer update comes.
- **Its state** (what runs, what waits, what was put aside) is in `localStorage` (`bannertv-ota:state`) with a copy in its database, which it waits for before any start again it makes: desktop Chromium has been seen to lose `localStorage` writes on `file://` across `location.reload()`, and a TV short of space may clear it.

### Once: the LG update key

Updates stay off until the key's public half is committed: with none, every build has `"updates": null` in its config and never asks.

1. On the laptop, from the repository's root: `node services/updates/scripts/lg-key.mjs`. It writes `apps/webos/certs/lg-updates.pem` (the public key, to commit) and `lg-updates-private.pem` in a `bannertv-update-keys` folder beside the repository, outside it. It refuses to write over either.
2. Add the private key as a repository secret: GitHub, the repository, Settings, Secrets and variables, Actions, New repository secret. Name `LG_UPDATES_PRIVATE_KEY`, value the whole of `lg-updates-private.pem`, from `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----`.
3. Keep a copy of the private key somewhere safe (a password manager), then delete the file. Losing it means a new pair, and a new `.ipk` on the TV, since the public key is part of the runtime version.
4. Commit `apps/webos/certs/lg-updates.pem` on main, after the secret is there: from then on every publish is signed, and Sign stops when the secret is missing or is another key's.
5. Publish, and install that build once from Homebrew Channel. Later publishes reach the TV by themselves.

### Publishing and rolling back

Nothing changes in how the workflow is run. A publish's **Build** describes the update from `apps/webos/dist` (`describe-update`: the shell config, every script checked against its file); **Sign**, the only job with `LG_UPDATES_PRIVATE_KEY`, with no install and no cache, holds the secret to the committed public key and the scripts to Build's description, and signs a manifest dated now; **Upload** checks the signature against the committed public key again, stores the scripts the store lacks, the history (each entry now names its update), the signed answer, and the index last, then waits up to three minutes for `/webos/update` to serve the answer byte for byte and each script with its SHA-256.

A **`rollback-previous`** also sends TVs back: Sign signs the build before again, with a new id and time so TVs take it, when it was an update of the same runtime whose scripts are still stored; otherwise a directive, and TVs go back to their own `.ipk`'s code. A TV that installed the undone `.ipk` itself runs it until Update is pressed in Homebrew Channel.

The run's summary has an **In-app update** line: the version, runtime and id, or why nothing was signed.

### Only main's builds

As for the phone, only a build of main on GitHub Actions asks (`apps/webos/build/shell.ts`, `GITHUB_ACTIONS` and `GITHUB_REF=refs/heads/main`): a pull request's `.ipk` (CI's artifact), the combined test build and a laptop build run their own code, and main's next publish never replaces them without a word. The LG Content Store build turns updates off with `LG_UPDATES_IN_BUILD` in `apps/webos/src/app/features.ts`. The Android TV app shows the same files and never asks.

### What the store keeps for it

- `webos/file/<sha256>`: each script, as built. Written once; a publish uploads only those not stored (about 1.2 MB a publish, the app's script; the first publish about 3 MB);
- `webos/app/main/<runtime>`: the signed answer for that runtime, exactly as served. Written after the history and before the index; a roll back writes it again.

A publish writes one more key than before (the answer) and the scripts the store lacks, usually one. Nothing is deleted: a script no longer in the history can be deleted by hand.

### If it goes wrong

- **"Add the repository secret LG_UPDATES_PRIVATE_KEY first" at Sign.** The public key is committed and the secret is not there: add it (above). Nothing was uploaded.
- **"LG_UPDATES_PRIVATE_KEY does not belong to apps/webos/certs/lg-updates.pem".** The secret is another key's. Put the right one in, or make a new pair and commit its public key (which needs a new `.ipk` on the TV).
- **"The build carries the key …, but apps/webos/certs/lg-updates.pem is …".** The build read another key than the one committed: build again.
- **"No in-app update this run" notice.** No public key is committed, or `LG_UPDATES_IN_BUILD` is off: the publish went to Homebrew Channel only.
- **The TV keeps running its own build.** On Settings, see the Updates line; `https://updates.bannertv.workers.dev/status?channel=main&platform=webos&runtime=<runtime>` says what is served for a runtime (the runtime is in the TV's `index.html`, and in the diagnostics). A TV on an `.ipk` of another runtime needs that publish's `.ipk` from Homebrew Channel once.

`pnpm --filter @bannertv/updates test` covers the routes, the describing, signing and checks, and a publish, roll back and publish served end to end and read by the TV's own reader (`apps/webos/src/shell/signed.ts`) with Web Crypto. The loader has its own unit tests (`apps/webos/src/shell`), and `apps/webos/e2e/lg-updates.spec.ts` runs the built app with a test key: an update taken on Settings and kept, one that throws put aside, one signed by another key refused.

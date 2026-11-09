# BannerTV updates

A Cloudflare Worker that sends the phone app new JavaScript over the air, so most changes reach a phone without a new APK. The phone uses Expo's own update client (expo-updates), and this Worker speaks Expo's update protocol to it ([Expo Updates protocol, version 1](https://docs.expo.dev/technical-specs/expo-updates-1/)). It is not EAS: nothing goes through Expo's servers, there is no account or user limit, and every update is code signed.

The Worker holds no key and cannot write. The **Publish phone update** workflow exports the app's JavaScript and images, signs the manifest with a private key only GitHub holds, and uploads it all to Workers KV with wrangler. The Worker serves the manifest and its signature exactly as uploaded, and the phone checks the signature against the certificate built into the app, so a phone runs only what CI signed. It keeps no logs (observability, traces and log pushes are off in `wrangler.toml`), and it never reads the per-install id expo-updates sends (`eas-client-id`).

| Path | What it is |
| --- | --- |
| `src/protocol.ts` | The protocol's rules: reading a request, the multipart answer, the signature header, the KV keys |
| `src/worker.ts` | The three routes |
| `scripts/publish.mjs` | Builds and signs a publish or a roll back, as `wrangler kv bulk put` files (the workflow runs it) |
| `scripts/lib/update.mjs` | What it does: the manifest, hashes, signing, the history |
| `scripts/runtime-version.mjs`, `scripts/lib/runtime.mjs` | Checks the runtime version expo-updates works out before a publish uses it |
| `../../.github/workflows/deploy-updates.yml` | Deploys the Worker and makes its KV namespace |
| `../../.github/workflows/publish-phone-update.yml` | Publishes, or rolls back |

```sh
pnpm --filter @bannertv/updates test        # the Worker, the publish script, and the two together
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

`{"storage": true, "protocol": 1}`: whether the KV namespace is bound. With `?channel=main&platform=android&runtimeVersion=<rv>` it also says what that runtime version gets: `update` (`{id, createdAt}` or null), `directive` (`{type, commitTime}` or null) and `serving` (`update`, `directive` or `none`). The workflows check it after a deploy or an upload.

Everything else is a 404. There are no write routes.

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

Deploy only through the workflow. Wrangler 4 can make a KV namespace by itself for a binding without an id, but it would call it `updates-updates` and find it again only through the deployed Worker's own binding, while the publish workflow needs the id for every upload. A deploy from a laptop with the committed `wrangler.toml` leaves the binding out, and phones get 503 (they keep what they have) until the workflow deploys again.

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

`pnpm --filter @bannertv/updates test` covers the protocol, the Worker over an in-memory KV, the publish script with a throwaway key pair, and a publish, roll back and republish served end to end. To run the Worker itself, copy this folder, add `[[kv_namespaces]]` with `binding = "UPDATES"` and any 32-hex-digit `id` to the copy's `wrangler.toml`, upload the script's files with `npx wrangler@4 kv bulk put <file> --local --namespace-id <id>`, and run `npx wrangler@4 dev --local`.

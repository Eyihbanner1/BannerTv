# Phone pairing relay

A Cloudflare Worker that passes something from a phone to the TV, so nobody types it with a remote: an addon address (ADR 0002, decision 15), or a viewer's SubDL key (ADR 0003, step D). Each kind has its own phone page.

1. The TV calls `POST /api/sessions` and gets a six-character code, a secret, the page address for its QR code and the session's `kind`. With no `for`, the session is an addon session, as it always was. `POST /api/sessions?for=subdl-key` opens a SubDL key session. Any other `for` gets 400 `unknown-kind`.
2. The phone opens the page in the QR code and sends what the viewer pasted to `POST /api/sessions/ABC123`.
   - An addon session's page is `/#code=ABC123`, and it sends `{ "url": … }`.
   - A key session's page is `/subdl#code=ABC123&k=…`, and it sends `{ "sealed": … }` (below).
   - A bad address gets 400 `invalid-url` or `too-long`, a bad sealed key gets `invalid-key`, and a body that is not JSON gets `invalid-url`. The Worker answers these itself, before asking the session, so they come even for a code that has run out, as before there were kinds.
   - A well-formed field sent to the other kind's session gets 400 `wrong-kind` from the session.
3. The TV calls `POST /api/sessions/ABC123/collect` every few seconds with the secret as a plain-text body. The first answer with what was sent (`url` or `sealed`) ends the session. A repeat collect gets it again for 30 seconds, in case that answer was lost, and anything sent in a session's last 30 seconds keeps it open 30 seconds more.

Each code is a Durable Object that keeps its session for ten minutes at most, then an alarm deletes it. Addresses can carry account keys, so what the phone sent stays in the object's memory only. Storage holds just the secret's hash, the expiry and the kind, since SQLite-backed storage can be restored to any point in the past 30 days. A session stored before there were kinds is an addon session. The Worker keeps no logs (observability is off in `wrangler.toml`).

## SubDL keys are sealed on the phone

For each key session the TV makes a 32-byte key, K, and puts it in the QR code after the code: `/subdl#code=ABC123&k=<K as base64url>`. A browser never sends the fragment anywhere, and the page clears it from the address bar once read. The page checks the key's shape, then seals it with AES-256-GCM:

- a random 12-byte IV and a 128-bit tag;
- additional data: the UTF-8 of `bannertv subdl-key v1 ` followed by the code, so a sealed key opens only for its own session;
- `sealed` is the IV, then the ciphertext with its tag, as base64url with no padding (48 to 208 characters for a key of 8 to 128).

The relay checks only that `sealed` is 48 to 256 base64url characters. It never sees the key or K, so it cannot read or change what it passes on. The TV opens it with the K of the session it came by, and anything that does not open is thrown away.

## Deploy

From GitHub: Actions, **Deploy pair Worker**, Run workflow, on `main`. It needs the repository secret `CLOUDFLARE_API_TOKEN` (the same one as Deploy api Worker) and, only if that token reaches more than one Cloudflare account, the repository variable `CLOUDFLARE_ACCOUNT_ID`. It runs the relay's typecheck and tests, deploys, then checks that `/subdl` answers and that a key session opens with its kind.

Or from this folder, on a machine signed in to the Cloudflare account:

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

Wrangler prints the address, `https://pair.<account subdomain>.workers.dev`; BannerTV's is `https://pair.bannertv.workers.dev`. It goes in `PAIR_SERVICE` in `apps/webos/src/data/pairing.ts`; the TV hides "Send from your phone" and addon Settings while that is empty, and the SubDL screen shows SubDL's own key page instead.

Deploy the relay before a TV build that asks for key sessions goes out. A TV that asks an older relay gets an addon session with no `kind`, and shows SubDL's own key page instead of its phone code, so either order is safe, but the phone way works only once both are out.

The free Workers plan covers a person or a household: each pairing makes one request every three seconds while its screen is open.

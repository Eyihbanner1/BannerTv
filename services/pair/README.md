# Phone pairing relay

A Cloudflare Worker that passes an addon address from a phone to the TV, so nobody types a long URL with a remote. See ADR 0002, decision 15.

1. The TV calls `POST /api/sessions` and gets a six-character code, a secret and the page address for its QR code.
2. The phone opens the page (`/#code=ABC123`), and sends the address to `POST /api/sessions/ABC123`.
3. The TV calls `POST /api/sessions/ABC123/collect` every few seconds with the secret as a plain-text body. The first answer with the address deletes the session.

Each code is a Durable Object that keeps its session for ten minutes at most, then an alarm deletes it. The Worker keeps no logs (observability is off in `wrangler.toml`), since addresses can carry account keys.

## Deploy

From this folder, on a machine signed in to the Cloudflare account:

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

Wrangler prints the address (`https://bannertv-pair.<account>.workers.dev`). Put it in `PAIR_SERVICE` in `apps/webos/src/data/pairing.ts`; the TV hides "Send from your phone" while that is empty.

The free Workers plan covers a person or a household: each pairing makes one request every three seconds while the dialog is open.

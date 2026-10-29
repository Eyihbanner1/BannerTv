# BannerTV Demo addon

A Stremio-protocol addon with three Creative Commons films from the Blender Foundation, so BannerTV has something to play from the first launch. It is a Cloudflare Worker: the films, artwork and subtitles are static assets, and the Worker answers the manifest, catalog (with search), details and stream lists. Design, sources and the full deploy steps are in [docs/DEMO_ADDON.md](../../docs/DEMO_ADDON.md).

| Path                   | What it is                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `films.json`           | The films: text, credit, licence, source addresses, artwork frames                           |
| `src/addon.ts`         | The addon's answers, built from `films.json`                                                 |
| `src/worker.ts`        | Routing, CORS and caching                                                                    |
| `scripts/render-art.mjs`    | Draws the title logos, poster shade and addon icon into `static/art` (committed)        |
| `scripts/prepare-media.mjs` | Downloads and encodes the films to HLS, writes subtitles, posters and backdrops into `public/` |
| `scripts/check-live.mjs`    | Checks the deployed addon from end to end                                               |
| `static/`              | Files copied into `public/` as they are: `_headers` and the artwork drawn above              |

`public/`, `.work/` and `review/` are built on the machine that encodes the films and are not committed.

```sh
pnpm --filter @bannertv/demo test          # routes, the app's own parser and ranker, the media scripts
pnpm --filter @bannertv/demo media         # needs ffmpeg; builds public/
pnpm --filter @bannertv/demo media --check
npx wrangler@4 deploy                      # from this folder, after asking Eyitayo
pnpm --filter @bannertv/demo check:live
```

To try it locally after `media`, run `npx wrangler@4 dev` here and add `http://127.0.0.1:8787/manifest.json` as an addon in the browser build.

# Data, privacy and the UK data disclosure (draft)

What BannerTV does with data, written once so the [privacy policy](../../site/privacy/index.html), the Seller Lounge data questions and the app all say the same thing. Keep the three in step: LG shows the Seller Lounge answers on the app's store page, and a mismatch with the app or the policy is a reason to reject.

## Data inventory

| Data | Where it goes | Who runs it | Kept | Lawful basis |
| --- | --- | --- | --- | --- |
| Settings, welcome flag, addon list (addresses can hold account keys), cached catalogues, last 8 searches, watch progress, library, profiles, PIN hash, Trakt tokens | The TV's own storage (localStorage and IndexedDB) | Nobody else | Until cleared or the app is removed | None needed: never leaves the TV. PECR "strictly necessary" for storing it |
| Catalogue, details, stream and subtitle requests: IP address, title IDs, search terms, the addon address | Straight from the TV to each addon (Cinemeta and OpenSubtitles v3 are Stremio's) | The addon's operator | Their policy | The user's own choice; never reaches the developer |
| Artwork and video requests: IP address, file asked for | Image hosts (Metahub) and stream hosts | Third parties | Their policy | As above |
| Phone relay: IP addresses of the TV and phone, the addon address, a hash of the TV's secret | `pair.bannertv.workers.dev` | The developer, on Cloudflare Workers (processor) | Address in memory only: 30 s after the TV collects it, 10 min at most. Logs off | Legitimate interests |
| Trailer: the YouTube ID | The TV's YouTube app | Google | Their policy | The user's own choice |
| Trakt (when it ships, optional): what is watched, history, lists | Straight from the TV to Trakt | Trakt | Their policy; token on the TV until unlinked | The user's own choice. If the relay ever does the token exchange, it becomes developer processing and the policy must say so |
| TMDB (when it ships): title IDs, IP address | Straight from the TV to TMDB | TMDB | Their policy | Legitimate interests (artwork) |
| Crash reports (when they ship, off by default): error, app version, TV model, webOS version, screen | Sentry, EU region (Frankfurt) | The developer, on Sentry (processor) | 90 days at most, IP address not stored | Consent (the toggle) |
| Emails: address and message | The support mailbox | The developer | Until resolved, then up to 12 months | Legitimate interests |
| Website visits: IP address | GitHub Pages | GitHub | GitHub's policy | GitHub's own |

Nothing is used for adverts, analytics, profiling or sale. There is no BannerTV account.

## Seller Lounge: UK data collection answers

Seller Lounge requires this section for any app sold in the UK ("Service Info", added in August 2024 under the UK Code of Practice for App Store Operators and App Developers). Field names below follow LG's Privacy Guideline and third-party walkthroughs; match them to the live form.

| Question | Answer |
| --- | --- |
| Privacy policy | The policy URL (see STORE.md, "Website"). It is also inside the app, on the About screen |
| Data collected within the app | Yes |
| Device identifier (including IP address) | Yes. App functionality: the phone relay sees the TV's and phone's IP addresses while passing an address on. Crash reports (opt-in) are sent from the TV's IP address, which is not stored |
| Personal information (name, email and so on) | No |
| Usage data | Yes, only if the user turns on crash reports. Purpose: app functionality (fixing crashes) |
| Content viewing information | Not collected by BannerTV. Shared with Trakt only when the user links a Trakt account (declare it as shared, if the form asks) |
| Voice | No. Voice search goes through LG's own keyboard; BannerTV only receives the text |
| Photo or video | No |
| Financial | No. Donations happen on an external page |
| Data shared with third parties | Cloudflare, Inc. (relay processor, USA); Functional Software, Inc. / Sentry (crash-report processor, data in Germany); Trakt, when the user links it. Requests to addons, TMDB and YouTube go straight from the TV to those services at the user's request |
| Where data is stored and processed | On the TV. Relay: Cloudflare's network (Cloudflare, Inc., USA), in memory only. Crash reports: Germany (Sentry EU region) |
| Requested access permissions | None (no microphone, camera or USB access) |
| Contact point | `SUPPORT_EMAIL` |
| Third-party SDKs | webOSTV.js (LG). When added: Sentry browser SDK (crash reports, opt-in), hls.js and Shaka Player (playback, no data collection). No advertising, analytics or proxy SDKs |

LG bans any SDK that uses the TV or its connection for proxy, crawling or traffic-routing services, even with consent, and suspends developer accounts over it. BannerTV must never add a "monetisation" SDK of that kind.

## What the app has to do

LG's Privacy Guideline, its self-checklist and the UK and ICO rules add these to the app. They belong to the Phase 1 to 4 threads; listed here so nothing is lost.

1. **Privacy inside the app.** An About or Privacy screen with a short summary, the policy address and a QR code to it. One-line notices where data leaves the TV: the phone QR dialog (the relay), Trakt sign-in, and the crash-report toggle.
2. **Optional means optional.** Everything works with Trakt and crash reports declined. Crash reports stay off until the user turns them on, with no nudging.
3. **Delete from the TV.** A way to clear BannerTV's data in Settings (addons, searches, progress, profiles, Trakt sign-in), since LG asks for an in-app way to delete personal data.
4. **No secrets in the package.** LG's checklist flags hard-coded passwords, tokens, keys and credentials, and file or variable names containing passwd, password, credential or token. Do not ship a Trakt client secret (have the relay do the token exchange, or confirm Trakt's device flow works without one). Keep the TMDB key restricted. Store Trakt tokens and the PIN hash encrypted.
5. **Sentry set up for privacy.** Create the Sentry organisation in the **EU region** (it can't be changed later), leave `sendDefaultPii` off, turn on "Prevent storing of IP addresses", and keep retention at 90 days or less. Never attach addon addresses.
6. **No geo-blocking.** LG tests from Korea and other non-UK addresses. The relay, the Demo addon and any server BannerTV calls must answer from anywhere, or the app fails QA.
7. **Relay logs stay off.** New Cloudflare Workers have logging on by default. `services/pair/wrangler.toml` turns observability off; keep it that way, since the policy promises no logs.
8. **TMDB rules.** Cache TMDB data for 6 months at most, don't enrich adult titles, and show the attribution in Credits.

## Children's code

The ICO's Age Appropriate Design Code covers apps and video streaming services "likely to be accessed by children", free ones included. A TV app in a family living room probably is, so the cautious course is to treat BannerTV as covered and keep a short written assessment. The draft below is for Eyitayo to check and keep on file; it is not legal advice.

| Standard | How BannerTV meets it |
| --- | --- |
| Data minimisation, default settings | No account, no profiling, no location. Optional features off by default. The adult filter on by default |
| Detrimental use, nudges | No adverts, no engagement tricks, no pressure to link Trakt or turn on crash reports |
| Profiling, geolocation | None |
| Data sharing | Only what the user starts: addons they add, Trakt if linked |
| Parental controls | Profiles with a PIN and the adult filter (Phase 3); the policy and the app explain them in plain words |
| Transparency | Plain-language policy with a short summary first; notices in the app where data leaves the TV |
| Online tools | Support email for questions, data requests and complaints |

Revisit this when profiles, Trakt or crash reports ship.

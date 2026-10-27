# Data, privacy and the UK data disclosure (draft)

What BannerTV does with data, written once so the [privacy policy](../../site/privacy/index.html), the Seller Lounge data questions and the app all say the same thing. Keep the three in step: LG shows the Seller Lounge answers on the app's store page, and a mismatch with the app or the policy is a reason to reject.

## Before each submission

The privacy policy describes BannerTV v1 as planned for the LG store, including features still being built: the BannerTV Demo addon, Trakt, TMDB, crash reports, profiles and the PIN, the adult filter, the donation QR code and clearing data in Settings. Before each store submission:

1. Check every section of the policy against the build being submitted. Remove sections for features it doesn't have, and correct any that work differently.
2. Check this file's tables against the same build, then copy the answers into Seller Lounge.
3. If the ICO fee is paid, add the registration number under "Who is responsible" in the policy.
4. Check that the About screen's privacy summary in the app still matches the policy.
5. Make any "Pending policy changes" below whose app change is in the build, and no others.
6. Run `node tools/scripts/check-site.mjs --publish`. It fails while any placeholder or HTML comment is left in `site/`, and comments are visible to anyone who views the page source, so notes for maintainers live here rather than in the pages.

## Pending policy changes

Planned app changes alter what BannerTV does with data in four places (three from the Phase 1 thread's store-readiness plan, and the Phase 4 debrid step). The policy, this file and the UX scenario describe today's behaviour and must change only when the new behaviour reaches users, never before.

| App change | When to edit | What changes |
| --- | --- | --- |
| Relay codes last 9 minutes (or 8.5; Eyitayo to decide) so nothing is held more than 10 | After the relay is deployed and checked, and at least 11 minutes later, since codes opened before the deploy keep their old expiry | Policy: "about 11 minutes" becomes "10 minutes" in the short version, the relay section and the retention table, and "Each code lasts 10 minutes" becomes 9 (or 8.5). The relay row below. UX scenario 7: the code's lifetime |
| Add an addon contacts the relay only after "Show a code" | With the first store build that has it | Policy relay section: the relay is contacted only after Show a code, or in an addon's Settings window; after an address arrives, the TV takes a new code and keeps checking until that code runs out or the window closes; typing an address on the TV never contacts the relay. The relay row and the device-identifier answer below; close item 10. UX scenario 7 step 3 |
| Removing an addon deletes its cached copies | With the build that has it | Policy: "copies BannerTV saved from it ... can stay on the TV" becomes "BannerTV deletes the copies it saved from it". The on-TV row below and item 3: cache keys start with the addon's base address; title details are keyed by title only and are cleared when an addon that provides title details is removed |
| The optional debrid account step and referral screen ([PLAN.md](../PLAN.md), "Debrid accounts and referral links") | With the first store build that has it | Policy: a debrid section (the token is stored encrypted on the TV and deleted on Unlink; the TV talks directly to the provider, which sees the TV's IP address and what is requested; the TV fetches the price file from the website, if used), and "no adverts" removed from the lead, the short version, "What I don't do" and Children. This file: an inventory row, the provider under "Data shared with third parties", and Children's code standards 1, 5, 11 and 13, with the sentence "Nothing is used for adverts, analytics, profiling or sale." reworded to say the Ad screens use no data about the user. Listing: "Free, with no adverts" and the In-app ads field. Self-check item 4 (Back leaves the ad screen). UX scenario: In-app ads and a scenario for the step |

Update the policy's "Last updated" date with each change.

## Data inventory

| Data | Where it goes | Who runs it | Kept | Lawful basis |
| --- | --- | --- | --- | --- |
| Settings, welcome flag, addon list (addresses can hold account keys), copies of catalogues and of the details of every title opened (up to 400 entries, keyed by addon address and title ID), TMDB copies, last 8 searches, watch progress, library, profiles, PIN hash, Trakt token and the Trakt history and lists | The TV's own storage (localStorage and IndexedDB) | Nobody else | Until cleared or the app is removed. Copies of a removed addon's data stay until replaced (see "What the app has to do", item 3). TMDB copies 6 months at most. Trakt data deleted on unlink | None needed: never leaves the TV. PECR "strictly necessary" for storing it |
| Catalogue, details, stream and subtitle requests, search as you type (from two letters), and a daily re-check of each addon's manifest shortly after launch: IP address, title IDs, search text, the addon address | Straight from the TV to each addon (Cinemeta and OpenSubtitles v3 are Stremio's) | The addon's operator | Their policy | The user's own choice of addon; never reaches the developer |
| BannerTV Demo addon (when it ships, preinstalled): IP address, the demo film listed or played | The Demo addon's host (planned: a Cloudflare Worker for the addon and R2 for the HLS files) | The developer, on Cloudflare (processor) | No request logs | Legitimate interests (something legal to play) |
| Missing backdrops and title logos: IP address, the IMDb ID of each title on screen | Metahub (`images.metahub.space`), filled in by BannerTV itself for titles from any addon | Stremio | Their policy | Legitimate interests (complete listings) |
| Other artwork and video requests: IP address, file asked for | Image and stream hosts the addons point to | Third parties | Their policy | The user's own choice of addon |
| Phone relay: IP address of the TV whenever the Add an addon or addon Settings window is open (it fetches a code, then checks every 3 s); the phone's IP address and the addon address if the user sends one; a hash of the TV's secret | `pair.bannertv.workers.dev` | The developer, on Cloudflare Workers (processor) | Address in memory only: 30 s after the TV collects it, and at most about 11 minutes after the code was created (an address sent in the code's last 30 s extends it by 30 s, then redelivery adds 30 s). Logs off | Legitimate interests |
| Trailer: the YouTube ID | The TV's YouTube app | Google | Their policy | The user's own choice |
| Trakt (when it ships, optional): what is watched, history, lists | Straight from the TV to Trakt | Trakt | Their policy. On the TV: token, history and lists until unlinked, then deleted | The user's own choice. If the relay ever does the token exchange, it becomes developer processing and the policy must say so |
| TMDB (when it ships): title IDs, IP address | Straight from the TV to TMDB, at BannerTV's initiative | TMDB | Their policy | Legitimate interests (artwork and details) |
| Crash reports (when they ship, off by default): error, app version, TV model, webOS version, route name only | Sentry, EU region (Frankfurt) | The developer, on Sentry (processor) | 90 days at most, IP address not stored | Consent (the toggle) |
| Emails: address and message | The support mailbox | The developer, on `EMAIL_PROVIDER` (processor) | Until resolved, then up to 12 months | Legitimate interests |
| Website visits: IP address | GitHub Pages | GitHub | GitHub's policy | GitHub's own |

Nothing is used for adverts, analytics, profiling or sale. There is no BannerTV account.

The Diagnostics and Playback lab screens in today's builds also stream test files from `raw.githubusercontent.com` and `devstreaming-cdn.apple.com`. They aren't in this inventory because they must be removed from the store build (STORE.md, "App work the store needs").

## Seller Lounge: UK data collection answers

Seller Lounge requires this section for any app sold in the UK ("Service Info", added in August 2024 under the UK Code of Practice for App Store Operators and App Developers). Field names below follow LG's Privacy Guideline and third-party walkthroughs; match them to the live form.

| Question | Answer |
| --- | --- |
| Privacy policy | The policy URL (see STORE.md, "Website"). It is also inside the app, on the About screen |
| Data collected within the app | Yes |
| Device identifier (including IP address) | Yes. App functionality: the phone relay sees the TV's IP address while the Add an addon or addon Settings window is open, and the phone's IP address when an address is sent; the Demo addon's host sees the IP address of TVs that browse or play it. Neither keeps logs. Crash reports (opt-in) are sent from the TV's IP address, which is not stored |
| Personal information (name, email and so on) | No |
| Usage data | Yes, only if the user turns on crash reports. Purpose: app functionality (fixing crashes) |
| Content viewing information | Not collected by the developer. BannerTV sends the IDs of titles on screen to Metahub and TMDB to fetch artwork and details, and the Demo addon's host serves the demo film being played without logging it. Shared with Trakt only when the user links a Trakt account (declare these as shared, if the form asks) |
| Voice | No. Voice search goes through LG's own keyboard; BannerTV only receives the text |
| Photo or video | No |
| Financial | No. Donations happen on an external page |
| Data shared with third parties | Cloudflare, Inc. (processor for the relay and the Demo addon, USA); Functional Software, Inc. / Sentry (crash-report processor, data in Germany); `EMAIL_PROVIDER` (support mailbox processor); Trakt, when the user links it. At BannerTV's initiative, Metahub (Stremio) and TMDB receive title IDs and the TV's IP address for artwork. At the user's request, the addons they add and YouTube receive requests straight from the TV |
| Where data is stored and processed | On the TV. Relay: Cloudflare's global network, usually the data centre nearest the user (Cloudflare, Inc. is a US company), in memory only. Demo addon: Cloudflare. Crash reports: Germany (Sentry EU region); Sentry keeps some account metadata about the developer, not users, in the USA |
| Requested access permissions | `application.launcher`, to open the TV's YouTube app for trailers. If kept (Eyitayo to decide, STORE.md item 5), `systemconfig.query`, to read the TV's 4K support and webOS version on the TV; nothing it reads is sent anywhere. No microphone, camera or USB access |
| Contact point | `SUPPORT_EMAIL` |
| Third-party SDKs | Bundled today, none of which collect data: React and React DOM, i18next and react-i18next, Norigin Spatial Navigation, qrcode-generator. When added: Sentry browser SDK (crash reports, opt-in), hls.js and Shaka Player (playback, no data collection). No advertising, analytics or proxy SDKs. BannerTV calls the webOS platform directly and doesn't bundle webOSTV.js |

LG bans any SDK that uses the TV or its connection for proxy, crawling or traffic-routing services, even with consent, and suspends developer accounts over it. BannerTV must never add a "monetisation" SDK of that kind.

## What the app has to do

LG's Privacy Guideline, its self-checklist and the UK and ICO rules add these to the app. They belong to the Phase 1 to 4 threads; listed here so nothing is lost.

1. **Privacy inside the app.** An About or Privacy screen with a short summary, the policy address and a QR code to it. One-line notices where data leaves the TV: the Add an addon and addon Settings windows (the relay), Trakt sign-in, and the crash-report toggle.
2. **Optional means optional.** Everything works with Trakt and crash reports declined. Crash reports stay off until the user turns them on, with no nudging.
3. **Delete from the TV.** A way to clear BannerTV's data in Settings (addons, cached copies, searches, progress, profiles, Trakt sign-in), since LG asks for an in-app way to delete personal data. Removing an addon should also delete the cached entries whose key starts with that addon's address, since those keys contain the address and any account key in it. Until it does, the policy says the copies can stay.
4. **No secrets in the package.** LG's checklist flags hard-coded passwords, tokens, keys and credentials, and file or variable names containing passwd, password, credential or token. Do not ship a Trakt client secret (have the relay do the token exchange, or confirm Trakt's device flow works without one). Keep the TMDB key restricted. Store Trakt tokens, the PIN hash and addon addresses that carry account keys encrypted, or record in self-check.md why plain storage in the app's own sandbox is acceptable.
5. **Sentry set up for privacy.** Create the Sentry organisation in the **EU region** (it can't be changed later), leave `sendDefaultPii` off, turn on "Prevent storing of IP addresses", and keep retention at 90 days or less. Turn off the fetch, XHR and console breadcrumbs, or scrub them in `beforeBreadcrumb` and `beforeSend`: addon request URLs contain addon addresses. Send the route name only, never its parameters, because routes carry title IDs and addon addresses.
6. **No geo-blocking.** LG tests from Korea and other non-UK addresses. The relay, the Demo addon and any server BannerTV calls must answer from anywhere, or the app fails QA.
7. **Server logs stay off.** New Cloudflare Workers have logging on by default. `services/pair/wrangler.toml` turns observability off; keep it that way, and do the same for the Demo addon's Worker and bucket, since the policy promises no logs.
8. **TMDB rules.** Cache TMDB data for 6 months at most, don't enrich adult titles, and show the attribution in Credits.
9. **Trakt on unlink.** Unlinking deletes the token and every piece of Trakt history and lists stored on the TV; Trakt's API Use Policy doesn't allow keeping its data after the integration ends.
10. **Relay only when needed (optional).** The TV starts pairing as soon as the Add an addon or addon Settings window opens. Starting it only when the user moves to the QR panel would keep the TV's IP address away from the relay for people who type the address; if that changes, update the relay section of the policy.

## Children's code: data protection impact assessment (draft)

The ICO's Age Appropriate Design Code covers apps and video streaming services "likely to be accessed by children", free ones included. A TV app in a family living room probably is, so the cautious course is to treat BannerTV as covered and keep a data protection impact assessment (DPIA), which standard 2 asks for. The draft below is for Eyitayo to check and keep on file; it is not legal advice.

| Standard | How BannerTV meets it |
| --- | --- |
| 1. Best interests of the child | No account, adverts, profiling or engagement tricks, so there is no commercial interest that pulls against a child's. The risk is content from addons, met by the adult filter and PIN (Phase 3) |
| 2. DPIA | This table, plus the data inventory above. Review it when profiles, Trakt, crash reports or the Demo addon ship |
| 3. Age-appropriate application | The same protections apply to everyone, so no age check is needed: nothing is collected that would need one |
| 4. Transparency | Plain-language policy with a short summary first; notices in the app where data leaves the TV |
| 5. Detrimental use | No adverts, autoplay pressure, streaks or rewards |
| 6. Policies and community standards | No user-generated content or community features. The terms say users are responsible for the addons they add |
| 7. Default settings | Optional features off by default. The adult filter on by default (Phase 3) |
| 8. Data minimisation | No account or location. The relay and Demo addon keep no logs |
| 9. Data sharing | Only what the app needs (Metahub, TMDB for artwork) or the user starts (addons they add, Trakt if linked) |
| 10. Geolocation | None |
| 11. Parental controls | Profiles with a PIN and the adult filter (Phase 3), explained in plain words in the policy and the app |
| 12. Profiling | None |
| 13. Nudge techniques | No pressure to link Trakt or turn on crash reports |
| 14. Connected toys and devices | BannerTV runs on a shared TV: nothing is collected about who is watching, and profiles stay on the TV |
| 15. Online tools | Support email for questions, data requests and complaints, which are accepted by any means |

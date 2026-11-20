# Getting BannerTV into the LG Content Store

Store prep for Phase 4, started early on 27 October 2026. Everything that doesn't need Eyitayo's own accounts is in the repo; the list below is what's left for them. The earliest realistic submission is after Phase 2 (the player) and the BannerTV Demo addon, because LG's testers must be able to play something and the screenshots must come from the submitted build.

| File | What it is |
| --- | --- |
| [`site/`](../site/) | The public website: [help and contact](../site/index.html), [privacy policy](../site/privacy/index.html), [terms of use](../site/terms/index.html). Static HTML for GitHub Pages |
| [store/listing.md](store/listing.md) | Store text, Service Info answers, images, screenshot shot list, Note for Tester |
| [store/data-safety.md](store/data-safety.md) | Data inventory, answers to Seller Lounge's mandatory UK data questions, privacy work the app needs, checks before each submission, Children's code DPIA |
| [store/self-check.md](store/self-check.md) | LG's App Self Checklist v5.0, item by item, against BannerTV |
| [store/ux-scenario.md](store/ux-scenario.md) | Draft UX scenario for LG's testers, to copy into LG's template |

## What Eyitayo needs to do

In order. None of it is urgent this week except the first two, which unblock the website.

1. **Pick a support email.** It is shown on the TV, the store page and the website, and LG and users write to it for up to a year after the last download, even after a withdrawal, so use a separate mailbox just for BannerTV rather than a personal one. Tell me the address, which company hosts the mailbox (for example Google for Gmail; the policy names it as a processor), the name to show as the person responsible (the policy needs a real name for UK GDPR), and whether the terms should name England and Wales, Scotland or Northern Ireland law.
2. **Put the website online.** See "Website" below. Free option recommended.
3. **Create the LG Account, then join Seller Lounge.** At [seller.lgappstv.com](http://seller.lgappstv.com/seller/main/Main.lge): Sign in, then Create account.
   - Country: **United Kingdom**. It can't be changed later; a wrong country means deleting the account and starting again.
   - Sign up with an email and password, not Google or Apple: the Developer Mode app on the TV only accepts an email sign-in, and the same LG Account is used for both. If the account already used for Developer Mode is set to the UK, reuse it.
   - On Seller Lounge's Additional Information page: Seller Info is the **public seller name** on the store (individual sellers sign up under their personal name); use the same name as the privacy policy. Region: **Europe**. Nickname is internal; tick 18 or older; opt in to emails so QA results and LG notices arrive. Confirm the verification email straight away.
   - It's free, needs no documents, bank or tax details for a free app, and completes the same day.
   - Don't join a "Group": app ownership moves to the group manager and can't be moved back.
4. **Ask LG the open questions** through Seller Lounge's 1:1 Q&A (the developer forum doesn't answer policy questions). Ready-to-send text is under "Questions for LG" below. While signed in, download the **LG Seller Lounge Guide** PDF (left menu, after APP MANAGEMENT), the current **self-checklist** and the **UX scenario template**, and drop them in the project's files so the drafts here can be matched to them.
5. **Check whether the ICO fee applies.** Run the ICO's self-assessment at [ico.org.uk/fee-checker](https://ico.org.uk/fee-checker). A sole developer running the relay and crash reports is probably not exempt. If it says pay: Tier 1 is £52 a year (£47 by direct debit); declare Tier 1 actively, because the ICO assumes Tier 3 (£3,763) otherwise; complete the online form before paying. The public register shows the controller's name and address, so ask the ICO about using an address other than home if that matters. Add the registration number to the privacy policy. The fee renews every year. If the checker says exempt, record that at [ico.org.uk/no-fee](https://ico.org.uk/no-fee) and keep the result.
6. **Search the name.** A free check that nobody holds "BannerTV" as a UK trade mark for software or TV services: [Search for a trade mark](https://www.gov.uk/search-for-trademark).
7. **At submission time** (after Phase 2, with my help):
   - Create the app with App ID **`com.bannertv.app`**, typed exactly. Never create it and then delete it: a deleted app's ID can't be submitted again. To try out the forms, use a throwaway ID such as `com.bannertv.sandbox`.
   - Read the Seller Agreement shown at submit and save a dated copy; its full text isn't public.
   - Book **webOS Cloud Test Lab** sessions (real TVs in Korea, open to all sellers since July 2025, up to 5 a day) on a 2020 webOS 5 TV, a webOS 6 TV and the newest model, and run the self-checklist there and on the webOS 22 TV.
   - Don't tick "release with minor defects": the seller becomes liable for resulting claims.

## Website

LG and UK law need a public privacy policy, and Seller Lounge needs a support contact. GitHub Pages can't publish from a **private** repository on GitHub Free, and BannerTv is private. Two ways:

| | Free: a separate public repo (recommended) | GitHub Pro: publish from BannerTv |
| --- | --- | --- |
| Cost | £0 | About $4 a month, for as long as the app is listed |
| Address | `https://eyihbanner1.github.io/` and `/privacy/`, `/terms/` | `https://eyihbanner1.github.io/BannerTv/` (the path is case-sensitive) |
| Setup | Create a **public** repo named exactly `eyihbanner1.github.io` on the Eyihbanner1 account. Run `node tools/scripts/check-site.mjs --publish` in BannerTv and copy the contents of `site/` into the new repo only when it passes (this route skips the `Website` workflow's check). Settings, Pages, Build and deployment, Source: **Deploy from a branch**, `main`, `/ (root)` | Upgrade the account to Pro. In BannerTv: Settings, Pages, Source: **GitHub Actions**; then Settings, Secrets and variables, Actions, Variables: add `PAGES_ENABLED` = `true`; then Actions, Website, **Run workflow** on `main` to publish the first time. After that the `Website` workflow republishes `site/` (and only `site/`) on every merge to `main` that changes it |
| Risk | None ongoing. Keep the repo public and never rename it | If Pro lapses, the policy goes offline and the LG listing points nowhere |

Either way: tick **Enforce HTTPS**, open the address in a private window, and give LG the exact address from Settings, Pages. Once the free repo exists, it can be added to this project and I'll keep it in step with `site/`. A domain bought later (for example bannertv.co.uk) can point at the same site.

`site/` still has placeholders (support email, mailbox provider, name, governing law), highlighted in yellow. The `Website` workflow refuses to publish while any are left, or while any HTML comment is left in a page, and `node tools/scripts/check-site.mjs --publish` lists them.

## How LG review works

- **Stages:** pretest (the submitted information is complete and matches the app), function test (the self-checklist, on real TVs), content test (inappropriate content, judged against the age rating), final review.
- **Time:** LG says 2 to 3 weeks on average per round; developers report 3 weeks to 3 months. Plan for at least one rejection. The app goes on sale the day of approval or the next day.
- **Rejected before testing:** missing English for an English-speaking country, a missing or incomplete self-checklist or UX scenario, an age rating above 18, an icon that breaks LG's icon guide.
- **Lock-out:** after a fifth function-test rejection in a row, or a third round rejected for the same issues as the first two, LG won't accept the app for three months. Submit only when every self-checklist item passes on a real TV.
- **Every update** needs a higher version, a fresh self-checklist (it resets) and another QA round. Changing the app's behaviour without QA can get it removed without notice. Store-text changes go through "Modifying Basic Info", which skips function testing but still needs a higher App Version.
- **After launch:** LG retests on new TV models and firmware; Stremio was delisted twice in 2025 and 2026 for bugs LG's reviewers found, then restored. Watch the Seller Lounge email and 1:1 Q&A. Withdrawing an app takes 15 days to a month and doesn't remove installed copies, and the seller must answer users for a year after the last download.

## App work the store needs

For the Phase 1 to 4 threads; the details are in [store/self-check.md](store/self-check.md) and [store/data-safety.md](store/data-safety.md).

1. **Two packages.** LG's [App resolution](https://webostv.developer.lge.com/develop/specifications/app-resolution) page says Full HD models draw apps on a 1280 x 720 plane and recommends submitting one 1920 x 1080 package and one 1280 x 720 package (`resolution` in appinfo.json). LG staff on the webOS TV developer forum add that some lower-spec UHD TVs only receive 1280 x 720 apps and that webOS doesn't resize apps (topics 26011 and 979). The Phase 1 thread recommends two packages from one build, scaled with CSS `zoom` on `<html>`, and uploading the 720p one only after it passes on a real Full HD TV or a Full HD model in the Cloud Test Lab. Without that test, submit 1920 x 1080 first and add 720p in an update, because five function-test rejections in a row lock the app out for three months. **Eyitayo to decide.**
2. **The BannerTV Demo addon.** Built in PR #8 (`docs/DEMO_ADDON.md`) and live at `https://demo.bannertv.workers.dev` since 28 October 2026; the app preinstalls it once PR #8 merges. Three all-ages films from the Blender Foundation: Big Buck Bunny (CC BY 3.0), Spring and Wing It! (CC BY 4.0). Each is adaptive HLS in five sizes from 288p, whose measured peak of 326 to 338 kbps sits well under LG's 512 kbps test in item 43, with English and Korean "Subtitle check" tracks for item 48. It is preinstalled first, ahead of Cinemeta and OpenSubtitles v3, so its films fill the hero. It runs as one Cloudflare Worker, `demo.bannertv.workers.dev`, on the same account as the relay: the films, artwork and subtitles are static files uploaded with the Worker (not R2), and the Worker answers the addon's catalogue, search, details and stream requests. Search words reach it in the request address and are used only to filter the three films. Workers logs, traces and Logpush are off. The privacy policy and data-safety.md describe exactly this; if the hosting or the logging changes, change them first. Every live check passed on 28 October, including IPv6 and Globalping probes in Seoul and Chuncheon. A Korea Telecom home probe was slow (3.3 s for a 4 s segment), so Korean traffic may be served from outside Korea on the free plan: re-check from Korea with Globalping shortly before submitting (DEMO_ADDON.md, Deploying).
3. **Privacy in the app:** About screen with the policy summary, address and QR code; one-line notices on the Add an addon and addon Settings windows (the relay), Trakt sign-in and the crash-report toggle; a "clear BannerTV's data" option; removing an addon also deletes its cached copies; Trakt data deleted on unlink; Sentry in the EU region with IP addresses not stored and request breadcrumbs off. Details in data-safety.md, "What the app has to do".
4. **No secrets in the .ipk.** No Trakt client secret; nothing named like a password or token.
5. **No developer screens in the store build.** Remove the Diagnostics and Playback lab screens from Settings and their test streams (the Phase 1 thread plans a separate "BannerTV Dev" app for them). In `requiredACG`, add `application.launcher`, which the Trailer button needs (webOS 26 enforces the list; webOS 22 doesn't, so the dev TV can't show the bug). `systemconfig.query` is used by the Phase 2 player to read the TV's 4K support and webOS version; the Phase 1 thread recommends keeping it. **Eyitayo to decide**, then update the permissions answer in data-safety.md. Keep the `requiredACG` field itself: Seller Lounge rejects apps without it from webOS 27.
6. **Player rules:** the video at 0,0 and 1920 x 1080 with no transform (or the screensaver starts; consider `screenSaverProperties.preferredType: 2` for the controls overlay); all transport keys; subtitle settings that apply; resume; pause and save on Home, power-off and mains unplug.
7. **Keep what's built:** Back stack ending in `webOS.platformBack()`, no Exit button, pointer and 5-way on every control, loading cues and Try again instead of blank screens, relative asset paths (absolute `/media/developer/` paths work in Developer Mode and break after store release).
8. **Back on webOS 23 to 25.** LG's mandatory UX list says Back on the first screen shows the Home screen on webOS 23 to 25, while `webOS.platformBack()` shows an exit prompt on webOS 6 and newer, and nothing public says what it does on 23 to 25. The Phase 1 thread plans to measure it in the Cloud Test Lab with a dev-build switch (`platformBack`, `window.close` or pass-through) before changing anything, and to ask LG (question 8 below).
9. **About screen credits:** Demo film credits, Urbanist licence, TMDB and Trakt notices, the donation QR labelled as optional.

## Age rating

LG rejects ratings above 18, and an app with any adult content must declare "Content rating: Yes" and name a PIN or card check that matches the self-checklist. Stremio's LG listing is rated 16+.

Recommendation: **App rating 16+** (or the nearest below 18 that Seller Lounge offers for the UK). For content rating, BannerTV itself shows no adult content, the adult-addon filter planned for Phase 3 will be on by default, and user-added addons are outside the tested build; declare **No** unless LG says otherwise in 1:1 Q&A. Once the Phase 3 profile PIN guards turning the filter off, switch to **Yes, PIN code** if LG prefers that.

## Donations

LG retired its own billing and has no published rule on donation links. Its UX scenario template counts "any related payment process outside the app" as Paid Content, which could read onto a donation QR. Keep the QR on the About screen only, label it "optional, unlocks nothing", mention it in the Note for Tester, and ask LG first (question 2 below). If LG says no, drop it from the app and keep the donation link on the website.

## Questions for LG

To send through Seller Lounge, 1:1 Q&A, Applications, App Submission, once registered:

> Hello. I'm preparing my first app, BannerTV (App ID com.bannertv.app), a free media player for webOS 5.0 and later, for the United Kingdom only. It plays content from addons that use the open Stremio addon protocol, which users add themselves by address. The app hosts no content apart from a demo addon of three Creative Commons films from the Blender Foundation, which I host so the app can be tested. It also comes with a metadata addon (Cinemeta) and a subtitles addon (OpenSubtitles v3). I have a few questions before submitting:
>
> 1. Is this kind of app acceptable on LG Apps, and are there content rules for it beyond the self-checklist?
> 2. The About screen will show a QR code to an optional external donation page (Ko-fi or GitHub Sponsors) that unlocks nothing in the app. Is that allowed, and should Billing / Paid Content be "Not applicable"?
> 3. Which App Rating and Content Rating options apply in the United Kingdom, and should an app like this declare Content Rating "Yes" with PIN protection? I plan to hide addons marked as adult by default, with a PIN to show them.
> 4. Which Category fits a media player?
> 5. Should I submit two packages (1920x1080 and 1280x720), and which Service Platform / SDK version option means "2020 (webOS 5.0) and later"? Are both files uploaded under one app and version, and does QA test each one on matching TVs? Which lower-spec UHD models receive only 1280x720 apps, and does that include 2020 webOS 5 entry-level models?
> 6. Is the privacy policy URL entered only in the UK data collection section, or also elsewhere?
> 7. Is there a maximum IPK file size?
> 8. The mandatory UX item says Back on the entry page must display the Home screen on webOS 23 to 25. My app calls webOS.platformBack() there, which shows the exit popup on webOS 6 and newer.
>    - (a) Does platformBack() meet the item on webOS 23 to 25, even when it shows the popup first?
>    - (b) If not, what should the app call on those versions: window.close() or something else?
>    - (c) Should webOS 26 keep the popup?
>    - (d) Is it acceptable for the first Back press on the entry page to return focus to the top, and the next to show Home?
>    - (e) Does the item also apply to a first-run welcome screen?
> 9. Which ACG group covers com.webos.service.config/getConfigs? The bundled Shaka Player calls it, and it isn't in the ACG table.
> 10. My code has no credentials, but bundled libraries use standard property names that match the credential rules (the Fetch API's `credentials` option, `password` input types in React, Shaka Player's token settings). Are these acceptable if I explain them in the self-checklist?
> 11. In a later update I'd like to add an optional section in Settings for linking an account with a debrid service. A debrid service is a paid cloud service that downloads files from file hosts and peer-to-peer networks to its own servers and streams them to the user over HTTPS. Examples are TorBox and Premiumize, whose terms forbid using them for infringing content. Some addons can use such an account. The section would only be in Settings, never shown on first launch or in a kids profile.
>    - Linking: the TV shows a code, the user approves it on their phone, and BannerTV then shows the account's plan and expiry date. In this version BannerTV does nothing else with the account.
>    - Sign-up: for people without an account, a screen labelled "Ad" would show the service's name, who sells it, and a QR code to its sign-up page through my referral link. I would receive free premium days (or a payment, if a service offers one) when someone signs up. Back always leaves the screen, nothing in the app needs an account, and no stream addons are promoted.
>    - (a) Is the linking section acceptable in the LG Content Store?
>    - (b) Is the sign-up screen with the referral QR code acceptable? Is there a rule on QR codes that lead to purchases outside the app?
>    - (c) Should the sign-up screen be declared as In-App Ad or Paid Content in Seller Lounge, what should the UX scenario show, and does the self-checklist's Advertisement item apply to it?
>
> Thank you.

Question 11 is about the optional debrid step in [PLAN.md](PLAN.md) ("Debrid accounts and referral links"). That step isn't in the first submission, but asking now means the answer is ready for the later update. Leave it out if the step is dropped. When crash reports are built, ask a twelfth: does `webOSSystem.deviceInfo.modelName` fall under the same user agreement as `getSystemInfo`'s `modelName`, and is sending it after an explicit crash-report opt-in acceptable?

## Not known yet

- Exact character limits, screenshot sizes, the category list and the UK age-rating options: Seller Lounge's pages can't be read without signing in, so the figures here come from third-party submission guides that agree with each other. Check them in the form and the Seller Lounge Guide.
- The Seller Lounge terms (revised July 2025) and the Seller Agreement: not public; read at sign-up and at submit.
- Whether TMDB treats a free app with a donation link as commercial use. Email TMDB before turning on TMDB enrichment.
- Whether a store update wipes the app's storage. LG's FAQ and a 2024 forum reply say packaged-app storage is deleted on update or removal (not checked). Test it by installing a new version over an old one; if it's true, the policy's "until you clear it or remove BannerTV" needs to mention updates.
- To check once signed in to Seller Lounge: the full QA checklist ZIP for the exact wording of item 37; whether the Seller Lounge FAQ covers resolution; whether the Cloud Test Lab has Full HD models, accepts a developer build and supports a long press of Back; whether Seller Lounge can exclude webOS 4.

## Sources

LG: [App approval process](https://webostv.developer.lge.com/distribute/app-approval-process), [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist), [App ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem), [Privacy guideline](https://webostv.developer.lge.com/develop/guides/privacy-guideline), [App resources](https://webostv.developer.lge.com/develop/getting-started/app-resources), [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json), [App resolution](https://webostv.developer.lge.com/develop/specifications/app-resolution), [Icon guide](https://webostv.developer.lge.com/develop/guides/icon), [Back button](https://webostv.developer.lge.com/develop/guides/back-button), [Screensaver](https://webostv.developer.lge.com/develop/guides/screensaver), [In-app purchase](https://webostv.developer.lge.com/develop/guides/in-app-purchase), Seller Lounge [user guide](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge), [FAQ](https://seller.lgappstv.com/seller/support/faq/RetrieveFaq.lge) and [self-check sample](https://seller.lgappstv.com/seller/support/RetrieveSelfCheckSample.lge).

Submission guides: [Brightcove](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html), [Red Bee](https://redbee.live/docs/White%20Label%20Apps/Publish/lg), [EaselTV](https://docs.easeltv.com/docs/lg-tv-submission), [OTTEngine](https://www.ottengine.com/blog/lg-seller-lounge-explained).

Precedent: [Stremio on LG](https://blog.stremio.com/stremio-for-lg-tv-is-back-2020-models-including-2026-models/), [UK LG Content Store](https://gb.lgappstv.com/main).

GitHub Pages: [Creating a site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [Custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

UK privacy: [ICO, what privacy information to provide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/), [ICO data protection fee](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/), [complaints duty, DUAA s.103](https://www.legislation.gov.uk/ukpga/2025/18/section/103), [Children's code scope](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/services-covered-by-this-code/), [UK app store Code of Practice](https://www.gov.uk/government/publications/code-of-practice-for-app-store-operators-and-app-developers/code-of-practice-for-app-store-operators-and-app-developers-new-updated-version), [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Sentry data location](https://docs.sentry.io/organization/data-storage-location/), [Trakt API use policy](https://developer.trakt.tv/docs/api-use-policy), [TMDB API terms](https://www.themoviedb.org/api-terms-of-use).

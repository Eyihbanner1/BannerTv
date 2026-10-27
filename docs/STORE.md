# Getting BannerTV into the LG Content Store

Store prep for Phase 4, started early on 27 October 2026. Everything that doesn't need Eyitayo's own accounts is in the repo; the list below is what's left for them. The earliest realistic submission is after Phase 2 (the player) and the BannerTV Demo addon, because LG's testers must be able to play something and the screenshots must come from the submitted build.

| File | What it is |
| --- | --- |
| [`site/`](../site/) | The public website: [help and contact](../site/index.html), [privacy policy](../site/privacy/index.html), [terms of use](../site/terms/index.html). Static HTML for GitHub Pages |
| [store/listing.md](store/listing.md) | Store text, Service Info answers, images, screenshot shot list, Note for Tester |
| [store/data-safety.md](store/data-safety.md) | Data inventory, answers to Seller Lounge's mandatory UK data questions, privacy work the app needs, Children's code notes |
| [store/self-check.md](store/self-check.md) | LG's App Self Checklist v5.0, item by item, against BannerTV |
| [store/ux-scenario.md](store/ux-scenario.md) | Draft UX scenario for LG's testers, to copy into LG's template |

## What Eyitayo needs to do

In order. None of it is urgent this week except the first two, which unblock the website.

1. **Pick a support email.** It is shown on the TV, the store page and the website, and LG and users write to it for at least a year after any withdrawal, so use a separate mailbox just for BannerTV rather than a personal one. Tell me the address and the name to show as the person responsible (the policy needs a real name for UK GDPR), and whether the terms should name England and Wales, Scotland or Northern Ireland law.
2. **Put the website online.** See "Website" below. Free option recommended.
3. **Create the LG Account, then join Seller Lounge.** At [seller.lgappstv.com](http://seller.lgappstv.com/seller/main/Main.lge): Sign in, then Create account.
   - Country: **United Kingdom**. It can't be changed later; a wrong country means deleting the account and starting again.
   - Sign up with an email and password, not Google or Apple: the Developer Mode app on the TV only accepts an email sign-in, and the same LG Account is used for both. If the account already used for Developer Mode is set to the UK, reuse it.
   - On Seller Lounge's Additional Information page: Seller Info is the **public seller name** on the store (individual sellers sign up under their personal name); Nickname is internal; tick 18 or older; opt in to emails so QA results and LG notices arrive. Confirm the verification email straight away.
   - It's free, needs no documents, bank or tax details for a free app, and completes the same day.
   - Don't join a "Group": app ownership moves to the group manager and can't be moved back.
4. **Ask LG the open questions** through Seller Lounge's 1:1 Q&A (the developer forum doesn't answer policy questions). Ready-to-send text is under "Questions for LG" below. While signed in, download the **LG Seller Lounge Guide** PDF (left menu, after APP MANAGEMENT), the current **self-checklist** and the **UX scenario template**, and drop them in the project's files so the drafts here can be matched to them.
5. **Check whether the ICO fee applies.** Run the ICO's self-assessment at [ico.org.uk/fee-checker](https://ico.org.uk/fee-checker). A sole developer running the relay and crash reports is probably not exempt. If it says pay: Tier 1 is £52 a year (£47 by direct debit); declare Tier 1 actively, because the ICO assumes Tier 3 (£3,763) otherwise; complete the online form before paying. The public register shows the controller's name and address, so ask the ICO about using an address other than home if that matters. Add the registration number to the privacy policy.
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
| Setup | Create a **public** repo named exactly `eyihbanner1.github.io` on the Eyihbanner1 account. Copy the contents of `site/` into it. Settings, Pages, Build and deployment, Source: **Deploy from a branch**, `main`, `/ (root)` | Upgrade the account to Pro. In BannerTv: Settings, Pages, Source: **GitHub Actions**; then Settings, Secrets and variables, Actions, Variables: add `PAGES_ENABLED` = `true`. The `Website` workflow publishes `site/` (and only `site/`) on every merge |
| Risk | None ongoing. Keep the repo public and never rename it | If Pro lapses, the policy goes offline and the LG listing points nowhere |

Either way: tick **Enforce HTTPS**, open the address in a private window, and give LG the exact address from Settings, Pages. Once the free repo exists, it can be added to this project and I'll keep it in step with `site/`. A domain bought later (for example bannertv.co.uk) can point at the same site.

`site/` still has placeholders (support email, name, governing law), highlighted in yellow. The `Website` workflow refuses to publish while any are left, and `node tools/scripts/check-site.mjs --publish` shows them.

## How LG review works

- **Stages:** pretest (the submitted information is complete and matches the app), function test (the self-checklist, on real TVs), content test (inappropriate content, judged against the age rating), final review.
- **Time:** LG says 2 to 3 weeks on average per round; developers report 3 weeks to 3 months. Plan for at least one rejection. The app goes on sale the day of approval or the next day.
- **Rejected before testing:** missing English for an English-speaking country, a missing or incomplete self-checklist or UX scenario, an age rating above 18, an icon that breaks LG's icon guide.
- **Lock-out:** after a fifth function-test rejection in a row, or a third round rejected for the same issues as the first two, LG won't accept the app for three months. Submit only when every self-checklist item passes on a real TV.
- **Every update** needs a higher version, a fresh self-checklist (it resets) and another QA round. Changing the app's behaviour without QA can get it removed without notice. Store-text changes go through "Modifying Basic Info", which skips function testing.
- **After launch:** LG retests on new TV models and firmware; Stremio was delisted twice in 2025 and 2026 for bugs LG's reviewers found, then restored. Watch the Seller Lounge email and 1:1 Q&A. Withdrawing an app takes 15 days to a month and doesn't remove installed copies, and the seller must answer users for a year after the last download.

## App work the store needs

For the Phase 1 to 4 threads; the details are in [store/self-check.md](store/self-check.md) and [store/data-safety.md](store/data-safety.md).

1. **Two packages.** LG's FAQ says Full HD TVs only run 1280 x 720 web apps, and some lower-spec UHD TVs only get 720p apps; it recommends submitting one package at 1920 x 1080 and one at 1280 x 720 (`resolution` in appinfo.json, with fixed-pixel root containers). Decide in Phase 2 whether to build a 720p variant; it may matter for the 2020 floor TV.
2. **The BannerTV Demo addon.** All-ages Blender open movies (CC BY), served as adaptive HLS with a rung well under 512 kbps (LG throttles to 512 kbps in item 43), from a host reachable over IPv6 and from Korea. Preinstalled in the store build.
3. **Privacy in the app:** About screen with the policy summary, address and QR code; one-line notices on the phone QR dialog, Trakt sign-in and the crash-report toggle; a "clear BannerTV's data" option; Sentry in the EU region with IP addresses not stored.
4. **No secrets in the .ipk.** No Trakt client secret; nothing named like a password or token.
5. **Player rules:** the video at 0,0 and 1920 x 1080 with no transform (or the screensaver starts; consider `screenSaverProperties.preferredType: 2` for the controls overlay); all transport keys; subtitle settings that apply; resume; pause and save on Home, power-off and mains unplug.
6. **Keep what's built:** Back stack ending in `webOS.platformBack()`, no Exit button, pointer and 5-way on every control, loading cues and Try again instead of blank screens, relative asset paths (absolute `/media/developer/` paths work in Developer Mode and break after store release).
7. **About screen credits:** Demo film credits, Urbanist licence, TMDB and Trakt notices, the donation QR labelled as optional.

## Age rating

LG rejects ratings above 18, and an app with any adult content must declare "Content rating: Yes" and name a PIN or card check that matches the self-checklist. Stremio's LG listing is rated 16+.

Recommendation: **App rating 16+** (or the nearest below 18 that Seller Lounge offers for the UK). For content rating, BannerTV itself shows no adult content, its filter is on by default, and user-added addons are outside the tested build; declare **No** unless LG says otherwise in 1:1 Q&A. Once the Phase 3 profile PIN guards turning the filter off, switch to **Yes, PIN code** if LG prefers that.

## Donations

LG retired its own billing and has no published rule on donation links. Its UX scenario template counts "any related payment process outside the app" as Paid Content, which could read onto a donation QR. Keep the QR on the About screen only, label it "optional, unlocks nothing", mention it in the Note for Tester, and ask LG first (question 2 below). If LG says no, drop it from the app and keep the donation link on the website.

## Questions for LG

To send through Seller Lounge, 1:1 Q&A, Applications, App Submission, once registered:

> Hello. I'm preparing my first app, BannerTV (App ID com.bannertv.app), a free media player for webOS 5.0 and later, for the United Kingdom only. It plays content from addons that use the open Stremio addon protocol, which users add themselves by address. The app hosts no content; it comes with a metadata addon (Cinemeta) and a demo addon of Creative Commons films so it can be tested, and an adult-content filter that is on by default. I have a few questions before submitting:
>
> 1. Is this kind of app acceptable on LG Apps, and are there content rules for it beyond the self-checklist?
> 2. The About screen will show a QR code to an optional external donation page (Ko-fi or GitHub Sponsors) that unlocks nothing in the app. Is that allowed, and should Billing / Paid Content be "Not applicable"?
> 3. Which App Rating and Content Rating options apply in the United Kingdom, and should an app like this declare Content Rating "Yes" with PIN protection?
> 4. Which Category fits a media player?
> 5. Should I submit two packages (1920x1080 and 1280x720), and which Service Platform / SDK version option means "2020 (webOS 5.0) and later"?
> 6. Is the privacy policy URL entered only in the UK data collection section, or also elsewhere?
> 7. Is there a maximum IPK file size?
>
> Thank you.

## Not known yet

- Exact character limits, screenshot sizes, the category list and the UK age-rating options: Seller Lounge's pages can't be read without signing in, so the figures here come from third-party submission guides that agree with each other. Check them in the form and the Seller Lounge Guide.
- The Seller Lounge terms (revised July 2025) and the Seller Agreement: not public; read at sign-up and at submit.
- Whether TMDB treats a free app with a donation link as commercial use. Email TMDB before turning on TMDB enrichment.

## Sources

LG: [App approval process](https://webostv.developer.lge.com/distribute/app-approval-process), [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist), [App ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem), [Privacy guideline](https://webostv.developer.lge.com/develop/guides/privacy-guideline), [App resources](https://webostv.developer.lge.com/develop/getting-started/app-resources), [appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json), [App resolution](https://webostv.developer.lge.com/develop/specifications/app-resolution), [Icon guide](https://webostv.developer.lge.com/develop/guides/icon), [Back button](https://webostv.developer.lge.com/develop/guides/back-button), [Screensaver](https://webostv.developer.lge.com/develop/guides/screensaver), [In-app purchase](https://webostv.developer.lge.com/develop/guides/in-app-purchase), Seller Lounge [user guide](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge), [FAQ](https://seller.lgappstv.com/seller/support/faq/RetrieveFaq.lge) and [self-check sample](https://seller.lgappstv.com/seller/support/RetrieveSelfCheckSample.lge).

Submission guides: [Brightcove](https://beacon-help.support.brightcove.com/publishing-apps/lg/submitting-to-lg.html), [Red Bee](https://redbee.live/docs/White%20Label%20Apps/Publish/lg), [EaselTV](https://docs.easeltv.com/docs/lg-tv-submission), [OTTEngine](https://www.ottengine.com/blog/lg-seller-lounge-explained).

Precedent: [Stremio on LG](https://blog.stremio.com/stremio-for-lg-tv-is-back-2020-models-including-2026-models/), [UK LG Content Store](https://gb.lgappstv.com/main).

GitHub Pages: [Creating a site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [Custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

UK privacy: [ICO, what privacy information to provide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/), [ICO data protection fee](https://ico.org.uk/for-organisations/data-protection-fee/data-protection-fee/), [complaints duty, DUAA s.103](https://www.legislation.gov.uk/ukpga/2025/18/section/103), [Children's code scope](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/services-covered-by-this-code/), [UK app store Code of Practice](https://www.gov.uk/government/publications/code-of-practice-for-app-store-operators-and-app-developers/code-of-practice-for-app-store-operators-and-app-developers-new-updated-version), [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Sentry data location](https://docs.sentry.io/organization/data-storage-location/), [Trakt API use policy](https://developer.trakt.tv/docs/api-use-policy), [TMDB API terms](https://www.themoviedb.org/api-terms-of-use).

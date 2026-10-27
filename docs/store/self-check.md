# LG App Self Checklist: where BannerTV stands (draft)

LG builds the self-checklist from the tests its QA team runs, so this is BannerTV's QA test plan. Every item must be marked Pass or N/A with real results from a TV before submitting; a wrong Pass or N/A is a reason to reject, and the checklist resets every time the version goes up. Item numbers and wording follow checklist **v5.0 (27 September 2022)**, the latest Seller Lounge showed on 27 October 2026. Download a fresh copy on submission day and redo this table if the version has changed.

Status: **Built** means the feature exists on a branch and still needs testing on the TV for the checklist; **Phase N** means it arrives with that phase; **N/A** is the answer to give LG.

## Execution and display (1 to 9)

| # | Item | What LG checks | BannerTV |
| --- | --- | --- | --- |
| 1 | Execution | The app runs when launched | Built |
| 2 | Main page | Main, intro and loading screens are right; buttons, text and logos inside the overscan frame; matches the submitted screenshots, splash and UX scenario | Built. 5% safe area in the design system. Screenshots must come from the submitted build |
| 3 | Reboot | Relaunch from the Launcher, Search and Recent list; power off and on with the remote during playback; pull the mains plug during playback | Phase 2 for the playback cases. Relaunch is handled (`handlesRelaunch`) |
| 4 | Advertisement | Back returns from an advert | N/A, no adverts |
| 5 | Resolution | 1920 x 1080 recommended, 16:9 | Built (1920 x 1080). See "Two packages" in STORE.md |
| 6 | Correct text | No typos or broken text; long text rolls or ends in an ellipsis; long lists scroll | Built. Test long titles |
| 7 | Mouse over and focus | Idle, focused and selected states are distinct | Built (focus ring and scale) |
| 8 | Flickering | None when entering or playing content | Phase 2 for playback |
| 9 | Full size | Video fills the screen unless the source is 4:3 | Phase 2. The video must sit at 0,0 at 1920 x 1080 with no transform, border or opacity, or the screensaver can start |

## Functions (10 to 25)

| # | Item | What LG checks | BannerTV |
| --- | --- | --- | --- |
| 10 | UI buttons | Every button does what the UX scenario says | Built; the UX scenario must list them |
| 11 | Back UI button | If there is one, it acts like the remote's Back | N/A unless a Back button is added |
| 12 | Exit UI button | Optional; if present it closes the app | N/A. Don't add one: LG's lifecycle guide says apps shouldn't have their own close button |
| 13 | Lock-up | The app never freezes | Test throughout |
| 14 | Abnormal end | Network loss on wired and wireless, static and dynamic IP | Built for browsing (row errors with Try again). Phase 2 for playback |
| 15 to 17 | Keyboard | Letters and numbers, upper and lower case, the caret buttons (< and >), the backslash, Voice Search on the LG keyboard | Built (system keyboard). Test the caret buttons: custom spatial navigation that holds on to arrow keys while a text box has focus is a known rejection |
| 18 | Terms | Agree goes on, Disagree goes back | N/A while the welcome is a notice with no Agree button. If an Agree step is ever added, Disagree must go back cleanly |
| 19 | Sign up | | N/A, no BannerTV account |
| 20 | Sign in | Sign-in works and "stay signed in" survives a relaunch and a TV reboot | Phase 3 (Trakt). N/A before then. Give LG a Trakt test account |
| 21 | Sign out | | Phase 3 (Trakt unlink) |
| 22 | Search | Unclear terms, terms in an unsupported language, partial words | Built. Test junk input and non-Latin text |
| 23 | Adult authentication | A PIN, parental lock or card check guards adult content, described in the comments and the UX scenario. Pornography is never allowed | Depends on the content rating; see STORE.md, "Age rating". Phase 3 PIN |
| 24 and 25 | Payment | | N/A, no payments (confirm with LG; see STORE.md, "Donations") |

## Remote control (26 to 40)

| # | Item | What LG checks | BannerTV |
| --- | --- | --- | --- |
| 26 to 30 | Magic Remote and pointer | Magic Remote support is required; the pointer follows motion; hover plus OK works on every control; the wheel scrolls lists in the wheel's direction | Built (pointer hover, click, row paging arrows). Check every new control, including the PIN pad and player |
| 31 | Navigation keys | Arrows work everywhere | Built |
| 32 | Colour keys | Work where mapped | Test once colour-key shortcuts exist; each must also be a visible button |
| 33 | OK key | | Built |
| 36 | Home | The webOS launcher appears | Platform behaviour; check playback pauses and progress saves |
| 37 | Back | Goes to the previous screen; on the first screen, back to where the user entered the app | Built: Back stack, then `webOS.platformBack()` on Home, which goes to the launcher on webOS 5 and shows an exit prompt on webOS 6 to 22 (measured on webOS 22 in Phase 0). Untested on webOS 23 and newer, where the mandatory UX line below asks for the Home screen. Test on webOS 5, 6 and 23 or newer in the Cloud Test Lab |
| 38 | Exit key | Closes the app | Platform behaviour; test |
| 39 and 40 | Live and other keys | Number and unsupported keys don't break anything | Test every key on both remotes |

Items 34 and 35 weren't captured in the research; read them in the form.

## Playback and the rest (41 to 53)

| # | Item | What LG checks | BannerTV |
| --- | --- | --- | --- |
| 41 | Change language | Only if the app has a language setting | N/A in v1 (English only) |
| 42 | Sound | | Phase 2 |
| 43 | Play contents | Playback throttled to 512 kbps, 1 Mbps, 7 Mbps and 17.5 Mbps, twice each, plus an IPv6 network; quality adapts and buffering isn't constant | Phase 2. The Demo addon needs adaptive HLS with a rung well under 512 kbps, on a host reachable over IPv6 |
| 44 | Full and original screen | Switching works, if offered | N/A unless a zoom option is added |
| 45 | Playback controls | Play, Pause, Stop, Fast forward, Rewind, Seek, Previous, Next by arrows and pointer; remote media keys do the same as the buttons; sound in sync | Phase 2 |
| 46 | Replay | Playing again after the end | Phase 2 |
| 47 | Real-time streaming | Live streams start without delay | N/A unless live addon streams are offered for testing |
| 48 | Subtitles | Shown, and subtitle settings (colour, size) apply | Phase 2 |
| 49 | Resume | Resume from history | Phase 2 (the `mediaOption` start position works on webOS 22) |
| 50 | SD to UHD | Each resolution plays | Phase 2, with the Demo addon's renditions |
| 51 | Codecs | Every codec the app claims | Phase 2. Declare only what the Demo addon has (H.264 and AAC) in Test Info |
| 52 | DRM | For paid content | N/A, no DRM |
| 53 | Factory reset | After a TV reset, the app installs, runs and plays | Test once before submitting |

## Also on LG's checklist page

- **Mandatory UX:** arrows, OK and Back reach everything; the pointer and OK reach everything; Back on the entry page shows the Home screen on webOS 23 to 25; every object has a selection effect. Built, except Back on webOS 23 to 25, which is **untested**: BannerTV calls `webOS.platformBack()`, which shows an exit prompt on webOS 6 and newer, and this line asks for Home. LG's pages disagree, so check it in the Cloud Test Lab and ask LG (STORE.md, question 8).
- **Recommended:** buttons at least 75 x 75 px and text at least 20 px at 1920 x 1080 (BannerTV's smallest is 22 px, on the Addons screen's phone help), a loading cue rather than a black screen, the LG keyboard, an on-screen playback menu.
- **Credentials:** no passwords, tokens, keys or credentials in the code or in file names. Addon addresses can carry a user's account key and sit in the app's IndexedDB; encrypt them with the Trakt token and PIN hash, or record here why the app's own sandbox is enough. See [data-safety.md](data-safety.md).
- **Developer screens:** the Diagnostics and Playback lab screens, their test streams and the `systemconfig.query` permission must not be in the store build (STORE.md, "App work the store needs").
- **Content:** nothing sexual, violent, discriminatory, criminal, drug-related, gambling-related, or against a religion or nation. Testers see what Cinemeta and the Demo addon show, so the Demo addon's films should be suitable for all ages.

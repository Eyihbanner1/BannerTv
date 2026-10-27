# UX scenario for LG testers (draft)

LG asks for a UX scenario with every submission: a guide that lets a tester reach every screen and feature. A missing or incomplete one is rejected before testing. LG's template is a PowerPoint from Seller Lounge (Test Info, Template); the version seen in research, 4.3, has these sections: Basic information, Document history, Page description (a screenshot of each screen with every button numbered and explained), Login information, Main page, Sub pages with an optional flow chart, Paid content, In-app ads, and an appendix for notes to QA. Delete the template's guide slide before submitting.

The text below fills those sections; the screenshots come from the submitted build. Steps marked **(Phase 2)** or later describe features still being built; update them against the build that is submitted.

## Basic information

| Field | Value |
| --- | --- |
| App title | BannerTV |
| Category | As chosen in Service Info (Entertainment) |
| File type | Web app (.ipk) |
| Optimised resolution | 1920 x 1080 (and 1280 x 720 if a second package is submitted) |
| Service area | United Kingdom |
| App service language | English |
| Geo-IP block | No |
| SDK version | As chosen in File Upload (webOS 5.0 and later) |
| In-app ads | Not applicable |
| Paid content | Not applicable (an optional external donation link that unlocks nothing; see the appendix) |

## Login information

None needed: BannerTV has no account. When Trakt sign-in ships, give a Trakt test account here and in Test Info; sign-in shows a code to enter at trakt.tv/activate on a phone or computer.

## About the app

BannerTV is a media centre that shows and plays what addons return. Apart from its demo addon, it hosts no content. The store build comes with three addons already added:

- **Cinemeta**, for film and series titles, artwork and details.
- **OpenSubtitles v3**, for subtitles.
- **BannerTV Demo**, which streams Blender open movies under Creative Commons Attribution licences, so every playback step below can be tested with legal content.

No account, login or payment is needed. The TV must be online.

## Remote keys

| Key | What it does |
| --- | --- |
| Arrows | Move focus |
| OK | Open or activate the focused item |
| Back | Close the top menu or dialog, then go back a screen. On Home it returns to the TV's launcher on webOS 5 and shows the TV's exit prompt on webOS 6 and newer (see scenario 9) |
| Magic Remote pointer | Hover moves focus, click activates, the wheel scrolls rows |
| Play, Pause, Stop, Rewind, Fast forward | Player transport **(Phase 2)** |

## Scenarios

### 1. First launch

1. Open BannerTV from the launcher. The splash appears, then the welcome screen.
2. The welcome explains that BannerTV doesn't host any content and that the user is responsible for the addons they add.
3. Choose **Start browsing**. Home opens. The welcome does not appear on later launches.
4. Alternatively, choose **Add an addon** on the welcome screen. The Add an addon window opens (scenario 7); closing it goes to Home.

### 2. Home

1. Home shows a large banner for the focused title and rows of titles under it.
2. Move down and across rows. The banner follows focus.
3. Move left from the first tile to open the menu (Home, Search, Discover, Library, Addons, Settings). **Library** is a placeholder until Phase 3.
4. The last tile of each row, **See all**, opens that row in Discover.

### 3. Details and trailer

1. Open any title. Details shows artwork, synopsis, cast and, for a series, seasons and episodes.
2. Choose **Trailer** on a title that has one. The TV's YouTube app opens; Back returns to BannerTV.

### 4. Playing a film (Phase 2)

1. Open **Home**, find the **BannerTV Demo** row and open a film, for example *Sintel*.
2. Choose **Watch**, then a stream from the list. Playback starts.
3. Press OK to show the controls. Left and Right seek 10 seconds. Up opens audio and subtitle choices; choose English subtitles.
4. Press Back to leave the player. Open the film again: BannerTV offers **Resume** from where it stopped.

### 5. Search

1. Open **Search** from the menu. Press OK on the search box to open the TV keyboard.
2. Type "sintel", or use the microphone key to say it. Results appear by type.
3. Open a result. The search appears under recent searches next time.

### 6. Discover

1. Open **Discover**. Change the type, catalogue and genre pickers.
2. Scroll the poster grid. More titles load near the end.

### 7. Adding an addon

1. Open **Addons**, then **Add an addon**.
2. Type this test address with the TV keyboard: `DEMO_ADDON_URL` (the Demo addon's manifest; remove it first from the Addons list to test adding it again).
3. Or scan the QR code with a phone, paste the same address on the page that opens, and send it. The address appears on the TV; choose **Add**. The code lasts 10 minutes; **New code** gets another.
4. The addon appears in the list and its rows appear on Home.

### 8. Managing addons

1. In **Addons**, focus an addon. Choose **Move up** or **Move down** to change its order; Home's rows follow.
2. Choose **Remove**. A confirmation appears with focus on **Keep it**. Confirm to remove.
3. On an addon that has settings, choose **Settings**. The window shows a QR code that opens the addon's own settings page on a phone. Choose options there, then send the new install link to BannerTV with the code shown on the TV. Choose **Update**; the addon keeps its place in the list with the new settings.

### 9. Back key and exit

1. From any screen, press Back repeatedly. BannerTV closes menus, then goes back screen by screen, then returns to Home.
2. On Home, Back returns to the TV's launcher on webOS 5 and shows the TV's exit prompt on webOS 6 and newer. Behaviour on webOS 23 and newer is being confirmed with LG; update this step to match the submitted build.

### 10. Network loss

1. Unplug the network while browsing. BannerTV shows a clear message on rows that can't load; artwork already loaded stays.
2. Reconnect and choose **Try again**. Rows load.
3. **(Phase 2)** Unplug during playback. The player shows a message and offers to try again.

### 11. Leaving and returning

1. **(Phase 2)** During playback, press the Home key and open another app. Return to BannerTV: playback is paused at the same point.

### 12. Adult addons and the PIN (Phase 3)

1. Addons marked as adult are hidden by default.
2. Open **Settings** and try to show adult addons. BannerTV asks for the profile PIN; the tester PIN is given in Test Info.

## Appendix: notes for LG QA

- BannerTV hosts no content. What appears depends on the addons installed; the store build comes with Cinemeta, OpenSubtitles v3 and BannerTV Demo.
- The About screen shows an optional QR code to an external donation page. It opens on a phone and unlocks nothing in the app.
- **(Phase 3)** Addons marked as adult are hidden by default, and showing them needs the PIN (scenario 12). Remove this line and scenario 12 if the submitted build doesn't have the filter.

## Known limits (not errors)

- Embedded subtitles inside some video files can't be listed on webOS; BannerTV offers subtitles from addons instead.
- Dolby Vision and Dolby Atmos depend on the TV model and its sound settings.
- What appears in Home, Search and Discover depends on the addons installed.

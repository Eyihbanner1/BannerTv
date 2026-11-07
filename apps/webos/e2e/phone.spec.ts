import { expect, type Page, test } from '@playwright/test';
import { DEMO_ROW, mockAddons } from './addons';
import { APP_URL, expectFocus, press } from './tv';

// A phone held sideways, as the Android app runs on one: 2340x1080 pixels, three to each CSS pixel.
test.use({ viewport: { width: 780, height: 360 }, deviceScaleFactor: 3, isMobile: true });

/** Where the UI sits on the phone's screen, and how far the page could pan. */
function layout(page: Page) {
  return page.evaluate(() => {
    const box = document.getElementById('root')!.getBoundingClientRect();
    const html = document.documentElement;
    return {
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.round(box.width),
      height: Math.round(box.height),
      pageWidth: html.scrollWidth,
      pageHeight: html.scrollHeight,
      shown: Math.round(window.visualViewport!.width),
    };
  });
}

test('on a phone the whole TV layout fits the screen, in the middle, and the page never pans', async ({
  page,
}) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  // 1920x1080 at a third is 640x360: the full height, with 70 pixels either side.
  expect(await layout(page)).toEqual({
    left: 70,
    top: 0,
    width: 640,
    height: 360,
    pageWidth: 780,
    pageHeight: 360,
    shown: 780,
  });

  await press(page, 'Enter', `${DEMO_ROW}-tile-0`);
  expect(await layout(page)).toMatchObject({ left: 70, width: 640, pageWidth: 780, shown: 780 });
});

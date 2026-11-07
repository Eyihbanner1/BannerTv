import { expect, type Page, test } from '@playwright/test';
import { mockAddons } from './addons';
import { seedStreamAddon } from './play';
import { mockServices } from './services';
import { APP_URL, expectFocus, openSection, press, watchErrors } from './tv';

/** Big Buck Bunny on My List: its addon gives it no release date. */
const MY_LIST = {
  kv: {
    library: {
      items: [
        { id: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', releaseInfo: '2008', addedAt: 1 },
      ],
      outbox: [],
      synced: [],
    },
  },
};

async function openCalendar(page: Page): Promise<void> {
  await page.goto(APP_URL);
  await expectFocus(page, 'home-my-list-tile-0');
  await openSection(page, 'library');
  await expectFocus(page, 'discover-tile-0');
  await press(page, 'ArrowUp', 'library-show');
  await press(page, 'Enter', 'library-show-menu-0');
  await press(page, 'ArrowDown', 'library-show-menu-1');
  await press(page, 'ArrowDown', 'library-show-menu-2');
  await page.keyboard.press('Enter');
}

test('the calendar dates a film on My List by when it comes out to watch at home', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  await mockServices(page, { tmdb: true, homeRelease: inTenDays });
  await seedStreamAddon(page, MY_LIST);
  await openCalendar(page);
  // Dated ten days on, by TMDB's UK digital release.
  await expect(
    page.getByRole('button', { name: /, Big Buck Bunny, Out to watch at home$/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('without TMDB, a film its addon gives no date stays off the calendar', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await mockServices(page, { tmdb: false });
  await seedStreamAddon(page, MY_LIST);
  await openCalendar(page);
  await expect(page.getByText(/^Nothing coming up in the next two months/)).toBeVisible();
  expect(errors).toEqual([]);
});

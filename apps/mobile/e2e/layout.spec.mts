import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { seedStreamAddon } from '../../webos/e2e/play.ts';

/*
 * The phone at its narrowest common width, 360 wide. React Native, and react-native-web with
 * it, lets a horizontal ScrollView shrink by default: on Search the results list squeezed the
 * Films and series / Films / Series row once results came in, cutting the pills in half (seen
 * on a phone). These check the pills keep their full height with a long list under them.
 */
test.use({ viewport: { width: 360, height: 780 } });

const KINDS = ['Films and series', 'Films', 'Series'];
/** touch.chip in the design tokens. */
const CHIP_HEIGHT = 40;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** The pill's height, and how much of it shows inside everything around it that clips. */
function shown(target: Locator): Promise<{ height: number; visible: number }> {
  return target.evaluate((element) => {
    const own = element.getBoundingClientRect();
    let top = own.top;
    let bottom = own.bottom;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'visible') continue;
      const box = parent.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    return { height: own.height, visible: Math.max(0, bottom - top) };
  });
}

async function expectWhole(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const pill = page.getByRole('button', { name, exact: true });
    await expect(pill).toBeVisible();
    const { height, visible } = await shown(pill);
    expect(height, `${name} is ${height} high`).toBeGreaterThanOrEqual(CHIP_HEIGHT);
    expect(visible, `${name} shows ${visible} of ${height}`).toBeGreaterThanOrEqual(height - 0.5);
  }
}

test('at 360 wide, the kind pills keep their height once Search and My List fill up', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  // A long My List, so its grid runs well past the screen too.
  await seedStreamAddon(page, {
    kv: {
      library: {
        items: [
          ['tt0807840', 'Elephants Dream'],
          ['tt1254207', 'Big Buck Bunny'],
          ['tt1727587', 'Sintel'],
          ['tt2285752', 'Tears of Steel'],
          ['tt9000005', 'Caminandes'],
          ['tt9000006', 'Cosmos Laundromat'],
          ['tt9000007', 'Glass Half'],
          ['tt9000008', 'Agent 327'],
          ['tt9000009', 'Hero'],
          ['tt9000010', 'Spring'],
          ['tt9000011', 'Coffee Run'],
          ['tt9000012', 'Sprite Fright'],
        ].map(([id, name], index) => ({ id, type: 'movie', name, addedAt: 1000 + index })),
        outbox: [],
        synced: [],
      },
    },
  });
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');

  // "er" finds Hero among the films and two series. With each addon's own results unfolded
  // under Top results, the list runs well past the bottom of the screen.
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByPlaceholder('Search for a film or series').fill('er');
  await expect(page.getByText('Top results', { exact: true })).toBeVisible();
  const hero = page.getByRole('button', { name: 'Hero, 2018' });
  await expect(hero).toHaveCount(1);
  await expectWhole(page, KINDS);
  await page.getByRole('button', { name: 'Results from each addon' }).click();
  await expect(hero).toHaveCount(2);
  await expectWhole(page, KINDS);

  await page.getByRole('tab', { name: 'My List' }).click();
  await expect(page.getByRole('button', { name: 'Sprite Fright, 2021' })).toBeVisible();
  await expectWhole(page, ['My List', 'History', 'Calendar', ...KINDS]);
  expect(errors).toEqual([]);
});

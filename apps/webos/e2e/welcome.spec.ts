import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { APP_URL, expectFocus, press, pressBack } from './tv';

test('the first launch welcomes the user once, then opens Home', async ({ page }) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  const welcome = page.getByRole('dialog', { name: 'Welcome to BannerTV' });
  await expect(
    welcome.getByText("BannerTV doesn't host or provide any films or series."),
  ).toBeVisible();

  // Focus stays on the welcome: the rail and Home wait underneath.
  await press(page, 'ArrowLeft', 'welcome-start');
  await press(page, 'ArrowRight', 'welcome-add');
  await press(page, 'ArrowLeft', 'welcome-start');
  await page.keyboard.press('Enter');
  await expect(welcome).toHaveCount(0);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);

  await page.reload();
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Add an addon on the welcome opens Addons with the dialog showing', async ({ page }) => {
  await mockAddons(page, { firstRun: true });
  await page.goto(APP_URL);
  await expectFocus(page, 'welcome-start');
  await press(page, 'ArrowRight', 'welcome-add');
  await press(page, 'Enter', 'install-field');
  await expect(page.getByRole('dialog', { name: 'Add an addon' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Addons', level: 1 })).toBeVisible();
  await pressBack(page);
  await expectFocus(page, 'addons-add');
});

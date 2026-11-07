import { expect, test, type Page } from '@playwright/test';
import { mockAddons } from '../../webos/e2e/addons.ts';
import { lockedWith, main, seedProfiles } from '../../webos/e2e/profiles.ts';

/*
 * Settings, Profiles on the phone (items A1, A4, A5, A7, A8): the TV's profile rules, by touch.
 */

const GUEST = 'guest4';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.route(/^http:\/\/localhost:8765\//, (route) => route.continue());
  await page.goto('/');
}

async function typePin(page: Page, digits: string): Promise<void> {
  for (const digit of digits) {
    // The newest pad: one closing as the next opens is still on the page while it slides away.
    await page.getByRole('button', { name: digit, exact: true }).last().click();
  }
}

async function savedProfiles(
  page: Page,
): Promise<Record<string, { name: string; kids?: string; pin?: unknown }>> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('bannertv.profiles')!) as {
      profiles: { id: string; name: string; kids?: string; pin?: unknown }[];
    };
    return Object.fromEntries(state.profiles.map((p) => [p.id, p]));
  });
}

test('Settings, Profiles adds a kids profile, offers to lock the grown-ups, and takes a forgotten PIN off', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(), { id: GUEST, name: 'Guest', colour: 2, ...lockedWith('1111') }],
    lastId: 'main',
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Profiles/ }).click();
  await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();

  // Guest is locked: its page asks for its PIN. With Main unlocked, Forgot PIN? only warns.
  await page.getByRole('button', { name: 'Guest, PIN' }).click();
  await expect(page.getByText('Enter the PIN for Guest')).toBeVisible();
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await expect(page.getByText('Take the PIN off Guest?')).toBeVisible();
  await expect(page.getByText(/Main has no PIN, so anyone using BannerTV here/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Take the PIN off Guest?')).toBeHidden();

  // A kids profile, and the offer to lock Main.
  await page.getByRole('button', { name: 'Add a profile' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Ada');
  await page.getByRole('button', { name: /^Kids profile/ }).click();
  await page.getByRole('button', { name: 'Kids, up to U' }).click();
  await expect(
    page.getByText(
      /^No Addons, and limited Settings\. Home, Discover and Search show family films/,
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add a profile' }).click();
  await expect(page.getByText('Lock the grown-up profiles?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  await page.getByRole('button', { name: 'Set a PIN for Main' }).click();
  await expect(page.getByText('Choose a four-digit PIN for Main')).toBeVisible();
  await typePin(page, '1357');
  await expect(page.getByText('Enter the PIN again')).toBeVisible();
  await typePin(page, '1357');
  await expect(page.getByText('Main has a PIN')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Ada, Kids, up to U' })).toBeVisible();

  // Main has a PIN now, so a forgotten Guest PIN comes off with Main's.
  await page.getByRole('button', { name: 'Guest, PIN' }).click();
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await expect(page.getByText("Enter Main's PIN to take the PIN off Guest")).toBeVisible();
  await typePin(page, '1111');
  await expect(page.getByText('That PIN is not right.')).toBeVisible();
  await typePin(page, '1357');
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set a PIN' })).toBeVisible();

  const saved = await savedProfiles(page);
  expect(saved.main!.pin).toBeDefined();
  expect(saved[GUEST]!.pin).toBeUndefined();
  const ada = Object.values(saved).filter((p) => p.name === 'Ada')[0]!;
  expect(ada.kids).toBe('U');

  // Deleting says where it goes from: this phone, with no account.
  await page.getByRole('button', { name: 'Delete profile' }).click();
  await expect(page.getByText(/deleted from this phone/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(errors).toEqual([]);
});

test('Forgot PIN? for Main on a phone with no account offers to reset it', async ({ page }) => {
  const errors = watchErrors(page);
  await mockAddons(page);
  await seedProfiles(page, {
    profiles: [main(lockedWith('2468')), { id: GUEST, name: 'Guest', colour: 2 }],
    lastId: GUEST,
    askAtLaunch: false,
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Profiles/ }).click();
  await page.getByRole('button', { name: 'Main, PIN' }).click();
  await page.getByRole('button', { name: 'Forgot PIN?' }).click();
  await expect(page.getByText('Reset BannerTV on this phone?')).toBeVisible();
  await expect(page.getByText(/Every profile, addon, My List/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await savedProfiles(page)).main!.pin).toBeDefined();
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { FIRST_ROW, mockAddons } from './addons';
import { APP_URL, expectFocus, openSection, press } from './tv';

// The helper on a phone on the home network, played by the test.
const HELPER = 'http://192.168.1.42:47020';

test('Stream helper: the phone sends its helper through a short code, and the TV pairs with one press', async ({
  page,
}) => {
  const { phone } = await mockAddons(page);
  const pairedWith: string[] = [];
  await page.route(`${HELPER}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/pair') {
      pairedWith.push(route.request().postData() ?? '');
      return route.fulfill({ json: { key: 'test-helper-key-0001' } });
    }
    if (path === '/status') return route.fulfill({ json: { helper: 'bannertv' } });
    return route.fulfill({ status: 404 });
  });

  await page.goto(APP_URL);
  await expectFocus(page, `${FIRST_ROW}-tile-0`);
  await openSection(page, 'settings');
  await expectFocus(page, 'settings-stream-choice');
  for (const key of [
    'settings-probing',
    'settings-subtitle-style',
    'settings-still-watching',
    'settings-next-at-credits',
    'settings-diagnostics',
    'settings-lab',
    'settings-stream-helper',
  ]) {
    await press(page, 'ArrowDown', key);
  }
  await press(page, 'Enter', 'helper-address');

  // The TV shows a relay code, spaced in threes, for the phone to type.
  await expect.poll(() => phone.codes.length).toBe(1);
  const code = phone.codes[0]!;
  await expect(page.getByText(`${code.slice(0, 3)} ${code.slice(3)}`)).toBeVisible();

  // Something that isn't a helper is turned away, and the TV waits on a new code.
  phone.send('https://addon.example/manifest.json');
  await expect(
    page.getByText("Your phone sent something that isn't a stream helper."),
  ).toBeVisible();
  await expect.poll(() => phone.codes.length).toBe(2);
  expect(pairedWith).toEqual([]);

  // The phone's helper fills in the form; nothing pairs until Pair is pressed on the TV.
  phone.send(`${HELPER}/pair?code=123456`);
  await expectFocus(page, 'helper-pair');
  await expect(page.getByText('Your phone sent its helper. Check the address below')).toBeVisible();
  await expect(page.locator('[data-focus-key="helper-address"] input')).toHaveValue(
    '192.168.1.42:47020',
  );
  await expect(page.locator('[data-focus-key="helper-code"] input')).toHaveValue('123456');
  expect(pairedWith).toEqual([]);

  await press(page, 'Enter', 'helper-check');
  await expect(page.getByText('Paired with the helper at 192.168.1.42.')).toBeVisible();
  await expect(page.getByText('The helper is on. Streams that need it will play.')).toBeVisible();
  expect(pairedWith).toEqual(['code=123456']);
});

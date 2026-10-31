import { expect, test, type Page } from '@playwright/test';
import { emptyPort } from '../playwright.config';

/** Fail the test on any uncaught error or console error from the display. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  return problems;
}

test('every screen, the sheets, the dialogs and the doorbell work in mock mode', async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  await page.goto('/?mode=daylight');

  // Today: date, weather, grocery peek, agenda.
  const dock = page.getByRole('navigation', { name: 'Screens' });
  await expect(dock).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Weather,/ })).toBeVisible();
  await expect(page.getByText(/^Now · /)).toBeVisible();

  // Quick add opens in the day sheet and closes with Escape.
  await page.getByRole('button', { name: 'Add an event today' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Event title')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The weather card opens its sheet, every tab renders, and a place can be looked up.
  await page.getByRole('button', { name: 'Open the forecast' }).click();
  const wx = page.getByRole('dialog', { name: /^Weather,/ });
  await expect(wx.getByRole('tab', { name: 'Hourly' })).toHaveAttribute('aria-selected', 'true');
  await expect(wx.getByRole('img', { name: /Temperature and rain/ })).toBeVisible();
  await wx.getByRole('tab', { name: '10-day' }).click();
  await expect(
    wx.getByRole('list', { name: 'Ten-day forecast' }).getByRole('listitem'),
  ).toHaveCount(10);
  await wx.getByRole('tab', { name: 'Details' }).click();
  await expect(wx.getByText('Dew point')).toBeVisible();
  await wx.getByRole('tab', { name: 'Alerts' }).click();
  await expect(wx.getByText(/^No alerts for/)).toBeVisible();
  await wx.getByRole('searchbox', { name: 'Search for a place' }).fill('Seattle');
  await wx.getByRole('option', { name: /Seattle/ }).click();
  await expect(wx.getByRole('heading', { name: 'Seattle' })).toBeVisible();
  await wx.getByRole('button', { name: 'Close' }).click();
  await expect(wx).toBeHidden();

  // A pushed warning shows a banner until dismissed.
  const warned = await request.post('/api/dev/emit', {
    data: {
      type: 'weather.alert',
      payload: {
        locationName: 'Home',
        alert: {
          id: 'smoke-wind',
          event: 'High Wind Warning',
          severity: 'severe',
          headline: 'High Wind Warning until 6 PM',
          description: 'Gusts up to 60 mph.',
          starts: new Date().toISOString(),
          ends: null,
        },
      },
    },
  });
  expect(warned.ok()).toBe(true);
  const banner = page.getByRole('alert');
  await expect(banner.getByText('High Wind Warning')).toBeVisible();
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();

  // The grocery card opens the Lists screen.
  await page.getByRole('button', { name: /list$/ }).first().click();
  await expect(page.locator('.screen[data-screen="lists"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grocery' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');

  // Month: six weeks and the day sheet for today.
  await dock.getByRole('button', { name: 'Month' }).click();
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('gridcell')).toHaveCount(42);
  await grid.locator('.cell.is-today').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Quick add' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Home: rooms from the fixture, and the lock asks before unlocking.
  await dock.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByText('Living room', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Ceiling' })).toBeVisible();
  await page.getByRole('button', { name: /Front door: Locked/ }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('Unlock the front door?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep locked' }).click();
  await expect(confirm).toBeHidden();

  // A doorbell press pops the live view over the screen.
  const ring = await request.post('/api/dev/doorbell');
  expect(ring.ok()).toBe(true);
  const live = page.getByRole('dialog', { name: "Someone's at the front door" });
  await expect(live).toBeVisible();
  await expect(live.getByRole('img')).toHaveAttribute(
    'src',
    /^\/api\/home\/cameras\/camera\.front_door\/stream/,
  );
  await live.getByRole('button', { name: 'Dismiss' }).click();
  await expect(live).toBeHidden();

  // Ambient by hand, then a tap brings Today back.
  await dock.getByRole('button', { name: 'Ambient mode' }).click();
  const ambient = page.getByRole('button', { name: /^Ambient mode\. Tap to wake/ });
  await expect(ambient).toBeVisible();
  await expect(ambient.getByText(/^Next · |^Tomorrow/)).toBeVisible();
  await ambient.click();
  await expect(ambient).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  expect(problems).toEqual([]);
});

test('the Dusk look renders every screen', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/?mode=dusk');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dusk');
  const dock = page.getByRole('navigation', { name: 'Screens' });
  for (const name of ['Month', 'Lists', 'Home', 'Today']) {
    await dock.getByRole('button', { name }).click();
    await expect(page.locator(`.screen[data-screen="${name.toLowerCase()}"]`)).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('the settings page and the phone page load', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Screen schedule')).toBeVisible();
  await page.getByRole('link', { name: 'Back to the display' }).click();
  await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();

  await page.goto('/add');
  await expect(page.getByRole('heading', { name: 'Add to a list' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a fresh install shows an empty state with a Settings link on every screen', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.goto(`http://127.0.0.1:${emptyPort}/?mode=daylight`);
  const dock = page.getByRole('navigation', { name: 'Screens' });
  await expect(dock).toBeVisible();

  // Today: no weather (no location yet) and no calendars.
  await expect(page.getByText('No weather yet. Tell Mantel where home is.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set your location' })).toHaveAttribute(
    'href',
    '/settings#home',
  );
  await expect(page.getByText('No calendars connected yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect a calendar' })).toHaveAttribute(
    'href',
    '/settings#calendars',
  );

  await dock.getByRole('button', { name: 'Lists' }).click();
  await expect(page.getByText(/^No lists yet\./)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set up lists' })).toHaveAttribute(
    'href',
    '/settings#lists',
  );

  await dock.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByText("Home Assistant isn't connected yet.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect Home Assistant' })).toHaveAttribute(
    'href',
    '/settings#homeassistant',
  );

  // The 501 answers for weather and Home Assistant are expected here; nothing else may fail.
  expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
});

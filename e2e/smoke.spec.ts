import { expect, test, type Page } from '@playwright/test';

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

test('three skins render every screen, with their decor, and no console errors', async ({
  page,
}) => {
  const problems = watchConsole(page);
  for (const [skin, decor] of [
    ['poster', 'rules'],
    ['harvest', 'leaves'],
    ['midnight', null],
  ] as const) {
    await page.goto(`/?mode=daylight&skin=${skin}`);
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
    const dock = page.getByRole('navigation', { name: 'Screens' });
    for (const name of ['Month', 'Home', 'Today']) {
      await dock.getByRole('button', { name }).click();
      await expect(page.locator(`.screen[data-screen="${name.toLowerCase()}"]`)).toBeVisible();
    }
    if (decor)
      await expect(page.locator(`.skin-decor[data-decor="${skin}"] svg`).first()).toBeAttached();
    else await expect(page.locator('.skin-decor')).toHaveCount(0);
  }
  // The skin's fonts are self-hosted and actually load (Midnight's headline face is Space Grotesk).
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replace(/"/g, ''));
  });
  expect(loaded).toContain('Space Grotesk');
  expect(loaded).toContain('Manrope');
  expect(problems).toEqual([]);
});

test('the skin gallery switches skins and makes a custom one', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/demo/skins?screen=month');
  await expect(page.getByRole('heading', { name: 'Skins' })).toBeVisible();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Poster skin' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'poster');
  await page
    .getByRole('group', { name: 'Look', exact: true })
    .getByRole('button', { name: 'Dusk' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dusk');
  await page.getByRole('switch', { name: 'Follow the season' }).click();
  await page.getByRole('button', { name: 'Create your own' }).click();
  await page.getByRole('button', { name: 'Use this skin' }).click();
  await page.getByRole('switch', { name: 'Follow the season' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'custom');
  expect(problems).toEqual([]);
});

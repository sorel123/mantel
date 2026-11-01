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

  // A pushed warning shows a banner until dismissed. The push only reaches a display whose
  // socket is up, so send it until the server reports a client.
  const warning = {
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
  };
  await expect
    .poll(async () => {
      const res = await request.post('/api/dev/emit', { data: warning });
      expect(res.ok()).toBe(true);
      return ((await res.json()) as { clients: number }).clients;
    })
    .toBeGreaterThan(0);
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
  // Four to six weeks, whatever the month needs.
  await expect(grid.getByRole('gridcell').first()).toBeVisible();
  const cells = await grid.getByRole('gridcell').count();
  expect(cells % 7).toBe(0);
  expect(cells).toBeGreaterThanOrEqual(28);
  expect(cells).toBeLessThanOrEqual(42);
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

/** Every settings section, by hash, with the heading each one shows. */
const SECTIONS: Array<[string, string]> = [
  ['home', 'Your home'],
  ['people', 'People'],
  ['calendars', 'Calendars'],
  ['integrations', 'Integrations'],
  ['homeassistant', 'Home Assistant'],
  ['appearance', 'Appearance'],
  ['layout', 'Layout'],
  ['quips', 'Weather quips'],
  ['screens', 'Screens and dock'],
  ['lists', 'Lists and chores'],
  ['places', 'Leave-by places'],
  ['schedule', 'Screen schedule'],
  ['features', 'Features'],
  ['displays', 'Displays'],
  ['health', 'Health'],
  ['backup', 'Backup and restore'],
  ['help', 'Help'],
  ['advanced', 'Advanced'],
];

test('the settings hub shows every section by hash, and the phone page loads', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your home' })).toBeVisible();
  for (const [id, title] of SECTIONS) {
    await page.goto(`/settings#${id}`);
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }).locator('[aria-current="page"]'),
    ).toHaveText(new RegExp(title.split(' ')[0]!));
  }

  // Integrations render one card per plugin manifest, calendars have a picker from the setup JSON.
  await page.goto('/settings#integrations');
  await expect(page.getByRole('article', { name: 'Photos' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Leave-by times' })).toBeVisible();
  await page.goto('/settings#calendars');
  await expect(page.getByRole('table', { name: 'Calendars on the wall' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show Family' })).toBeVisible();
  // Appearance mounts workstream E's section: skin tiles and Follow the season.
  await page.goto('/settings#appearance');
  await expect(page.getByRole('button', { name: 'Poster skin' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Follow the season' })).toBeVisible();

  await page.getByRole('link', { name: 'Back to the display' }).click();
  await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();

  await page.goto('/add');
  await expect(page.getByRole('heading', { name: 'Add to a list' })).toBeVisible();

  await page.goto('/settings#appearance');
  // Fonts are shown in their own face, and Preview on the wall opens the real display with the
  // unsaved choice.
  await page.getByRole('button', { name: 'Poster skin' }).click();
  await page.getByRole('radio', { name: 'Caveat' }).click();
  await expect(page.getByRole('img', { name: /^Preview: Poster, Caveat headlines/ })).toBeVisible();
  const [wall] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: 'Preview on the wall' }).click(),
  ]);
  await expect(wall.getByRole('navigation', { name: 'Screens' })).toBeVisible();
  await expect(wall.locator('html')).toHaveAttribute('data-skin', 'poster');
  await expect(wall.getByRole('button', { name: /Preview, not saved/ })).toBeVisible();
  await wall.close();
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

test('the old calendar setup address redirects into Settings', async ({ request }) => {
  const res = await request.get('/api/calendar/setup', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toBe('/settings#calendars');
});

test('the setup wizard walks every step and lands in Settings', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  // A fresh server asks for the admin PIN first; once one project has set it, the other finds
  // the PIN in place and this (mock, pre-paired) browser is let straight through.
  const again = page.getByLabel('Admin PIN again');
  await expect(again.or(page.getByText('This browser is paired'))).toBeVisible();
  if (await again.isVisible()) {
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByLabel('Admin PIN', { exact: true }).fill('1234');
    await again.fill('1234');
    await page.getByRole('button', { name: 'Set the PIN' }).click();
    // Either this browser set the PIN, or the other project beat it to it; both end here.
    await expect(page.getByText('This browser is paired')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Your home' }).first()).toBeVisible();
  await expect(page.getByLabel('Location')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'People' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Calendars' }).first()).toBeVisible();
  await expect(page.getByRole('article', { name: 'Google Calendar' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Home Assistant' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Photos and extras' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Put it on the wall' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish and open Settings' }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The project that lost the PIN race gets a 403 from /api/admin/pin, which the browser logs.
  expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
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

test('Home Assistant is set up from Settings: test, pick rooms and devices, save, turn off', async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  await page.goto('/settings#homeassistant');
  const ha = page.locator('section', {
    has: page.getByRole('heading', { name: 'Home Assistant' }),
  });
  await expect(ha).toBeVisible();
  await expect(ha.getByText(/^Connected to Home Assistant/)).toBeVisible();

  // The Test button answers in one sentence.
  await ha.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(ha.getByText(/Home Assistant answered \(mock mode/)).toBeVisible();

  // Rooms from discovery: Kitchen is shown; open it and untick the island, then hide the room.
  const rooms = ha.getByRole('list', { name: 'Rooms on the Home screen' });
  await expect(rooms.getByLabel('Kitchen room name')).toHaveValue('Kitchen');
  await rooms.getByRole('button', { name: 'Choose devices in Kitchen' }).click();
  const island = rooms.getByRole('switch', { name: 'Show Island' });
  await expect(island).toHaveAttribute('aria-checked', 'true');
  await island.click();
  await expect(island).toHaveAttribute('aria-checked', 'false');
  await expect(rooms.getByText('2 of 3 shown')).toBeVisible();
  await rooms.getByRole('switch', { name: 'Show Kitchen' }).click();
  await expect(
    ha.getByRole('list', { name: 'Rooms not on the Home screen' }).getByText('Kitchen'),
  ).toBeVisible();
  await ha.getByRole('button', { name: 'Save rooms and devices' }).click();
  await expect(ha.getByText('Saved. The Home screen is updating.')).toBeVisible();

  // The server applied it without a restart.
  const state = (await (await request.get('/api/home/state')).json()) as {
    areas: { id: string }[];
  };
  expect(state.areas.map((a) => a.id)).not.toContain('kitchen');

  // Put it back the way it was, so the other tests see the fixture rooms.
  await ha.getByRole('switch', { name: 'Show Kitchen' }).click();
  await ha.getByRole('button', { name: 'Save rooms and devices' }).click();
  await expect(ha.getByText('Saved. The Home screen is updating.')).toBeVisible();
  const after = (await (await request.get('/api/home/state')).json()) as {
    areas: { id: string }[];
  };
  expect(after.areas.map((a) => a.id)).toContain('kitchen');

  // Turning Home Assistant off takes the Home screen out of the dock; on brings it back.
  await ha.getByRole('switch', { name: 'Show Home Assistant on the wall' }).click();
  await expect(ha.getByText('Turned off. The Home screen is hidden.')).toBeVisible();
  expect((await request.get('/api/home/state')).status()).toBe(503);
  await page.goto('/?mode=daylight');
  const dock = page.getByRole('navigation', { name: 'Screens' });
  await expect(dock.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Home' })).toHaveCount(0);
  await page.goto('/settings#homeassistant');
  await ha.getByRole('switch', { name: 'Show Home Assistant on the wall' }).click();
  await expect(ha.getByText(/^Connected to Home Assistant/)).toBeVisible();
  expect((await request.get('/api/home/state')).status()).toBe(200);
  expect(problems).toEqual([]);
});

test('layout presets switch, and the day sheet and quick add still work in each', async ({
  page,
}) => {
  const problems = watchConsole(page);
  const dock = () => page.getByRole('navigation', { name: 'Screens' });

  // Each Today preset on the display's address, with quick add reachable from every one.
  const todayChecks: Array<[string, () => Promise<void>]> = [
    ['agenda', async () => expect(page.getByRole('button', { name: /list$/ })).toBeVisible()],
    [
      'weather',
      async () => expect(page.getByRole('region', { name: 'The week ahead' })).toBeVisible(),
    ],
    [
      'family',
      async () => {
        const board = page.getByRole('list', { name: 'Family board' });
        await expect(board).toBeVisible();
        expect(await board.getByRole('listitem').count()).toBeGreaterThanOrEqual(4);
      },
    ],
    ['photo', async () => expect(page.locator('.photo-panel .ph-show')).toBeVisible()],
    [
      'poster',
      async () => expect(page.getByRole('region', { name: "Today's bill" })).toBeVisible(),
    ],
  ];
  for (const [preset, check] of todayChecks) {
    await page.goto(`/?mode=daylight&today=${preset}`);
    await expect(dock()).toBeVisible();
    await expect(page.locator(`.today[data-preset="${preset}"]`)).toBeVisible();
    await check();
    await page.getByRole('button', { name: 'Add an event today' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByLabel('Event title')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }

  // The Week strip: seven days, the day sheet from a day's header, paging by week.
  await page.goto('/?mode=daylight&month=week');
  await dock().getByRole('button', { name: 'Month' }).click();
  const week = page.getByRole('list', { name: /^Week of / });
  await expect(week).toBeVisible();
  await expect(week.getByRole('listitem')).toHaveCount(7);
  await week.locator('.day.today .dh').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Quick add' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('heading', { name: /^This week/ })).toBeHidden();
  await page.locator('.wstrip .today-btn').click();
  await expect(page.getByRole('heading', { name: /^This week/ })).toBeVisible();

  expect(problems).toEqual([]);
});

test('Your own layout: the cards from the address, and the editor moves, resizes, adds, saves and previews', async ({
  page,
}) => {
  const problems = watchConsole(page);

  // The display draws each card where the address puts it; a one-row date is a single line.
  await page.goto('/?mode=daylight&today=custom&cards=date:0.0.3.1,photo:0.1.5.7,agenda:5.0.7.8');
  await expect(page.locator('.today[data-preset="custom"]')).toBeVisible();
  await expect(page.locator('.region[data-region="date"] .dateline')).toBeVisible();
  await expect(page.locator('.region[data-region="photo"] .photo-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  // A narrow agenda keeps its Day/Week switch, even beside a week card, and its week slides.
  await page.goto('/?mode=daylight&today=custom&cards=agenda:0_0_3_5,date:3_0_4_2,week:3_2_9_6');
  await page.getByRole('button', { name: 'Week', exact: true }).first().click();
  const narrowWeek = page.locator('.region[data-region="agenda"] .week.slide');
  await expect(narrowWeek).toBeVisible();
  expect(await narrowWeek.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Day', exact: true }).first().click();
  await expect(page.locator('.region[data-region="agenda"] .agenda')).toBeVisible();

  // Settings › Layout › Your own: the editor starts from the Agenda layout's cards.
  await page.goto('/settings#layout');
  await page.getByRole('radio', { name: /Your own/ }).click();
  const canvas = page.getByRole('group', { name: 'Today layout' });
  await expect(canvas.getByRole('button', { name: 'Date, 4 by 2' })).toBeVisible();

  // Drag the date's bottom edge up one row to shrink it.
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const grip = canvas.getByRole('button', { name: 'Date, 4 by 2' }).locator('.ced-h-s');
  const box = (await canvas.boundingBox())!;
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - box.height / 8, { steps: 5 });
  await page.mouse.up();
  await expect(canvas.getByRole('button', { name: 'Date, 4 by 1' })).toBeVisible();

  // Covering another card is refused with a note; keys move and resize the selected card.
  const weather = canvas.getByRole('button', { name: /^Weather,/ });
  await weather.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status').filter({ hasText: 'cover another card' })).toBeVisible();
  // Keys go in half cells.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(canvas.getByRole('button', { name: 'Weather, 4 by 3.5' })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(canvas.getByRole('button', { name: 'Weather, 4 by 3' })).toBeVisible();

  // A card stops at its smallest readable size.
  await canvas.getByRole('button', { name: 'Date, 4 by 1' }).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByRole('status')).toHaveText(/Date can't get smaller than 2 by 1/);

  // Add photos into the room that frees, then remove it again.
  await page
    .getByRole('group', { name: 'Add a card' })
    .getByRole('button', { name: '+ Photos' })
    .click();
  await expect(canvas.getByRole('button', { name: /^Photos, 4 by 2$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Photos' }).click();
  await expect(canvas.getByRole('button', { name: /^Photos,/ })).toHaveCount(0);

  // The agenda's left edge moves right one cell: it shrinks from the left.
  const left = (await canvas
    .getByRole('button', { name: /^Agenda,/ })
    .locator('.ced-h-w')
    .boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + left.width / 2 + box.width / 12, left.y + left.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(canvas.getByRole('button', { name: 'Agenda, 7 by 8' })).toBeVisible();

  // Save it by name, start from a starter, then switch back to the saved one.
  await page.getByLabel('Layout name').fill('Our kitchen');
  await page.getByRole('button', { name: 'Save as my layout' }).click();
  await expect(page.getByRole('status')).toHaveText(/Saved as “Our kitchen”/);
  await page.getByRole('button', { name: 'Start from Week at a glance' }).click();
  await expect(canvas.getByRole('button', { name: 'Week, 12 by 6.5' })).toBeVisible();
  await page.getByRole('button', { name: 'Use Our kitchen' }).click();
  await expect(canvas.getByRole('button', { name: 'Agenda, 7 by 8' })).toBeVisible();

  // The preview shows the real Today screen with this layout.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Preview of Today"]');
  await expect(frame.locator('.today[data-preset="custom"]')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Our kitchen' }).click();
  await expect(page.getByRole('button', { name: 'Use Our kitchen' })).toHaveCount(0);

  expect(problems).toEqual([]);
});

test('fill and scale reach the edges of the viewport', async ({ page }) => {
  const problems = watchConsole(page);
  const size = page.viewportSize()!;
  const panelBox = async () => (await page.locator('.panel').boundingBox())!;

  await page.goto('/?mode=daylight&fit=fill');
  await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();
  let box = await panelBox();
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - size.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - size.height)).toBeLessThanOrEqual(2);

  // Scale 120%: still edge to edge, with a panel that holds a fifth less in each direction.
  await page.goto('/?mode=daylight&fit=scale&scale=1.2');
  await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();
  box = await panelBox();
  expect(Math.abs(box.width - size.width)).toBeLessThanOrEqual(2);
  const logical = await page.locator('.panel').evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
  }));
  expect(logical.height).toBe(Math.round(820 / 1.2));
  expect(Math.abs(logical.width * 1.2 - size.width * (820 / size.height))).toBeLessThan(3);

  // A short, wide browser window (a laptop): the panel is wider than the viewport before it is
  // scaled, and must still sit at the left edge, not slide off to the right.
  await page.setViewportSize({ width: 1000, height: 545 });
  for (const q of ['fit=fill', 'fit=scale&scale=1', 'fit=scale&scale=1.2']) {
    await page.goto(`/?mode=daylight&${q}`);
    await expect(page.getByRole('navigation', { name: 'Screens' })).toBeVisible();
    box = await panelBox();
    expect(Math.abs(box.x), q).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y), q).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 1000), q).toBeLessThanOrEqual(2);
  }

  expect(problems).toEqual([]);
});

/**
 * Screenshots for the companion PR (`docs/screenshots/v3-c-*.png`): the phone app's tabs at
 * 390×844, the Magic Import review, the Notifications sheet, and the wall's notes card, add
 * menu and Phone app settings at iPad and Surface sizes. Run after `pnpm build`:
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node e2e/companion-shots.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = 8792;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve('docs/screenshots');
fs.mkdirSync(out, { recursive: true });

const server = spawn('node', ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    MOCK: '1',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: ':memory:',
    DISPLAY_DIST: './apps/display/dist',
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
  },
  stdio: 'inherit',
});
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

// A 1×1 PNG: the mock import returns the fixtures for any photo.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const browser = await chromium.launch();
process.on('uncaughtException', (e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});

async function settle(page) {
  // eslint-disable-next-line no-undef
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/* ---------- the phone ---------- */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const p = await phone.newPage();
p.on('pageerror', (e) => console.error('pageerror', e.message));

const tabs = p.getByRole('navigation', { name: 'Companion tabs' });
await p.goto(`${base}/app#lists`);
await tabs.waitFor();
await settle(p);
await p.screenshot({ path: path.join(out, 'v3-c-phone-lists.png') });
await p.getByRole('button', { name: 'Got it' }).click();

for (const [tab, heading] of [
  ['calendar', 'Calendar'],
  ['meals', 'Meals'],
  ['chores', 'Chores'],
  ['note', 'Note for the wall'],
]) {
  await tabs.getByRole('button', { name: tab === 'note' ? 'Note' : heading }).click();
  await p.getByRole('heading', { name: heading }).waitFor();
  await settle(p);
  await p.screenshot({ path: path.join(out, `v3-c-phone-${tab}.png`) });
}

// A note, then the drawing pad.
await p.getByRole('textbox', { name: 'Note' }).fill('Back by six. Pizza in the fridge!');
await p.getByRole('radio', { name: 'Pink' }).click();
await p.getByRole('button', { name: 'Put it on the wall' }).click();
await p.getByRole('region', { name: 'Notes on the wall now' }).getByText('Back by six').waitFor();
await p.getByRole('radio', { name: 'Drawing' }).click();
const pad = p.getByRole('img', { name: /Drawing pad/ });
const box = await pad.boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await p.mouse.move(cx - 80, cy - 40);
  await p.mouse.down();
  for (let t = 0; t <= 40; t++) {
    const a = (t / 40) * Math.PI * 2;
    await p.mouse.move(cx + Math.cos(a) * 80, cy + Math.sin(a) * 60);
  }
  await p.mouse.up();
}
await settle(p);
await p.screenshot({ path: path.join(out, 'v3-c-phone-drawing.png') });

// Magic Import: the review step with the fixtures, on the Calendar tab.
await p.goto(`${base}/app#calendar`);
await p.getByRole('heading', { name: 'Calendar' }).waitFor();
await p.getByRole('button', { name: 'Read a photo into the calendar' }).click();
await p.getByTestId('import-file').first().setInputFiles({
  name: 'flyer.png',
  mimeType: 'image/png',
  buffer: TINY_PNG,
});
await p.getByRole('heading', { name: 'Check what was found' }).waitFor();
await settle(p);
await p.screenshot({ path: path.join(out, 'v3-c-phone-import-review.png') });

// The notifications sheet.
await p.goto(`${base}/app#lists`);
await tabs.waitFor();
await p.getByRole('button', { name: 'Notifications and this phone' }).click();
await p.getByRole('dialog', { name: 'Notifications' }).waitFor();
await settle(p);
await p.screenshot({ path: path.join(out, 'v3-c-phone-notifications.png') });
await phone.close();

/* ---------- the wall and Settings ---------- */
for (const [name, viewport] of [
  ['ipad', { width: 1180, height: 820 }],
  ['surface', { width: 1440, height: 960 }],
]) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));

  await page.goto(
    `${base}/?mode=daylight&today=custom&cards=date:0.0.3.1,weather:0.1.3.3,notes:0.4.3.4,agenda:3.0.5.8,photo:8.0.4.8`,
  );
  await page.getByRole('navigation', { name: 'Screens' }).waitFor();
  await page.locator('.notes-card').waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(out, `v3-c-wall-notes-${name}.png`) });

  await page.getByRole('button', { name: 'Add an event, a note or a photo' }).click();
  await page.getByRole('button', { name: /A photo of a flyer/ }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(out, `v3-c-wall-add-menu-${name}.png`) });

  await page.getByRole('button', { name: /A drawing/ }).click();
  await page.getByRole('img', { name: /Drawing pad/ }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(out, `v3-c-wall-draw-${name}.png`) });

  await page.goto(`${base}/?mode=daylight`);
  await page
    .getByRole('navigation', { name: 'Screens' })
    .getByRole('button', { name: 'Ambient mode' })
    .click();
  await page.getByText('Back by six').first().waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(out, `v3-c-ambient-note-${name}.png`) });

  await page.goto(`${base}/settings#companion`);
  await page.getByRole('heading', { name: 'Phone app' }).waitFor();
  await settle(page);
  await page.screenshot({ path: path.join(out, `v3-c-settings-phone-${name}.png`) });
  await ctx.close();
}

await browser.close();
server.kill();
console.log(
  'done',
  fs.readdirSync(out).filter((f) => f.startsWith('v3-c-')),
);

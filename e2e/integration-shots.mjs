/**
 * Screenshots for the v3 integration pass (`docs/screenshots/v3-int-*.png`, `v3-c-phone-meals.png`):
 * the person filter on Lists and the chore chart, and the companion Meals tab. Run after
 * `pnpm build`:
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node e2e/integration-shots.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = 8793;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve('docs/screenshots');
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
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch();
// Full brightness whatever the clock says, so a shot taken in the evening isn't dimmed.
const bright = (page) =>
  // eslint-disable-next-line no-undef
  page.evaluate(() => document.documentElement.style.setProperty('--brightness', '100'));
const settle = async (page) => {
  // eslint-disable-next-line no-undef
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};
try {
  for (const [name, viewport] of [
    ['ipad', { width: 1180, height: 820 }],
    ['surface', { width: 1440, height: 960 }],
  ]) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/?mode=daylight`);
    const dock = page.getByRole('navigation', { name: 'Screens' });
    await dock.getByRole('button', { name: 'Lists' }).click();
    await dock.getByRole('button', { name: 'Show Sam' }).click();
    await page.locator('.lgrid li.pf-dim').first().waitFor();
    await settle(page);
    await bright(page);
    await page.screenshot({ path: path.join(out, `v3-int-lists-filter-${name}.png`) });
    await page.getByRole('tab', { name: /Chore chart/ }).click();
    await page.getByRole('button', { name: 'This week' }).click();
    await dock.getByRole('button', { name: 'Show Ava' }).click();
    await page.getByRole('region', { name: "Leo's chores" }).waitFor();
    await settle(page);
    await bright(page);
    await page.screenshot({ path: path.join(out, `v3-int-chores-filter-${name}.png`) });
    await ctx.close();
  }
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const p = await phone.newPage();
  await p.goto(`${base}/app#meals`);
  await p.getByRole('heading', { name: 'Meals' }).waitFor();
  const gotIt = p.getByRole('button', { name: 'Got it' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await settle(p);
  await p.screenshot({ path: path.join(out, 'v3-c-phone-meals.png') });
  await phone.close();
} finally {
  await browser.close();
  server.kill();
}

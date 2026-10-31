/**
 * Gallery screenshots for the skins PR: every skin on Today, Month and Home in both looks as one
 * contact sheet per skin (`docs/screenshots/v2-e-<skin>.png`), plus the gallery page and the
 * Appearance controls. Run after `pnpm build`:
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node e2e/skin-shots.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 8791;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve('docs/screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-shots-'));
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

const skins = fs
  .readdirSync('apps/display/src/styles/skins')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join('apps/display/src/styles/skins', f), 'utf8')));
const order = [
  'mantel',
  'slate',
  'paper',
  'midnight',
  'chalkboard',
  'poster',
  'harvest',
  'frost',
  'bloom',
  'shore',
  'harvest-night',
  'lights',
];
skins.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1180, height: 820 },
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));

async function settle() {
  // eslint-disable-next-line no-undef
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shot(url, file) {
  await page.goto(`${base}${url}`);
  await page.getByRole('navigation', { name: 'Screens' }).waitFor();
  await settle();
  await page.screenshot({ path: file });
}

for (const skin of skins) {
  const cells = [];
  for (const mode of ['daylight', 'dusk']) {
    for (const screen of ['today', 'month', 'home']) {
      const file = path.join(tmp, `${skin.id}-${mode}-${screen}.png`);
      await shot(`/?mode=${mode}&skin=${skin.id}&screen=${screen}`, file);
      cells.push({ file, label: `${screen[0].toUpperCase()}${screen.slice(1)} · ${mode}` });
    }
  }
  // One contact sheet per skin: three screens across, Daylight over Dusk.
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 1820, height: 920 });
  const html = `<!doctype html><html><body style="margin:0;background:#1a1a1a;font:600 15px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#eee">
    <div style="display:flex;align-items:baseline;gap:14px;padding:18px 20px 8px"><span style="font-size:24px">${skin.name}</span><span style="color:#aaa">${skin.description ?? ''}</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,590px);gap:10px;padding:0 20px 20px">
      ${cells
        .map(
          (c) =>
            `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(c.file).toString('base64')}" style="display:block;width:590px;height:410px;border-radius:8px"><figcaption style="padding:6px 2px 0;color:#bbb;font-weight:500">${c.label}</figcaption></figure>`,
        )
        .join('')}
    </div></body></html>`;
  await sheet.setContent(html);
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: path.join(out, `v2-e-${skin.id}.png`), fullPage: true });
  await sheet.close();
  console.log('sheet', skin.id);
}

// The gallery page and the Appearance controls, at iPad and Surface sizes.
await page.goto(`${base}/demo/skins?skin=harvest&mode=daylight&screen=today`);
await page.getByRole('heading', { name: 'Skins' }).waitFor();
await settle();
await page.screenshot({ path: path.join(out, 'v2-e-gallery-ipad.png') });
await page.getByRole('heading', { name: 'Try the controls' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'v2-e-appearance-ipad.png') });

await page.setViewportSize({ width: 1440, height: 960 });
await page.goto(`${base}/demo/skins?skin=poster&mode=dusk&screen=month`);
await page.getByRole('heading', { name: 'Skins' }).waitFor();
await settle();
await page.screenshot({ path: path.join(out, 'v2-e-gallery-surface.png') });
await page.getByRole('button', { name: 'Create your own' }).click();
await page.getByRole('button', { name: 'Use this skin' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'v2-e-create-your-own-surface.png') });

// A Surface-sized wall shot of two skins, as the panel actually fits.
await shot(
  '/?mode=daylight&skin=poster&screen=today',
  path.join(out, 'v2-e-surface-poster-today.png'),
);
await shot(
  '/?mode=dusk&skin=harvest-night&screen=today',
  path.join(out, 'v2-e-surface-harvest-night-today.png'),
);

await browser.close();
server.kill();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('done →', out);

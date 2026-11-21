/**
 * `node dist/index.js --check`: starts Mantel in-process against the real data folder, asks it
 * for its health and its display page, and exits 0 when both answer. The snap's post-refresh
 * hook runs it after every update: a non-zero exit makes snapd undo the update and put the
 * previous version and its data back (packaging/snap/hooks/post-refresh).
 */
import { createApp } from './app.js';
import type { Config } from './config.js';

export async function runSelfCheck(config: Config, out = console): Promise<number> {
  const problems: string[] = [];
  let app: ReturnType<typeof createApp> | null = null;
  try {
    // Image processing is a native module too; load it so a broken build fails here.
    await import('sharp').catch((err: unknown) => problems.push(`sharp: ${String(err)}`));
    // No box features (Wi-Fi, hotspot) and no update check while checking.
    app = createApp({ ...config, MANTEL_BOX: '', UPDATE_CHECK: false });
    await app.ready;
    const health = await app.app.request('/api/health');
    const body = (await health.json().catch(() => null)) as {
      ok?: boolean;
      version?: string;
    } | null;
    if (!health.ok || body?.ok !== true) problems.push(`health answered ${health.status}`);
    else out.log(`mantel check: server ${body.version ?? ''} healthy`);
    if (config.DISPLAY_DIST) {
      const page = await app.app.request('/');
      const html = await page.text();
      if (!page.ok || !/<html/i.test(html)) problems.push(`display page answered ${page.status}`);
      else out.log('mantel check: display page served');
    }
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    app?.close();
  }
  for (const p of problems) out.error(`mantel check failed: ${p}`);
  return problems.length ? 1 : 0;
}

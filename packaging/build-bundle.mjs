#!/usr/bin/env node
/**
 * Assembles a self-contained Mantel folder for the platform this script runs on:
 *
 *   <out>/node(.exe)   the Node that runs this script, so the bundle needs no install
 *   <out>/app/         the server (dist/index.js), its production node_modules (with this
 *                      platform's native SQLite and image binaries) and the built display
 *
 * Run `pnpm build` first. Usage: node packaging/build-bundle.mjs <out-dir> [version]
 * The Windows installer and the Mac/Linux archives are made from this folder in CI
 * (.github/workflows/package.yml); see packaging/README.md.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node packaging/build-bundle.mjs <out-dir>');
  process.exit(2);
}
for (const need of ['apps/server/dist/index.js', 'apps/display/dist/index.html']) {
  if (!existsSync(join(root, need))) {
    console.error(`missing ${need}: run "pnpm build" first`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Production dependencies only, laid out flat ("hoisted") as real files rather than pnpm's
// symlinks, so the folder can be moved, zipped or installed anywhere.
const app = join(out, 'app');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(pnpm, ['--filter', '@mantel/server', 'deploy', '--prod', '--legacy', app], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, npm_config_node_linker: 'hoisted' },
});
cpSync(join(root, 'apps/server/dist'), join(app, 'dist'), { recursive: true });
cpSync(join(root, 'apps/display/dist'), join(app, 'display'), { recursive: true });

// Values the app reads at start: its version, and Mantel's shared Google sign-in client when the
// build has it (the same Desktop client the container image carries; see docs/google-shared-client.md).
const version = process.argv[3] ?? '';
const builtin = [
  version && `MANTEL_VERSION=${version}`,
  process.env.MANTEL_GOOGLE_CLIENT_ID &&
    `MANTEL_GOOGLE_CLIENT_ID=${process.env.MANTEL_GOOGLE_CLIENT_ID}`,
  process.env.MANTEL_GOOGLE_CLIENT_SECRET &&
    `MANTEL_GOOGLE_CLIENT_SECRET=${process.env.MANTEL_GOOGLE_CLIENT_SECRET}`,
].filter(Boolean);
writeFileSync(join(app, 'builtin.env'), builtin.join('\n') + '\n');

const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
cpSync(process.execPath, join(out, nodeName));

writeFileSync(
  join(out, 'bundle.json'),
  JSON.stringify(
    { platform: process.platform, arch: process.arch, node: process.version },
    null,
    2,
  ),
);
console.log(`bundle ready: ${out} (node ${process.version}, ${process.platform}-${process.arch})`);

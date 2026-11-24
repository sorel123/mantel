#!/usr/bin/env node
/**
 * Assembles a self-contained Mantel folder for the platform this script runs on:
 *
 *   <out>/node(.exe)   the Node that runs this script, so the bundle needs no install
 *   <out>/app/         the server as one file (dist/index.js, its JavaScript dependencies
 *                      bundled in), node_modules with only the packages that carry native
 *                      binaries (SQLite, image processing) for this platform, and the built display
 *
 * Run `pnpm build` first. Usage: node packaging/build-bundle.mjs <out-dir> [version]
 * The Windows installer and the Mac/Linux archives are made from this folder in CI
 * (.github/workflows/package.yml); see packaging/README.md.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

// The server as one file with its JavaScript dependencies inside (apps/server/tsup.bundle.config.ts).
// A full node_modules is about 12,000 small files, and Windows Defender scans every one as the
// installer writes it, which made installing on a Surface take half an hour.
execFileSync(
  pnpm,
  ['--filter', '@mantel/server', 'exec', 'tsup', '--config', 'tsup.bundle.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
cpSync(join(root, 'apps/server/dist-bundle'), join(app, 'dist'), { recursive: true });
pruneToNative(join(app, 'node_modules'));

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

/**
 * Keeps only the packages the bundled server still loads from node_modules (the native ones
 * listed in tsup.bundle.config.ts) and what they depend on, and drops type declarations, source
 * maps, docs and native build sources that nothing reads at run time.
 */
function pruneToNative(modules) {
  const config = readFileSync(join(root, 'apps/server/tsup.bundle.config.ts'), 'utf8');
  const list = /bundleExternal = \[([^\]]*)\]/.exec(config);
  if (!list) throw new Error('bundleExternal not found in apps/server/tsup.bundle.config.ts');
  const keep = new Set();
  // Used only to fetch or compile the native binary when installing, never at run time.
  const installOnly = new Set(['prebuild-install', 'node-gyp', 'nan', 'node-addon-api']);
  const visit = (name) => {
    if (keep.has(name) || installOnly.has(name) || !existsSync(join(modules, name, 'package.json')))
      return;
    keep.add(name);
    const pkg = JSON.parse(readFileSync(join(modules, name, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep);
  };
  for (const m of list[1].matchAll(/'([^']+)'/g)) visit(m[1]);

  for (const entry of readdirSync(modules)) {
    if (entry === '.bin' || entry.startsWith('.')) {
      rmSync(join(modules, entry), { recursive: true, force: true });
      continue;
    }
    const names = entry.startsWith('@')
      ? readdirSync(join(modules, entry)).map((n) => `${entry}/${n}`)
      : [entry];
    for (const name of names) {
      if (!keep.has(name)) rmSync(join(modules, name), { recursive: true, force: true });
    }
    if (entry.startsWith('@') && readdirSync(join(modules, entry)).length === 0) {
      rmSync(join(modules, entry), { recursive: true, force: true });
    }
  }

  const junk = /\.(d\.[cm]?ts|map|md|markdown|cc|cpp|c|h|hpp|gyp|gypi|mk)$/i;
  const junkDirs = new Set(['deps', 'src', 'docs', 'test', 'tests', 'obj', 'obj.target', '.deps']);
  const sweep = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // better-sqlite3 ships its C sources in deps/ and src/; the built binary is in build/Release.
        if (junkDirs.has(e.name)) rmSync(p, { recursive: true, force: true });
        else sweep(p);
      } else if (junk.test(e.name) && !/^license/i.test(e.name)) {
        rmSync(p, { force: true });
      }
    }
  };
  sweep(modules);
  console.log(`node_modules kept for native code: ${[...keep].sort().join(', ')}`);
}

import { defineConfig } from 'tsup';

// The downloadable apps (packaging/build-bundle.mjs) ship the server as one file with its
// JavaScript dependencies inside, so the installer writes a few hundred files instead of
// twelve thousand (Windows Defender scans each one, which made the Windows install take ages).
// Only packages with native binaries stay in node_modules (packaging/build-bundle.mjs keeps them
// and what they load at run time). The rest of this list are optional native add-ons that their
// packages load only when present.
export const bundleExternal = [
  'better-sqlite3',
  'sharp',
  'bufferutil',
  'utf-8-validate',
  'usocket',
  'x11',
];

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist-bundle',
  clean: true,
  splitting: false,
  sourcemap: false,
  // tsup's noExternal would win over its own external list, so hand the list to esbuild directly.
  noExternal: [/.*/],
  esbuildOptions(options) {
    options.external = bundleExternal;
  },
  // CommonJS dependencies bundled into an ES module still call require() and use __dirname.
  banner: {
    js: [
      "import { createRequire as __mantelCreateRequire } from 'node:module';",
      "import { fileURLToPath as __mantelFileURLToPath } from 'node:url';",
      "import { dirname as __mantelDirname } from 'node:path';",
      'const require = __mantelCreateRequire(import.meta.url);',
      'const __filename = __mantelFileURLToPath(import.meta.url);',
      'const __dirname = __mantelDirname(__filename);',
    ].join('\n'),
  },
});

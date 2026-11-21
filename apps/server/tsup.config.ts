import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // One file: a shared chunk would load before env-files.ts reads builtin.env (version, Google client).
  splitting: false,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep real dependencies external.
  noExternal: ['@mantel/shared'],
});

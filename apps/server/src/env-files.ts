import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads env files before anything else reads process.env (imported first by index.ts, since
 * module-level constants such as VERSION are fixed at import time).
 */
// `builtin.env` sits beside dist/ in packaged apps (version, shared Google sign-in); a `.env`
// in the working folder is for settings typed by hand and wins over it.
const builtin = fileURLToPath(new URL('../builtin.env', import.meta.url));
for (const file of ['.env', '../../.env', builtin]) if (existsSync(file)) process.loadEnvFile(file);

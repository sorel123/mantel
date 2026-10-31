import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { log, setLogLevel } from './log.js';
import { VERSION } from './version.js';

for (const file of ['.env', '../../.env']) if (existsSync(file)) process.loadEnvFile(file);

const config = loadConfig();
setLogLevel(config.LOG_LEVEL);
const { app, deps, close } = createApp(config);

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  log.info(
    `mantel server ${VERSION} on http://${config.HOST}:${info.port}${config.MOCK ? ' (MOCK mode)' : ''}`,
  );
  if (config.MOCK) log.info('Mock mode: no pairing needed; code 000000 also pairs.');
  deps.auth.currentCode();
}) as Server;
deps.hub.attach(server);

const shutdown = () => {
  log.info('shutting down');
  close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';

const config = loadConfig();
const db = openDb(config.dataDir);
const app = await buildApp(config, db, { logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
if (config.devLogin) app.log.warn('DEV_LOGIN включён: вход по имени без passkey');

import { config, corsOrigins } from './config';
import { createDb } from './db';
import { buildApp } from './app';

const dbh = await createDb({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR });
const { app } = await buildApp({
  dbh,
  corsOrigin: corsOrigins(),
  region: config.SERVER_REGION,
  sessionDays: config.SESSION_DAYS,
  logger: { level: config.LOG_LEVEL },
});

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`GTA 7 ONLINE server em http://${config.HOST}:${config.PORT} (db: ${dbh.kind})`);

let closing = false;
async function shutdown(sig: string) {
  if (closing) return;
  closing = true;
  app.log.info({ sig }, 'encerrando: salvando jogadores...');
  try { await app.close(); await dbh.close(); } finally { process.exit(0); }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

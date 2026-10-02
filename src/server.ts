import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db';
import { analyticsService } from './analytics/analytics.service';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`🍽️  Mesa a Dois API rodando em http://localhost:${env.PORT}`);
});

function purgeAnalytics() {
  analyticsService.purgeOld().catch((e) => console.error('[analytics] limpeza falhou', e));
}
purgeAnalytics();
const purgeTimer = setInterval(purgeAnalytics, PURGE_INTERVAL_MS);
purgeTimer.unref();

async function shutdown() {
  clearInterval(purgeTimer);
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`🍽️  Mesa a Dois API rodando em http://localhost:${env.PORT}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

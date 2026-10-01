import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

async function main() {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  console.log('[migrate] banco atualizado.');
}

main()
  .catch((e) => {
    console.error('[migrate] falhou:', e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

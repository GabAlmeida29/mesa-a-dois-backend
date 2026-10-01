import bcrypt from 'bcryptjs';
import { db, pool } from './index';
import { users } from './schema';
import { destroyAllSessions } from '../auth/session';
import { isProd } from '../config/env';
import { passwordProblem } from '../auth/password-policy';

async function upsertUser(name: string, email?: string, password?: string) {
  if (!email || !password) {
    console.warn(`[seed] ${name}: e-mail/senha não definidos no .env — ignorado.`);
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    if (isProd) throw new Error(`[seed] senha de ${name} recusada: ${problem}`);
    console.warn(`[seed] ⚠️  senha fraca para ${name} (${problem}) — aceita só fora de produção.`);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ name, email: email.toLowerCase(), passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    })
    .returning({ id: users.id });

  await destroyAllSessions(user.id);
  console.log(`[seed] usuário ${name} pronto (${email}).`);
}

async function main() {
  await upsertUser('Gabriel', process.env.SEED_GABRIEL_EMAIL, process.env.SEED_GABRIEL_PASSWORD);
  await upsertUser('Milena', process.env.SEED_MILENA_EMAIL, process.env.SEED_MILENA_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, pool } from './index';
import { users } from './schema';
import { destroyAllSessions } from '../auth/session';
import { isProd } from '../config/env';
import { passwordProblem } from '../auth/password-policy';

interface SeedUser {
  name: string;
  email?: string;
  password?: string;
  profile: { avatarUrl: string; instagram: string; headline: string; bio: string };
}

const SEED_USERS: SeedUser[] = [
  {
    name: 'Gabriel',
    email: process.env.SEED_GABRIEL_EMAIL,
    password: process.env.SEED_GABRIEL_PASSWORD,
    profile: {
      avatarUrl: '/about/gabriel.webp',
      instagram: 'gabalmeida29',
      headline: 'Desenvolvedor & provador oficial de sobremesas',
      bio: 'Desenvolvedor, curioso por natureza. Construiu este site e não recusa um bom hambúrguer artesanal — nem uma segunda sobremesa.',
    },
  },
  {
    name: 'Milena',
    email: process.env.SEED_MILENA_EMAIL,
    password: process.env.SEED_MILENA_PASSWORD,
    profile: {
      avatarUrl: '/about/milena.webp',
      instagram: 'mih_denardi',
      headline: 'Estudante de Psicologia & crítica exigente',
      bio: 'Repara em cada detalhe: do atendimento ao empratamento. É quem escolhe os lugares novos e quem dá a palavra final sobre voltar ou não.',
    },
  },
];

const keepExisting = (column: AnyPgColumn, fallback: string) => sql`coalesce(${column}, ${fallback})`;

async function upsertUser({ name, email, password, profile }: SeedUser) {
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
    .values({ name, email: email.toLowerCase(), passwordHash, role: 'admin', showOnAbout: true, ...profile })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        avatarUrl: keepExisting(users.avatarUrl, profile.avatarUrl),
        instagram: keepExisting(users.instagram, profile.instagram),
        headline: keepExisting(users.headline, profile.headline),
        bio: keepExisting(users.bio, profile.bio),
      },
    })
    .returning({ id: users.id });

  await destroyAllSessions(user.id);
  console.log(`[seed] usuário ${name} pronto (${email}).`);
}

async function main() {
  for (const user of SEED_USERS) await upsertUser(user);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

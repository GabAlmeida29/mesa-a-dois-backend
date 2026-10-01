import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../db/schema';
import { env } from '../config/env';
import { HttpError } from '../lib/http-error';
import { loginSchema } from '../schemas';
import { decryptSecret, verifyTotp } from '../auth/totp';

type Credentials = z.infer<typeof loginSchema>;
type UserRow = typeof users.$inferSelect;

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';
const DUMMY_HASH = bcrypt.hashSync('mesa-a-dois-dummy', 12);

const isLocked = (user: UserRow) => Boolean(user.lockedUntil && user.lockedUntil > new Date());

async function registerFailure(user: UserRow) {
  const attempts = user.failedLoginAttempts + 1;
  const lock = attempts >= env.LOGIN_MAX_ATTEMPTS;
  await db
    .update(users)
    .set({
      failedLoginAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) : null,
    })
    .where(eq(users.id, user.id));
}

async function resetFailures(user: UserRow) {
  await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
}

async function verifySecondFactor(user: UserRow, code: string | undefined) {
  if (!user.totpSecret) {
    if (env.REQUIRE_2FA) {
      throw new HttpError(403, 'Esta conta ainda não tem verificação em duas etapas ativada.', undefined, {
        mfaSetupRequired: true,
      });
    }
    return;
  }

  if (!code) {
    throw new HttpError(401, 'Informe o código do autenticador', undefined, { mfaRequired: true });
  }

  const step = verifyTotp(decryptSecret(user.totpSecret), code, user.totpLastStep);
  if (step === null) {
    await registerFailure(user);
    throw new HttpError(401, 'Código inválido', undefined, { mfaRequired: true });
  }
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
}

export const authService = {
  async authenticate({ email, password, code }: Credentials) {
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user) throw new HttpError(401, INVALID_CREDENTIALS);
    if (isLocked(user)) throw new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');
    if (!passwordOk) {
      await registerFailure(user);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    await verifySecondFactor(user, code);
    await resetFailures(user);
    return { id: user.id, name: user.name, email: user.email };
  },
};

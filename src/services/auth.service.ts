import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { users, type User } from '../db/schema';
import { env } from '../config/env';
import { HttpError } from '../lib/http-error';
import { loginSchema } from '../schemas';
import { toSessionUser } from '../mappers/user.mapper';
import { decryptSecret, encryptSecret, generateTotpSecret, otpauthUrl, verifyTotp } from '../auth/totp';

type Credentials = z.infer<typeof loginSchema>;

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos';
const WRONG_PASSWORD = 'Senha atual incorreta';
const DUMMY_HASH = bcrypt.hashSync('mesa-a-dois-dummy', 12);
const ENROLLMENT_TTL_MS = 10 * 60 * 1000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const isLocked = (user: User) => Boolean(user.lockedUntil && user.lockedUntil > new Date());

async function registerFailure(user: User) {
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

async function markLogin(user: User) {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
}

export async function startEnrollment(user: User) {
  const secret = generateTotpSecret();
  const token = randomBytes(32).toString('base64url');
  await db
    .update(users)
    .set({
      totpPendingSecret: encryptSecret(secret),
      enrollmentTokenHash: sha256(token),
      enrollmentExpiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
    })
    .where(eq(users.id, user.id));

  const url = otpauthUrl(secret, user.email);
  const qrCode = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  return { enrollmentToken: token, secret, otpauthUrl: url, qrCode };
}

async function verifySecondFactor(user: User, code: string | undefined) {
  if (!user.totpSecret) {
    if (env.REQUIRE_2FA) {
      throw new HttpError(403, 'Configure a verificação em duas etapas para continuar.', undefined, {
        mfaSetupRequired: true,
        enrollment: await startEnrollment(user),
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
    await markLogin(user);
    return toSessionUser(user);
  },

  async completeEnrollment(token: string, code: string) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.enrollmentTokenHash, sha256(token)), gt(users.enrollmentExpiresAt, new Date())),
    });
    if (!user?.totpPendingSecret) {
      throw new HttpError(400, 'Configuração expirada. Faça login novamente para gerar um novo QR code.');
    }
    if (isLocked(user)) throw new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');

    const secret = decryptSecret(user.totpPendingSecret);
    const step = verifyTotp(secret, code, null);
    if (step === null) {
      await registerFailure(user);
      throw new HttpError(400, 'Código inválido. Confira o app e tente de novo.');
    }

    await db
      .update(users)
      .set({
        totpSecret: user.totpPendingSecret,
        totpLastStep: step,
        totpPendingSecret: null,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
      })
      .where(eq(users.id, user.id));
    await markLogin(user);
    return toSessionUser(user);
  },

  async confirmPassword(userId: string, password: string) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new HttpError(401, 'Não autenticado');
    if (isLocked(user)) throw new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await registerFailure(user);
      throw new HttpError(400, WRONG_PASSWORD, { currentPassword: [WRONG_PASSWORD] });
    }
    return user;
  },
};

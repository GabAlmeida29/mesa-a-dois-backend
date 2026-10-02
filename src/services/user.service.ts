import bcrypt from 'bcryptjs';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { sessions, users, type User } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { passwordProblem } from '../auth/password-policy';
import { createUserSchema, updateUserSchema } from '../schemas';

type CreateUser = Omit<z.infer<typeof createUserSchema>, 'currentPassword'>;
type UpdateUser = z.infer<typeof updateUserSchema>;

const BCRYPT_COST = 12;

function toUserDto(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    twoFactorEnabled: Boolean(user.totpSecret),
    lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export type UserDto = ReturnType<typeof toUserDto>;

async function hashPassword(password: string) {
  const problem = passwordProblem(password);
  if (problem) {
    const message = `Senha fraca: ${problem}`;
    throw new HttpError(400, message, { password: [message] });
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

async function findOrFail(id: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) throw HttpError.notFound('Usuário');
  return user;
}

async function assertEmailFree(email: string, exceptId?: string) {
  const taken = await db.query.users.findFirst({
    where: exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email),
  });
  if (taken) {
    const message = 'Já existe um usuário com esse e-mail';
    throw new HttpError(409, message, { email: [message] });
  }
}

async function endSessions(userId: string, keepSessionId?: string) {
  await db
    .delete(sessions)
    .where(
      keepSessionId
        ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
        : eq(sessions.userId, userId),
    );
}

export const userService = {
  async list() {
    const rows = await db.query.users.findMany({ orderBy: asc(users.createdAt) });
    return rows.map(toUserDto);
  },

  async create({ name, email, password }: CreateUser) {
    await assertEmailFree(email);
    const [created] = await db
      .insert(users)
      .values({ name, email, passwordHash: await hashPassword(password) })
      .returning();
    return toUserDto(created);
  },

  async update(id: string, data: UpdateUser) {
    await findOrFail(id);
    if (data.email) await assertEmailFree(data.email, id);
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return toUserDto(updated);
  },

  async setPassword(id: string, password: string, keepSessionId?: string) {
    await findOrFail(id);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, id));
    await endSessions(id, keepSessionId);
  },

  async resetTwoFactor(id: string) {
    await findOrFail(id);
    await db
      .update(users)
      .set({
        totpSecret: null,
        totpLastStep: null,
        totpPendingSecret: null,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
      })
      .where(eq(users.id, id));
    await endSessions(id);
  },

  async unlock(id: string) {
    await findOrFail(id);
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
  },

  async endOtherSessions(userId: string, keepSessionId: string) {
    await endSessions(userId, keepSessionId);
  },

  async remove(id: string, actingUserId: string) {
    if (id === actingUserId) throw new HttpError(400, 'Você não pode excluir o próprio usuário');
    await findOrFail(id);
    const [{ total }] = await db.select({ total: count() }).from(users);
    if (total <= 1) throw new HttpError(400, 'É preciso manter ao menos um usuário');
    await db.delete(users).where(eq(users.id, id));
  },
};

import bcrypt from 'bcryptjs';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { sessions, users, type User } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { passwordProblem } from '../auth/password-policy';
import { isAdmin, type Role } from '../domain/permissions';
import { toManagedUserDto, toProfileDto, toTeamMemberDto } from '../mappers/user.mapper';
import { createUserSchema, profileSchema, updateUserSchema } from '../schemas';
import { storage } from '../storage';

type CreateUser = Omit<z.infer<typeof createUserSchema>, 'currentPassword'>;
type UpdateUser = z.infer<typeof updateUserSchema>;
type ProfileUpdate = z.infer<typeof profileSchema>;

const BCRYPT_COST = 12;

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

async function adminCount() {
  const [{ total }] = await db.select({ total: count() }).from(users).where(eq(users.role, 'admin'));
  return total;
}

async function assertKeepsAnAdmin(target: User, nextRole?: Role) {
  const losesAdmin = isAdmin(target) && nextRole !== 'admin';
  if (losesAdmin && (await adminCount()) <= 1) {
    throw new HttpError(400, 'É preciso manter ao menos um administrador');
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

const accessColumns = (role: Role, permissions: string[]) => ({
  role,
  permissions: role === 'admin' ? [] : [...new Set(permissions)],
});

export const userService = {
  async list() {
    const rows = await db.query.users.findMany({ orderBy: asc(users.createdAt) });
    return rows.map(toManagedUserDto);
  },

  async team() {
    const rows = await db.query.users.findMany({
      where: eq(users.showOnAbout, true),
      orderBy: asc(users.createdAt),
    });
    return rows.map(toTeamMemberDto);
  },

  async profile(id: string) {
    return toProfileDto(await findOrFail(id));
  },

  async create({ name, email, password, role, permissions }: CreateUser) {
    await assertEmailFree(email);
    const [created] = await db
      .insert(users)
      .values({
        name,
        email,
        passwordHash: await hashPassword(password),
        ...accessColumns(role, permissions),
      })
      .returning();
    return toManagedUserDto(created);
  },

  async update(id: string, data: UpdateUser, actingUserId: string) {
    const target = await findOrFail(id);
    if (data.email) await assertEmailFree(data.email, id);

    const changesAccess = data.role !== undefined || data.permissions !== undefined;
    if (changesAccess && id === actingUserId) {
      throw new HttpError(400, 'Você não pode alterar as próprias permissões');
    }
    const role = data.role ?? (target.role as Role);
    if (changesAccess) await assertKeepsAnAdmin(target, role);

    const [updated] = await db
      .update(users)
      .set({
        name: data.name,
        email: data.email,
        ...(changesAccess ? accessColumns(role, data.permissions ?? target.permissions) : {}),
      })
      .where(eq(users.id, id))
      .returning();
    return toManagedUserDto(updated);
  },

  async updateProfile(id: string, data: ProfileUpdate) {
    const current = await findOrFail(id);
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    if (data.avatarUrl !== undefined && current.avatarUrl && current.avatarUrl !== data.avatarUrl) {
      await storage.remove(current.avatarUrl);
    }
    return toProfileDto(updated);
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
    const target = await findOrFail(id);
    await assertKeepsAnAdmin(target);
    await db.delete(users).where(eq(users.id, id));
    if (target.avatarUrl) await storage.remove(target.avatarUrl);
  },
};

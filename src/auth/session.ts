import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { env } from '../config/env';
import { toSessionUser } from '../mappers/user.mapper';

export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-mesa_session' : 'mesa_session';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function cookieOptions(maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export async function createSession(req: Request, res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = env.SESSION_TTL_HOURS * 3600 * 1000;
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    ip: req.ip?.slice(0, 64) ?? null,
  });

  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  res.cookie(SESSION_COOKIE, token, cookieOptions(env.SESSION_PERSISTENT ? ttlMs : undefined));
}

export async function findSession(token: string | undefined) {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({ sessionId: sessions.id, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (env.REQUIRE_2FA && !row.user.totpSecret) return null;
  return { sessionId: row.sessionId, user: toSessionUser(row.user) };
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function destroyAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

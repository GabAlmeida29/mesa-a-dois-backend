import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from '../lib/http-error';
import { SESSION_COOKIE, findSession } from '../auth/session';
import { hasPermission, isAdmin, type Permission } from '../domain/permissions';
import type { SessionUser } from '../mappers/user.mapper';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

const FORBIDDEN = 'Você não tem permissão para esta ação';

function guard(isAllowed: (user: SessionUser) => boolean): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const session = await findSession(req.cookies?.[SESSION_COOKIE]);
    if (!session) return next(new HttpError(401, 'Não autenticado'));
    if (!isAllowed(session.user)) return next(new HttpError(403, FORBIDDEN));
    req.user = session.user;
    req.sessionId = session.sessionId;
    return next();
  };
}

export const requireAuth = guard(() => true);
export const requireAdmin = guard(isAdmin);
export const requirePermission = (permission: Permission) => guard((user) => hasPermission(user, permission));

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http-error';
import { SESSION_COOKIE, findSession } from '../auth/session';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const session = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) return next(new HttpError(401, 'Não autenticado'));
  req.user = { id: session.id, name: session.name, email: session.email };
  req.sessionId = session.sessionId;
  return next();
}

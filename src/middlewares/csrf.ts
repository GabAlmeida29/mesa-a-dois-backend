import type { NextFunction, Request, Response } from 'express';
import { corsOrigins } from '../config/env';
import { HttpError } from '../lib/http-error';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'mesa-a-dois') {
    return next(new HttpError(403, 'Requisição bloqueada'));
  }
  const origin = req.get('origin');
  if (origin && !corsOrigins.includes(origin)) {
    return next(new HttpError(403, 'Origem não permitida'));
  }
  return next();
}

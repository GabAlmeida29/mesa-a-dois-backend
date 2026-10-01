import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { HttpError } from '../lib/http-error';

const INVALID_TEXT_REPRESENTATION = '22P02';

function postgresErrorCode(err: unknown): string | undefined {
  const error = err as { code?: string; cause?: { code?: string } };
  return error?.code ?? error?.cause?.code;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details, ...err.flags });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Dados inválidos', details: err.flatten().fieldErrors });
  }
  if (err instanceof MulterError) {
    return res.status(400).json({ message: `Upload inválido: ${err.message}` });
  }

  if (postgresErrorCode(err) === INVALID_TEXT_REPRESENTATION) {
    return res.status(404).json({ message: 'Registro não encontrado' });
  }
  console.error('[erro não tratado]', err);
  return res.status(500).json({ message: 'Erro interno' });
}

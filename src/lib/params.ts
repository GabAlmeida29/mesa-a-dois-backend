import { z } from 'zod';
import { HttpError } from './http-error';

const uuid = z.string().uuid();

export function parseId(value: unknown, label = 'Registro'): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new HttpError(404, `${label} não encontrado`);
  return parsed.data;
}

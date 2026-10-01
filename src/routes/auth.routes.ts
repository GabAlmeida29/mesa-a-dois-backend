import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { loginSchema } from '../schemas';
import { requireAuth } from '../middlewares/auth';
import { createSession, destroySession } from '../auth/session';
import { authService } from '../services/auth.service';

export const authRoutes = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

authRoutes.post('/login', loginLimiter, async (req, res) => {
  const user = await authService.authenticate(loginSchema.parse(req.body));
  await createSession(req, res, user.id);
  res.json({ user });
});

authRoutes.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

authRoutes.get('/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

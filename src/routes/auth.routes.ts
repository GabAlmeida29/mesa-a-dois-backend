import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { enrollSchema, loginSchema, reauthSchema, updateUserSchema } from '../schemas';
import { requireAuth } from '../middlewares/auth';
import { createSession, destroyAllSessions, destroySession } from '../auth/session';
import { authService, startEnrollment } from '../services/auth.service';
import { userService } from '../services/user.service';

export const authRoutes = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

authRoutes.post('/login', authLimiter, async (req, res) => {
  const user = await authService.authenticate(loginSchema.parse(req.body));
  await createSession(req, res, user.id);
  res.json({ user });
});

authRoutes.post('/2fa/enroll', authLimiter, async (req, res) => {
  const { enrollmentToken, code } = enrollSchema.parse(req.body);
  const user = await authService.completeEnrollment(enrollmentToken, code);
  await destroyAllSessions(user.id);
  await createSession(req, res, user.id);
  res.json({ user });
});

authRoutes.post('/2fa/setup', requireAuth, authLimiter, async (req, res) => {
  const user = await authService.confirmPassword(req.user!.id, reauthSchema.parse(req.body).currentPassword);
  res.set('Cache-Control', 'no-store');
  res.json(await startEnrollment(user));
});

authRoutes.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
});

authRoutes.post('/logout-others', requireAuth, async (req, res) => {
  await userService.endOtherSessions(req.user!.id, req.sessionId!);
  res.status(204).end();
});

authRoutes.get('/me', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

authRoutes.put('/me', requireAuth, async (req, res) => {
  const { name } = updateUserSchema.pick({ name: true }).parse(req.body);
  const user = await userService.update(req.user!.id, { name });
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

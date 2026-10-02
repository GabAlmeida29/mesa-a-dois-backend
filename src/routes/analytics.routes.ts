import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { requireAuth } from '../middlewares/auth';
import { analyticsQuerySchema, collectSchema } from '../schemas';
import { analyticsService } from '../analytics/analytics.service';

export const analyticsRoutes = Router();

const collectLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

analyticsRoutes.post('/collect', collectLimiter, async (req, res) => {
  const parsed = collectSchema.safeParse(req.body);
  if (parsed.success) await analyticsService.collect(req, parsed.data);
  res.status(204).end();
});

analyticsRoutes.get('/summary', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await analyticsService.summary(analyticsQuerySchema.parse(req.query)));
});

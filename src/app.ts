import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { corsOrigins, env } from './config/env';
import { authRoutes } from './routes/auth.routes';
import { restaurantRoutes } from './routes/restaurants.routes';
import { uploadRoutes } from './routes/upload.routes';
import { userRoutes } from './routes/users.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { errorHandler } from './middlewares/error';
import { csrfProtection } from './middlewares/csrf';
import { HttpError } from './lib/http-error';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  if (env.STORAGE_DRIVER === 'local') {
    app.use(
      '/uploads',
      express.static(path.resolve(env.UPLOAD_DIR), {
        maxAge: '365d',
        immutable: true,
        dotfiles: 'deny',
        index: false,
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      }),
    );
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', csrfProtection);
  app.use('/api/auth', authRoutes);
  app.use('/api/restaurants', restaurantRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/analytics', analyticsRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
  app.use(errorHandler);
  return app;
}

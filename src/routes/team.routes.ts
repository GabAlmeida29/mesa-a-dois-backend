import { Router } from 'express';
import { userService } from '../services/user.service';

export const teamRoutes = Router();

teamRoutes.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await userService.team());
});

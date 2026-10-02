import { Router } from 'express';
import { parseId } from '../lib/params';
import { requireAuth } from '../middlewares/auth';
import { createUserSchema, reauthSchema, setPasswordSchema, updateUserSchema } from '../schemas';
import { authService } from '../services/auth.service';
import { userService } from '../services/user.service';

export const userRoutes = Router();

const userId = (value: unknown) => parseId(value, 'Usuário');

userRoutes.use(requireAuth);

userRoutes.get('/', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await userService.list());
});

userRoutes.post('/', async (req, res) => {
  const { currentPassword, ...data } = createUserSchema.parse(req.body);
  await authService.confirmPassword(req.user!.id, currentPassword);
  res.status(201).json(await userService.create(data));
});

userRoutes.put('/:id', async (req, res) => {
  res.json(await userService.update(userId(req.params.id), updateUserSchema.parse(req.body)));
});

userRoutes.post('/:id/password', async (req, res) => {
  const id = userId(req.params.id);
  const { password, currentPassword } = setPasswordSchema.parse(req.body);
  await authService.confirmPassword(req.user!.id, currentPassword);
  await userService.setPassword(id, password, id === req.user!.id ? req.sessionId : undefined);
  res.status(204).end();
});

userRoutes.post('/:id/reset-2fa', async (req, res) => {
  const id = userId(req.params.id);
  await authService.confirmPassword(req.user!.id, reauthSchema.parse(req.body).currentPassword);
  await userService.resetTwoFactor(id);
  res.status(204).end();
});

userRoutes.post('/:id/unlock', async (req, res) => {
  await userService.unlock(userId(req.params.id));
  res.status(204).end();
});

userRoutes.delete('/:id', async (req, res) => {
  const id = userId(req.params.id);
  await authService.confirmPassword(req.user!.id, reauthSchema.parse(req.body).currentPassword);
  await userService.remove(id, req.user!.id);
  res.status(204).end();
});

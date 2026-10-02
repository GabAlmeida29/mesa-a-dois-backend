import { Router } from 'express';
import { parseId } from '../lib/params';
import { requirePermission } from '../middlewares/auth';
import {
  dishSchema,
  dishUpdateSchema,
  listQuerySchema,
  restaurantSchema,
  restaurantUpdateSchema,
} from '../schemas';
import { restaurantService } from '../services/restaurant.service';

export const restaurantRoutes = Router();

const restaurantId = (value: unknown) => parseId(value, 'Restaurante');
const dishId = (value: unknown) => parseId(value, 'Prato');

restaurantRoutes.get('/', async (req, res) => {
  res.json(await restaurantService.list(listQuerySchema.parse(req.query)));
});

restaurantRoutes.get('/:id', async (req, res) => {
  res.json(await restaurantService.get(restaurantId(req.params.id)));
});

restaurantRoutes.post('/', requirePermission('restaurants:create'), async (req, res) => {
  const created = await restaurantService.create(restaurantSchema.parse(req.body), req.user!.id);
  res.status(201).json(created);
});

restaurantRoutes.put('/:id', requirePermission('restaurants:update'), async (req, res) => {
  const id = restaurantId(req.params.id);
  res.json(await restaurantService.update(id, restaurantUpdateSchema.parse(req.body)));
});

restaurantRoutes.delete('/:id', requirePermission('restaurants:delete'), async (req, res) => {
  await restaurantService.remove(restaurantId(req.params.id));
  res.status(204).end();
});

restaurantRoutes.post('/:id/dishes', requirePermission('dishes:manage'), async (req, res) => {
  const id = restaurantId(req.params.id);
  res.status(201).json(await restaurantService.addDish(id, dishSchema.parse(req.body)));
});

restaurantRoutes.put('/:id/dishes/:dishId', requirePermission('dishes:manage'), async (req, res) => {
  const ids = [restaurantId(req.params.id), dishId(req.params.dishId)] as const;
  res.json(await restaurantService.updateDish(...ids, dishUpdateSchema.parse(req.body)));
});

restaurantRoutes.delete('/:id/dishes/:dishId', requirePermission('dishes:manage'), async (req, res) => {
  await restaurantService.removeDish(restaurantId(req.params.id), dishId(req.params.dishId));
  res.status(204).end();
});

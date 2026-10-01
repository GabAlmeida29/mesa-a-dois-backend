import { and, asc, desc, eq, exists, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { dishes, restaurants } from '../db/schema';
import { HttpError } from '../lib/http-error';
import {
  dishSchema,
  dishUpdateSchema,
  listQuerySchema,
  restaurantSchema,
  restaurantUpdateSchema,
} from '../schemas';
import { storage } from '../storage';
import {
  toDateColumn,
  toDishDto,
  toPriceColumn,
  toRestaurantDto,
  type RestaurantDto,
} from '../mappers/restaurant.mapper';

type ListQuery = z.infer<typeof listQuerySchema>;
type RestaurantInput = z.infer<typeof restaurantSchema>;
type RestaurantUpdate = z.infer<typeof restaurantUpdateSchema>;
type DishInput = z.infer<typeof dishSchema>;
type DishUpdate = z.infer<typeof dishUpdateSchema>;

const withDishes = { dishes: { orderBy: asc(dishes.createdAt) } } as const;

async function removeReplacedImage(previous: string | null, next: string | null | undefined) {
  if (next !== undefined && previous && previous !== next) await storage.remove(previous);
}

function searchFilter(term: string): SQL {
  const pattern = `%${term}%`;
  const dishMatches = db
    .select({ one: sql`1` })
    .from(dishes)
    .where(and(eq(dishes.restaurantId, restaurants.id), ilike(dishes.name, pattern)));

  return or(
    ilike(restaurants.name, pattern),
    ilike(restaurants.cuisine, pattern),
    ilike(restaurants.city, pattern),
    exists(dishMatches),
  )!;
}

function sortByRating(list: RestaurantDto[]) {
  return [...list].sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
}

async function findRestaurantOrFail(id: string) {
  const row = await db.query.restaurants.findFirst({ where: eq(restaurants.id, id), with: withDishes });
  if (!row) throw HttpError.notFound('Restaurante');
  return row;
}

async function findDishOrFail(restaurantId: string, dishId: string) {
  const dish = await db.query.dishes.findFirst({
    where: and(eq(dishes.id, dishId), eq(dishes.restaurantId, restaurantId)),
  });
  if (!dish) throw HttpError.notFound('Prato');
  return dish;
}

export const restaurantService = {
  async list({ q, city, sort }: ListQuery) {
    const filters: SQL[] = [];
    if (city) filters.push(ilike(restaurants.city, city));
    if (q) filters.push(searchFilter(q));

    const rows = await db.query.restaurants.findMany({
      where: filters.length ? and(...filters) : undefined,
      orderBy:
        sort === 'name'
          ? [asc(restaurants.name)]
          : [sql`${restaurants.visitedAt} desc nulls last`, desc(restaurants.createdAt)],
      with: withDishes,
    });

    const list = rows.map(toRestaurantDto);
    return sort === 'rating' ? sortByRating(list) : list;
  },

  async get(id: string) {
    return toRestaurantDto(await findRestaurantOrFail(id));
  },

  async create(data: RestaurantInput, userId: string) {
    const [created] = await db
      .insert(restaurants)
      .values({ ...data, visitedAt: toDateColumn(data.visitedAt), createdById: userId })
      .returning();
    return toRestaurantDto(created);
  },

  async update(id: string, data: RestaurantUpdate) {
    const current = await findRestaurantOrFail(id);
    await db
      .update(restaurants)
      .set({ ...data, visitedAt: toDateColumn(data.visitedAt) })
      .where(eq(restaurants.id, id));
    await removeReplacedImage(current.logoUrl, data.logoUrl);
    return toRestaurantDto(await findRestaurantOrFail(id));
  },

  async remove(id: string) {
    const current = await findRestaurantOrFail(id);
    await db.delete(restaurants).where(eq(restaurants.id, id));
    const images = [current.logoUrl, ...current.dishes.map((d) => d.photoUrl)].filter((url): url is string =>
      Boolean(url),
    );
    await Promise.all(images.map((url) => storage.remove(url)));
  },

  async addDish(restaurantId: string, data: DishInput) {
    await findRestaurantOrFail(restaurantId);
    const [created] = await db
      .insert(dishes)
      .values({ ...data, price: toPriceColumn(data.price), restaurantId })
      .returning();
    return toDishDto(created);
  },

  async updateDish(restaurantId: string, dishId: string, data: DishUpdate) {
    const current = await findDishOrFail(restaurantId, dishId);
    const [updated] = await db
      .update(dishes)
      .set({ ...data, price: toPriceColumn(data.price) })
      .where(eq(dishes.id, current.id))
      .returning();
    await removeReplacedImage(current.photoUrl, data.photoUrl);
    return toDishDto(updated);
  },

  async removeDish(restaurantId: string, dishId: string) {
    const current = await findDishOrFail(restaurantId, dishId);
    await db.delete(dishes).where(eq(dishes.id, current.id));
    if (current.photoUrl) await storage.remove(current.photoUrl);
  },
};

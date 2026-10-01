import type { Dish, Restaurant } from '../db/schema';

export function averageRating(...values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number');
  if (!valid.length) return null;
  const mean = valid.reduce((sum, v) => sum + v, 0) / valid.length;
  return Math.round(mean * 10) / 10;
}

export function toDishDto(dish: Dish) {
  return {
    ...dish,
    price: dish.price === null ? null : Number(dish.price),
    averageRating: averageRating(dish.ratingGabriel, dish.ratingMilena),
  };
}

export function toRestaurantDto(restaurant: Restaurant & { dishes?: Dish[] }) {
  const { dishes = [], ...rest } = restaurant;
  return {
    ...rest,
    averageRating: averageRating(restaurant.ratingGabriel, restaurant.ratingMilena),
    dishCount: dishes.length,
    dishes: dishes.map(toDishDto),
  };
}

export type RestaurantDto = ReturnType<typeof toRestaurantDto>;

export function toDateColumn(value: Date | null | undefined) {
  if (value === undefined) return undefined;
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toPriceColumn(value: number | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : value.toFixed(2);
}

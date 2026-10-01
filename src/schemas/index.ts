import { z } from 'zod';

const rating = z.coerce.number().min(0).max(10).multipleOf(0.5).nullable().optional();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(1).max(200),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

export const restaurantSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cuisine: optionalText(60),
  description: optionalText(500),
  address: optionalText(200),
  city: optionalText(80),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  logoUrl: optionalText(500),
  priceLevel: z.coerce.number().int().min(1).max(4).nullable().optional(),
  ratingGabriel: rating,
  ratingMilena: rating,
  review: optionalText(3000),
  visitedAt: z.coerce.date().nullable().optional(),
  wouldReturn: z.boolean().optional(),
});

export const restaurantUpdateSchema = restaurantSchema.partial();

export const dishSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  photoUrl: optionalText(500),
  price: z.coerce.number().min(0).max(99999999).nullable().optional(),
  ratingGabriel: rating,
  ratingMilena: rating,
});

export const dishUpdateSchema = dishSchema.partial();

export const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  city: z.string().trim().optional(),
  sort: z.enum(['recent', 'rating', 'name']).default('recent'),
});

import { z } from 'zod';
import { SCORE_FIELDS, type ScoreField } from '../domain/criteria';
import { PERMISSIONS, ROLES } from '../domain/permissions';

const rating = z.coerce.number().min(0).max(10).multipleOf(0.5).nullable().optional();
const scoreShape = Object.fromEntries(SCORE_FIELDS.map((f) => [f, rating])) as Record<
  ScoreField,
  typeof rating
>;

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
  ...scoreShape,
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

const email = z.string().trim().toLowerCase().email().max(160);
const newPassword = z.string().min(1).max(200);
const currentPassword = z.string().min(1).max(200);
const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export const enrollSchema = z.object({
  enrollmentToken: z.string().min(20).max(100),
  code: totpCode,
});

export const reauthSchema = z.object({ currentPassword });

const access = {
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
};

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email,
  password: newPassword,
  currentPassword,
  role: access.role.default('member'),
  permissions: access.permissions.default([]),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: email.optional(),
  role: access.role.optional(),
  permissions: access.permissions.optional(),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  headline: optionalText(120),
  bio: optionalText(600),
  instagram: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ''))
    .pipe(z.string().regex(/^[A-Za-z0-9._]{0,30}$/))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  avatarUrl: optionalText(500),
  showOnAbout: z.boolean().optional(),
});

export const setPasswordSchema = z.object({ password: newPassword, currentPassword });

export const collectSchema = z.object({
  type: z.enum(['pageview', 'click']),
  path: z.string().trim().min(1).max(300),
  target: z.string().trim().max(120).optional(),
  referrer: z.string().trim().max(500).optional(),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  includeAdmin: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

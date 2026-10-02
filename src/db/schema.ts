import { relations } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 80 }).notNull(),
  email: varchar('email', { length: 160 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  totpSecret: text('totp_secret'),
  totpLastStep: integer('totp_last_step'),
  totpPendingSecret: text('totp_pending_secret'),
  enrollmentTokenHash: varchar('enrollment_token_hash', { length: 64 }),
  enrollmentExpiresAt: timestamp('enrollment_expires_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    ip: varchar('ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const restaurants = pgTable(
  'restaurants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    cuisine: varchar('cuisine', { length: 60 }),
    description: varchar('description', { length: 500 }),
    address: varchar('address', { length: 200 }),
    city: varchar('city', { length: 80 }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    logoUrl: text('logo_url'),
    priceLevel: integer('price_level'),
    scoreFood: doublePrecision('score_food'),
    scoreService: doublePrecision('score_service'),
    scoreAmbience: doublePrecision('score_ambience'),
    scoreCleanliness: doublePrecision('score_cleanliness'),
    scoreComfort: doublePrecision('score_comfort'),
    scoreValue: doublePrecision('score_value'),
    scoreWait: doublePrecision('score_wait'),
    review: text('review'),
    visitedAt: date('visited_at'),
    wouldReturn: boolean('would_return').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('restaurants_visited_at_idx').on(t.visitedAt)],
);

export const dishes = pgTable(
  'dishes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    photoUrl: text('photo_url'),
    price: numeric('price', { precision: 10, scale: 2 }),
    ratingGabriel: doublePrecision('rating_gabriel'),
    ratingMilena: doublePrecision('rating_milena'),
    ...timestamps,
  },
  (t) => [index('dishes_restaurant_id_idx').on(t.restaurantId)],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    type: varchar('type', { length: 16 }).notNull(),
    path: varchar('path', { length: 300 }).notNull(),
    target: varchar('target', { length: 120 }),
    referrerHost: varchar('referrer_host', { length: 200 }),
    visitorHash: varchar('visitor_hash', { length: 32 }).notNull(),
    country: varchar('country', { length: 2 }),
    region: varchar('region', { length: 80 }),
    city: varchar('city', { length: 80 }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    device: varchar('device', { length: 16 }),
    browser: varchar('browser', { length: 32 }),
    os: varchar('os', { length: 32 }),
    isAdmin: boolean('is_admin').notNull().default(false),
  },
  (t) => [index('analytics_events_occurred_at_idx').on(t.occurredAt)],
);

export const restaurantsRelations = relations(restaurants, ({ many }) => ({
  dishes: many(dishes),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const dishesRelations = relations(dishes, ({ one }) => ({
  restaurant: one(restaurants, { fields: [dishes.restaurantId], references: [restaurants.id] }),
}));

export type Restaurant = typeof restaurants.$inferSelect;
export type Dish = typeof dishes.$inferSelect;
export type User = typeof users.$inferSelect;

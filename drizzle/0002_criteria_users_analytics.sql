CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" varchar(16) NOT NULL,
	"path" varchar(300) NOT NULL,
	"target" varchar(120),
	"referrer_host" varchar(200),
	"visitor_hash" varchar(32) NOT NULL,
	"country" varchar(2),
	"region" varchar(80),
	"city" varchar(80),
	"latitude" double precision,
	"longitude" double precision,
	"device" varchar(16),
	"browser" varchar(32),
	"os" varchar(32),
	"is_admin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_food" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_service" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_ambience" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_cleanliness" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_comfort" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_value" double precision;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "score_wait" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "enrollment_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "enrollment_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events" USING btree ("occurred_at");
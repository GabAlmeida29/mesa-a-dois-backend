CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(300),
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "restaurants" DROP COLUMN "cover_url";--> statement-breakpoint
-- imagens locais passam a usar URL relativa (/uploads/...), servidas pelo mesmo domínio do site
UPDATE "restaurants" SET "logo_url" = regexp_replace("logo_url", '^https?://[^/]+(/uploads/)', '\1') WHERE "logo_url" ~ '^https?://[^/]+/uploads/';--> statement-breakpoint
UPDATE "dishes" SET "photo_url" = regexp_replace("photo_url", '^https?://[^/]+(/uploads/)', '\1') WHERE "photo_url" ~ '^https?://[^/]+/uploads/';

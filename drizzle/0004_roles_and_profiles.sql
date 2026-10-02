ALTER TABLE "users" ADD COLUMN "role" varchar(16) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "headline" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" varchar(600);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "instagram" varchar(40);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_on_about" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "users" SET "show_on_about" = true, "instagram" = 'gabalmeida29', "headline" = 'Desenvolvedor & provador oficial de sobremesas', "bio" = 'Desenvolvedor, curioso por natureza. Construiu este site e não recusa um bom hambúrguer artesanal — nem uma segunda sobremesa.' WHERE "name" = 'Gabriel';--> statement-breakpoint
UPDATE "users" SET "show_on_about" = true, "instagram" = 'mih_denardi', "headline" = 'Estudante de Psicologia & crítica exigente', "bio" = 'Repara em cada detalhe: do atendimento ao empratamento. É quem escolhe os lugares novos e quem dá a palavra final sobre voltar ou não.' WHERE "name" = 'Milena';

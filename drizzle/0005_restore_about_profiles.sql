UPDATE "users" SET
  "show_on_about" = true,
  "avatar_url" = COALESCE("avatar_url", '/about/gabriel.webp'),
  "instagram" = COALESCE("instagram", 'gabalmeida29'),
  "headline" = COALESCE("headline", 'Desenvolvedor & provador oficial de sobremesas'),
  "bio" = COALESCE("bio", 'Desenvolvedor, curioso por natureza. Construiu este site e não recusa um bom hambúrguer artesanal — nem uma segunda sobremesa.')
WHERE "name" ILIKE 'gabriel%' OR "email" ILIKE 'gab%';--> statement-breakpoint
UPDATE "users" SET
  "show_on_about" = true,
  "avatar_url" = COALESCE("avatar_url", '/about/milena.webp'),
  "instagram" = COALESCE("instagram", 'mih_denardi'),
  "headline" = COALESCE("headline", 'Estudante de Psicologia & crítica exigente'),
  "bio" = COALESCE("bio", 'Repara em cada detalhe: do atendimento ao empratamento. É quem escolhe os lugares novos e quem dá a palavra final sobre voltar ou não.')
WHERE "name" ILIKE 'milena%' OR "email" ILIKE 'milena%';

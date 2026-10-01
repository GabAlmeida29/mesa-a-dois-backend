# Deploy — Mesa a Dois

Infraestrutura de produção para uma VPS com Docker:

- **Caddy** cuida do HTTPS automático e do roteamento;
- **Web** é o site em Next.js ([mesa-a-dois-frontend](https://github.com/GabAlmeida29/mesa-a-dois-frontend));
- **API** é este repositório;
- **PostgreSQL** guarda os dados.

```
Navegador ──► Caddy (80/443) ──┬── /               → web:3000
                               └── /api, /uploads  → api:3333 ──► db:5432
```

Só o Caddy expõe portas. Banco, API e site ficam na rede interna do Docker. Site e API respondem no **mesmo domínio**, então o cookie de sessão é first-party (`SameSite=Strict`) e não existe CORS aberto.

## Pré-requisitos

- VPS com Docker e Docker Compose (ex.: Hostinger KVM 1).
- Domínio com registro **A** apontando para o IP da VPS, criado **antes** de subir: é com ele que o Caddy emite o certificado.
- Os dois repositórios clonados **lado a lado**:

```bash
git clone https://github.com/GabAlmeida29/mesa-a-dois-backend.git
git clone https://github.com/GabAlmeida29/mesa-a-dois-frontend.git
```

## Subindo

```bash
cd mesa-a-dois-backend/deploy
cp .env.example .env              # SITE_DOMAIN, POSTGRES_PASSWORD (openssl rand -base64 24)
cp ../.env.example ../.env        # senhas fortes, TOTP_ENCRYPTION_KEY, storage
docker compose up -d --build
docker compose exec api node dist/db/seed.js
docker compose exec -it api node dist/cli/user.js 2fa:enable seu@email.com
```

A API aplica as migrations sozinha ao iniciar.

Para atualizar depois:

```bash
git -C .. pull && git -C ../../mesa-a-dois-frontend pull
docker compose up -d --build
```

## Checklist de segurança

- [ ] `POSTGRES_PASSWORD`, `TOTP_ENCRYPTION_KEY` e senhas dos usuários fortes e únicas.
- [ ] 2FA ativado para todos os usuários (`REQUIRE_2FA=true` é o padrão).
- [ ] Firewall liberando apenas as portas 22, 80 e 443. SSH só com chave.
- [ ] Backup diário do Postgres (`pg_dump`) para fora da VPS.
- [ ] Atualizar as imagens periodicamente: `docker compose pull && docker compose up -d --build`.

## Fotos no Cloudflare R2 (opcional, recomendado)

1. Crie um bucket e habilite o acesso público (`r2.dev` ou domínio próprio).
2. Gere um token com leitura e escrita no bucket.
3. No `.env` da API:
   ```env
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=mesa-a-dois
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_PUBLIC_URL=https://pub-xxxx.r2.dev
   ```
4. No build do site, defina `NEXT_PUBLIC_IMAGE_HOSTS=https://pub-xxxx.r2.dev` para a CSP liberar as imagens.

## Alternativa sem VPS

- Site na Vercel, com `API_INTERNAL_URL` apontando para a API.
- API no Render, Railway ou Fly.io, com `TRUST_PROXY=1`.
- Banco no Neon ou Supabase (`?sslmode=require`).
- Fotos no R2.
- Os planos gratuitos podem "dormir" quando ficam sem acesso.

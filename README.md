# Mesa a Dois — API

API REST do **Mesa a Dois**, o diário gastronômico de Gabriel e Milena. Ela guarda restaurantes, pratos, notas e fotos, autentica os administradores, gerencia os usuários, registra os acessos ao site e entrega os dados públicos que o site exibe.

- **Leitura é pública:** qualquer visitante lista e vê restaurantes.
- **Escrita é restrita:** criar, editar, excluir, enviar imagens, gerenciar usuários e ver o painel de acessos exige uma sessão autenticada com senha e segundo fator (TOTP).
- **Analytics sem cookies:** o site registra visualizações e cliques sem guardar IP e sem cookie de rastreamento.

---

## Sumário

1. [Stack](#stack)
2. [Arquitetura](#arquitetura)
3. [Estrutura de pastas](#estrutura-de-pastas)
4. [Modelo de dados](#modelo-de-dados)
5. [Autenticação e segurança](#autenticação-e-segurança)
6. [Gestão de usuários](#gestão-de-usuários)
7. [Analytics sem cookies](#analytics-sem-cookies)
8. [Upload e armazenamento de imagens](#upload-e-armazenamento-de-imagens)
9. [Endpoints](#endpoints)
10. [Variáveis de ambiente](#variáveis-de-ambiente)
11. [Rodando localmente](#rodando-localmente)
12. [Scripts](#scripts)
13. [Administração de usuários (CLI)](#administração-de-usuários-cli)
14. [Testes](#testes)
15. [Migrations](#migrations)
16. [Docker e produção](#docker-e-produção)

---

## Stack

| Camada           | Tecnologia                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js 20+ · TypeScript 5                                                                        |
| HTTP             | Express 5 (erros assíncronos tratados nativamente)                                                |
| Banco            | PostgreSQL 16                                                                                     |
| ORM / migrations | Drizzle ORM + drizzle-kit (100% JavaScript, sem binários nativos)                                 |
| Validação        | Zod                                                                                               |
| Segurança        | bcryptjs, helmet, express-rate-limit, cookie-parser, TOTP próprio (RFC 6238), qrcode (QR do 2FA)  |
| Geolocalização   | maxmind + `@ip-location-db/dbip-city-mmdb` (base DB-IP Lite local, licença CC BY 4.0)             |
| Imagens          | Multer (memória) + Sharp (reprocessamento em WebP)                                                |
| Storage          | Disco local **ou** qualquer S3-compatível (Cloudflare R2, Supabase Storage, Backblaze B2, AWS S3) |
| Testes           | Vitest + Supertest, contra um Postgres real                                                       |
| Qualidade        | ESLint (typescript-eslint) + Prettier                                                             |

---

## Arquitetura

A API é organizada em camadas simples. Cada camada só conversa com a de baixo:

```
HTTP ──► middlewares ──► routes ──► services ──► db (Drizzle) ──► PostgreSQL
                │                       │
                │                       ├──► mappers (entidade → DTO)
                │                       └──► storage (disco / S3)
                └── csrf · auth · error
```

- **routes**: falam HTTP e nada mais. Validam a entrada com Zod, chamam o service e devolvem o status certo.
- **services**: concentram a regra de negócio, como a busca com filtros, a remoção de imagens substituídas, o login com bloqueio e 2FA, a ativação do 2FA pelo site e a gestão de usuários.
- **domain**: definições compartilhadas, como a lista dos critérios de avaliação (`criteria.ts`), usada pelos schemas e pelo mapper.
- **analytics**: coleta e resumo dos acessos, geolocalização aproximada por IP e leitura do user-agent.
- **mappers**: transformam linhas do banco em DTOs. É aqui que se calcula a média das notas, converte `numeric` em `number` e conta os pratos.
- **auth**: guarda as primitivas de segurança (sessão, TOTP, política de senha). Elas são reutilizadas pelas rotas, pelo seed e pela CLI.
- **middlewares**:
  - `requireAuth` resolve a sessão a partir do cookie;
  - `csrfProtection` barra escrita vinda de outra origem;
  - `errorHandler` traduz erros em respostas JSON padronizadas.

Todo erro sai no mesmo formato:

```json
{ "message": "Dados inválidos", "details": { "latitude": ["Number must be less than or equal to 90"] } }
```

Erros de autenticação podem trazer campos extras para o front reagir: `mfaRequired`, ou `mfaSetupRequired` junto com os dados de ativação do 2FA (`enrollment`).

---

## Estrutura de pastas

```
api/
├── drizzle/                     # migrations SQL geradas pelo drizzle-kit (versionadas)
├── src/
│   ├── app.ts                   # monta o Express: helmet, cors, cookies, rotas, erros
│   ├── server.ts                # sobe o servidor e faz shutdown gracioso
│   ├── config/env.ts            # leitura e validação das variáveis de ambiente (Zod)
│   ├── db/
│   │   ├── schema.ts            # tabelas: users, sessions, restaurants, dishes, analytics_events
│   │   ├── index.ts             # pool do pg + instância do Drizzle
│   │   ├── migrate.ts           # aplica as migrations pendentes
│   │   └── seed.ts              # cria/atualiza os usuários administradores
│   ├── auth/
│   │   ├── session.ts           # cria, valida e destrói sessões (cookie httpOnly)
│   │   ├── totp.ts              # TOTP (RFC 6238) + cifra AES-256-GCM do segredo
│   │   └── password-policy.ts   # regras de senha forte
│   ├── services/
│   │   ├── auth.service.ts      # login: bcrypt, bloqueio por tentativas, 2FA, ativação do 2FA, reautenticação
│   │   ├── user.service.ts      # gestão de usuários: criar, editar, senha, reset de 2FA, desbloqueio, exclusão
│   │   └── restaurant.service.ts# CRUD de restaurantes e pratos, busca e limpeza de imagens
│   ├── analytics/
│   │   ├── analytics.service.ts # coleta, resumo do painel e limpeza por retenção
│   │   ├── geoip.ts             # cidade/país aproximados pela base DB-IP local (carregada sob demanda)
│   │   └── user-agent.ts        # dispositivo, navegador, sistema e detecção de robôs
│   ├── domain/criteria.ts       # os 7 critérios de avaliação do restaurante
│   ├── mappers/restaurant.mapper.ts
│   ├── routes/                  # auth, restaurants (+ dishes), uploads, users, analytics
│   ├── middlewares/             # auth, csrf, error
│   ├── schemas/index.ts         # contratos de entrada (Zod)
│   ├── storage/index.ts         # driver local e driver S3
│   ├── lib/                     # HttpError e parse de ids
│   └── cli/user.ts              # administração de usuários pelo terminal
├── tests/                       # integração (supertest: api, admin) e unidade (TOTP, senha)
├── docker/postgres-init/        # cria o banco de testes no Postgres de desenvolvimento
├── docker-compose.dev.yml       # Postgres local (porta 5433)
└── deploy/                      # produção: docker-compose + Caddy + guia (ver deploy/README.md)
```

---

## Modelo de dados

```
users ──1:N── sessions
users ──1:N── restaurants ──1:N── dishes
analytics_events (independente)
```

### `users`

| Coluna                  | Tipo        | Descrição                                                         |
| ----------------------- | ----------- | ----------------------------------------------------------------- |
| `id`                    | uuid        | PK                                                                |
| `name`, `email`         | varchar     | e-mail único (minúsculo)                                          |
| `password_hash`         | text        | bcrypt, custo 12                                                  |
| `failed_login_attempts` | int         | erros seguidos de senha ou código                                 |
| `locked_until`          | timestamptz | bloqueio temporário após muitas falhas                            |
| `totp_secret`           | text        | segredo do 2FA **cifrado** (AES-256-GCM); `null` = sem 2FA        |
| `totp_last_step`        | int         | último passo TOTP aceito, para impedir reutilizar o mesmo código  |
| `totp_pending_secret`   | text        | segredo **cifrado** gerado na ativação, ainda não confirmado      |
| `enrollment_token_hash` | varchar(64) | SHA-256 do token de ativação do 2FA (o token em si nunca é salvo) |
| `enrollment_expires_at` | timestamptz | validade do token de ativação (10 minutos)                        |
| `last_login_at`         | timestamptz | último login bem-sucedido (exibido na gestão de usuários)         |

### `sessions`

| Coluna             | Tipo        | Descrição                                                    |
| ------------------ | ----------- | ------------------------------------------------------------ |
| `token_hash`       | varchar(64) | **SHA-256** do token do cookie (o token em si nunca é salvo) |
| `expires_at`       | timestamptz | expiração absoluta                                           |
| `user_agent`, `ip` | varchar     | auditoria                                                    |

### `restaurants`

| Coluna                           | Tipo    | Descrição                                                        |
| -------------------------------- | ------- | ---------------------------------------------------------------- |
| `name`, `cuisine`, `description` | varchar | dados básicos (a categoria vem de uma lista fixa no front)       |
| `address`, `city`                | varchar | preenchidos pelo autocomplete ou pela busca reversa              |
| `latitude`, `longitude`          | double  | posição do pin                                                   |
| `logo_url`                       | text    | foto/logo (URL relativa `/uploads/...` ou URL pública do bucket) |
| `price_level`                    | int     | 1 a 4 (`$` a `$$$$`)                                             |
| `score_food`                     | double  | Comida                                                           |
| `score_service`                  | double  | Atendimento                                                      |
| `score_ambience`                 | double  | Ambiente                                                         |
| `score_cleanliness`              | double  | Limpeza                                                          |
| `score_comfort`                  | double  | Conforto                                                         |
| `score_value`                    | double  | Custo-benefício                                                  |
| `score_wait`                     | double  | Tempo de espera (10 = rápido)                                    |
| `review`                         | text    | opinião do casal                                                 |
| `visited_at`                     | date    | data da visita                                                   |
| `would_return`                   | boolean | "voltaríamos?"                                                   |

### `dishes`

| Coluna                             | Tipo          | Descrição                                |
| ---------------------------------- | ------------- | ---------------------------------------- |
| `restaurant_id`                    | uuid          | FK com `ON DELETE CASCADE`               |
| `name`, `description`, `photo_url` | —             | dados do prato                           |
| `price`                            | numeric(10,2) | valor exato, sem erro de ponto flutuante |
| `rating_gabriel`, `rating_milena`  | double        | 0 a 10                                   |

Os 7 critérios do restaurante vão de 0 a 10, em passos de 0,5, e todos aceitam `null` (critério não avaliado). A lista fica em `src/domain/criteria.ts`.

Os pratos continuam com uma nota por pessoa (`rating_gabriel` e `rating_milena`).

A **média** não é armazenada: o mapper calcula e arredonda para uma casa decimal.

- **restaurante**: média dos critérios preenchidos (os vazios ficam de fora);
- **prato**: média das notas do Gabriel e da Milena.

### `analytics_events`

| Coluna                      | Tipo        | Descrição                                                           |
| --------------------------- | ----------- | ------------------------------------------------------------------- |
| `id`                        | bigserial   | PK                                                                  |
| `occurred_at`               | timestamptz | momento do evento (indexado)                                        |
| `type`                      | varchar     | `pageview` ou `click`                                               |
| `path`                      | varchar     | caminho da página, **sem query string**                             |
| `target`                    | varchar     | rótulo do elemento clicado (só em `click`)                          |
| `referrer_host`             | varchar     | domínio de origem (só quando é outro site)                          |
| `visitor_hash`              | varchar(32) | hash do visitante com sal que troca todo dia; o IP **não é salvo**  |
| `country`, `region`, `city` | varchar     | localização aproximada pelo IP                                      |
| `latitude`, `longitude`     | double      | coordenadas aproximadas da cidade                                   |
| `device`, `browser`, `os`   | varchar     | lidos do user-agent                                                 |
| `is_admin`                  | boolean     | `true` quando o acesso veio com uma sessão válida (o próprio casal) |

---

## Autenticação e segurança

### Sessão em cookie `httpOnly`

1. `POST /api/auth/login` valida e-mail, senha e, se exigido, o código 2FA.
2. A API gera um token aleatório de **256 bits**, grava só o **hash SHA-256** em `sessions` e devolve o token num cookie:
   - `HttpOnly`: o JavaScript da página não consegue ler o cookie, então um XSS não rouba a sessão.
   - `SameSite=Strict`: o navegador não envia o cookie em requisições que partem de outros sites.
   - `Secure` com prefixo `__Host-` em produção: só trafega por HTTPS e não pode ser sobrescrito por subdomínios.
   - Por padrão é um **cookie de sessão do navegador** (`SESSION_PERSISTENT=false`): fechou o navegador, precisa entrar de novo.
3. Cada requisição protegida passa por `requireAuth`, que busca a sessão pelo hash e checa a expiração (`SESSION_TTL_HOURS`).
4. Logout, troca de senha, ativação e reset de 2FA **apagam a sessão no servidor**. Um cookie antigo deixa de valer na hora.
5. `POST /api/auth/logout-others` encerra todas as outras sessões do usuário e mantém a atual.

### Login à prova de força bruta

- **Rate limit por IP**: 10 tentativas a cada 15 minutos.
- **Bloqueio por conta**: depois de `LOGIN_MAX_ATTEMPTS` erros seguidos (senha ou código), a conta fica bloqueada por `LOGIN_LOCK_MINUTES`.
- **Respostas indistinguíveis**:
  - e-mail inexistente e senha errada devolvem a **mesma mensagem**;
  - o bcrypt roda mesmo quando o usuário não existe (hash fictício), então o tempo de resposta não revela se a conta existe.
- **Limite de tamanho** da senha (200 caracteres): evita abuso de CPU no bcrypt.

### 2FA (TOTP)

- Implementação própria da RFC 6238, testada contra os vetores oficiais. Funciona com Google Authenticator, Authy, 1Password e Bitwarden.
- O segredo é cifrado em repouso com **AES-256-GCM** usando `TOTP_ENCRYPTION_KEY`. Um vazamento do banco não expõe os segredos.
- Aceita o código da janela atual e o das janelas vizinhas (±30s, para tolerar diferença de relógio), mas **cada código vale uma única vez** (`totp_last_step`).
- Com `REQUIRE_2FA=true` (padrão):
  - contas sem 2FA **não entram** e recebem `403 { mfaSetupRequired: true, enrollment }`;
  - sessões antigas dessas contas também deixam de valer.

### Ativação do 2FA pelo site

O 2FA é ativado no próprio site, sem terminal:

1. A conta sem 2FA faz login com e-mail e senha corretos.
2. A API gera um segredo novo, guarda **cifrado** em `totp_pending_secret` e responde `403` com `enrollment`:
   - `enrollmentToken`: token aleatório, válido por **10 minutos**, salvo só como hash SHA-256;
   - `secret`: chave para digitar no app manualmente;
   - `otpauthUrl`: URL `otpauth://` padrão;
   - `qrCode`: QR code em PNG (data URL), pronto para um `<img>`.
3. O usuário escaneia o QR e envia `POST /api/auth/2fa/enroll { enrollmentToken, code }`.
4. Com o código certo, o segredo pendente vira o definitivo, as sessões antigas são encerradas e uma sessão nova é criada.

Código errado conta para o bloqueio por tentativas. Token expirado devolve `400`, e basta fazer login de novo para gerar outro QR.

Para **trocar de celular**, o usuário logado chama `POST /api/auth/2fa/setup { currentPassword }`. A API devolve um `enrollment` novo, e a confirmação segue pelo mesmo `POST /api/auth/2fa/enroll`. Até lá, o 2FA antigo continua valendo.

### Reautenticação em ações sensíveis

Criar usuário, trocar senha, resetar 2FA, excluir usuário e reconfigurar o próprio 2FA exigem a **senha atual** de quem está logado (`currentPassword`):

- senha errada devolve `400` com `{ "currentPassword": ["Senha atual incorreta"] }`;
- cada erro **conta para o bloqueio** da conta, como no login.

### CSRF e origem

Toda requisição que altera dados (`POST`, `PUT`, `DELETE`) precisa:

- do header `X-Requested-With: mesa-a-dois`. Um site de terceiros não consegue enviar esse header sem passar pelo preflight CORS, que é recusado;
- de um `Origin` presente em `CORS_ORIGINS`, quando o navegador informar.

Isso soma ao `SameSite=Strict` do cookie.

### Demais proteções

- `helmet` com CSP `default-src 'none'`: a API só serve JSON e imagens.
- `x-powered-by` desligado.
- Corpo JSON limitado a 1 MB.
- IDs validados como UUID antes de chegar ao banco; um id malformado devolve 404, não 500.
- Erros inesperados devolvem só `Erro interno`. O detalhe fica no log do servidor.
- `TRUST_PROXY` permite que o rate limit enxergue o IP real atrás do Caddy/Nginx.

---

## Gestão de usuários

Não existe cadastro público. Todo usuário logado é administrador e pode gerenciar os outros pelo site (`/admin/usuarios`):

- listar usuários, com status do 2FA, bloqueio e último login (sem expor hash, segredo ou token);
- criar usuário;
- editar nome e e-mail (e-mail único);
- redefinir senha: **encerra as sessões** daquele usuário. Se for a própria senha, a sessão atual é mantida;
- resetar 2FA: apaga o segredo e encerra as sessões. No próximo login, o usuário ativa o 2FA de novo pelo QR code;
- desbloquear conta travada por tentativas;
- excluir usuário. Ninguém exclui a si mesmo, e o último usuário não pode ser excluído.

Toda senha nova passa pela **política de senha**: 12+ caracteres, 3 tipos entre minúsculas, maiúsculas, números e símbolos, e nenhum termo óbvio. Senha fraca devolve `400` com o motivo em `details.password`.

---

## Analytics sem cookies

O site envia eventos de visualização e clique para `POST /api/analytics/collect`. Não há cookie de rastreamento nem serviço de terceiros.

- **Rota pública**, com rate limit de **120 eventos por minuto** por IP. Payload inválido é ignorado em silêncio (`204`).
- **Robôs ignorados**: user-agent vazio ou de crawler, preview de link, headless e Lighthouse não são gravados.
- **Caminho sem query string** e origem só pelo domínio (`referrer_host`), e só quando vem de outro site.
- **Dispositivo, navegador e sistema** são lidos do user-agent (`user-agent.ts`).
- **Localização aproximada** (país, estado, cidade e coordenadas) pela base **DB-IP Lite** local (`@ip-location-db/dbip-city-mmdb`, licença CC BY 4.0), lida com `maxmind`:
  - nenhuma consulta sai do servidor;
  - a base é carregada só no primeiro uso e ocupa cerca de **130 MB de RAM**;
  - `GEOIP_ENABLED=false` desliga a geolocalização.
- **IP nunca é salvo**: o visitante vira um hash de IP + user-agent com um sal aleatório que **troca todo dia**. Dá para contar visitantes únicos no dia, mas não para seguir alguém entre dias.
- **Acessos do casal**: quando o evento chega com um cookie de sessão válido, ele é marcado com `is_admin = true`.
- **Retenção**: o servidor apaga eventos mais antigos que `ANALYTICS_RETENTION_DAYS` (padrão 395 dias) ao subir e depois uma vez por dia.

`GET /api/analytics/summary?days=30&includeAdmin=false` (logado) monta o painel do site:

| Campo                            | Conteúdo                                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| `totals`                         | visualizações, cliques e visitantes únicos                       |
| `daily`                          | visualizações e visitantes por dia (dias sem acesso vêm zerados) |
| `pages`                          | 10 páginas mais vistas                                           |
| `clicks`                         | 15 elementos mais clicados, com a página                         |
| `countries`, `cities`            | visitantes por país e por cidade (cidades com coordenadas)       |
| `devices`, `browsers`, `systems` | visitantes por dispositivo, navegador e sistema                  |
| `referrers`                      | domínios de origem                                               |
| `recent`                         | 25 últimos eventos                                               |

- `days` vai de 1 a 365 (padrão 30). Os dias são contados no fuso `America/Sao_Paulo`.
- `includeAdmin=true` inclui os acessos do casal, que por padrão ficam de fora.

---

## Upload e armazenamento de imagens

`POST /api/uploads?folder=logos|dishes` (multipart, campo `file`):

1. Aceita só os tipos `image/jpeg`, `png`, `webp`, `avif` e `heic/heif`, até **10 MB**.
2. O **Sharp reprocessa** a imagem:
   - corrige a orientação EXIF (fotos de celular);
   - limita a 1600px no maior lado;
   - descarta metadados (como a localização GPS da foto);
   - converte para **WebP** (qualidade 80).

   Um arquivo que não é imagem de verdade, mesmo com extensão ou MIME falsos, é recusado nessa etapa. Também há limite de pixels contra "bombas de descompressão".

3. Salva com nome aleatório (`folder/ano/uuid.webp`) e devolve `{ url }`.

| Driver  | Onde salva                                                                           | URL devolvida                                |
| ------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `local` | `UPLOAD_DIR` (padrão `./uploads`), servido em `/uploads` com cache imutável de 1 ano | `/uploads/...` (relativa ao domínio do site) |
| `s3`    | bucket `S3_BUCKET` em `S3_ENDPOINT`                                                  | `S3_PUBLIC_URL/...`                          |

Quando a imagem de um restaurante ou prato é **substituída** ou o registro é **excluído**, o arquivo antigo é removido do storage.

---

## Endpoints

Base: `/api`. Respostas em JSON.

| Método   | Rota                              | Auth | Descrição                                  |
| -------- | --------------------------------- | ---- | ------------------------------------------ |
| `GET`    | `/health`                         | —    | `{ "status": "ok" }`                       |
| `POST`   | `/auth/login`                     | —    | login (cria a sessão)                      |
| `POST`   | `/auth/2fa/enroll`                | —    | confirma a ativação do 2FA e cria a sessão |
| `POST`   | `/auth/2fa/setup`                 | ✔    | gera um QR novo para reconfigurar o 2FA    |
| `POST`   | `/auth/logout`                    | —    | encerra a sessão atual                     |
| `POST`   | `/auth/logout-others`             | ✔    | encerra as outras sessões                  |
| `GET`    | `/auth/me`                        | ✔    | usuário logado                             |
| `PUT`    | `/auth/me`                        | ✔    | altera o próprio nome                      |
| `GET`    | `/users`                          | ✔    | lista usuários                             |
| `POST`   | `/users`                          | ✔    | cria usuário                               |
| `PUT`    | `/users/:id`                      | ✔    | edita nome e/ou e-mail                     |
| `POST`   | `/users/:id/password`             | ✔    | redefine a senha                           |
| `POST`   | `/users/:id/reset-2fa`            | ✔    | reseta o 2FA                               |
| `POST`   | `/users/:id/unlock`               | ✔    | remove o bloqueio por tentativas           |
| `DELETE` | `/users/:id`                      | ✔    | exclui usuário                             |
| `POST`   | `/analytics/collect`              | —    | registra visualização ou clique            |
| `GET`    | `/analytics/summary`              | ✔    | resumo do painel de acessos                |
| `GET`    | `/restaurants`                    | —    | lista com busca e ordenação                |
| `GET`    | `/restaurants/:id`                | —    | detalhe com pratos                         |
| `POST`   | `/restaurants`                    | ✔    | cria restaurante                           |
| `PUT`    | `/restaurants/:id`                | ✔    | atualiza (parcial)                         |
| `DELETE` | `/restaurants/:id`                | ✔    | exclui (pratos e imagens juntos)           |
| `POST`   | `/restaurants/:id/dishes`         | ✔    | adiciona prato                             |
| `PUT`    | `/restaurants/:id/dishes/:dishId` | ✔    | atualiza prato                             |
| `DELETE` | `/restaurants/:id/dishes/:dishId` | ✔    | remove prato                               |
| `POST`   | `/uploads?folder=logos\|dishes`   | ✔    | envia imagem                               |

> Rotas de escrita exigem o header `X-Requested-With: mesa-a-dois` e o cookie de sessão.

### `POST /auth/login`

```json
{ "email": "gabriel@exemplo.com", "password": "Senha-Forte-2026", "code": "123456" }
```

| Situação                          | Status | Corpo                                                                   |
| --------------------------------- | ------ | ----------------------------------------------------------------------- |
| Sucesso                           | `200`  | `{ "user": { "id", "name", "email" } }` + cookie de sessão              |
| Credenciais inválidas             | `401`  | `{ "message": "E-mail ou senha inválidos" }`                            |
| Falta o código 2FA                | `401`  | `{ "message": "...", "mfaRequired": true }`                             |
| Conta sem 2FA (com `REQUIRE_2FA`) | `403`  | `{ "message": "...", "mfaSetupRequired": true, "enrollment": { ... } }` |
| Conta bloqueada / rate limit      | `429`  | `{ "message": "Muitas tentativas..." }`                                 |

Formato do `enrollment`:

```json
{
  "enrollmentToken": "Zk3…",
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauthUrl": "otpauth://totp/Mesa%20a%20Dois:gabriel%40exemplo.com?secret=…",
  "qrCode": "data:image/png;base64,iVBORw0…"
}
```

### `POST /auth/2fa/enroll`

```json
{ "enrollmentToken": "Zk3…", "code": "123456" }
```

| Situação                   | Status | Corpo                                                      |
| -------------------------- | ------ | ---------------------------------------------------------- |
| Sucesso                    | `200`  | `{ "user": { "id", "name", "email" } }` + cookie de sessão |
| Código inválido            | `400`  | `{ "message": "Código inválido..." }`                      |
| Token inválido ou expirado | `400`  | `{ "message": "Configuração expirada..." }`                |
| Conta bloqueada            | `429`  | `{ "message": "Muitas tentativas..." }`                    |

### `POST /auth/2fa/setup`

```json
{ "currentPassword": "Senha-Forte-2026" }
```

Devolve `200` com o mesmo formato do `enrollment`, para confirmar em `POST /auth/2fa/enroll`.

### Usuários

| Rota                        | Corpo                                        | Resposta             |
| --------------------------- | -------------------------------------------- | -------------------- |
| `POST /users`               | `{ name, email, password, currentPassword }` | `201` com o usuário  |
| `PUT /users/:id`            | `{ name?, email? }`                          | `200` com o usuário  |
| `POST /users/:id/password`  | `{ password, currentPassword }`              | `204`                |
| `POST /users/:id/reset-2fa` | `{ currentPassword }`                        | `204`                |
| `POST /users/:id/unlock`    | —                                            | `204`                |
| `DELETE /users/:id`         | `{ currentPassword }`                        | `204`                |
| `PUT /auth/me`              | `{ name }`                                   | `200` com `{ user }` |

Formato do usuário em `GET /users`:

```json
{
  "id": "6f1c…",
  "name": "Gabriel",
  "email": "gabriel@exemplo.com",
  "twoFactorEnabled": true,
  "lockedUntil": null,
  "lastLoginAt": "2026-09-30T22:14:05.000Z",
  "createdAt": "2026-09-01T12:00:00.000Z"
}
```

E-mail já usado devolve `409`. Senha fraca devolve `400` com `details.password`.

### `POST /analytics/collect`

```json
{ "type": "click", "path": "/restaurantes", "target": "Filtros", "referrer": "https://www.google.com/" }
```

- `type`: `pageview` ou `click`;
- `target`: rótulo do elemento clicado (até 120 caracteres), só usado em `click`;
- `referrer`: opcional, normalmente enviado só na primeira visualização.

Sempre responde `204`, mesmo com payload inválido ou user-agent de robô.

### `GET /restaurants`

Query string:

- `q`: busca em nome, categoria, cidade e **nome dos pratos**, sem diferenciar maiúsculas;
- `city`: filtra por cidade exata;
- `sort`: `recent` (padrão; visita mais recente, sem data por último), `rating` (média) ou `name`.

```json
[
  {
    "id": "cf95cd12-…",
    "name": "Cantina da Nonna",
    "cuisine": "Italiana",
    "address": "Rua Independência, 100",
    "city": "Passo Fundo",
    "latitude": -28.2628,
    "longitude": -52.4067,
    "logoUrl": "/uploads/logos/2026/….webp",
    "priceLevel": 2,
    "scoreFood": 9.5,
    "scoreService": 9,
    "scoreAmbience": 8.5,
    "scoreCleanliness": 9,
    "scoreComfort": 8,
    "scoreValue": 8.5,
    "scoreWait": null,
    "averageRating": 8.8,
    "review": "Massa fresca impecável…",
    "visitedAt": "2026-09-20",
    "wouldReturn": true,
    "dishCount": 1,
    "dishes": [{ "id": "…", "name": "Lasanha", "price": 59.9, "averageRating": 9.5, "…": "…" }]
  }
]
```

### `POST /restaurants` / `PUT /restaurants/:id`

```json
{
  "name": "Cantina da Nonna",
  "cuisine": "Italiana",
  "address": "Rua Independência, 100",
  "city": "Passo Fundo",
  "latitude": -28.2628,
  "longitude": -52.4067,
  "logoUrl": "/uploads/logos/2026/abc.webp",
  "priceLevel": 2,
  "scoreFood": 9.5,
  "scoreService": 9,
  "scoreAmbience": 8.5,
  "scoreCleanliness": 9,
  "scoreComfort": 8,
  "scoreValue": 8.5,
  "scoreWait": null,
  "review": "…",
  "visitedAt": "2026-09-20",
  "wouldReturn": true
}
```

Regras:

- `name`, `latitude` e `longitude` são obrigatórios na criação.
- No `PUT`, todos os campos são opcionais (atualização parcial).
- Os critérios (`scoreFood`, `scoreService`, `scoreAmbience`, `scoreCleanliness`, `scoreComfort`, `scoreValue`, `scoreWait`) vão de 0 a 10 em passos de 0,5. Todos aceitam `null`.
- `averageRating` é calculada pela API e não é aceita na entrada.
- `priceLevel` vai de 1 a 4.
- Textos vazios são gravados como `null`.

### `POST /restaurants/:id/dishes`

```json
{
  "name": "Lasanha",
  "description": "…",
  "price": 59.9,
  "ratingGabriel": 10,
  "ratingMilena": 9,
  "photoUrl": "/uploads/dishes/2026/x.webp"
}
```

---

## Variáveis de ambiente

Copie `.env.example` para `.env`. Todas as variáveis são validadas na inicialização: um valor inválido derruba o processo com uma mensagem clara.

| Variável                                                                                             | Padrão                  | Descrição                                                                     |
| ---------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `PORT`                                                                                               | `3333`                  | porta HTTP                                                                    |
| `NODE_ENV`                                                                                           | `development`           | `development`, `test` ou `production`                                         |
| `CORS_ORIGINS`                                                                                       | `http://localhost:3000` | origens do site, separadas por vírgula (CORS + checagem de `Origin`)          |
| `TRUST_PROXY`                                                                                        | `0`                     | nº de proxies reversos à frente da API (use `1` atrás do Caddy)               |
| `DATABASE_URL`                                                                                       | —                       | conexão Postgres (`?sslmode=require` liga SSL para Neon/Supabase)             |
| `SESSION_TTL_HOURS`                                                                                  | `12`                    | duração máxima da sessão                                                      |
| `SESSION_PERSISTENT`                                                                                 | `false`                 | `true` mantém o login após fechar o navegador                                 |
| `REQUIRE_2FA`                                                                                        | `true`                  | exige 2FA de todas as contas                                                  |
| `COOKIE_SECURE`                                                                                      | `true` em produção      | cookie só via HTTPS (`__Host-`)                                               |
| `LOGIN_MAX_ATTEMPTS`                                                                                 | `5`                     | falhas antes do bloqueio                                                      |
| `LOGIN_LOCK_MINUTES`                                                                                 | `15`                    | duração do bloqueio                                                           |
| `TOTP_ENCRYPTION_KEY`                                                                                | —                       | 32 bytes em base64 (`openssl rand -base64 32`). Obrigatória com `REQUIRE_2FA` |
| `GEOIP_ENABLED`                                                                                      | `true`                  | localização aproximada dos acessos pela base DB-IP local (~130 MB de RAM)     |
| `ANALYTICS_RETENTION_DAYS`                                                                           | `395`                   | dias que os eventos de acesso ficam guardados (30 a 3650)                     |
| `SEED_GABRIEL_EMAIL` / `SEED_GABRIEL_PASSWORD`                                                       | —                       | usuário criado pelo seed                                                      |
| `SEED_MILENA_EMAIL` / `SEED_MILENA_PASSWORD`                                                         | —                       | usuário criado pelo seed                                                      |
| `STORAGE_DRIVER`                                                                                     | `local`                 | `local` ou `s3`                                                               |
| `PUBLIC_BASE_URL`                                                                                    | vazio                   | prefixo das URLs locais (vazio = `/uploads/...` relativo)                     |
| `UPLOAD_DIR`                                                                                         | `uploads`               | pasta dos arquivos no driver local                                            |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | —                       | configuração do driver `s3`                                                   |

---

## Rodando localmente

Pré-requisitos: **Node 20+** e **Docker** (para o Postgres).

```bash
# Postgres na porta 5433 (+ banco de testes)
docker compose -f docker-compose.dev.yml up -d

cd api
cp .env.example .env              # defina TOTP_ENCRYPTION_KEY e as senhas do seed
npm install
npm run db:migrate                # cria/atualiza as tabelas
npm run seed                      # cria Gabriel e Milena
npm run dev                       # http://localhost:3333
```

No primeiro login pelo site, cada conta recebe o QR code para ativar o 2FA (obrigatório por padrão).

Teste rápido: `curl http://localhost:3333/api/health`.

---

## Scripts

| Script                                 | O que faz                                      |
| -------------------------------------- | ---------------------------------------------- |
| `npm run dev`                          | servidor com recarga automática (tsx watch)    |
| `npm run build` / `npm start`          | compila para `dist/` e roda a versão compilada |
| `npm test`                             | testes de unidade e integração                 |
| `npm run typecheck`                    | checagem de tipos                              |
| `npm run lint`                         | ESLint                                         |
| `npm run format` / `format:check`      | Prettier                                       |
| `npm run db:generate -- --name <nome>` | gera migration a partir do `schema.ts`         |
| `npm run db:migrate`                   | aplica migrations pendentes                    |
| `npm run db:studio`                    | interface visual do Drizzle para o banco       |
| `npm run seed`                         | cria/atualiza os usuários do `.env`            |
| `npm run user -- <comando> <email>`    | administração pelo terminal (ver abaixo)       |

---

## Administração de usuários (CLI)

Não existe cadastro público nem recuperação de senha por e-mail, **de propósito**. A maior parte da administração agora é feita no próprio site (ver [Gestão de usuários](#gestão-de-usuários)). A CLI continua existindo como **plano B**, para quem tem acesso ao servidor, como quando ninguém consegue entrar:

```bash
npm run user -- 2fa:enable  gabriel@exemplo.com   # mostra QR code; confirma com um código do app
npm run user -- 2fa:disable gabriel@exemplo.com
npm run user -- password    gabriel@exemplo.com   # pede a nova senha sem eco
npm run user -- logout-all  gabriel@exemplo.com   # encerra todas as sessões
npm run user -- unlock      gabriel@exemplo.com   # remove bloqueio por tentativas
```

O que esses comandos garantem:

- ativar 2FA, trocar senha ou rodar o seed **encerram todas as sessões** abertas do usuário;
- em produção, o seed e o comando `password` recusam senhas fracas. A regra é 12+ caracteres, 3 tipos entre minúsculas, maiúsculas, números e símbolos, e nenhum termo óbvio.

Em Docker: `docker compose exec -it api node dist/cli/user.js <comando> <email>`.

---

## Testes

```bash
npm test
```

São 45 testes (`tests/api.test.ts`, `tests/admin.test.ts` e `tests/totp.test.ts`), rodando contra um **Postgres real** (banco `mesa_a_dois_test`, criado pelo `docker-compose.dev.yml`).

| Grupo        | O que valida                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessão       | cookie `HttpOnly` + `SameSite=Strict`, token salvo só como hash, logout invalida no servidor, cookie forjado ou expirado recusado                         |
| Força bruta  | bloqueio após 5 erros, mesma mensagem para e-mail inexistente e senha errada                                                                              |
| 2FA          | exige código, recusa código errado, impede reutilizar o mesmo código, `REQUIRE_2FA` bloqueia contas sem 2FA e derruba sessões antigas                     |
| CSRF         | escrita sem `X-Requested-With` ou de outra origem → 403                                                                                                   |
| Ativação 2FA | primeiro login devolve QR e ativa com o código, token expirado recusado, reset força nova ativação, reconfigurar exige senha atual                        |
| Usuários     | exige login, lista sem expor segredos, criação com reautenticação e senha forte, troca de senha derruba sessões (mantém a própria), exclusão, desbloqueio |
| Analytics    | não guarda IP, ignora robôs, payload inválido não grava, marca acessos do casal e os exclui do resumo, resumo exige login, user-agent, GeoIP              |
| Restaurantes | validação, CRUD com pratos, busca por prato, ordenação por nota, id inválido                                                                              |
| Uploads      | conversão para WebP, URL relativa, arquivo falso recusado                                                                                                 |
| Unidade      | TOTP contra os vetores da RFC 6238, cifra AES-GCM (inclusive adulteração), política de senha                                                              |

Para apontar outro banco de teste: `TEST_DATABASE_URL=postgresql://... npm test`.

Os testes rodam com `GEOIP_ENABLED=false`. O teste de GeoIP liga a geolocalização só durante ele mesmo.

---

## Migrations

1. Altere `src/db/schema.ts`.
2. `npm run db:generate -- --name descricao_da_mudanca` gera o SQL em `drizzle/`.
3. Revise o SQL e rode `npm run db:migrate`.

Em produção, o container aplica as migrations sozinho antes de subir o servidor.

| Migration                             | O que faz                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `0002_criteria_users_analytics`       | adiciona os 7 critérios em `restaurants`, as colunas de ativação do 2FA e `last_login_at` em `users` e cria `analytics_events`              |
| `0003_drop_restaurant_person_ratings` | remove `rating_gabriel` e `rating_milena` de `restaurants`. **As notas antigas dos restaurantes são descartadas** (as dos pratos continuam) |

---

## Docker e produção

O `Dockerfile` usa _multi-stage build_:

- compila o TypeScript;
- remove as dependências de desenvolvimento;
- roda como usuário `node`, sem root.

Ao iniciar, executa `node dist/db/migrate.js && node dist/server.js`.

No `deploy/docker-compose.yml`:

- a API **não expõe porta** para a internet;
- o Caddy encaminha `/api/*` e `/uploads/*` para ela no mesmo domínio do site, com HTTPS automático.

O passo a passo completo de produção está em [`deploy/README.md`](./deploy/README.md).

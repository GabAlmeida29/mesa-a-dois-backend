import path from 'node:path';
import { rm } from 'node:fs/promises';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { analyticsEvents, dishes, restaurants, sessions, users } from '../src/db/schema';
import { encryptSecret, generateTotpSecret, totpCode, currentStep } from '../src/auth/totp';
import { env } from '../src/config/env';

const app = createApp();
const EMAIL = 'gabriel@teste.com';
const PASSWORD = 'Senha-Forte-2026';
const H = { 'X-Requested-With': 'mesa-a-dois', Origin: 'http://localhost:3000' };

const baseRestaurant = {
  name: 'Cantina da Nonna',
  cuisine: 'Italiana',
  city: 'Passo Fundo',
  latitude: -28.2628,
  longitude: -52.4067,
  scoreFood: 9,
  scoreService: 8.5,
  priceLevel: 2,
  visitedAt: '2026-09-20',
};

async function loggedAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });
});

beforeEach(async () => {
  await db.delete(analyticsEvents);
  await db.delete(dishes);
  await db.delete(restaurants);
  await db.delete(sessions);
  await db.delete(users);
  await db
    .insert(users)
    .values({ name: 'Gabriel', email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 4) });
});

afterAll(async () => {
  await rm(path.resolve('tmp-test-uploads'), { recursive: true, force: true });
  await pool.end();
});

describe('auth — sessão em cookie httpOnly', () => {
  it('login define cookie HttpOnly + SameSite=Strict e não devolve token no corpo', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('token');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/mesa_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('guarda só o hash do token no banco', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
    const token = String(res.headers['set-cookie']).match(/mesa_session=([^;]+)/)![1];
    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenHash).not.toBe(token);
  });

  it('/me funciona com o cookie e logout invalida a sessão no servidor', async () => {
    const agent = await loggedAgent();
    expect((await agent.get('/api/auth/me')).body.user.name).toBe('Gabriel');
    expect((await agent.post('/api/auth/logout').set(H)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('rejeita senha errada e usuário inexistente com a mesma mensagem', async () => {
    const a = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: 'errada' });
    const b = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: 'x@teste.com', password: 'errada' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('bloqueia a conta após 5 senhas erradas, mesmo com a senha certa depois', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .set(H)
        .send({ email: EMAIL, password: `errada${i}` });
    }
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(429);
    const [u] = await db.select().from(users).where(eq(users.email, EMAIL));
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('cookie forjado não autentica', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'mesa_session=forjado123');
    expect(res.status).toBe(401);
  });

  it('sessão expirada não autentica', async () => {
    const agent = await loggedAgent();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('auth — 2FA (TOTP)', () => {
  it('exige código quando 2FA está ativo e não reaceita o mesmo código', async () => {
    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecret: encryptSecret(secret) })
      .where(eq(users.email, EMAIL));

    const semCodigo = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD });
    expect(semCodigo.status).toBe(401);
    expect(semCodigo.body.mfaRequired).toBe(true);
    expect(semCodigo.headers['set-cookie']).toBeUndefined();

    const errado = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD, code: '000000' });
    expect(errado.status).toBe(401);

    const code = totpCode(secret, currentStep());
    const ok = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD, code });
    expect(ok.status).toBe(200);

    const replay = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD, code });
    expect(replay.status).toBe(401);
  });
});

describe('auth — 2FA obrigatório (REQUIRE_2FA)', () => {
  afterEach(() => {
    env.REQUIRE_2FA = false;
  });

  it('cookie de sessão não é persistente (some ao fechar o navegador)', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });

  it('recusa login de conta sem 2FA e não cria sessão', async () => {
    env.REQUIRE_2FA = true;
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.mfaSetupRequired).toBe(true);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('senha errada continua devolvendo 401 genérico (não revela se tem 2FA)', async () => {
    env.REQUIRE_2FA = true;
    const res = await request(app).post('/api/auth/login').set(H).send({ email: EMAIL, password: 'errada' });
    expect(res.status).toBe(401);
    expect(res.body.mfaSetupRequired).toBeUndefined();
  });

  it('invalida sessões antigas de contas sem 2FA quando a regra é ligada', async () => {
    const agent = await loggedAgent();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    env.REQUIRE_2FA = true;
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('com 2FA ativo, exige o código a cada login', async () => {
    env.REQUIRE_2FA = true;
    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecret: encryptSecret(secret) })
      .where(eq(users.email, EMAIL));
    const semCodigo = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD });
    expect(semCodigo.body.mfaRequired).toBe(true);
    const agent = request.agent(app);
    const ok = await agent
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD, code: totpCode(secret, currentStep()) });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('CSRF', () => {
  it('bloqueia escrita sem o header X-Requested-With', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post('/api/restaurants')
      .set('Origin', 'http://localhost:3000')
      .send(baseRestaurant);
    expect(res.status).toBe(403);
  });

  it('bloqueia escrita vinda de outra origem', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post('/api/restaurants')
      .set({ 'X-Requested-With': 'mesa-a-dois', Origin: 'https://site-malicioso.com' })
      .send(baseRestaurant);
    expect(res.status).toBe(403);
  });
});

describe('restaurantes', () => {
  it('bloqueia escrita sem login', async () => {
    const res = await request(app).post('/api/restaurants').set(H).send(baseRestaurant);
    expect(res.status).toBe(401);
  });

  it('valida payload', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post('/api/restaurants')
      .set(H)
      .send({ ...baseRestaurant, latitude: 200, scoreFood: 11 });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('latitude');
    expect(res.body.details).toHaveProperty('scoreFood');
  });

  it('CRUD completo com pratos (sem capa)', async () => {
    const agent = await loggedAgent();
    const created = await agent
      .post('/api/restaurants')
      .set(H)
      .send({ ...baseRestaurant, coverUrl: 'x' });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty('coverUrl');
    expect(created.body.averageRating).toBe(8.8);
    expect(created.body.visitedAt).toBe('2026-09-20');
    const id = created.body.id;

    const dish = await agent
      .post(`/api/restaurants/${id}/dishes`)
      .set(H)
      .send({ name: 'Lasanha', price: 59.9, ratingGabriel: 10, ratingMilena: 9 });
    expect(dish.status).toBe(201);
    expect(dish.body.price).toBe(59.9);

    const list = await request(app).get('/api/restaurants?q=lasanha');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].dishCount).toBe(1);

    const updated = await agent
      .put(`/api/restaurants/${id}`)
      .set(H)
      .send({ scoreCleanliness: 10, scoreWait: 7 });
    expect(updated.body.scoreCleanliness).toBe(10);
    expect(updated.body.averageRating).toBe(8.6);
    expect(updated.body).not.toHaveProperty('ratingGabriel');

    expect((await agent.delete(`/api/restaurants/${id}`).set(H)).status).toBe(204);
    expect((await request(app).get(`/api/restaurants/${id}`)).status).toBe(404);
  });

  it('retorna 404 para id inválido', async () => {
    expect((await request(app).get('/api/restaurants/nao-e-uuid')).status).toBe(404);
  });

  it('ordena por nota', async () => {
    const agent = await loggedAgent();
    await agent
      .post('/api/restaurants')
      .set(H)
      .send({ ...baseRestaurant, name: 'A', scoreFood: 5, scoreService: 5 });
    await agent
      .post('/api/restaurants')
      .set(H)
      .send({ ...baseRestaurant, name: 'B', scoreFood: 9, scoreService: 9 });
    const res = await request(app).get('/api/restaurants?sort=rating');
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['B', 'A']);
  });
});

describe('uploads', () => {
  it('converte para webp e devolve URL relativa', async () => {
    const agent = await loggedAgent();
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ff6600' } })
      .png()
      .toBuffer();
    const res = await agent
      .post('/api/uploads?folder=logos')
      .set(H)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/logos\/\d{4}\/.+\.webp$/);
    expect((await request(app).get(res.body.url)).status).toBe(200);
  });

  it('rejeita arquivo que não é imagem e pasta "covers" removida', async () => {
    const agent = await loggedAgent();
    const txt = await agent
      .post('/api/uploads')
      .set(H)
      .attach('file', Buffer.from('oi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);
    const png = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const covers = await agent
      .post('/api/uploads?folder=covers')
      .set(H)
      .attach('file', png, { filename: 'c.png', contentType: 'image/png' });
    expect(covers.status).toBe(400);
  });

  it('imagem disfarçada (extensão/mime falsos) é recusada pelo processamento', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post('/api/uploads?folder=logos')
      .set(H)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
  });
});

describe('mensagens de validação', () => {
  it('responde em português indicando o campo', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post('/api/restaurants')
      .set(H)
      .send({ ...baseRestaurant, description: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.details.description[0]).toBe('Máximo de 500 caracteres');
  });
});

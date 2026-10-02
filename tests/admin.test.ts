import path from 'node:path';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { analyticsEvents, dishes, restaurants, sessions, users } from '../src/db/schema';
import { base32Decode, currentStep, decryptSecret, totpCode } from '../src/auth/totp';
import { env } from '../src/config/env';
import { parseUserAgent, isBot } from '../src/analytics/user-agent';
import { locate } from '../src/analytics/geoip';

const app = createApp();
const EMAIL = 'gabriel@teste.com';
const PASSWORD = 'Senha-Forte-2026';
const NEW_PASSWORD = 'Outra-Chave-Forte-99';
const H = { 'X-Requested-With': 'mesa-a-dois', Origin: 'http://localhost:3000' };
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

async function loggedAgent(email = EMAIL, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

async function userId(email: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  return user!.id;
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

afterEach(() => {
  env.REQUIRE_2FA = false;
});

afterAll(async () => {
  await pool.end();
});

describe('gestão de usuários', () => {
  it('exige login', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
  });

  it('lista sem expor hash, segredo 2FA ou token', async () => {
    const agent = await loggedAgent();
    const res = await agent.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ email: EMAIL, twoFactorEnabled: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password|totp|enrollment/i);
  });

  it('cria usuário só com a senha atual correta e senha nova forte', async () => {
    const agent = await loggedAgent();
    const novo = { name: 'Milena', email: 'Milena@Teste.com', password: NEW_PASSWORD };

    const semReauth = await agent
      .post('/api/users')
      .set(H)
      .send({ ...novo, currentPassword: 'errada' });
    expect(semReauth.status).toBe(400);
    expect(semReauth.body.details).toHaveProperty('currentPassword');

    const fraca = await agent
      .post('/api/users')
      .set(H)
      .send({ ...novo, password: 'curta', currentPassword: PASSWORD });
    expect(fraca.status).toBe(400);
    expect(fraca.body.details).toHaveProperty('password');

    const ok = await agent
      .post('/api/users')
      .set(H)
      .send({ ...novo, currentPassword: PASSWORD });
    expect(ok.status).toBe(201);
    expect(ok.body.email).toBe('milena@teste.com');

    const repetido = await agent
      .post('/api/users')
      .set(H)
      .send({ ...novo, currentPassword: PASSWORD });
    expect(repetido.status).toBe(409);
  });

  it('troca a senha de outro usuário e derruba as sessões dele', async () => {
    const agent = await loggedAgent();
    await agent
      .post('/api/users')
      .set(H)
      .send({ name: 'Milena', email: 'milena@teste.com', password: NEW_PASSWORD, currentPassword: PASSWORD });
    const milena = await loggedAgent('milena@teste.com', NEW_PASSWORD);

    const res = await agent
      .post(`/api/users/${await userId('milena@teste.com')}/password`)
      .set(H)
      .send({ password: 'Chave-Renovada-2027', currentPassword: PASSWORD });
    expect(res.status).toBe(204);
    expect((await milena.get('/api/auth/me')).status).toBe(401);
    await loggedAgent('milena@teste.com', 'Chave-Renovada-2027');
  });

  it('trocar a própria senha mantém a sessão atual', async () => {
    const agent = await loggedAgent();
    const other = await loggedAgent();
    const res = await agent
      .post(`/api/users/${await userId(EMAIL)}/password`)
      .set(H)
      .send({ password: NEW_PASSWORD, currentPassword: PASSWORD });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('não exclui a si mesmo e exclui outro com reautenticação', async () => {
    const agent = await loggedAgent();
    await agent
      .post('/api/users')
      .set(H)
      .send({ name: 'Milena', email: 'milena@teste.com', password: NEW_PASSWORD, currentPassword: PASSWORD });

    const self = await agent
      .delete(`/api/users/${await userId(EMAIL)}`)
      .set(H)
      .send({ currentPassword: PASSWORD });
    expect(self.status).toBe(400);

    const other = await agent
      .delete(`/api/users/${await userId('milena@teste.com')}`)
      .set(H)
      .send({ currentPassword: PASSWORD });
    expect(other.status).toBe(204);
    expect((await agent.get('/api/users')).body).toHaveLength(1);
  });

  it('desbloqueia conta travada', async () => {
    const agent = await loggedAgent();
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(users.email, EMAIL));
    const id = await userId(EMAIL);
    expect((await agent.get('/api/users')).body[0].lockedUntil).not.toBeNull();
    expect((await agent.post(`/api/users/${id}/unlock`).set(H)).status).toBe(204);
    expect((await agent.get('/api/users')).body[0].lockedUntil).toBeNull();
  });
});

describe('2FA pelo site', () => {
  it('primeiro login sem 2FA devolve QR code e ativa com o código', async () => {
    env.REQUIRE_2FA = true;
    const first = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD });
    expect(first.status).toBe(403);
    expect(first.body.mfaSetupRequired).toBe(true);
    expect(first.headers['set-cookie']).toBeUndefined();
    const { enrollmentToken, secret, qrCode } = first.body.enrollment;
    expect(qrCode).toMatch(/^data:image\/png;base64,/);
    expect(base32Decode(secret)).toHaveLength(20);

    const wrong = await request(app)
      .post('/api/auth/2fa/enroll')
      .set(H)
      .send({ enrollmentToken, code: '000000' });
    expect(wrong.status).toBe(400);

    const agent = request.agent(app);
    const ok = await agent
      .post('/api/auth/2fa/enroll')
      .set(H)
      .send({ enrollmentToken, code: totpCode(secret, currentStep()) });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.email, EMAIL));
    expect(decryptSecret(row.totpSecret!)).toBe(secret);
    expect(row.enrollmentTokenHash).toBeNull();

    const reused = await request(app)
      .post('/api/auth/2fa/enroll')
      .set(H)
      .send({ enrollmentToken, code: totpCode(secret, currentStep() + 1) });
    expect(reused.status).toBe(400);
  });

  it('token de ativação expirado é recusado', async () => {
    env.REQUIRE_2FA = true;
    const first = await request(app)
      .post('/api/auth/login')
      .set(H)
      .send({ email: EMAIL, password: PASSWORD });
    const { enrollmentToken, secret } = first.body.enrollment;
    await db.update(users).set({ enrollmentExpiresAt: new Date(Date.now() - 1000) });
    const res = await request(app)
      .post('/api/auth/2fa/enroll')
      .set(H)
      .send({ enrollmentToken, code: totpCode(secret, currentStep()) });
    expect(res.status).toBe(400);
  });

  it('reset do 2FA pelo admin força nova ativação no próximo login', async () => {
    const agent = await loggedAgent();
    const res = await agent
      .post(`/api/users/${await userId(EMAIL)}/reset-2fa`)
      .set(H)
      .send({ currentPassword: PASSWORD });
    expect(res.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('reconfigurar o próprio 2FA exige a senha atual', async () => {
    const agent = await loggedAgent();
    const denied = await agent.post('/api/auth/2fa/setup').set(H).send({ currentPassword: 'errada' });
    expect(denied.status).toBe(400);
    const ok = await agent.post('/api/auth/2fa/setup').set(H).send({ currentPassword: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.enrollmentToken).toBeTruthy();
  });
});

describe('analytics', () => {
  it('registra visita sem guardar IP e ignora robôs', async () => {
    const ok = await request(app)
      .post('/api/analytics/collect')
      .set({ ...H, 'User-Agent': CHROME_MAC })
      .send({ type: 'pageview', path: '/restaurantes?q=pizza', referrer: 'https://www.instagram.com/x' });
    expect(ok.status).toBe(204);
    await request(app)
      .post('/api/analytics/collect')
      .set({ ...H, 'User-Agent': 'Googlebot/2.1' })
      .send({ type: 'pageview', path: '/' });

    const rows = await db.select().from(analyticsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: '/restaurantes',
      referrerHost: 'instagram.com',
      device: 'desktop',
      browser: 'Chrome',
      os: 'macOS',
      isAdmin: false,
    });
    expect(rows[0].visitorHash).toHaveLength(32);
    expect(JSON.stringify(rows[0])).not.toMatch(/127\.0\.0\.1/);
  });

  it('payload inválido não quebra nem grava', async () => {
    const res = await request(app)
      .post('/api/analytics/collect')
      .set({ ...H, 'User-Agent': CHROME_MAC })
      .send({ type: 'hack', path: 'x'.repeat(1000) });
    expect(res.status).toBe(204);
    expect(await db.select().from(analyticsEvents)).toHaveLength(0);
  });

  it('marca acessos do casal e o resumo os exclui por padrão', async () => {
    const send = (client: { post: ReturnType<typeof request>['post'] }, body: object) =>
      client
        .post('/api/analytics/collect')
        .set({ ...H, 'User-Agent': CHROME_MAC })
        .send(body);

    const admin = await loggedAgent();
    await send(request(app), { type: 'pageview', path: '/' });
    await send(request(app), { type: 'click', path: '/', target: 'Ver detalhes' });
    await send(admin, { type: 'pageview', path: '/sobre' });

    const summary = await admin.get('/api/analytics/summary?days=7');
    expect(summary.status).toBe(200);
    expect(summary.body.totals).toEqual({ pageviews: 1, clicks: 1, visitors: 1 });
    expect(summary.body.pages).toEqual([{ path: '/', views: 1, visitors: 1 }]);
    expect(summary.body.clicks[0]).toMatchObject({ target: 'Ver detalhes', clicks: 1 });
    expect(summary.body.daily).toHaveLength(7);

    const all = await admin.get('/api/analytics/summary?days=7&includeAdmin=true');
    expect(all.body.totals.pageviews).toBe(2);
  });

  it('resumo exige login', async () => {
    expect((await request(app).get('/api/analytics/summary')).status).toBe(401);
  });

  it('identifica dispositivo e robôs pelo user-agent', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(iphone)).toEqual({ device: 'mobile', browser: 'Safari', os: 'iOS' });
    expect(isBot('facebookexternalhit/1.1')).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });

  it('localiza IP público pela base DB-IP', async () => {
    env.GEOIP_ENABLED = true;
    try {
      const geo = await locate('::ffff:8.8.8.8');
      expect(geo.country).toBe('US');
      expect(await locate('127.0.0.1')).toMatchObject({ country: null });
    } finally {
      env.GEOIP_ENABLED = false;
    }
  });
});

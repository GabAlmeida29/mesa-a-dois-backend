import path from 'node:path';
import { rm } from 'node:fs/promises';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { analyticsEvents, dishes, restaurants, sessions, users } from '../src/db/schema';

const app = createApp();
const H = { 'X-Requested-With': 'mesa-a-dois', Origin: 'http://localhost:3000' };
const ADMIN = { email: 'gabriel@teste.com', password: 'Chave-Forte-2026!' };
const MEMBER = { email: 'convidado@teste.com', password: 'Chave-Convidado-2026!' };
const restaurant = { name: 'Cantina', latitude: -28.26, longitude: -52.4, scoreFood: 9 };

async function login({ email, password }: { email: string; password: string }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(H).send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

async function createMember(permissions: string[]) {
  const admin = await login(ADMIN);
  const res = await admin
    .post('/api/users')
    .set(H)
    .send({ name: 'Convidado', ...MEMBER, role: 'member', permissions, currentPassword: ADMIN.password });
  expect(res.status).toBe(201);
  return { admin, member: await login(MEMBER), id: res.body.id as string };
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
  await db.insert(users).values({
    name: 'Gabriel',
    email: ADMIN.email,
    passwordHash: await bcrypt.hash(ADMIN.password, 4),
  });
});

afterAll(async () => {
  await rm(path.resolve('tmp-test-uploads'), { recursive: true, force: true });
  await pool.end();
});

describe('papéis e permissões', () => {
  it('usuário existente vira administrador e /me devolve as permissões efetivas', async () => {
    const admin = await login(ADMIN);
    const me = await admin.get('/api/auth/me');
    expect(me.body.user.role).toBe('admin');
    expect(me.body.user.permissions).toContain('restaurants:delete');
  });

  it('membro só faz o que foi liberado', async () => {
    const { member } = await createMember(['restaurants:create']);
    const created = await member.post('/api/restaurants').set(H).send(restaurant);
    expect(created.status).toBe(201);

    const id = created.body.id;
    expect((await member.put(`/api/restaurants/${id}`).set(H).send({ name: 'X' })).status).toBe(403);
    expect((await member.delete(`/api/restaurants/${id}`).set(H)).status).toBe(403);
    expect((await member.post(`/api/restaurants/${id}/dishes`).set(H).send({ name: 'Prato' })).status).toBe(
      403,
    );
    expect((await member.get('/api/analytics/summary')).status).toBe(403);
    expect((await member.get('/api/users')).status).toBe(403);
  });

  it('permissões atualizadas valem na hora', async () => {
    const { admin, member, id } = await createMember([]);
    expect((await member.get('/api/analytics/summary')).status).toBe(403);
    const res = await admin
      .put(`/api/users/${id}`)
      .set(H)
      .send({ permissions: ['analytics:view'] });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(['analytics:view']);
    expect((await member.get('/api/analytics/summary')).status).toBe(200);
  });

  it('não permite alterar as próprias permissões nem ficar sem administrador', async () => {
    const admin = await login(ADMIN);
    const [me] = await db.select().from(users).where(eq(users.email, ADMIN.email));
    const self = await admin.put(`/api/users/${me.id}`).set(H).send({ role: 'member' });
    expect(self.status).toBe(400);

    const { id } = await createMember([]);
    const promote = await admin.put(`/api/users/${id}`).set(H).send({ role: 'admin' });
    expect(promote.body.role).toBe('admin');
    const demote = await admin.put(`/api/users/${id}`).set(H).send({ role: 'member' });
    expect(demote.status).toBe(200);
  });

  it('rejeita permissão inexistente', async () => {
    const admin = await login(ADMIN);
    const res = await admin
      .post('/api/users')
      .set(H)
      .send({ name: 'X', ...MEMBER, role: 'member', permissions: ['tudo'], currentPassword: ADMIN.password });
    expect(res.status).toBe(400);
  });
});

describe('perfil e página Sobre', () => {
  it('atualiza o próprio perfil e aparece no /team só quando marcado', async () => {
    const admin = await login(ADMIN);
    expect((await request(app).get('/api/team')).body).toEqual([]);

    const res = await admin.put('/api/auth/me').set(H).send({
      name: 'Gabriel Almeida',
      headline: 'Dev',
      bio: 'Gosta de massa',
      instagram: '@gabalmeida29',
      showOnAbout: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.instagram).toBe('gabalmeida29');

    const team = await request(app).get('/api/team');
    expect(team.body).toHaveLength(1);
    expect(team.body[0]).toMatchObject({ name: 'Gabriel Almeida', headline: 'Dev' });
    expect(JSON.stringify(team.body)).not.toMatch(/email|role|permissions/);
  });

  it('valida o usuário do Instagram', async () => {
    const admin = await login(ADMIN);
    const res = await admin.put('/api/auth/me').set(H).send({ name: 'G', instagram: 'nome com espaço' });
    expect(res.status).toBe(400);
  });

  it('aceita upload de avatar reduzido para 512px', async () => {
    const admin = await login(ADMIN);
    const png = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#a64b25' } })
      .png()
      .toBuffer();
    const res = await admin
      .post('/api/uploads?folder=avatars')
      .set(H)
      .attach('file', png, { filename: 'eu.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const image = await request(app).get(res.body.url).buffer(true);
    const meta = await sharp(image.body as Buffer).metadata();
    expect(meta.width).toBe(512);
  });
});

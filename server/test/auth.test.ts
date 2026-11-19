import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, api, newUser, type TestServer } from './helpers';
import { STARTING_MONEY } from '../../shared/src';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.stop(); });

describe('API / autenticação', () => {
  it('health check responde', async () => {
    const r = await api(srv.base, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('cadastra, faz login, consulta perfil e logout', async () => {
    const reg = await api(srv.base, 'POST', '/api/v1/auth/register', { username: 'Jogador_Um', password: 'minhaSenha!23' });
    expect(reg.status).toBe(201);
    expect(reg.body.token).toBeTypeOf('string');

    const dup = await api(srv.base, 'POST', '/api/v1/auth/register', { username: 'jogador_um', password: 'outraSenha123' });
    expect(dup.status).toBe(409);

    const bad = await api(srv.base, 'POST', '/api/v1/auth/login', { username: 'Jogador_Um', password: 'errada12345' });
    expect(bad.status).toBe(401);

    const login = await api(srv.base, 'POST', '/api/v1/auth/login', { username: 'JOGADOR_UM', password: 'minhaSenha!23' });
    expect(login.status).toBe(200);
    const token = login.body.token;

    const prof = await api(srv.base, 'GET', '/api/v1/profile', undefined, token);
    expect(prof.status).toBe(200);
    expect(prof.body.balance).toBe(STARTING_MONEY);
    expect(prof.body.appearance.skin).toBeTypeOf('number');

    const out = await api(srv.base, 'POST', '/api/v1/auth/logout', {}, token);
    expect(out.status).toBe(200);
    const after = await api(srv.base, 'GET', '/api/v1/auth/me', undefined, token);
    expect(after.status).toBe(401);
  });

  it('senha nunca é salva em texto puro (argon2id)', async () => {
    const u = await newUser(srv.base);
    const { users } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await srv.dbh.db.select().from(users).where(eq(users.id, u.id));
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain('senhaSegura123');
  });

  it('valida entradas', async () => {
    const r = await api(srv.base, 'POST', '/api/v1/auth/register', { username: 'a', password: '1' });
    expect(r.status).toBe(400);
    const r2 = await api(srv.base, 'GET', '/api/v1/profile');
    expect(r2.status).toBe(401);
  });

  it('persiste aparência e configurações', async () => {
    const u = await newUser(srv.base);
    const ap = { body: 'fem', skin: 5, face: 2, hair: 3, hairColor: 4, top: 1, topColor: 7, legs: 2, legsColor: 3, shoes: 1, shoesColor: 2, accessory: 1 };
    const r = await api(srv.base, 'PUT', '/api/v1/profile/character', { appearance: ap }, u.token);
    expect(r.status).toBe(200);
    const s = await api(srv.base, 'PUT', '/api/v1/profile/settings', { settings: { graphics: 'ultra', sensitivity: 1.5 } }, u.token);
    expect(s.status).toBe(200);
    const prof = await api(srv.base, 'GET', '/api/v1/profile', undefined, u.token);
    expect(prof.body.appearance).toEqual(ap);
    expect(prof.body.settings.graphics).toBe('ultra');
    const bad = await api(srv.base, 'PUT', '/api/v1/profile/settings', { settings: { hack: true } }, u.token);
    expect(bad.status).toBe(400);
  });

  it('compras exigem estar no jogo e perto da loja', async () => {
    const u = await newUser(srv.base);
    const r = await api(srv.base, 'POST', '/api/v1/shop/buy', { itemId: 'w_smg' }, u.token);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('not_in_game');
  });
});

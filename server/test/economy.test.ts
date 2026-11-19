import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, newUser, type TestServer } from './helpers';
import { STARTING_MONEY } from '../../shared/src';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.stop(); });

describe('Economia', () => {
  it('impede saldo negativo', async () => {
    const u = await newUser(srv.base);
    await expect(srv.economy.apply(u.id, -(STARTING_MONEY + 1), 'test')).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(await srv.economy.balance(u.id)).toBe(STARTING_MONEY);
  });

  it('chave de idempotência impede recompensa duplicada', async () => {
    const u = await newUser(srv.base);
    await srv.economy.apply(u.id, 1000, 'mission', 'x', 'idem-1');
    await expect(srv.economy.apply(u.id, 1000, 'mission', 'x', 'idem-1')).rejects.toMatchObject({ code: 'duplicate_transaction' });
    expect(await srv.economy.balance(u.id)).toBe(STARTING_MONEY + 1000);
  });

  it('gastos concorrentes nunca deixam saldo negativo', async () => {
    const u = await newUser(srv.base);
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => srv.economy.apply(u.id, -1000, 'spam')));
    const ok = attempts.filter((a) => a.status === 'fulfilled').length;
    expect(ok).toBe(STARTING_MONEY / 1000);
    expect(await srv.economy.balance(u.id)).toBe(0);
  });

  it('compra é atômica: sem saldo, nada é entregue', async () => {
    const u = await newUser(srv.base);
    await expect(srv.players.buyVehicle(u.id, 'zenit', 0)).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect((await srv.players.vehicles(u.id)).length).toBe(0);
    const res = await srv.players.buyVehicle(u.id, 'brisa', 0xd23b2f).catch((e) => e);
    // brisa custa 14000 > 5000 iniciais
    expect(res.code).toBe('insufficient_funds');
    await srv.economy.apply(u.id, 20000, 'grant', undefined, `grant:${u.id}`);
    const ok = await srv.players.buyVehicle(u.id, 'brisa', 0xd23b2f);
    expect(ok.balance).toBe(STARTING_MONEY + 20000 - 14000);
    expect((await srv.players.vehicles(u.id)).length).toBe(1);
  });

  it('propriedade não pode ser comprada duas vezes e venda reembolsa 50%', async () => {
    const u = await newUser(srv.base);
    await srv.economy.apply(u.id, 200000, 'grant', undefined, `g2:${u.id}`);
    await srv.players.buyProperty(u.id, 'house_vila');
    await expect(srv.players.buyProperty(u.id, 'house_vila')).rejects.toMatchObject({ code: 'already_owned' });
    const before = await srv.economy.balance(u.id);
    const sale = await srv.players.sellProperty(u.id, 'house_vila');
    expect(sale.balance).toBe(before + 30000);
  });

  it('arma não pode ser comprada duas vezes; munição acumula', async () => {
    const u = await newUser(srv.base);
    await expect(srv.players.buyShopItem(u.id, 'w_pistol')).rejects.toMatchObject({ code: 'already_owned' });
    await srv.players.buyShopItem(u.id, 'a_pistol');
    const inv = await srv.players.inventory(u.id);
    expect(inv.find((i) => i.itemId === 'ammo_pistol')!.qty).toBe(48 + 36);
  });
});

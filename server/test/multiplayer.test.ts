import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Socket } from 'socket.io-client';
import { startServer, newUser, connect, emit, waitFor, sleep, api, type TestServer } from './helpers';
import { EV, MISSION_MAP, POIS, STARTING_MONEY, type Snapshot, type RoomDetail } from '../../shared/src';

let srv: TestServer;
let A: { token: string; id: string; username: string }, B: typeof A, C: typeof A;
let sa: Socket, sb: Socket, sc: Socket;
let room: RoomDetail;

beforeAll(async () => {
  srv = await startServer();
  A = await newUser(srv.base); B = await newUser(srv.base); C = await newUser(srv.base);
  sa = await connect(srv.base, A.token); sb = await connect(srv.base, B.token); sc = await connect(srv.base, C.token);
});
afterAll(async () => { sa?.close(); sb?.close(); sc?.close(); await srv.stop(); });

const ctx = (id: string) => srv.rooms.context(id)!;

describe('Multiplayer real com clientes independentes', () => {
  it('rejeita socket sem token', async () => {
    await expect(connect(srv.base, 'token-invalido')).rejects.toBeTruthy();
  });

  it('cria sala privada com senha e código de convite', async () => {
    const r = await emit<RoomDetail>(sa, EV.roomCreate, { name: 'Sala Teste', maxPlayers: 2, isPrivate: true, password: 'abc123', mode: 'freeroam', pvp: true, rules: 'sem regras' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    room = r.data;
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    const list = await emit<any[]>(sb, EV.roomList);
    expect(list.ok && list.data.find((x) => x.id === room.id)).toBeFalsy(); // privada não aparece
  });

  it('valida código e senha', async () => {
    const wrong = await emit(sb, EV.roomJoin, { code: 'ZZZZZZ' });
    expect(wrong.ok).toBe(false);
    const byId = await emit(sb, EV.roomJoin, { roomId: room.id, password: 'abc123' });
    expect(byId.ok).toBe(false);
    const badPw = await emit(sb, EV.roomJoin, { code: room.code, password: 'errada' });
    expect(badPw.ok).toBe(false);
    const statePromise = waitFor<RoomDetail>(sa, EV.roomState, (d) => d.playersList.length === 2);
    const ok = await emit<RoomDetail>(sb, EV.roomJoin, { code: room.code.toLowerCase(), password: 'abc123' });
    expect(ok.ok).toBe(true);
    const st = await statePromise;
    expect(st.playersList.map((p) => p.username).sort()).toEqual([A.username, B.username].sort());
  });

  it('sala lotada recusa terceiro jogador', async () => {
    const r = await emit(sc, EV.roomJoin, { code: room.code, password: 'abc123' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lotada/i);
  });

  it('apenas anfitrião inicia e exige todos prontos', async () => {
    const notHost = await emit(sb, EV.roomStart);
    expect(notHost.ok).toBe(false);
    const notReady = await emit(sa, EV.roomStart);
    expect(notReady.ok).toBe(false);
    await emit(sb, EV.roomReady, { ready: true });
    const ga = waitFor(sa, EV.gameStarted), gb = waitFor(sb, EV.gameStarted);
    const st = await emit(sa, EV.roomStart);
    expect(st.ok).toBe(true);
    const [a, b] = await Promise.all([ga, gb]);
    expect(a.snapshot.players.length).toBe(2);
    expect(b.snapshot.vehicles.length).toBeGreaterThan(20);
  });

  it('sincroniza movimento entre os dois clientes', async () => {
    const start = ctx(A.id).player.p;
    const target: [number, number, number] = [start[0] + 1.5, start[1], start[2] + 0.5];
    const r = await emit(sa, EV.playerState, { seq: 1, p: target, yaw: 1.2, anim: 'run' });
    expect(r.ok && r.data).toBe(true);
    const snap = await waitFor<Snapshot>(sb, EV.snapshot, (s) => s.players.some((p) => p.id === A.id && p.anim === 'run'));
    const pa = snap.players.find((p) => p.id === A.id)!;
    expect(pa.p[0]).toBeCloseTo(target[0], 1);
    expect(pa.yaw).toBeCloseTo(1.2, 2);
  });

  it('servidor rejeita teleporte e corrige o cliente', async () => {
    await sleep(100);
    const corr = waitFor(sa, EV.correct);
    const r = await emit(sa, EV.playerState, { seq: 2, p: [900, 2, 900], yaw: 0, anim: 'run' });
    expect(r.ok && r.data).toBe(false);
    const c = await corr;
    expect(Math.abs(c.p[0] - 900)).toBeGreaterThan(100);
  });

  it('entrada em veículo com assentos validados e sincronização de direção', async () => {
    const { room: rm } = ctx(A.id);
    const veh = [...rm.vehicles.values()].find((v) => v.model === 'aurelia' && !v.driver)!;
    ctx(A.id).player.p = [veh.p[0] + 1, veh.p[1], veh.p[2]];
    ctx(B.id).player.p = [veh.p[0] - 1, veh.p[1], veh.p[2]];
    const far = await emit(sc, EV.vehicleEnter, { id: veh.id, seat: -1 });
    expect(far.ok).toBe(false);
    const ea = await emit<any>(sa, EV.vehicleEnter, { id: veh.id, seat: -1 });
    expect(ea.ok && ea.data.seat).toBe(0);
    const stealDriver = await emit(sb, EV.vehicleEnter, { id: veh.id, seat: 0 });
    expect(stealDriver.ok).toBe(false);
    const eb = await emit<any>(sb, EV.vehicleEnter, { id: veh.id, seat: -1 });
    expect(eb.ok && eb.data.seat).toBe(1);
    // passageiro não pode dirigir
    const fake = await emit(sb, EV.vehicleState, { id: veh.id, p: veh.p, q: veh.q, v: [0, 0, 0], steer: 0, speed: 0, lights: false });
    expect(fake.ok && fake.data).toBe(false);
    await sleep(80);
    const np: [number, number, number] = [veh.p[0] + 2, veh.p[1], veh.p[2]];
    const drive = await emit(sa, EV.vehicleState, { id: veh.id, p: np, q: [0, 0, 0, 1], v: [10, 0, 0], steer: 0.2, speed: 10, lights: true });
    expect(drive.ok && drive.data).toBe(true);
    const snap = await waitFor<Snapshot>(sb, EV.snapshot, (s) => s.vehicles.some((v) => v.id === veh.id && v.lights));
    const sv = snap.vehicles.find((v) => v.id === veh.id)!;
    expect(sv.driver).toBe(A.id);
    expect(sv.passengers[0]).toBe(B.id);
    expect(sv.p[0]).toBeCloseTo(np[0], 1);
    await emit(sa, EV.vehicleExit); await emit(sb, EV.vehicleExit);
    expect(ctx(A.id).player.veh).toBeNull();
  });

  it('combate validado pelo servidor: dano, munição e cadência', async () => {
    const pa = ctx(A.id).player, pb = ctx(B.id).player;
    pa.p = [0, 2, 0]; pb.p = [0, 2, 10];
    const sel = await emit(sa, EV.selectWeapon, { weapon: 'pistol' });
    expect(sel.ok).toBe(true);
    const notOwned = await emit(sa, EV.selectWeapon, { weapon: 'sniper' });
    expect(notOwned.ok).toBe(false);
    const hit = waitFor(sb, EV.combatEvent, (e) => e.type === 'hit' && e.target === B.id);
    const f = await emit<any>(sa, EV.fire, { weapon: 'pistol', origin: [0, 3.4, 0], dirs: [[0, -0.07, 1]] });
    expect(f.ok).toBe(true);
    const ev = await hit;
    expect(ev.hp).toBeLessThan(100);
    expect(pb.hp).toBeLessThan(100);
    // cadência: segundo tiro imediato é rejeitado
    const f2 = await emit<any>(sa, EV.fire, { weapon: 'pistol', origin: [0, 3.4, 0], dirs: [[0, -0.07, 1]] });
    expect(f2.ok && f2.data.rejected).toBe('rate');
    expect(pa.ammo.get('pistol')!.mag).toBe(11);
    // disparo gera procurado
    expect(pa.wanted).toBeGreaterThanOrEqual(1);
  });

  it('missão com checkpoints validados e recompensa única', async () => {
    const def = MISSION_MAP.get('explore_rural')!;
    const pa = ctx(A.id).player;
    pa.p = [def.giver.x, 5, def.giver.z];
    const st = await emit<any>(sa, EV.missionStart, { missionId: def.id });
    expect(st.ok).toBe(true);
    const away = await emit(sa, EV.missionCheckpoint, { missionId: def.id, index: 0 });
    expect(away.ok).toBe(false); // longe do checkpoint
    let last: any;
    for (let i = 0; i < def.checkpoints.length; i++) {
      const cp = def.checkpoints[i];
      if (i > 0) {
        const prev = def.checkpoints[i - 1];
        await sleep((Math.hypot(cp.x - prev.x, cp.z - prev.z) / 95) * 1000 + 100);
      }
      pa.p = [cp.x, 5, cp.z];
      last = await emit<any>(sa, EV.missionCheckpoint, { missionId: def.id, index: i });
      expect(last.ok).toBe(true);
    }
    expect(last.data.completed).toBe(true);
    expect(last.data.balance).toBe(STARTING_MONEY + def.reward);
    const again = await emit(sa, EV.missionCheckpoint, { missionId: def.id, index: 0 });
    expect(again.ok).toBe(false);
  });

  it('compra na loja exige proximidade e atualiza inventário em jogo', async () => {
    const shop = POIS.find((p) => p.id === 'gun_1')!;
    const pa = ctx(A.id).player;
    pa.p = [shop.x + 3, 2, shop.z];
    const invEvt = waitFor(sa, EV.inventory);
    const r = await api(srv.base, 'POST', '/api/v1/shop/buy', { itemId: 'w_csmg' }, A.token);
    expect(r.status).toBe(200);
    const inv = await invEvt;
    expect(inv.weapons).toContain('csmg');
    pa.p = [shop.x + 300, 2, shop.z];
    const far = await api(srv.base, 'POST', '/api/v1/shop/buy', { itemId: 'a_csmg' }, A.token);
    expect(far.status).toBe(403);
  });

  it('chat com proteção anti-spam', async () => {
    const got = waitFor(sb, EV.chatMsg, (m) => m.text === 'olá mundo');
    expect((await emit(sa, EV.chatSend, { text: 'olá mundo' })).ok).toBe(true);
    await got;
    const rep = await emit(sa, EV.chatSend, { text: 'olá mundo' });
    expect(rep.ok).toBe(false);
  });

  it('reconexão automática devolve o jogador à partida', async () => {
    sb.close();
    await sleep(200);
    expect(ctx(B.id).player.connected).toBe(false);
    let gsPromise!: Promise<any>;
    sb = await connect(srv.base, B.token, (s) => {
      gsPromise = waitFor(s, EV.gameStarted, () => true, 3000);
    });
    const gs = await gsPromise.catch(() => null);
    expect(gs).not.toBeNull();
    expect(ctx(B.id).player.connected).toBe(true);
  });

  it('persiste posição ao sair e mantém dados ao voltar', async () => {
    ctx(A.id).player.p = [123, 2, -45];
    await emit(sa, EV.roomLeave);
    const prof = await api(srv.base, 'GET', '/api/v1/profile', undefined, A.token);
    expect(prof.body.lastPos[0]).toBeCloseTo(123, 0);
    expect(prof.body.balance).toBe(STARTING_MONEY + 2000 - 4800); // recompensa da missão (2000) - compra csmg (4800)
    const inv = await api(srv.base, 'GET', '/api/v1/inventory', undefined, A.token);
    expect(inv.body.items.some((i: any) => i.itemId === 'csmg')).toBe(true);
    expect(inv.body.items.find((i: any) => i.itemId === 'ammo_pistol').qty).toBe(47);
  });

  it('partida rápida cria/encontra sessão pública', async () => {
    const r = await emit<RoomDetail>(sc, EV.roomQuick);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('playing');
  });
});

import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  EV, MAX_PLAYERS_PER_ROOM, RECONNECT_GRACE_MS, EMPTY_ROOM_TTL_MS, SNAPSHOT_HZ, WATER_LEVEL,
  RoomCreateSchema, RoomJoinSchema, RoomUpdateSchema, PlayerStateMsgSchema, VehicleStateMsgSchema, VehicleEnterSchema,
  FireMsgSchema, ChatSchema, EmoteSchema, MissionStartSchema, MissionCheckpointSchema, CrimeSchema, SelfDamageSchema,
  RamSchema, UseItemSchema, VehicleDamageSchema, VehicleSpawnSchema,
  WEAPONS, VEHICLES, MISSION_MAP, POIS, SPAWN_POINTS, ARREST_FINE, RESPAWN_COST, WORLD_HALF,
  getParkingSpots, terrainHeight, mulberry32, nearestRoad,
  type Appearance, type RoomDetail, type RoomSummary, type NetPlayer, type NetVehicle, type Snapshot, type WorldClock,
  type Vec3, type Quat, type AnimState, type GameMode, type Weather, type Ack, type MissionDef, type VehicleCategory,
} from '../../../shared/src';
import type { DB } from '../db';
import { roomHistory } from '../db/schema';
import type { AuthUser } from '../services/auth';
import { AppError } from '../services/auth';
import type { EconomyService } from '../services/economy';
import type { PlayerService, VehicleMods } from '../services/player';

/* ------------------------------------------------------------------ */
interface AmmoState { mag: number; reserve: number }
interface MissionRun { def: MissionDef; runId: string; index: number; startedAt: number; lastCpAt: number; vehicleId?: string }

export class RoomPlayer {
  socket: Socket | null = null;
  ready = false;
  connected = true;
  disconnectedAt = 0;
  p: Vec3 = [0, 2, 0];
  yaw = 0; pitch = 0;
  anim: AnimState = 'idle';
  lastSeq = -1;
  lastStateAt = 0;
  hp = 100; armor = 0;
  dead = false; deadAt = 0;
  veh: string | null = null; seat = -1;
  wanted = 0; lastSpotted = 0; lastCrimeAt = 0;
  weapon = 'fists';
  weapons = new Set<string>(['fists']);
  ammo = new Map<string, AmmoState>();
  lastFireAt = 0; reloadUntil = 0;
  mission: MissionRun | null = null;
  ownedSpawned: string | null = null;
  joinedAt = Date.now();
  lastSave = Date.now();
  kills = 0; deaths = 0;
  team = 0;
  violations = 0;
  constructor(public userId: string, public username: string, public appearance: Appearance) {}
}

interface SrvVehicle extends NetVehicle {
  ambient: boolean;
  spawn?: { p: Vec3; q: Quat };
  lastUse: number;
  ownedId?: string;
  missionFor?: string;
  mods: VehicleMods;
  destroyedAt: number;
}

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/* ------------------- limitador de mensagens (token bucket) ------------------- */
class Bucket {
  private tokens: number; private last = Date.now();
  constructor(private rate: number, private burst: number) { this.tokens = burst; }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n; return true;
  }
}

/* ================================================================== */
export class Room {
  players = new Map<string, RoomPlayer>();
  vehicles = new Map<string, SrvVehicle>();
  status: 'lobby' | 'playing' = 'lobby';
  clock: WorldClock = { hour: 9, rate: 24 / (48 * 60), weather: 'clear', weatherBlend: 0 };
  nextWeatherAt = Date.now() + 5 * 60_000;
  emptySince: number | null = null;
  createdAt = Date.now();
  historyId?: number;
  peak = 0;
  vehSeq = 0;
  dirtyVeh = new Set<string>();
  lastFull = 0;
  passwordHash?: string;
  nextEventAt = Date.now() + 8 * 60_000;

  constructor(
    public id: string, public code: string, public name: string, public hostId: string,
    public maxPlayers: number, public isPrivate: boolean, public mode: GameMode, public pvp: boolean, public rules: string,
  ) {}

  get channel() { return `room:${this.id}`; }
  activeCount() { let n = 0; for (const p of this.players.values()) if (p.connected || Date.now() - p.disconnectedAt < RECONNECT_GRACE_MS) n++; return n; }

  summary(region: string): RoomSummary {
    return {
      id: this.id, name: this.name, players: this.activeCount(), maxPlayers: this.maxPlayers, status: this.status,
      mode: this.mode, pvp: this.pvp, hasPassword: !!this.passwordHash, region, host: this.players.get(this.hostId)?.username ?? '?',
    };
  }
  detail(region: string): RoomDetail {
    return {
      ...this.summary(region), code: this.code, isPrivate: this.isPrivate, rules: this.rules,
      playersList: [...this.players.values()].map((p) => ({ userId: p.userId, username: p.username, ready: p.ready, isHost: p.userId === this.hostId, connected: p.connected, appearance: p.appearance })),
    };
  }

  netPlayer(p: RoomPlayer): NetPlayer {
    return {
      id: p.userId, name: p.username, p: [r2(p.p[0]), r2(p.p[1]), r2(p.p[2])], yaw: r3(p.yaw), pitch: r3(p.pitch), anim: p.dead ? 'dead' : p.anim,
      hp: Math.round(p.hp), armor: Math.round(p.armor), veh: p.veh, seat: p.seat, wanted: p.wanted, weapon: p.weapon, appearance: p.appearance, team: p.team,
    };
  }
  netVehicle(v: SrvVehicle): NetVehicle {
    return {
      id: v.id, model: v.model, p: [r2(v.p[0]), r2(v.p[1]), r2(v.p[2])], q: [r3(v.q[0]), r3(v.q[1]), r3(v.q[2]), r3(v.q[3])],
      v: [r2(v.v[0]), r2(v.v[1]), r2(v.v[2])], steer: r2(v.steer), speed: r2(v.speed), lights: v.lights, horn: v.horn, siren: v.siren,
      driver: v.driver, passengers: v.passengers, color: v.color, health: Math.round(v.health), ownerUserId: v.ownerUserId,
    };
  }

  snapshot(full: boolean): Snapshot {
    const vehicles: NetVehicle[] = [];
    for (const v of this.vehicles.values()) if (full || this.dirtyVeh.has(v.id)) vehicles.push(this.netVehicle(v));
    this.dirtyVeh.clear();
    return {
      t: Date.now(),
      players: [...this.players.values()].filter((p) => p.connected).map((p) => this.netPlayer(p)),
      vehicles,
      clock: { ...this.clock, hour: r3(this.clock.hour) },
    };
  }

  addVehicle(model: string, p: Vec3, yaw: number, opts: Partial<SrvVehicle> = {}): SrvVehicle {
    const def = VEHICLES[model];
    const id = `v${++this.vehSeq}`;
    const q = yawQuat(yaw);
    const v: SrvVehicle = {
      id, model, p: [...p] as Vec3, q, v: [0, 0, 0], steer: 0, speed: 0, lights: false, horn: false, siren: false,
      driver: null, passengers: new Array(Math.max(0, def.seats - 1)).fill(null), color: def.colors[0], health: 1000,
      ownerUserId: null, ambient: true, spawn: { p: [...p] as Vec3, q }, lastUse: 0, mods: {}, destroyedAt: 0, ...opts,
    };
    this.vehicles.set(id, v);
    this.dirtyVeh.add(id);
    return v;
  }

  /** popula veículos estacionados determinísticos por sala */
  populate() {
    const seed = [...this.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
    const rnd = mulberry32(seed);
    const spots = getParkingSpots();
    const byRegion: Record<string, string[]> = {
      downtown: ['aurelia', 'brisa', 'taxi', 'raio', 'aurelia', 'trilha', 'saudade', 'onibus'],
      residential: ['brisa', 'aurelia', 'trilha', 'boiadeiro', 'furgao', 'saudade'],
      luxury: ['zenit', 'raio', 'saudade', 'trilha'],
      beach: ['brisa', 'trilha', 'raio', 'saudade'],
      industrial: ['carreta', 'furgao', 'boiadeiro', 'carreta'],
      airport: ['taxi', 'furgao', 'aurelia', 'onibus'],
      rural: ['boiadeiro', 'trator', 'trilha', 'boiadeiro'],
      mountains: ['trilha', 'boiadeiro'], island: ['brisa'], ocean: ['brisa'],
    };
    const chosen = spots.filter(() => rnd() < 0.42).slice(0, 70);
    for (const s of chosen) {
      const list = byRegion[s.region] ?? byRegion.downtown;
      const model = list[Math.floor(rnd() * list.length)];
      const def = VEHICLES[model];
      const v = this.addVehicle(model, [s.x, s.y + def.height * 0.45 + 0.2, s.z], s.yaw);
      v.color = def.colors[Math.floor(rnd() * def.colors.length)];
    }
    // garantidos perto do spawn central
    const near: [string, number, number, number][] = [
      ['raio', 22, 60, 0], ['aurelia', -22, 75, 0], ['taxi', -60, 22, Math.PI / 2], ['trilha', 60, -22, -Math.PI / 2],
      ['police', -95, 160, 0], ['police', -105, 160, 0], ['ambulance', 140, -100, Math.PI],
      ['carreta', 720, 650, 0], ['furgao', 100, 165, Math.PI / 2], ['boiadeiro', 640, -540, 0.4],
    ];
    for (const [m, x, z, yaw] of near) this.addVehicle(m, [x, terrainHeight(x, z) + VEHICLES[m].height * 0.45 + 0.2, z], yaw);
    // marina
    const boats: [string, number, number][] = [['lancha', -915, 470], ['jetski', -915, 500], ['lancha', -915, 530], ['jetski', -915, 560]];
    for (const [m, x, z] of boats) this.addVehicle(m, [x, WATER_LEVEL + 0.5, z], -Math.PI / 2);
  }
}

/* ================================================================== */
export interface ManagerDeps { db: DB; economy: EconomyService; players: PlayerService; log: FastifyBaseLogger; region: string }

export class RoomManager {
  rooms = new Map<string, Room>();
  userRoom = new Map<string, string>();
  userSocket = new Map<string, Socket>();
  private timers: NodeJS.Timeout[] = [];
  private io!: Server;
  private tickN = 0;

  constructor(private deps: ManagerDeps) {}

  attach(io: Server) {
    this.io = io;
    let last = Date.now();
    this.timers.push(setInterval(() => { const now = Date.now(); this.tick((now - last) / 1000); last = now; }, 1000 / SNAPSHOT_HZ));
    this.timers.push(setInterval(() => this.cleanup(), 5000));
    this.timers.push(setInterval(() => void this.autosave(), 30_000));
  }

  async shutdown() {
    for (const t of this.timers) clearInterval(t);
    await this.autosave(true);
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.activeCount();
    return { rooms: this.rooms.size, players };
  }

  /** contexto do jogador em jogo (usado pela API REST para validar proximidade de lojas) */
  context(userId: string): { room: Room; player: RoomPlayer } | null {
    const rid = this.userRoom.get(userId);
    const room = rid ? this.rooms.get(rid) : undefined;
    const player = room?.players.get(userId);
    if (!room || !player || room.status !== 'playing') return null;
    return { room, player };
  }

  requireNear(userId: string, kinds: string[], radius = 30, coords?: { x: number; z: number }) {
    const ctx = this.context(userId);
    if (!ctx) throw new AppError(403, 'not_in_game', 'Você precisa estar dentro do jogo');
    if (ctx.player.dead) throw new AppError(403, 'dead', 'Você está morto');
    const targets = coords ? [coords] : POIS.filter((p) => kinds.includes(p.kind));
    const ok = targets.some((t) => Math.hypot(ctx.player.p[0] - t.x, ctx.player.p[2] - t.z) <= radius);
    if (!ok) throw new AppError(403, 'too_far', 'Vá até o local para fazer isso');
    return ctx;
  }

  /* ------------------------- conexão ------------------------- */
  onConnect(socket: Socket, user: AuthUser) {
    const prev = this.userSocket.get(user.id);
    if (prev && prev.id !== socket.id) {
      prev.emit(EV.error, { code: 'session_replaced', message: 'Sua conta conectou em outra aba.' });
      prev.data.replaced = true;
      prev.disconnect(true);
    }
    this.userSocket.set(user.id, socket);
    socket.data.user = user;
    const buckets = {
      state: new Bucket(40, 60), fire: new Bucket(30, 40), chat: new Bucket(0.8, 3), room: new Bucket(6, 15), misc: new Bucket(10, 20),
    };
    const on = <T>(ev: string, bucket: Bucket, fn: (data: any) => Promise<T> | T) => {
      socket.on(ev, async (data: unknown, ack?: (r: Ack<T>) => void) => {
        if (!bucket.take()) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Muitas mensagens, aguarde.' });
          return;
        }
        try {
          const out = await fn(data);
          if (typeof ack === 'function') ack({ ok: true, data: out });
        } catch (e: any) {
          const msg = e instanceof AppError ? e.message : e?.issues ? (e.issues[0]?.message ?? 'Dados inválidos') : 'Erro interno';
          if (!(e instanceof AppError) && !e?.issues) this.deps.log.error({ err: e, ev }, 'socket handler error');
          if (typeof ack === 'function') ack({ ok: false, error: msg });
        }
      });
    };

    on(EV.roomList, buckets.room, () => this.list());
    on(EV.roomCreate, buckets.room, (d) => this.create(user, socket, d));
    on(EV.roomJoin, buckets.room, (d) => this.join(user, socket, d));
    on(EV.roomQuick, buckets.room, () => this.quick(user, socket));
    on(EV.roomLeave, buckets.room, () => this.leave(user.id, 'left'));
    on(EV.roomReady, buckets.room, (d) => this.ready(user.id, !!d?.ready));
    on(EV.roomStart, buckets.room, () => this.start(user.id));
    on(EV.roomUpdate, buckets.room, (d) => this.update(user.id, d));
    on(EV.roomClose, buckets.room, () => this.close(user.id));
    on(EV.chatSend, buckets.chat, (d) => this.chat(user.id, d));
    on(EV.emote, buckets.misc, (d) => this.emote(user.id, d));
    on(EV.playerState, buckets.state, (d) => this.playerState(user.id, d));
    on(EV.vehicleState, buckets.state, (d) => this.vehicleState(user.id, d));
    on(EV.vehicleEnter, buckets.misc, (d) => this.vehicleEnter(user.id, d));
    on(EV.vehicleExit, buckets.misc, () => this.vehicleExit(user.id));
    on(EV.vehicleDamage, buckets.misc, (d) => this.vehicleDamage(user.id, d));
    on(EV.vehicleSpawnOwned, buckets.room, (d) => this.spawnOwned(user.id, d));
    on(EV.fire, buckets.fire, (d) => this.fire(user.id, d));
    on(EV.reload, buckets.misc, () => this.reload(user.id));
    on(EV.selectWeapon, buckets.misc, (d) => this.selectWeapon(user.id, d));
    on(EV.useItem, buckets.misc, (d) => this.useItem(user.id, d));
    on(EV.selfDamage, buckets.misc, (d) => this.selfDamage(user.id, d));
    on(EV.ram, buckets.misc, (d) => this.ram(user.id, d));
    on(EV.crime, buckets.misc, (d) => this.crime(user.id, d));
    on(EV.arrest, buckets.misc, () => this.arrest(user.id));
    on(EV.missionStart, buckets.misc, (d) => this.missionStart(user.id, d));
    on(EV.missionCheckpoint, buckets.misc, (d) => this.missionCheckpoint(user.id, d));
    on(EV.missionAbort, buckets.misc, () => this.missionFail(user.id, 'Missão abandonada'));

    socket.on('disconnect', () => this.onDisconnect(user.id, socket));

    // reconexão automática à sala anterior
    const rid = this.userRoom.get(user.id);
    const room = rid ? this.rooms.get(rid) : undefined;
    const rp = room?.players.get(user.id);
    if (room && rp) {
      rp.socket = socket; rp.connected = true; rp.disconnectedAt = 0;
      socket.join(room.channel);
      socket.emit(EV.roomState, room.detail(this.deps.region));
      if (room.status === 'playing') this.sendGameStart(room, rp);
      this.broadcastRoom(room);
      this.sys(room, `${rp.username} reconectou.`);
    }
  }

  private onDisconnect(userId: string, socket: Socket) {
    if (this.userSocket.get(userId) === socket) this.userSocket.delete(userId);
    const room = this.roomOf(userId);
    const p = room?.players.get(userId);
    if (!room || !p || p.socket !== socket) return;
    p.connected = false; p.disconnectedAt = Date.now(); p.socket = null;
    if (p.veh) this.releaseSeat(room, p);
    this.broadcastRoom(room);
    this.sys(room, `${p.username} desconectou (aguardando reconexão).`);
  }

  /* ------------------------- salas ------------------------- */
  private roomOf(userId: string) { const id = this.userRoom.get(userId); return id ? this.rooms.get(id) : undefined; }
  private requireRoom(userId: string) { const r = this.roomOf(userId); if (!r) throw new AppError(400, 'not_in_room', 'Você não está em uma sala'); return r; }
  private requireGame(userId: string) {
    const room = this.requireRoom(userId);
    const p = room.players.get(userId)!;
    if (room.status !== 'playing') throw new AppError(400, 'not_playing', 'A partida não começou');
    return { room, p };
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.isPrivate).map((r) => r.summary(this.deps.region))
      .sort((a, b) => b.players - a.players);
  }

  private newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)];
      if (![...this.rooms.values()].some((r) => r.code === c)) return c;
    }
  }

  async create(user: AuthUser, socket: Socket, input: unknown, autoStart = false) {
    const o = RoomCreateSchema.parse(input);
    if (this.roomOf(user.id)) await this.leave(user.id, 'left');
    if (this.rooms.size >= 200) throw new AppError(503, 'server_full', 'Servidor cheio');
    const room = new Room(crypto.randomUUID().slice(0, 8), this.newCode(), o.name, user.id, o.maxPlayers, o.isPrivate, o.mode, o.pvp, o.rules ?? '');
    if (o.password) room.passwordHash = await hash(o.password);
    room.populate();
    this.rooms.set(room.id, room);
    try {
      const [h] = await this.deps.db.insert(roomHistory).values({ roomId: room.id, name: room.name, hostUserId: user.id, mode: room.mode, maxPlayers: room.maxPlayers }).returning();
      room.historyId = h.id;
    } catch (e) { this.deps.log.warn({ err: e }, 'room_history insert failed'); }
    this.deps.log.info({ room: room.id, host: user.username }, 'room created');
    await this.addPlayer(room, user, socket);
    if (autoStart) await this.start(user.id);
    return room.detail(this.deps.region);
  }

  async join(user: AuthUser, socket: Socket, input: unknown) {
    const o = RoomJoinSchema.parse(input);
    const room = o.code ? [...this.rooms.values()].find((r) => r.code === o.code) : this.rooms.get(o.roomId!);
    if (!room) throw new AppError(404, 'room_not_found', 'Sala não encontrada');
    if (!o.code && room.isPrivate) throw new AppError(403, 'private_room', 'Sala privada: use o código de convite');
    if (room.players.has(user.id)) {
      const rp = room.players.get(user.id)!;
      rp.socket = socket; rp.connected = true; socket.join(room.channel);
      if (room.status === 'playing') this.sendGameStart(room, rp);
      this.broadcastRoom(room);
      return room.detail(this.deps.region);
    }
    if (room.activeCount() >= room.maxPlayers) throw new AppError(409, 'room_full', 'Sala lotada');
    if (room.passwordHash) {
      if (!o.password || !(await verify(room.passwordHash, o.password))) throw new AppError(403, 'wrong_password', 'Senha incorreta');
    }
    if (this.roomOf(user.id)) await this.leave(user.id, 'left');
    await this.addPlayer(room, user, socket);
    return room.detail(this.deps.region);
  }

  async quick(user: AuthUser, socket: Socket) {
    const candidates = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && !r.passwordHash && r.mode === 'freeroam' && r.activeCount() < r.maxPlayers)
      .sort((a, b) => b.activeCount() - a.activeCount());
    if (candidates[0]) return this.join(user, socket, { roomId: candidates[0].id });
    return this.create(user, socket, { name: `Sessão Pública ${this.newCode().slice(0, 3)}`, maxPlayers: MAX_PLAYERS_PER_ROOM, isPrivate: false, mode: 'freeroam', pvp: true, rules: 'Sessão pública de mundo aberto' }, true);
  }

  private async addPlayer(room: Room, user: AuthUser, socket: Socket) {
    const prof = await this.deps.players.profile(user.id);
    const inv = await this.deps.players.inventory(user.id);
    const p = new RoomPlayer(user.id, user.username, prof.appearance);
    for (const it of inv) {
      if (it.kind === 'weapon' && it.qty > 0 && WEAPONS[it.itemId]) p.weapons.add(it.itemId);
    }
    for (const w of p.weapons) {
      const def = WEAPONS[w];
      if (def.mag <= 0) continue;
      const total = inv.find((i) => i.itemId === `ammo_${w}`)?.qty ?? 0;
      const mag = Math.min(total, def.mag);
      p.ammo.set(w, { mag, reserve: total - mag });
    }
    const lp = prof.lastPos;
    if (lp && lp.length === 3 && lp.every(Number.isFinite) && Math.abs(lp[0]) < WORLD_HALF && Math.abs(lp[2]) < WORLD_HALF) {
      p.p = [lp[0], terrainHeight(lp[0], lp[2]) + 0.1, lp[2]];
    } else {
      const sp = SPAWN_POINTS[room.players.size % SPAWN_POINTS.length];
      p.p = [sp[0], terrainHeight(sp[0], sp[1]) + 0.1, sp[1]];
    }
    p.socket = socket;
    p.team = room.players.size % 2;
    room.players.set(user.id, p);
    room.emptySince = null;
    room.peak = Math.max(room.peak, room.activeCount());
    this.userRoom.set(user.id, room.id);
    socket.join(room.channel);
    this.broadcastRoom(room);
    this.sys(room, `${user.username} entrou na sala.`);
    if (room.status === 'playing') this.sendGameStart(room, p);
  }

  async leave(userId: string, reason: 'left' | 'kicked' | 'timeout' | 'closed') {
    const room = this.roomOf(userId);
    if (!room) return true;
    const p = room.players.get(userId);
    this.userRoom.delete(userId);
    if (!p) return true;
    if (p.veh) this.releaseSeat(room, p);
    if (p.ownedSpawned) { room.vehicles.delete(p.ownedSpawned); room.dirtyVeh.add(p.ownedSpawned); this.io?.to(room.channel).emit(EV.vehicleEvent, { type: 'remove', id: p.ownedSpawned }); }
    if (p.mission?.vehicleId) { room.vehicles.delete(p.mission.vehicleId); this.io?.to(room.channel).emit(EV.vehicleEvent, { type: 'remove', id: p.mission.vehicleId }); }
    await this.savePlayer(p, room).catch((e) => this.deps.log.error({ err: e }, 'save on leave failed'));
    room.players.delete(userId);
    p.socket?.leave(room.channel);
    if (reason === 'kicked') p.socket?.emit(EV.roomKicked, { reason: 'Você foi removido pelo anfitrião' });
    if (room.hostId === userId) {
      const next = [...room.players.values()].find((x) => x.connected) ?? [...room.players.values()][0];
      if (next) { room.hostId = next.userId; this.sys(room, `${next.username} agora é o anfitrião.`); }
    }
    if (room.players.size === 0) room.emptySince = Date.now();
    this.io?.to(room.channel).emit(EV.vehicleEvent, { type: 'playerLeft', userId });
    this.sys(room, `${p.username} saiu da sala.`);
    this.broadcastRoom(room);
    return true;
  }

  ready(userId: string, ready: boolean) {
    const room = this.requireRoom(userId);
    room.players.get(userId)!.ready = ready;
    this.broadcastRoom(room);
    return true;
  }

  async start(userId: string) {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new AppError(403, 'not_host', 'Apenas o anfitrião pode iniciar');
    if (room.status === 'playing') return true;
    const notReady = [...room.players.values()].filter((p) => p.userId !== userId && p.connected && !p.ready);
    if (notReady.length) throw new AppError(409, 'not_ready', `Aguardando: ${notReady.map((p) => p.username).join(', ')}`);
    room.status = 'playing';
    room.lastFull = 0;
    for (const p of room.players.values()) this.sendGameStart(room, p);
    this.broadcastRoom(room);
    this.deps.log.info({ room: room.id }, 'game started');
    return true;
  }

  private sendGameStart(room: Room, p: RoomPlayer) {
    p.socket?.emit(EV.gameStarted, {
      roomId: room.id, you: room.netPlayer(p), snapshot: room.snapshot(true), pvp: room.pvp, mode: room.mode,
      inventory: { weapons: [...p.weapons], ammo: Object.fromEntries(p.ammo), weapon: p.weapon },
      mission: p.mission ? { id: p.mission.def.id, index: p.mission.index, startedAt: p.mission.startedAt } : null,
    });
    // full snapshot também alcança outros jogadores (novo veículo/jogador)
    for (const v of room.vehicles.values()) room.dirtyVeh.add(v.id);
  }

  update(userId: string, input: unknown) {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new AppError(403, 'not_host', 'Apenas o anfitrião pode alterar a sala');
    const o = RoomUpdateSchema.parse(input);
    if (o.name) room.name = o.name;
    if (o.maxPlayers) room.maxPlayers = Math.max(o.maxPlayers, room.activeCount());
    if (o.pvp !== undefined) room.pvp = o.pvp;
    if (o.mode) room.mode = o.mode;
    if (o.rules !== undefined) room.rules = o.rules;
    if (o.kick && o.kick !== userId && room.players.has(o.kick)) void this.leave(o.kick, 'kicked');
    this.broadcastRoom(room);
    return room.detail(this.deps.region);
  }

  async close(userId: string) {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new AppError(403, 'not_host', 'Apenas o anfitrião pode fechar a sala');
    this.io.to(room.channel).emit(EV.roomClose, { reason: 'A sala foi encerrada pelo anfitrião' });
    for (const id of [...room.players.keys()]) await this.leave(id, 'closed');
    await this.destroyRoom(room);
    return true;
  }

  private async destroyRoom(room: Room) {
    this.rooms.delete(room.id);
    if (room.historyId) {
      await this.deps.db.update(roomHistory).set({ closedAt: new Date(), peakPlayers: room.peak }).where(eq(roomHistory.id, room.historyId)).catch(() => {});
    }
    this.deps.log.info({ room: room.id }, 'room destroyed');
  }

  private broadcastRoom(room: Room) { this.io?.to(room.channel).emit(EV.roomState, room.detail(this.deps.region)); }
  private sys(room: Room, text: string) { this.io?.to(room.channel).emit(EV.chatMsg, { from: 'Sistema', text, system: true, t: Date.now() }); }
  private notify(p: RoomPlayer, text: string, kind: 'info' | 'success' | 'warn' | 'money' = 'info') { p.socket?.emit(EV.notify, { text, kind }); }

  /* ------------------------- social ------------------------- */
  private lastChat = new Map<string, { text: string; t: number; strikes: number; mutedUntil: number }>();
  chat(userId: string, input: unknown) {
    const room = this.requireRoom(userId);
    const p = room.players.get(userId)!;
    const { text } = ChatSchema.parse(input);
    const st = this.lastChat.get(userId) ?? { text: '', t: 0, strikes: 0, mutedUntil: 0 };
    const now = Date.now();
    if (now < st.mutedUntil) throw new AppError(429, 'muted', 'Você está silenciado temporariamente por spam');
    if (st.text === text && now - st.t < 10_000) {
      st.strikes++;
      if (st.strikes >= 3) { st.mutedUntil = now + 30_000; st.strikes = 0; }
      this.lastChat.set(userId, st);
      throw new AppError(429, 'spam', 'Mensagem repetida');
    }
    this.lastChat.set(userId, { text, t: now, strikes: Math.max(0, st.strikes - 1), mutedUntil: st.mutedUntil });
    const clean = text.replace(/[<>]/g, '');
    this.io.to(room.channel).emit(EV.chatMsg, { from: p.username, userId, text: clean, t: now });
    return true;
  }

  emote(userId: string, input: unknown) {
    const room = this.requireRoom(userId);
    const { emote } = EmoteSchema.parse(input);
    this.io.to(room.channel).emit(EV.emote, { userId, emote });
    return true;
  }

  /* ------------------------- movimento ------------------------- */
  playerState(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const m = PlayerStateMsgSchema.parse(input);
    if (p.dead) return false;
    if (m.seq <= p.lastSeq && p.lastSeq - m.seq < 1000) return false;
    const now = Date.now();
    const dt = Math.max(0.03, (now - (p.lastStateAt || now)) / 1000);
    if (p.veh) {
      const v = room.vehicles.get(p.veh);
      if (v) { p.p = [v.p[0], v.p[1], v.p[2]]; }
    } else {
      const d = dist2(m.p, p.p);
      const maxSpeed = 14; // sprint + rolagem + tolerância
      if (d > maxSpeed * dt + 4 && p.lastStateAt) {
        p.violations++;
        p.socket?.emit(EV.correct, { p: p.p });
        if (p.violations > 50) this.deps.log.warn({ user: p.username }, 'many movement violations');
        return false;
      }
      if (Math.abs(m.p[0]) > WORLD_HALF + 300 || Math.abs(m.p[2]) > WORLD_HALF + 300 || m.p[1] < -60 || m.p[1] > 800) {
        p.socket?.emit(EV.correct, { p: p.p });
        return false;
      }
      p.p = m.p as Vec3;
    }
    p.lastSeq = m.seq; p.lastStateAt = now;
    p.yaw = m.yaw; p.pitch = m.pitch ?? 0; p.anim = m.anim;
    if (m.spotted && p.wanted > 0) p.lastSpotted = now;
    return true;
  }

  vehicleState(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const m = VehicleStateMsgSchema.parse(input);
    const v = room.vehicles.get(m.id);
    if (!v || v.driver !== userId || p.veh !== v.id) return false;
    const def = VEHICLES[v.model];
    const now = Date.now();
    const dt = Math.max(0.03, (now - (v.lastUse || now)) / 1000);
    const d = dist3(m.p, v.p);
    const max = def.maxSpeed * 1.8 + 15;
    if (v.lastUse && d > max * dt + 6) {
      p.socket?.emit(EV.correct, { vehicle: v.id, p: v.p, q: v.q });
      return false;
    }
    v.p = m.p as Vec3; v.q = m.q as Quat; v.v = m.v as Vec3;
    v.steer = m.steer; v.speed = m.speed; v.lights = m.lights; v.horn = !!m.horn; v.siren = !!m.siren && def.category === 'police';
    v.lastUse = now;
    p.p = [v.p[0], v.p[1], v.p[2]];
    room.dirtyVeh.add(v.id);
    return true;
  }

  vehicleEnter(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { id, seat } = VehicleEnterSchema.parse(input);
    if (p.dead) throw new AppError(400, 'dead', 'Você está morto');
    if (p.veh) throw new AppError(400, 'already_in_vehicle', 'Você já está em um veículo');
    const v = room.vehicles.get(id);
    if (!v || v.health <= 0) throw new AppError(404, 'vehicle_unavailable', 'Veículo indisponível');
    const def = VEHICLES[v.model];
    if (dist3(p.p, v.p) > def.length / 2 + 4) throw new AppError(400, 'too_far', 'Muito longe do veículo');
    let s = seat;
    if (s === -1) s = !v.driver ? 0 : v.passengers.findIndex((x) => !x) + 1;
    if (s < 0 || s > v.passengers.length) throw new AppError(409, 'vehicle_full', 'Veículo lotado');
    if (s === 0) {
      if (v.driver) throw new AppError(409, 'seat_taken', 'Assento ocupado');
      if (v.ownerUserId && v.ownerUserId !== userId) throw new AppError(403, 'not_owner', 'Este veículo pertence a outro jogador');
      if (v.missionFor && v.missionFor !== userId) throw new AppError(403, 'mission_vehicle', 'Veículo reservado para missão');
      v.driver = userId;
      if (def.category === 'police' && p.wanted < 2) this.setWanted(room, p, 2, 'Roubo de viatura!');
    } else {
      if (v.passengers[s - 1]) throw new AppError(409, 'seat_taken', 'Assento ocupado');
      v.passengers[s - 1] = userId;
    }
    p.veh = v.id; p.seat = s;
    v.lastUse = Date.now();
    room.dirtyVeh.add(v.id);
    this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'enter', id: v.id, userId, seat: s, state: room.netVehicle(v) });
    return { id: v.id, seat: s, vehicle: room.netVehicle(v) };
  }

  private releaseSeat(room: Room, p: RoomPlayer) {
    const v = p.veh ? room.vehicles.get(p.veh) : undefined;
    if (v) {
      if (v.driver === p.userId) { v.driver = null; v.v = [0, 0, 0]; v.speed = 0; v.horn = false; }
      v.passengers = v.passengers.map((x) => (x === p.userId ? null : x));
      v.lastUse = Date.now();
      room.dirtyVeh.add(v.id);
      this.io?.to(room.channel).emit(EV.vehicleEvent, { type: 'exit', id: v.id, userId: p.userId, state: room.netVehicle(v) });
    }
    p.veh = null; p.seat = -1;
  }

  vehicleExit(userId: string) {
    const { room, p } = this.requireGame(userId);
    if (!p.veh) return false;
    const v = room.vehicles.get(p.veh);
    this.releaseSeat(room, p);
    if (v) {
      const def = VEHICLES[v.model];
      const right: Vec3 = [Math.cos(this.yawOf(v.q)), 0, -Math.sin(this.yawOf(v.q))];
      const side = def.width / 2 + 0.9;
      p.p = [v.p[0] - right[0] * side, Math.max(v.p[1], terrainHeight(v.p[0], v.p[2])) + 0.2, v.p[2] - right[2] * side];
    }
    return { p: p.p };
  }

  private yawOf(q: Quat) { return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])); }

  vehicleDamage(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { id, amount } = VehicleDamageSchema.parse(input);
    const v = room.vehicles.get(id);
    if (!v || v.driver !== userId || p.veh !== id) return false;
    this.damageVehicle(room, v, Math.min(amount, 250), userId);
    return v.health;
  }

  private damageVehicle(room: Room, v: SrvVehicle, amount: number, attacker: string | null) {
    if (v.health <= 0) return;
    v.health = Math.max(0, v.health - amount);
    room.dirtyVeh.add(v.id);
    if (v.health <= 0) {
      v.destroyedAt = Date.now();
      this.io.to(room.channel).emit(EV.combatEvent, { type: 'explosion', p: v.p, vehicle: v.id });
      const occupants = [v.driver, ...v.passengers].filter(Boolean) as string[];
      for (const uid of occupants) {
        const op = room.players.get(uid);
        if (op) { this.releaseSeat(room, op); this.applyDamage(room, op, 200, attacker, 'explosion'); }
      }
      for (const op of room.players.values()) {
        if (!op.veh && !op.dead && dist3(op.p, v.p) < 6) this.applyDamage(room, op, 60 * (1 - dist3(op.p, v.p) / 6), attacker, 'explosion');
      }
      if (v.ownedId) void this.deps.players.setVehicleHealth(v.ownedId, 0);
    }
  }

  async spawnOwned(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { ownedId } = VehicleSpawnSchema.parse(input);
    const owned = await this.deps.players.vehicle(userId, ownedId);
    if (owned.health <= 0) throw new AppError(400, 'destroyed', 'Veículo destruído: repare na oficina (Aurora Customs)');
    if (p.ownedSpawned) {
      const old = room.vehicles.get(p.ownedSpawned);
      if (old && (old.driver || old.passengers.some(Boolean))) throw new AppError(409, 'in_use', 'Seu veículo atual está ocupado');
      room.vehicles.delete(p.ownedSpawned);
      this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'remove', id: p.ownedSpawned });
    }
    const def = VEHICLES[owned.model];
    let pos: Vec3; let yaw = p.yaw;
    if (def.category === 'boat') {
      const marina = POIS.find((x) => x.kind === 'marina')!;
      pos = [marina.x - 60, WATER_LEVEL + 0.5, marina.z]; yaw = -Math.PI / 2;
    } else {
      const road = nearestRoad(p.p[0], p.p[2], 80);
      const x = road ? road.px : p.p[0] + Math.sin(p.yaw) * 5;
      const z = road ? road.pz : p.p[2] + Math.cos(p.yaw) * 5;
      if (road) { const a = road.edge.pts[road.i], b = road.edge.pts[road.i + 1]; yaw = Math.atan2(b[0] - a[0], b[2] - a[2]); }
      pos = [x, terrainHeight(x, z) + def.height * 0.45 + 0.4, z];
    }
    const v = room.addVehicle(owned.model, pos, yaw, {
      ambient: false, ownerUserId: userId, ownedId: owned.id, color: owned.color, health: owned.health, mods: owned.mods as VehicleMods,
    });
    p.ownedSpawned = v.id;
    this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'spawn', id: v.id, state: room.netVehicle(v), mods: v.mods });
    return { id: v.id, vehicle: room.netVehicle(v) };
  }

  /** chamada pela API após personalização para refletir no veículo spawnado */
  applyOwnedUpdate(userId: string, owned: { id: string; color: number; health: number; mods: unknown }) {
    const ctx = this.context(userId);
    if (!ctx) return;
    for (const v of ctx.room.vehicles.values()) {
      if (v.ownedId === owned.id) {
        v.color = owned.color; v.health = owned.health; v.mods = owned.mods as VehicleMods;
        ctx.room.dirtyVeh.add(v.id);
        this.io.to(ctx.room.channel).emit(EV.vehicleEvent, { type: 'mods', id: v.id, mods: v.mods, color: v.color, state: ctx.room.netVehicle(v) });
      }
    }
  }

  /* ------------------------- combate ------------------------- */
  selectWeapon(userId: string, input: unknown) {
    const { p } = this.requireGame(userId);
    const w = input && typeof input === 'object' && typeof (input as { weapon?: unknown }).weapon === 'string' ? (input as { weapon: string }).weapon : '';
    if (!p.weapons.has(w)) throw new AppError(400, 'not_owned', 'Arma não disponível');
    p.weapon = w;
    p.reloadUntil = 0;
    return { weapon: w, ammo: p.ammo.get(w) ?? null };
  }

  reload(userId: string) {
    const { p } = this.requireGame(userId);
    const def = WEAPONS[p.weapon];
    const a = p.ammo.get(p.weapon);
    if (!def || !a || def.mag <= 0) return null;
    if (a.mag >= def.mag || a.reserve <= 0) return a;
    const need = Math.min(def.mag - a.mag, a.reserve);
    a.mag += need; a.reserve -= need;
    p.reloadUntil = Date.now() + def.reload * 1000 * 0.85;
    return a;
  }

  fire(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const m = FireMsgSchema.parse(input);
    if (p.dead) return null;
    const def = WEAPONS[m.weapon];
    if (!def || !p.weapons.has(m.weapon) || p.weapon !== m.weapon) throw new AppError(400, 'invalid_weapon', 'Arma inválida');
    const now = Date.now();
    if (now < p.reloadUntil) return { rejected: 'reloading' };
    if (now - p.lastFireAt < (1000 / def.rps) * 0.8) return { rejected: 'rate' };
    if (dist3(m.origin, p.p) > (p.veh ? 6 : 3.5)) return { rejected: 'origin' };
    let ammo = p.ammo.get(m.weapon);
    if (def.mag > 0) {
      if (!ammo || ammo.mag <= 0) return { rejected: 'empty' };
      ammo.mag--;
    }
    p.lastFireAt = now;
    const dirs = m.dirs.slice(0, Math.max(1, def.pellets)).map((d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l] as Vec3; });
    // broadcast visual
    p.socket?.to(room.channel).emit(EV.combatEvent, { type: 'shot', shooter: userId, weapon: def.id, origin: m.origin, dirs, impact: m.impact });
    if (def.category !== 'melee' && def.id !== 'smoke') this.crimeInternal(room, p, 'shots_fired');

    const hits: { target: string; dmg: number }[] = [];
    if (def.id === 'launcher' || def.category === 'throwable') {
      if (def.id === 'smoke') return { ammo };
      const impact = m.impact as Vec3 | undefined;
      if (!impact || dist3(impact, m.origin) > def.range + 5) return { ammo };
      // ponto de impacto deve estar próximo da trajetória declarada (lançador)
      if (def.id === 'launcher') {
        const d = dirs[0];
        const to: Vec3 = [impact[0] - m.origin[0], impact[1] - m.origin[1], impact[2] - m.origin[2]];
        const t = to[0] * d[0] + to[1] * d[1] + to[2] * d[2];
        const off = Math.hypot(to[0] - d[0] * t, to[1] - d[1] * t, to[2] - d[2] * t);
        if (off > 4) return { ammo };
      }
      this.io.to(room.channel).emit(EV.combatEvent, { type: 'explosion', p: impact });
      this.explode(room, impact, def.damage, 9, userId, def.id);
      return { ammo };
    }
    for (const d of dirs) {
      let best: { t: number; pl?: RoomPlayer; v?: SrvVehicle } | null = null;
      if (def.category === 'melee') {
        for (const o of room.players.values()) {
          if (o === p || o.dead || o.veh || !o.connected) continue;
          const dd = dist3(o.p, p.p);
          if (dd <= def.range + 0.6 && (!best || dd < best.t)) best = { t: dd, pl: o };
        }
      } else {
        for (const o of room.players.values()) {
          if (o === p || o.dead || o.veh || !o.connected) continue;
          for (const yOff of [0.5, 1.0, 1.5]) {
            const c: Vec3 = [o.p[0], o.p[1] + yOff, o.p[2]];
            const t = this.rayHit(m.origin as Vec3, d, c, 0.42, def.range);
            if (t !== null && (!best || t < best.t)) best = { t, pl: o };
          }
        }
        for (const v of room.vehicles.values()) {
          if (v.health <= 0 || v.id === p.veh) continue;
          const t = this.rayHit(m.origin as Vec3, d, v.p, VEHICLES[v.model].length * 0.35, def.range);
          if (t !== null && (!best || t < best.t)) best = { t, v };
        }
      }
      if (!best) continue;
      const falloff = def.category === 'melee' ? 1 : Math.max(0.35, 1 - (best.t / def.range) * 0.6);
      const dmg = def.damage * falloff;
      if (best.pl) {
        if (!room.pvp) continue;
        this.applyDamage(room, best.pl, dmg, userId, def.id);
        hits.push({ target: best.pl.userId, dmg });
      } else if (best.v) {
        const occupied = best.v.driver || best.v.passengers.some(Boolean);
        if (occupied && !room.pvp) continue;
        this.damageVehicle(room, best.v, dmg * 1.5, userId);
      }
    }
    return { ammo, hits };
  }

  private rayHit(o: Vec3, d: Vec3, c: Vec3, r: number, range: number): number | null {
    const oc: Vec3 = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
    const t = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
    if (t < 0 || t > range) return null;
    const px = o[0] + d[0] * t - c[0], py = o[1] + d[1] * t - c[1], pz = o[2] + d[2] * t - c[2];
    return px * px + py * py + pz * pz <= r * r ? t : null;
  }

  private explode(room: Room, at: Vec3, damage: number, radius: number, attacker: string, weapon: string) {
    for (const o of room.players.values()) {
      if (o.dead || !o.connected) continue;
      const d = dist3(o.p, at);
      if (d > radius) continue;
      if (!room.pvp && o.userId !== attacker) continue;
      this.applyDamage(room, o, damage * (1 - d / radius), attacker, weapon);
    }
    for (const v of room.vehicles.values()) {
      const d = dist3(v.p, at);
      if (d < radius) this.damageVehicle(room, v, damage * 4 * (1 - d / radius), attacker);
    }
  }

  applyDamage(room: Room, target: RoomPlayer, amount: number, attacker: string | null, cause: string) {
    if (target.dead || amount <= 0) return;
    const absorbed = Math.min(target.armor, amount * 0.7);
    target.armor -= absorbed;
    target.hp -= amount - absorbed;
    this.io.to(room.channel).emit(EV.combatEvent, { type: 'hit', target: target.userId, attacker, amount: Math.round(amount), hp: Math.max(0, Math.round(target.hp)), armor: Math.round(target.armor), cause });
    if (target.hp <= 0) {
      target.hp = 0; target.dead = true; target.deadAt = Date.now(); target.deaths++;
      if (target.veh) this.releaseSeat(room, target);
      if (target.mission) this.missionFail(target.userId, 'Você morreu');
      const killer = attacker ? room.players.get(attacker) : undefined;
      if (killer && killer !== target) killer.kills++;
      this.io.to(room.channel).emit(EV.combatEvent, { type: 'death', victim: target.userId, killer: attacker, cause });
    }
  }

  selfDamage(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { amount, cause } = SelfDamageSchema.parse(input);
    this.applyDamage(room, p, Math.min(amount, 200), null, cause);
    return { hp: p.hp, armor: p.armor };
  }

  ram(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { target, speed } = RamSchema.parse(input);
    const v = p.veh ? room.vehicles.get(p.veh) : undefined;
    const t = room.players.get(target);
    if (!v || v.driver !== userId || !t || t.veh || t.dead || !room.pvp) return false;
    if (dist3(v.p, t.p) > VEHICLES[v.model].length / 2 + 3) return false;
    const real = Math.min(speed, Math.abs(v.speed) + 3);
    if (real < 6) return false;
    this.applyDamage(room, t, real * 3.2, userId, 'vehicle');
    return true;
  }

  async useItem(userId: string, input: unknown) {
    const { p } = this.requireGame(userId);
    const { itemId } = UseItemSchema.parse(input);
    if (p.dead) throw new AppError(400, 'dead');
    const effects: Record<string, () => void> = {
      medkit: () => { p.hp = 100; },
      snack: () => { p.hp = Math.min(100, p.hp + 20); },
      armor_light: () => { p.armor = Math.max(p.armor, 50); },
      armor_heavy: () => { p.armor = 100; },
    };
    if (!effects[itemId]) throw new AppError(400, 'not_usable', 'Item não utilizável');
    if (!(await this.deps.players.consume(userId, itemId))) throw new AppError(400, 'not_owned', 'Você não possui este item');
    effects[itemId]();
    return { hp: p.hp, armor: p.armor };
  }

  /** chamada pela API após compras em loja enquanto em jogo */
  applyPurchase(userId: string, itemKind: string, ref?: string, qty?: number) {
    const ctx = this.context(userId);
    if (!ctx) return;
    const p = ctx.player;
    if (itemKind === 'weapon' && ref) {
      p.weapons.add(ref);
      const w = WEAPONS[ref];
      if (w.mag > 0) { const a = p.ammo.get(ref) ?? { mag: 0, reserve: 0 }; a.reserve += w.mag * 2; p.ammo.set(ref, a); }
    } else if (itemKind === 'ammo' && ref) {
      const a = p.ammo.get(ref) ?? { mag: 0, reserve: 0 }; a.reserve += qty ?? 0; p.ammo.set(ref, a);
    }
    p.socket?.emit(EV.inventory, { weapons: [...p.weapons], ammo: Object.fromEntries(p.ammo), weapon: p.weapon });
  }

  /* ------------------------- polícia ------------------------- */
  private setWanted(room: Room, p: RoomPlayer, level: number, reason?: string) {
    const nl = Math.max(0, Math.min(5, level));
    if (nl === p.wanted) return;
    p.wanted = nl;
    p.lastSpotted = Date.now();
    p.socket?.emit(EV.wanted, { level: nl, reason });
  }

  private crimeInternal(room: Room, p: RoomPlayer, kind: string) {
    const now = Date.now();
    if (kind === 'shots_fired') {
      if (p.wanted < 1) this.setWanted(room, p, 1, 'Disparos relatados');
      else if (now - p.lastCrimeAt > 25_000 && p.wanted < 3) this.setWanted(room, p, p.wanted + 1, 'Tiroteio em andamento');
      else p.lastSpotted = now;
    } else if (now - p.lastCrimeAt > 4000) {
      this.setWanted(room, p, Math.max(p.wanted + 1, 1), kind === 'hit_pedestrian' ? 'Atropelamento' : kind === 'assault' ? 'Agressão' : kind === 'vehicle_theft' ? 'Roubo de veículo' : 'Infração');
    }
    p.lastCrimeAt = now;
  }

  crime(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const c = CrimeSchema.parse(input);
    if (dist2(c.p as Vec3, p.p) > 40) return false;
    this.crimeInternal(room, p, c.kind);
    return p.wanted;
  }

  async arrest(userId: string) {
    const { room, p } = this.requireGame(userId);
    if (p.wanted <= 0 || p.dead) return false;
    const fine = Math.min(ARREST_FINE * p.wanted, await this.deps.economy.balance(userId));
    if (fine > 0) await this.deps.economy.apply(userId, -fine, 'arrest_fine');
    if (p.veh) this.releaseSeat(room, p);
    if (p.mission) this.missionFail(userId, 'Você foi preso');
    const st = POIS.find((x) => x.id === 'police_central')!;
    p.p = [st.x + 6, terrainHeight(st.x + 6, st.z + 6) + 0.2, st.z + 6];
    this.setWanted(room, p, 0);
    p.socket?.emit(EV.respawn, { p: p.p, hp: p.hp, armor: p.armor, reason: `Preso! Multa de $${fine}` });
    p.socket?.emit(EV.wallet, { balance: await this.deps.economy.balance(userId) });
    return true;
  }

  /* ------------------------- missões ------------------------- */
  async missionStart(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { missionId } = MissionStartSchema.parse(input);
    const def = MISSION_MAP.get(missionId);
    if (!def) throw new AppError(404, 'mission_not_found', 'Missão inexistente');
    if (p.mission) throw new AppError(409, 'mission_active', 'Termine a missão atual primeiro');
    if (p.dead) throw new AppError(400, 'dead');
    if (Math.hypot(p.p[0] - def.giver.x, p.p[2] - def.giver.z) > 20) throw new AppError(400, 'too_far', 'Vá até o marcador da missão');
    if (def.requires.minPlayers && room.activeCount() < def.requires.minPlayers) throw new AppError(409, 'need_players', `Requer ${def.requires.minPlayers} jogadores na sala`);
    const run: MissionRun = { def, runId: crypto.randomUUID(), index: 0, startedAt: Date.now(), lastCpAt: Date.now() };
    if (def.spawnVehicle) {
      const sv = def.spawnVehicle;
      const vdef = VEHICLES[sv.model];
      const v = room.addVehicle(sv.model, [sv.x, terrainHeight(sv.x, sv.z) + vdef.height * 0.45 + 0.4, sv.z], sv.yaw, { ambient: false, missionFor: userId });
      run.vehicleId = v.id;
      this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'spawn', id: v.id, state: room.netVehicle(v), mods: {} });
    }
    p.mission = run;
    if (def.setWanted) this.setWanted(room, p, Math.max(p.wanted, def.setWanted), 'Procurado!');
    p.socket?.emit(EV.missionEvent, { type: 'started', missionId, index: 0, timeLimit: def.timeLimit, vehicleId: run.vehicleId });
    if (def.public) this.sys(room, `${p.username} iniciou o evento "${def.name}"!`);
    return { missionId, runId: run.runId, vehicleId: run.vehicleId };
  }

  async missionCheckpoint(userId: string, input: unknown) {
    const { room, p } = this.requireGame(userId);
    const { missionId, index } = MissionCheckpointSchema.parse(input);
    const run = p.mission;
    if (!run || run.def.id !== missionId) throw new AppError(400, 'no_mission', 'Nenhuma missão ativa');
    if (index !== run.index) throw new AppError(400, 'wrong_checkpoint', 'Checkpoint fora de ordem');
    const cp = run.def.checkpoints[index];
    const d = Math.hypot(p.p[0] - cp.x, p.p[2] - cp.z);
    if (d > cp.r + 8) throw new AppError(400, 'not_at_checkpoint', 'Você não está no checkpoint');
    // tempo mínimo plausível desde o último checkpoint (anti-teleporte)
    const prev = index > 0 ? run.def.checkpoints[index - 1] : null;
    if (prev) {
      const segment = Math.hypot(cp.x - prev.x, cp.z - prev.z);
      if ((Date.now() - run.lastCpAt) / 1000 < segment / 95) throw new AppError(400, 'too_fast', 'Checkpoint inválido');
    }
    const v = p.veh ? room.vehicles.get(p.veh) : undefined;
    const cat = v ? (VEHICLES[v.model].category as VehicleCategory) : null;
    const req = run.def.requires;
    if (req.landVehicle && (!cat || cat === 'boat')) throw new AppError(400, 'need_vehicle', 'Você precisa de um veículo terrestre');
    if (req.vehicleCategory && (!cat || !req.vehicleCategory.includes(cat))) throw new AppError(400, 'need_vehicle', `Requer veículo: ${req.vehicleCategory.join('/')}`);
    if (req.boat && cat !== 'boat') throw new AppError(400, 'need_boat', 'Você precisa de uma embarcação');
    if (cp.needMissionVehicle && p.veh !== run.vehicleId) throw new AppError(400, 'need_mission_vehicle', 'Entre no veículo da missão');
    run.index++;
    run.lastCpAt = Date.now();
    if (run.index >= run.def.checkpoints.length) {
      const time = (Date.now() - run.startedAt) / 1000;
      p.mission = null;
      let reward = run.def.reward;
      if (run.def.type === 'coop') reward += 500 * (room.activeCount() - 1);
      const balance = await this.deps.players.completeMission(userId, run.def.id, run.runId, reward, time);
      if (run.vehicleId) {
        room.vehicles.delete(run.vehicleId);
        this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'remove', id: run.vehicleId });
        if (p.veh === run.vehicleId) { p.veh = null; p.seat = -1; }
      }
      p.socket?.emit(EV.missionEvent, { type: 'completed', missionId, reward, time, balance });
      p.socket?.emit(EV.wallet, { balance });
      this.sys(room, `${p.username} completou "${run.def.name}" (+$${reward}).`);
      return { completed: true, reward, balance };
    }
    p.socket?.emit(EV.missionEvent, { type: 'checkpoint', missionId, index: run.index });
    return { completed: false, index: run.index };
  }

  missionFail(userId: string, reason: string) {
    const room = this.roomOf(userId);
    const p = room?.players.get(userId);
    if (!room || !p?.mission) return false;
    const run = p.mission;
    p.mission = null;
    if (run.vehicleId) {
      const v = room.vehicles.get(run.vehicleId);
      if (v) {
        if (p.veh === v.id) this.releaseSeat(room, p);
        room.vehicles.delete(v.id);
        this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'remove', id: v.id });
      }
    }
    p.socket?.emit(EV.missionEvent, { type: 'failed', missionId: run.def.id, reason });
    return true;
  }

  /* ------------------------- loop ------------------------- */
  private tick(dt: number) {
    this.tickN++;
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.status !== 'playing') continue;
      // relógio e clima
      room.clock.hour = (room.clock.hour + dt * room.clock.rate) % 24;
      if (now > room.nextWeatherAt) {
        const options: Weather[] = ['clear', 'clear', 'cloudy', 'cloudy', 'rain', 'storm', 'fog'];
        room.clock.weather = options[crypto.randomInt(options.length)];
        room.nextWeatherAt = now + (4 + crypto.randomInt(6)) * 60_000;
        this.sys(room, `Previsão do tempo: ${({ clear: 'céu limpo', cloudy: 'nublado', rain: 'chuva', storm: 'tempestade', fog: 'neblina' } as const)[room.clock.weather]}.`);
      }
      if (now > room.nextEventAt) {
        room.nextEventAt = now + 10 * 60_000;
        this.sys(room, 'Evento público disponível: "Caça ao Tesouro" na Praia Dourada! (marcador amarelo no mapa)');
      }
      for (const p of room.players.values()) {
        // respawn
        if (p.dead && now - p.deadAt > 5000) void this.respawn(room, p);
        // missão por tempo
        if (p.mission && (now - p.mission.startedAt) / 1000 > p.mission.def.timeLimit) this.missionFail(p.userId, 'Tempo esgotado');
        // procurado: perde estrelas sem contato visual
        if (p.wanted > 0 && now - p.lastSpotted > (18 + p.wanted * 7) * 1000) {
          this.setWanted(room, p, p.wanted - 1, p.wanted - 1 === 0 ? 'Você despistou a polícia' : undefined);
        }
        // regeneração lenta até 50%
        if (!p.dead && p.hp < 50 && now - p.lastCrimeAt > 8000) p.hp = Math.min(50, p.hp + dt * 1.5);
      }
      const full = now - room.lastFull > 3000;
      if (full) room.lastFull = now;
      const snap = room.snapshot(full);
      this.io.to(room.channel).volatile.emit(EV.snapshot, snap);
    }
  }

  private async respawn(room: Room, p: RoomPlayer) {
    if (!p.dead) return;
    p.dead = false;
    const hosp = POIS.filter((x) => x.kind === 'hospital').sort((a, b) => Math.hypot(a.x - p.p[0], a.z - p.p[2]) - Math.hypot(b.x - p.p[0], b.z - p.p[2]))[0];
    p.p = [hosp.x + 8, terrainHeight(hosp.x + 8, hosp.z) + 0.2, hosp.z];
    p.hp = 100; p.armor = 0;
    this.setWanted(room, p, 0);
    let cost = 0;
    try {
      cost = Math.min(RESPAWN_COST, await this.deps.economy.balance(p.userId));
      if (cost > 0) await this.deps.economy.apply(p.userId, -cost, 'hospital');
      p.socket?.emit(EV.wallet, { balance: await this.deps.economy.balance(p.userId) });
    } catch (e) { this.deps.log.warn({ err: e }, 'hospital charge failed'); }
    p.socket?.emit(EV.respawn, { p: p.p, hp: p.hp, armor: p.armor, reason: `Conta do hospital: $${cost}` });
  }

  private cleanup() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      for (const p of [...room.players.values()]) {
        if (!p.connected && now - p.disconnectedAt > RECONNECT_GRACE_MS) void this.leave(p.userId, 'timeout');
      }
      if (room.players.size === 0 && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) void this.destroyRoom(room);
      // recicla veículos ambientes abandonados/destruídos
      for (const v of room.vehicles.values()) {
        if (!v.ambient || v.driver || v.passengers.some(Boolean) || !v.spawn) continue;
        const destroyedLong = v.health <= 0 && now - v.destroyedAt > 30_000;
        const abandoned = v.lastUse && now - v.lastUse > 180_000 && dist2(v.p, v.spawn.p) > 30;
        if (destroyedLong || abandoned) {
          const nearPlayer = [...room.players.values()].some((p) => dist2(p.p, v.spawn!.p) < 120);
          if (nearPlayer && !destroyedLong) continue;
          v.p = [...v.spawn.p] as Vec3; v.q = [...v.spawn.q] as Quat; v.v = [0, 0, 0]; v.health = 1000; v.lastUse = 0; v.speed = 0;
          room.dirtyVeh.add(v.id);
          this.io.to(room.channel).emit(EV.vehicleEvent, { type: 'reset', id: v.id, state: room.netVehicle(v) });
        }
      }
    }
  }

  private async savePlayer(p: RoomPlayer, room: Room) {
    const ammo: Record<string, number> = {};
    for (const [w, a] of p.ammo) ammo[w] = a.mag + a.reserve;
    await this.deps.players.saveRuntime(p.userId, {
      pos: room.status === 'playing' ? [r2(p.p[0]), r2(p.p[1]), r2(p.p[2])] : undefined,
      playtimeDelta: (Date.now() - p.lastSave) / 1000, kills: p.kills, deaths: p.deaths, ammo,
    });
    p.lastSave = Date.now(); p.kills = 0; p.deaths = 0;
    if (p.ownedSpawned) {
      const v = room.vehicles.get(p.ownedSpawned);
      if (v?.ownedId) await this.deps.players.setVehicleHealth(v.ownedId, v.health);
    }
  }

  async autosave(_final = false) {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        try { await this.savePlayer(p, room); } catch (e) { this.deps.log.error({ err: e, user: p.username }, 'autosave failed'); }
      }
    }
  }
}

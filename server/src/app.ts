import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { AuthService, AppError, type AuthUser } from './services/auth';
import { EconomyService } from './services/economy';
import { PlayerService } from './services/player';
import { RoomManager } from './game/rooms';
import type { DbHandle } from './db';
import {
  PROTOCOL_VERSION, SHOP_ITEMS, VEHICLES, DEALER_STOCK, PROPERTIES, MISSIONS, CUSTOMS, PAINT_COLORS, WEAPONS,
} from '../../shared/src';

export interface AppOptions { dbh: DbHandle; corsOrigin: string[] | true; logger?: boolean | object; region?: string; sessionDays?: number }

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser; token?: string }
}

export async function buildApp(opts: AppOptions) {
  const app: FastifyInstance = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });
  const db = opts.dbh.db;
  const auth = new AuthService(db, opts.sessionDays);
  const economy = new EconomyService(db);
  const players = new PlayerService(db, economy);
  const region = opts.region ?? 'local';
  const rooms = new RoomManager({ db, economy, players, log: app.log, region });
  const startedAt = Date.now();

  await app.register(cors, { origin: opts.corsOrigin, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message ?? 'Dados inválidos', issues: err.issues });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Muitas requisições. Aguarde um pouco.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'bad_request', message: err.message });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal', message: 'Erro interno do servidor' });
  });

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  const requireAuth = async (req: FastifyRequest) => {
    const token = bearer(req);
    const user = await auth.validate(token);
    if (!user) throw new AppError(401, 'unauthorized', 'Sessão inválida ou expirada');
    req.user = user; req.token = token;
  };

  /* ---------------- saúde / status ---------------- */
  app.get('/health', async () => ({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000), db: opts.dbh.kind }));
  app.get('/', async () => ({ name: 'GTA 7 ONLINE server', api: '/api/v1', health: '/health' }));

  await app.register(async (r) => {
    const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
    r.get('/server/status', async () => ({ version: PROTOCOL_VERSION, region, uptime: Math.round((Date.now() - startedAt) / 1000), ...rooms.stats(), db: opts.dbh.kind }));

    /* ---------------- autenticação ---------------- */
    r.post('/auth/register', authLimit, async (req, reply) => reply.status(201).send(await auth.register(req.body)));
    r.post('/auth/login', authLimit, async (req) => auth.login(req.body));
    r.post('/auth/logout', { preHandler: requireAuth }, async (req) => { await auth.logout(req.token!); return { ok: true }; });
    r.get('/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));

    /* ---------------- perfil ---------------- */
    r.get('/profile', { preHandler: requireAuth }, async (req) => ({ user: req.user, ...(await players.profile(req.user!.id)) }));
    r.put('/profile/character', { preHandler: requireAuth }, async (req) => {
      const appearance = await players.setAppearance(req.user!.id, (req.body as any)?.appearance);
      const ctx = rooms.context(req.user!.id);
      if (ctx) ctx.player.appearance = appearance;
      return { appearance };
    });
    r.put('/profile/settings', { preHandler: requireAuth }, async (req) => ({ settings: await players.setSettings(req.user!.id, (req.body as any)?.settings) }));

    /* ---------------- economia ---------------- */
    r.get('/wallet', { preHandler: requireAuth }, async (req) => ({ balance: await economy.balance(req.user!.id), history: await economy.history(req.user!.id) }));

    /* ---------------- inventário / lojas ---------------- */
    r.get('/inventory', { preHandler: requireAuth }, async (req) => ({ items: await players.inventory(req.user!.id) }));
    r.post('/inventory/drop', { preHandler: requireAuth }, async (req) => {
      const b = z.object({ itemId: z.string().max(32), qty: z.number().int().min(1).max(999) }).parse(req.body);
      await players.drop(req.user!.id, b.itemId, b.qty);
      return { items: await players.inventory(req.user!.id) };
    });
    r.get('/shop/catalog', async () => ({ items: Object.values(SHOP_ITEMS), weapons: WEAPONS, vehicles: DEALER_STOCK.map((id) => VEHICLES[id]), properties: PROPERTIES, customs: CUSTOMS, paints: PAINT_COLORS }));
    r.post('/shop/buy', { preHandler: requireAuth }, async (req) => {
      const { itemId } = z.object({ itemId: z.string().max(40) }).parse(req.body);
      const item = SHOP_ITEMS[itemId];
      if (!item) throw new AppError(404, 'unknown_item', 'Item inexistente');
      const kinds = item.kind === 'weapon' || item.kind === 'ammo' || item.kind === 'armor' ? ['gunshop'] : ['store', 'restaurant', 'gas', 'hospital'];
      rooms.requireNear(req.user!.id, kinds, 25);
      const res = await players.buyShopItem(req.user!.id, itemId);
      rooms.applyPurchase(req.user!.id, item.kind, item.ref, item.qty);
      return { balance: res.balance, item };
    });

    /* ---------------- veículos ---------------- */
    r.get('/vehicles', { preHandler: requireAuth }, async (req) => ({ vehicles: await players.vehicles(req.user!.id) }));
    r.post('/vehicles/buy', { preHandler: requireAuth }, async (req) => {
      const b = z.object({ model: z.string().max(24), color: z.number().int() }).parse(req.body);
      const def = VEHICLES[b.model];
      rooms.requireNear(req.user!.id, def?.category === 'boat' ? ['marina', 'dealer'] : ['dealer'], 30);
      const res = await players.buyVehicle(req.user!.id, b.model, b.color);
      return { balance: res.balance, vehicle: res.result };
    });
    r.post('/vehicles/:id/customize', { preHandler: requireAuth }, async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ color: z.number().int().optional(), wheels: z.number().int().optional(), suspension: z.number().int().optional(), engine: z.number().int().optional(), repair: z.boolean().optional() }).parse(req.body);
      rooms.requireNear(req.user!.id, ['customs'], 30);
      const res = await players.customizeVehicle(req.user!.id, id, b);
      rooms.applyOwnedUpdate(req.user!.id, res.result);
      return { balance: res.balance, vehicle: res.result };
    });

    /* ---------------- propriedades ---------------- */
    r.get('/properties', { preHandler: requireAuth }, async (req) => ({ catalog: PROPERTIES, owned: await players.properties(req.user!.id) }));
    r.post('/properties/buy', { preHandler: requireAuth }, async (req) => {
      const { propertyId } = z.object({ propertyId: z.string().max(40) }).parse(req.body);
      const def = PROPERTIES.find((p) => p.id === propertyId);
      if (!def) throw new AppError(404, 'unknown_property', 'Propriedade inexistente');
      rooms.requireNear(req.user!.id, [], 30, def);
      const res = await players.buyProperty(req.user!.id, propertyId);
      return { balance: res.balance, property: res.result };
    });
    r.post('/properties/sell', { preHandler: requireAuth }, async (req) => {
      const { propertyId } = z.object({ propertyId: z.string().max(40) }).parse(req.body);
      return players.sellProperty(req.user!.id, propertyId);
    });

    /* ---------------- missões ---------------- */
    r.get('/missions', { preHandler: requireAuth }, async (req) => ({ missions: MISSIONS, progress: await players.missionProgress(req.user!.id) }));
  }, { prefix: '/api/v1' });

  /* ---------------- Socket.IO ---------------- */
  const io = new Server(app.server, {
    cors: { origin: opts.corsOrigin, credentials: true },
    pingInterval: 10_000, pingTimeout: 20_000, maxHttpBufferSize: 32 * 1024,
    connectionStateRecovery: { maxDisconnectionDuration: 0 },
  });
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      const user = await auth.validate(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (e) { next(new Error('auth_error')); }
  });
  io.on('connection', (socket) => rooms.onConnect(socket, socket.data.user as AuthUser));
  rooms.attach(io);

  const sessionPurge = setInterval(() => void auth.purgeExpired().catch(() => {}), 3600_000);
  app.addHook('onClose', async () => {
    clearInterval(sessionPurge);
    await rooms.shutdown();
    io.close();
  });

  return { app, io, rooms, auth, economy, players };
}

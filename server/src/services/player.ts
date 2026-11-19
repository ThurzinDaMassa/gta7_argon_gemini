import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import {
  playerProfiles, playerCharacters, playerInventory, playerVehicles, playerProperties, missionProgress, playerSettings,
} from '../db/schema';
import type { Executor } from './economy';
import { EconomyService } from './economy';
import { AppError } from './auth';
import {
  AppearanceSchema, DEFAULT_APPEARANCE, SHOP_ITEMS, VEHICLES, PROPERTIES, CUSTOMS, PAINT_COLORS, WEAPONS, type Appearance,
} from '../../../shared/src';
import { z } from 'zod';

export const SettingsSchema = z.object({
  graphics: z.enum(['low', 'medium', 'high', 'ultra']).optional(),
  masterVolume: z.number().min(0).max(1).optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  sfxVolume: z.number().min(0).max(1).optional(),
  radioVolume: z.number().min(0).max(1).optional(),
  sensitivity: z.number().min(0.1).max(5).optional(),
  invertY: z.boolean().optional(),
  fov: z.number().min(50).max(100).optional(),
  keybinds: z.record(z.string().max(32), z.string().max(32)).optional(),
}).strict();

export interface VehicleMods { wheels?: number; suspension?: number; engine?: number; spoiler?: boolean }

export class PlayerService {
  constructor(private db: DB, private economy: EconomyService) {}

  async profile(userId: string) {
    const [p] = await this.db.select().from(playerProfiles).where(eq(playerProfiles.userId, userId));
    const [c] = await this.db.select().from(playerCharacters).where(eq(playerCharacters.userId, userId));
    const [s] = await this.db.select().from(playerSettings).where(eq(playerSettings.userId, userId));
    return {
      profile: p,
      appearance: AppearanceSchema.parse(c?.appearance ?? DEFAULT_APPEARANCE),
      lastPos: (c?.lastPos as number[] | null) ?? null,
      settings: (s?.settings ?? {}) as Record<string, unknown>,
      balance: await this.economy.balance(userId),
    };
  }

  async appearance(userId: string): Promise<Appearance> {
    const [c] = await this.db.select().from(playerCharacters).where(eq(playerCharacters.userId, userId));
    return AppearanceSchema.parse(c?.appearance ?? DEFAULT_APPEARANCE);
  }

  async setAppearance(userId: string, input: unknown) {
    const appearance = AppearanceSchema.parse(input);
    await this.db.update(playerCharacters).set({ appearance, updatedAt: new Date() }).where(eq(playerCharacters.userId, userId));
    return appearance;
  }

  async setSettings(userId: string, input: unknown) {
    const patch = SettingsSchema.parse(input);
    const [s] = await this.db.select().from(playerSettings).where(eq(playerSettings.userId, userId));
    const merged = { ...((s?.settings as object) ?? {}), ...patch };
    await this.db.update(playerSettings).set({ settings: merged }).where(eq(playerSettings.userId, userId));
    return merged;
  }

  async saveRuntime(userId: string, data: { pos?: number[]; playtimeDelta?: number; kills?: number; deaths?: number; ammo?: Record<string, number> }) {
    if (data.pos) await this.db.update(playerCharacters).set({ lastPos: data.pos, updatedAt: new Date() }).where(eq(playerCharacters.userId, userId));
    if (data.playtimeDelta || data.kills || data.deaths) {
      await this.db.update(playerProfiles).set({
        playtimeSec: sql`${playerProfiles.playtimeSec} + ${Math.round(data.playtimeDelta ?? 0)}`,
        kills: sql`${playerProfiles.kills} + ${data.kills ?? 0}`,
        deaths: sql`${playerProfiles.deaths} + ${data.deaths ?? 0}`,
      }).where(eq(playerProfiles.userId, userId));
    }
    if (data.ammo) {
      for (const [w, total] of Object.entries(data.ammo)) {
        await this.db.insert(playerInventory).values({ userId, itemId: `ammo_${w}`, kind: 'ammo', qty: Math.max(0, total | 0) })
          .onConflictDoUpdate({ target: [playerInventory.userId, playerInventory.itemId], set: { qty: Math.max(0, total | 0) } });
      }
    }
  }

  /* ---------------- inventário ---------------- */
  async inventory(userId: string) {
    return this.db.select({ itemId: playerInventory.itemId, kind: playerInventory.kind, qty: playerInventory.qty })
      .from(playerInventory).where(eq(playerInventory.userId, userId));
  }

  async addItemIn(ex: Executor, userId: string, itemId: string, kind: string, qty: number) {
    await ex.insert(playerInventory).values({ userId, itemId, kind, qty })
      .onConflictDoUpdate({ target: [playerInventory.userId, playerInventory.itemId], set: { qty: sql`${playerInventory.qty} + ${qty}` } });
  }

  /** consome 1 unidade; retorna false se não houver */
  async consume(userId: string, itemId: string, qty = 1): Promise<boolean> {
    const r = await this.db.update(playerInventory).set({ qty: sql`${playerInventory.qty} - ${qty}` })
      .where(and(eq(playerInventory.userId, userId), eq(playerInventory.itemId, itemId), sql`${playerInventory.qty} >= ${qty}`))
      .returning({ q: playerInventory.qty });
    return r.length > 0;
  }

  async drop(userId: string, itemId: string, qty: number) {
    if (itemId === 'fists') throw new AppError(400, 'cannot_drop');
    const ok = await this.consume(userId, itemId, qty);
    if (!ok) throw new AppError(400, 'not_enough_items', 'Quantidade insuficiente');
    await this.db.delete(playerInventory).where(and(eq(playerInventory.userId, userId), eq(playerInventory.qty, 0), sql`${playerInventory.kind} <> 'ammo'`));
  }

  async buyShopItem(userId: string, itemId: string) {
    const item = SHOP_ITEMS[itemId];
    if (!item) throw new AppError(404, 'unknown_item', 'Item inexistente');
    return this.economy.purchase(userId, item.price, 'shop', itemId, async (tx) => {
      if (item.kind === 'weapon') {
        const owned = await tx.select().from(playerInventory).where(and(eq(playerInventory.userId, userId), eq(playerInventory.itemId, item.ref!)));
        if (owned.length && owned[0].qty > 0) throw new AppError(409, 'already_owned', 'Você já possui esta arma');
        await this.addItemIn(tx, userId, item.ref!, 'weapon', 1);
        const w = WEAPONS[item.ref!];
        if (w.mag > 0) await this.addItemIn(tx, userId, `ammo_${w.id}`, 'ammo', w.mag * 2);
      } else if (item.kind === 'ammo') {
        await this.addItemIn(tx, userId, `ammo_${item.ref}`, 'ammo', item.qty ?? 1);
      } else if (item.kind === 'armor' || item.kind === 'consumable') {
        await this.addItemIn(tx, userId, item.id, item.kind, 1);
      }
      return item;
    });
  }

  /* ---------------- veículos ---------------- */
  async vehicles(userId: string) {
    return this.db.select().from(playerVehicles).where(eq(playerVehicles.userId, userId));
  }

  async vehicle(userId: string, id: string) {
    const [v] = await this.db.select().from(playerVehicles).where(and(eq(playerVehicles.userId, userId), eq(playerVehicles.id, id)));
    if (!v) throw new AppError(404, 'vehicle_not_found', 'Veículo não encontrado');
    return v;
  }

  async buyVehicle(userId: string, model: string, color: number) {
    const def = VEHICLES[model];
    if (!def || def.price <= 0) throw new AppError(404, 'unknown_vehicle', 'Modelo indisponível');
    const c = def.colors.includes(color) || PAINT_COLORS.includes(color) ? color : def.colors[0];
    const count = await this.db.select({ n: sql<number>`count(*)::int` }).from(playerVehicles).where(eq(playerVehicles.userId, userId));
    const slots = 2 + (await this.garageSlots(userId));
    if ((count[0]?.n ?? 0) >= slots) throw new AppError(409, 'garage_full', `Garagem cheia (${slots} vagas). Compre uma propriedade com garagem.`);
    return this.economy.purchase(userId, def.price, 'vehicle', model, async (tx) => {
      const [v] = await tx.insert(playerVehicles).values({ userId, model, color: c, mods: {} }).returning();
      return v;
    });
  }

  async customizeVehicle(userId: string, id: string, patch: { color?: number; wheels?: number; suspension?: number; engine?: number; repair?: boolean }) {
    const v = await this.vehicle(userId, id);
    const mods = { ...(v.mods as VehicleMods) };
    let price = 0;
    let color = v.color;
    let health = v.health;
    if (patch.color !== undefined) { if (!PAINT_COLORS.includes(patch.color)) throw new AppError(400, 'invalid_color'); color = patch.color; price += CUSTOMS.paint; }
    if (patch.wheels !== undefined) { mods.wheels = Math.max(0, Math.min(5, patch.wheels | 0)); price += CUSTOMS.wheels; }
    if (patch.suspension !== undefined) { mods.suspension = Math.max(0, Math.min(3, patch.suspension | 0)); price += CUSTOMS.suspension; }
    if (patch.engine !== undefined) {
      const lvl = Math.max(0, Math.min(3, patch.engine | 0));
      if (lvl <= (mods.engine ?? 0)) throw new AppError(400, 'already_upgraded', 'Motor já está neste nível');
      price += CUSTOMS.engine[lvl]; mods.engine = lvl;
    }
    if (patch.repair) { if (v.health >= 1000) throw new AppError(400, 'not_damaged', 'Veículo não está danificado'); health = 1000; price += CUSTOMS.repair; }
    if (price === 0) throw new AppError(400, 'nothing_to_do');
    return this.economy.purchase(userId, price, 'customs', id, async (tx) => {
      const [nv] = await tx.update(playerVehicles).set({ color, mods, health }).where(eq(playerVehicles.id, id)).returning();
      return nv;
    });
  }

  async setVehicleHealth(id: string, health: number) {
    await this.db.update(playerVehicles).set({ health: Math.max(0, Math.min(1000, Math.round(health))) }).where(eq(playerVehicles.id, id));
  }

  /* ---------------- propriedades ---------------- */
  async properties(userId: string) {
    return this.db.select().from(playerProperties).where(eq(playerProperties.userId, userId));
  }

  async garageSlots(userId: string) {
    const owned = await this.properties(userId);
    return owned.reduce((s, o) => s + (PROPERTIES.find((p) => p.id === o.propertyId)?.garageSlots ?? 0), 0);
  }

  async buyProperty(userId: string, propertyId: string) {
    const def = PROPERTIES.find((p) => p.id === propertyId);
    if (!def) throw new AppError(404, 'unknown_property');
    const owned = await this.db.select().from(playerProperties).where(and(eq(playerProperties.userId, userId), eq(playerProperties.propertyId, propertyId)));
    if (owned.length) throw new AppError(409, 'already_owned', 'Você já possui esta propriedade');
    return this.economy.purchase(userId, def.price, 'property', propertyId, async (tx) => {
      const [p] = await tx.insert(playerProperties).values({ userId, propertyId }).returning();
      return p;
    });
  }

  async sellProperty(userId: string, propertyId: string) {
    const def = PROPERTIES.find((p) => p.id === propertyId);
    if (!def) throw new AppError(404, 'unknown_property');
    return this.db.transaction(async (tx) => {
      const del = await tx.delete(playerProperties).where(and(eq(playerProperties.userId, userId), eq(playerProperties.propertyId, propertyId))).returning();
      if (!del.length) throw new AppError(404, 'not_owned', 'Você não possui esta propriedade');
      const refund = Math.floor(def.price * 0.5);
      return { balance: await this.economy.applyIn(tx, userId, refund, 'property_sale', propertyId), refund };
    });
  }

  /* ---------------- missões ---------------- */
  async missionProgress(userId: string) {
    return this.db.select().from(missionProgress).where(eq(missionProgress.userId, userId));
  }

  async completeMission(userId: string, missionId: string, runId: string, reward: number, time: number) {
    return this.db.transaction(async (tx) => {
      const balance = await this.economy.applyIn(tx, userId, reward, 'mission', missionId, `mission:${runId}:${userId}`);
      await tx.insert(missionProgress).values({ userId, missionId, completions: 1, bestTime: time, lastCompletedAt: new Date() })
        .onConflictDoUpdate({
          target: [missionProgress.userId, missionProgress.missionId],
          set: { completions: sql`${missionProgress.completions} + 1`, bestTime: sql`LEAST(COALESCE(${missionProgress.bestTime}, ${time}), ${time})`, lastCompletedAt: new Date() },
        });
      await tx.update(playerProfiles).set({ xp: sql`${playerProfiles.xp} + ${Math.round(reward / 10)}`, level: sql`1 + floor((${playerProfiles.xp} + ${Math.round(reward / 10)}) / 1000)` }).where(eq(playerProfiles.userId, userId));
      return balance;
    });
  }
}

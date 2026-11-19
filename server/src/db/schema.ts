import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, timestamp, jsonb, boolean, serial, real, uniqueIndex, index, check,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  usernameLower: text('username_lower').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_username_lower_idx').on(t.usernameLower)]);

export const sessions = pgTable('sessions', {
  /** sha256 do token opaco — o token em si nunca é salvo */
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const playerProfiles = pgTable('player_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  avatar: integer('avatar').notNull().default(0),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  playtimeSec: integer('playtime_sec').notNull().default(0),
});

export const playerCharacters = pgTable('player_characters', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  appearance: jsonb('appearance').notNull(),
  lastPos: jsonb('last_pos'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const playerInventory = pgTable('player_inventory', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  kind: text('kind').notNull(),
  qty: integer('qty').notNull().default(1),
}, (t) => [uniqueIndex('inv_user_item_idx').on(t.userId, t.itemId), check('inv_qty_nonneg', sql`${t.qty} >= 0`)]);

export const playerVehicles = pgTable('player_vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  color: integer('color').notNull(),
  mods: jsonb('mods').notNull().default({}),
  health: integer('health').notNull().default(1000),
  stored: boolean('stored').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('veh_user_idx').on(t.userId)]);

export const playerProperties = pgTable('player_properties', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull(),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('prop_user_prop_idx').on(t.userId, t.propertyId)]);

export const playerWallets = pgTable('player_wallets', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('wallet_nonneg', sql`${t.balance} >= 0`)]);

export const walletTransactions = pgTable('wallet_transactions', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  reason: text('reason').notNull(),
  ref: text('ref'),
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('wtx_idem_idx').on(t.idempotencyKey), index('wtx_user_idx').on(t.userId)]);

export const missionProgress = pgTable('mission_progress', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  missionId: text('mission_id').notNull(),
  completions: integer('completions').notNull().default(0),
  bestTime: real('best_time'),
  lastCompletedAt: timestamp('last_completed_at', { withTimezone: true }),
}, (t) => [uniqueIndex('mp_user_mission_idx').on(t.userId, t.missionId)]);

export const playerSettings = pgTable('player_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  settings: jsonb('settings').notNull().default({}),
});

export const roomHistory = pgTable('room_history', {
  id: serial('id').primaryKey(),
  roomId: text('room_id').notNull(),
  name: text('name').notNull(),
  hostUserId: uuid('host_user_id'),
  mode: text('mode').notNull(),
  maxPlayers: integer('max_players').notNull(),
  peakPlayers: integer('peak_players').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

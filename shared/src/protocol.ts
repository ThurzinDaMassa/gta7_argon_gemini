import { z } from 'zod';

/* ===================================================================
 * Protocolo compartilhado cliente <-> servidor. O servidor SEMPRE
 * revalida tudo; o cliente usa os mesmos schemas apenas para UX.
 * =================================================================== */

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS_PER_ROOM = 8;
export const SNAPSHOT_HZ = 15;
export const CLIENT_SEND_HZ = 15;
export const RECONNECT_GRACE_MS = 30_000;
export const EMPTY_ROOM_TTL_MS = 60_000;
export const WATER_LEVEL = 0;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const finite = z.number().finite();
export const Vec3Schema = z.tuple([finite, finite, finite]);
export const QuatSchema = z.tuple([finite, finite, finite, finite]);

export const UsernameSchema = z
  .string()
  .trim()
  .min(3, 'Nome deve ter ao menos 3 caracteres')
  .max(20, 'Nome deve ter no máximo 20 caracteres')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use apenas letras, números e _');
export const PasswordSchema = z.string().min(8, 'Senha deve ter ao menos 8 caracteres').max(128);
export const CredentialsSchema = z.object({ username: UsernameSchema, password: PasswordSchema });

/* ---------------- Personagem ---------------- */
export const AppearanceSchema = z.object({
  body: z.enum(['masc', 'fem']).default('masc'),
  skin: z.number().int().min(0).max(7).default(2),
  face: z.number().int().min(0).max(5).default(0),
  hair: z.number().int().min(0).max(6).default(1),
  hairColor: z.number().int().min(0).max(7).default(0),
  top: z.number().int().min(0).max(5).default(0),
  topColor: z.number().int().min(0).max(11).default(3),
  legs: z.number().int().min(0).max(3).default(0),
  legsColor: z.number().int().min(0).max(11).default(1),
  shoes: z.number().int().min(0).max(3).default(0),
  shoesColor: z.number().int().min(0).max(11).default(0),
  accessory: z.number().int().min(0).max(4).default(0),
});
export type Appearance = z.infer<typeof AppearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = AppearanceSchema.parse({});

/* ---------------- Salas ---------------- */
export const GameModeSchema = z.enum(['freeroam', 'race', 'coop', 'deathmatch']);
export type GameMode = z.infer<typeof GameModeSchema>;

export const RoomCreateSchema = z.object({
  name: z.string().trim().min(3).max(32),
  maxPlayers: z.number().int().min(1).max(MAX_PLAYERS_PER_ROOM),
  isPrivate: z.boolean(),
  password: z.string().max(32).optional().transform((v) => (v ? v : undefined)),
  mode: GameModeSchema,
  pvp: z.boolean(),
  rules: z.string().max(200).optional().default(''),
});
export type RoomCreate = z.infer<typeof RoomCreateSchema>;

export const RoomJoinSchema = z
  .object({
    roomId: z.string().max(64).optional(),
    code: z.string().trim().toUpperCase().max(8).optional(),
    password: z.string().max(32).optional(),
  })
  .refine((v) => v.roomId || v.code, 'Informe a sala ou o código');

export const RoomUpdateSchema = z.object({
  name: z.string().trim().min(3).max(32).optional(),
  maxPlayers: z.number().int().min(1).max(MAX_PLAYERS_PER_ROOM).optional(),
  pvp: z.boolean().optional(),
  mode: GameModeSchema.optional(),
  rules: z.string().max(200).optional(),
  kick: z.string().max(64).optional(),
});

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  status: 'lobby' | 'playing';
  mode: GameMode;
  pvp: boolean;
  hasPassword: boolean;
  region: string;
  host: string;
}

export interface RoomPlayerInfo {
  userId: string;
  username: string;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  appearance: Appearance;
}

export interface RoomDetail extends RoomSummary {
  code: string;
  isPrivate: boolean;
  rules: string;
  playersList: RoomPlayerInfo[];
}

/* ---------------- Estado de jogo ---------------- */
export const AnimStateSchema = z.enum([
  'idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'crouch', 'crouchWalk',
  'swim', 'dive', 'drive', 'aim', 'dead', 'wave', 'dance', 'cheer', 'roll',
]);
export type AnimState = z.infer<typeof AnimStateSchema>;

export const PlayerStateMsgSchema = z.object({
  seq: z.number().int().nonnegative(),
  p: Vec3Schema,
  yaw: finite,
  pitch: finite.optional(),
  anim: AnimStateSchema,
  weapon: z.string().max(24).optional(),
  /** a IA policial local tem contato visual (só pode ATRASAR a perda de estrelas) */
  spotted: z.boolean().optional(),
});
export type PlayerStateMsg = z.infer<typeof PlayerStateMsgSchema>;

export const VehicleStateMsgSchema = z.object({
  id: z.string().max(32),
  p: Vec3Schema,
  q: QuatSchema,
  v: Vec3Schema,
  steer: finite,
  speed: finite,
  lights: z.boolean(),
  horn: z.boolean().optional(),
  siren: z.boolean().optional(),
});
export type VehicleStateMsg = z.infer<typeof VehicleStateMsgSchema>;

export const VehicleEnterSchema = z.object({ id: z.string().max(32), seat: z.number().int().min(-1).max(7).default(-1) });
export const VehicleSpawnSchema = z.object({ ownedId: z.string().max(64) });

export const FireMsgSchema = z.object({
  weapon: z.string().max(24),
  origin: Vec3Schema,
  /** uma direção por projétil (escopetas enviam várias) */
  dirs: z.array(Vec3Schema).min(1).max(12),
  /** ponto de explosão para armas explosivas (servidor valida) */
  impact: Vec3Schema.optional(),
});
export const SelfDamageSchema = z.object({ amount: z.number().min(0).max(500), cause: z.enum(['fall', 'drown', 'vehicle', 'fire', 'npc']) });
export const RamSchema = z.object({ target: z.string().max(64), speed: z.number().min(0).max(120) });
export const UseItemSchema = z.object({ itemId: z.string().max(32) });
export const VehicleDamageSchema = z.object({ id: z.string().max(32), amount: z.number().min(0).max(400) });

export const ChatSchema = z.object({ text: z.string().trim().min(1).max(200) });
export const EmoteSchema = z.object({ emote: z.enum(['wave', 'dance', 'cheer']) });

export const MissionStartSchema = z.object({ missionId: z.string().max(48) });
export const MissionCheckpointSchema = z.object({ missionId: z.string().max(48), index: z.number().int().min(0).max(200) });

export const CrimeSchema = z.object({
  kind: z.enum(['shots_fired', 'vehicle_theft', 'hit_pedestrian', 'assault', 'speeding_police']),
  p: Vec3Schema,
});

export interface NetPlayer {
  id: string;
  name: string;
  p: Vec3;
  yaw: number;
  pitch: number;
  anim: AnimState;
  hp: number;
  armor: number;
  veh: string | null;
  seat: number;
  wanted: number;
  weapon: string;
  appearance: Appearance;
  team: number;
}

export interface NetVehicle {
  id: string;
  model: string;
  p: Vec3;
  q: Quat;
  v: Vec3;
  steer: number;
  speed: number;
  lights: boolean;
  horn: boolean;
  siren: boolean;
  driver: string | null;
  passengers: (string | null)[];
  color: number;
  health: number;
  ownerUserId: string | null;
}

export interface WorldClock {
  /** hora do dia 0..24 */
  hour: number;
  /** horas de jogo por segundo real */
  rate: number;
  weather: Weather;
  weatherBlend: number;
}
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export interface Snapshot {
  t: number;
  players: NetPlayer[];
  vehicles: NetVehicle[];
  clock: WorldClock;
}

/** Nomes de eventos Socket.IO */
export const EV = {
  roomCreate: 'room:create',
  roomList: 'room:list',
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomReady: 'room:ready',
  roomStart: 'room:start',
  roomUpdate: 'room:update',
  roomClose: 'room:close',
  roomState: 'room:state',
  roomQuick: 'room:quick',
  roomKicked: 'room:kicked',
  chatSend: 'chat:send',
  chatMsg: 'chat:msg',
  emote: 'player:emote',
  gameStarted: 'game:started',
  playerState: 'player:state',
  snapshot: 'world:snapshot',
  vehicleEnter: 'vehicle:enter',
  vehicleExit: 'vehicle:exit',
  vehicleState: 'vehicle:state',
  vehicleSpawnOwned: 'vehicle:spawnOwned',
  vehicleEvent: 'vehicle:event',
  fire: 'combat:fire',
  combatEvent: 'combat:event',
  reload: 'combat:reload',
  selectWeapon: 'combat:select',
  crime: 'police:crime',
  wanted: 'police:wanted',
  missionStart: 'mission:start',
  missionCheckpoint: 'mission:checkpoint',
  missionAbort: 'mission:abort',
  missionEvent: 'mission:event',
  wallet: 'economy:wallet',
  correct: 'player:correct',
  useItem: 'inventory:use',
  inventory: 'inventory:state',
  selfDamage: 'player:selfDamage',
  ram: 'combat:ram',
  vehicleDamage: 'vehicle:damage',
  arrest: 'police:arrest',
  respawn: 'player:respawn',
  notify: 'notify',
  error: 'server:error',
} as const;

export type Ack<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

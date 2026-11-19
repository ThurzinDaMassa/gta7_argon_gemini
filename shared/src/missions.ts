import { z } from 'zod';
import raw from './missions.json';

export const MissionSchema = z.object({
  id: z.string().min(2).max(48),
  name: z.string(),
  type: z.enum(['delivery', 'race', 'chase', 'taxi', 'coop', 'explore', 'boat_race', 'cargo', 'recover', 'event']),
  description: z.string(),
  giver: z.object({ x: z.number(), z: z.number() }),
  reward: z.number().int().min(0).max(100_000),
  timeLimit: z.number().min(10).max(3600),
  public: z.boolean().optional(),
  setWanted: z.number().int().min(0).max(5).optional(),
  requires: z.object({
    landVehicle: z.boolean().optional(),
    vehicleCategory: z.array(z.string()).optional(),
    boat: z.boolean().optional(),
    minPlayers: z.number().int().min(1).max(8).optional(),
  }),
  spawnVehicle: z.object({ model: z.string(), x: z.number(), z: z.number(), yaw: z.number() }).optional(),
  checkpoints: z.array(z.object({
    x: z.number(), z: z.number(), r: z.number().min(2).max(40), label: z.string(),
    dialog: z.string().optional(), needMissionVehicle: z.boolean().optional(),
  })).min(1),
});
export type MissionDef = z.infer<typeof MissionSchema>;

export const MISSIONS: MissionDef[] = z.object({ missions: z.array(MissionSchema) }).parse(raw).missions;
export const MISSION_MAP = new Map(MISSIONS.map((m) => [m.id, m]));

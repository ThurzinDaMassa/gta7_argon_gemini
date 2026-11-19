import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  HOST: z.string().default('0.0.0.0'),
  /** vazio => PGlite embarcado (PostgreSQL em WASM) salvo em PGLITE_DIR */
  DATABASE_URL: z.string().optional().default(''),
  PGLITE_DIR: z.string().default('./data/pglite'),
  /** lista separada por vírgula; "*" libera tudo (apenas dev) */
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  SERVER_REGION: z.string().default('sa-east (lógica)'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof Env>;
export const config: Config = Env.parse(process.env);

export function corsOrigins(c: Config = config): string[] | true {
  if (c.CORS_ORIGIN.trim() === '*') return true;
  return c.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
}

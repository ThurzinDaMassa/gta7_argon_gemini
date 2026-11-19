import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../drizzle');

export interface DbHandle { db: DB; kind: 'postgres' | 'pglite'; close: () => Promise<void> }

/**
 * Cria a conexão. Com DATABASE_URL usa PostgreSQL real (ex.: Neon);
 * sem ela usa PGlite (PostgreSQL compilado para WASM) — persistente em
 * disco ou em memória ("memory://") para testes. Mesmas migrations.
 */
export async function createDb(opts: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (opts.url) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const needsSsl = /sslmode=require|neon\.tech/.test(opts.url);
    const pool = new Pool({ connectionString: opts.url, max: 5, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
    const db = drizzle(pool, { schema }) as unknown as DB;
    await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
    return { db, kind: 'postgres', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dir = opts.pgliteDir ?? 'memory://';
  if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  return { db, kind: 'pglite', close: () => client.close() };
}

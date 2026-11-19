import { config } from '../config';
import { createDb } from './index';

const h = await createDb({ url: config.DATABASE_URL || undefined, pgliteDir: config.PGLITE_DIR });
console.log(`[migrate] migrations aplicadas (${h.kind})`);
await h.close();

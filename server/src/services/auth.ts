import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DB } from '../db';
import {
  users, sessions, playerProfiles, playerCharacters, playerWallets, walletTransactions, playerInventory, playerSettings,
} from '../db/schema';
import { CredentialsSchema, DEFAULT_APPEARANCE, STARTING_MONEY, STARTING_WEAPONS, STARTING_AMMO } from '../../../shared/src';

export class AppError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

/** Argon2id (algoritmo padrão do @node-rs/argon2 = Argon2id) com parâmetros OWASP */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface AuthUser { id: string; username: string }

export class AuthService {
  constructor(private db: DB, private sessionDays = 30) {}

  async register(input: unknown): Promise<{ token: string; user: AuthUser }> {
    const { username, password } = CredentialsSchema.parse(input);
    const lower = username.toLowerCase();
    const exists = await this.db.select({ id: users.id }).from(users).where(eq(users.usernameLower, lower));
    if (exists.length) throw new AppError(409, 'username_taken', 'Nome de usuário já está em uso');
    const passwordHash = await hash(password, ARGON);
    const user = await this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ username, usernameLower: lower, passwordHash }).returning();
      await tx.insert(playerProfiles).values({ userId: u.id, displayName: username });
      await tx.insert(playerCharacters).values({ userId: u.id, appearance: DEFAULT_APPEARANCE });
      await tx.insert(playerWallets).values({ userId: u.id, balance: STARTING_MONEY });
      await tx.insert(walletTransactions).values({ userId: u.id, amount: STARTING_MONEY, balanceAfter: STARTING_MONEY, reason: 'starting_bonus', idempotencyKey: `start:${u.id}` });
      for (const w of STARTING_WEAPONS) await tx.insert(playerInventory).values({ userId: u.id, itemId: w, kind: 'weapon', qty: 1 });
      for (const [w, q] of Object.entries(STARTING_AMMO)) await tx.insert(playerInventory).values({ userId: u.id, itemId: `ammo_${w}`, kind: 'ammo', qty: q });
      await tx.insert(playerSettings).values({ userId: u.id, settings: {} });
      return u;
    }).catch((e) => {
      if (String(e?.message ?? e).includes('users_username_lower_idx') || e?.code === '23505') throw new AppError(409, 'username_taken', 'Nome de usuário já está em uso');
      throw e;
    });
    const token = await this.createSession(user.id);
    return { token, user: { id: user.id, username: user.username } };
  }

  async login(input: unknown): Promise<{ token: string; user: AuthUser }> {
    const parsed = CredentialsSchema.safeParse(input);
    if (!parsed.success) throw new AppError(401, 'invalid_credentials', 'Usuário ou senha inválidos');
    const { username, password } = parsed.data;
    const [u] = await this.db.select().from(users).where(eq(users.usernameLower, username.toLowerCase()));
    // verificação com custo constante mesmo quando o usuário não existe
    const ok = u ? await verify(u.passwordHash, password) : (await hash(password, ARGON), false);
    if (!u || !ok) throw new AppError(401, 'invalid_credentials', 'Usuário ou senha inválidos');
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    const token = await this.createSession(u.id);
    return { token, user: { id: u.id, username: u.username } };
  }

  private async createSession(userId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionDays * 86400_000);
    await this.db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
    return token;
  }

  async validate(token: string | undefined | null): Promise<AuthUser | null> {
    if (!token || token.length > 200) return null;
    const rows = await this.db
      .select({ id: users.id, username: users.username })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
    return rows[0] ?? null;
  }

  async logout(token: string) {
    await this.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }

  async purgeExpired() {
    await this.db.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
  }
}

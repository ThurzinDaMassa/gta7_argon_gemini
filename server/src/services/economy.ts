import { and, desc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { playerWallets, walletTransactions } from '../db/schema';
import { AppError } from './auth';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;

/**
 * Toda movimentação financeira passa por aqui. Garantias:
 * - UPDATE atômico condicionado a saldo >= 0 (+ CHECK no banco)
 * - chave de idempotência única impede recompensas duplicadas
 * - registro em wallet_transactions na mesma transação
 */
export class EconomyService {
  constructor(private db: DB) {}

  async balance(userId: string): Promise<number> {
    const [w] = await this.db.select({ b: playerWallets.balance }).from(playerWallets).where(eq(playerWallets.userId, userId));
    return w?.b ?? 0;
  }

  async history(userId: string, limit = 20) {
    return this.db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(desc(walletTransactions.id)).limit(limit);
  }

  /** aplica delta dentro de um executor (transação existente) */
  async applyIn(ex: Executor, userId: string, amount: number, reason: string, ref?: string, idempotencyKey?: string): Promise<number> {
    if (!Number.isInteger(amount) || Math.abs(amount) > 10_000_000) throw new AppError(400, 'invalid_amount');
    if (idempotencyKey) {
      const dup = await ex.select({ id: walletTransactions.id }).from(walletTransactions).where(eq(walletTransactions.idempotencyKey, idempotencyKey));
      if (dup.length) throw new AppError(409, 'duplicate_transaction', 'Transação já processada');
    }
    const res = await ex
      .update(playerWallets)
      .set({ balance: sql`${playerWallets.balance} + ${amount}`, updatedAt: new Date() })
      .where(and(eq(playerWallets.userId, userId), sql`${playerWallets.balance} + ${amount} >= 0`))
      .returning({ balance: playerWallets.balance });
    if (!res.length) throw new AppError(402, 'insufficient_funds', 'Saldo insuficiente');
    await ex.insert(walletTransactions).values({ userId, amount, balanceAfter: res[0].balance, reason, ref, idempotencyKey });
    return res[0].balance;
  }

  async apply(userId: string, amount: number, reason: string, ref?: string, idempotencyKey?: string) {
    try {
      return await this.db.transaction((tx) => this.applyIn(tx, userId, amount, reason, ref, idempotencyKey));
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      const msg = String(e?.message ?? '') + String(e?.cause?.message ?? '');
      if (msg.includes('wtx_idem_idx') || e?.code === '23505') throw new AppError(409, 'duplicate_transaction', 'Transação já processada');
      if (msg.includes('wallet_nonneg')) throw new AppError(402, 'insufficient_funds', 'Saldo insuficiente');
      throw e;
    }
  }

  /** executa compra: debita e entrega o bem na MESMA transação */
  async purchase<T>(userId: string, price: number, reason: string, ref: string, grant: (tx: Tx) => Promise<T>): Promise<{ balance: number; result: T }> {
    if (price < 0) throw new AppError(400, 'invalid_price');
    try {
      return await this.db.transaction(async (tx) => {
        const balance = price > 0 ? await this.applyIn(tx, userId, -price, reason, ref) : await this.balanceIn(tx, userId);
        const result = await grant(tx);
        return { balance, result };
      });
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      const msg = String(e?.message ?? '') + String(e?.cause?.message ?? '');
      if (msg.includes('wallet_nonneg')) throw new AppError(402, 'insufficient_funds', 'Saldo insuficiente');
      if (msg.includes('prop_user_prop_idx')) throw new AppError(409, 'already_owned', 'Você já possui isso');
      throw e;
    }
  }

  private async balanceIn(ex: Executor, userId: string) {
    const [w] = await ex.select({ b: playerWallets.balance }).from(playerWallets).where(eq(playerWallets.userId, userId));
    return w?.b ?? 0;
  }
}

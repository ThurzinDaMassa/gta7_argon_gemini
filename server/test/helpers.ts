import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createDb } from '../src/db';
import { buildApp } from '../src/app';
import type { Ack } from '../../shared/src';

export async function startServer() {
  const dbh = await createDb({ pgliteDir: 'memory://' });
  const built = await buildApp({ dbh, corsOrigin: true, logger: false });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (built.app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    ...built, dbh, base,
    async stop() { await built.app.close(); await dbh.close(); },
  };
}
export type TestServer = Awaited<ReturnType<typeof startServer>>;

export async function api(base: string, method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any };
}

let n = 0;
export async function newUser(base: string) {
  const username = `user_${Date.now() % 100000}_${n++}`;
  const r = await api(base, 'POST', '/api/v1/auth/register', { username, password: 'senhaSegura123' });
  if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.body));
  return { username, token: r.body.token as string, id: r.body.user.id as string };
}

export function connect(base: string, token: string, onInit?: (s: Socket) => void): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    onInit?.(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

export function emit<T = any>(s: Socket, ev: string, data?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => s.emit(ev, data, (r: Ack<T>) => resolve(r)));
}

export function waitFor<T = any>(s: Socket, ev: string, pred: (d: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(ev, h); reject(new Error(`timeout waiting ${ev}`)); }, ms);
    const h = (d: T) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); resolve(d); } };
    s.on(ev, h);
  });
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

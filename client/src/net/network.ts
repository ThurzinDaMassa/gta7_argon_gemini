import { io, type Socket } from 'socket.io-client';
import { EV, type Ack } from '../../../shared/src';

const API_BASE = (import.meta as any).env?.VITE_API_URL ? String((import.meta as any).env.VITE_API_URL).replace(/\/$/, '') : '';
const WS_BASE = (import.meta as any).env?.VITE_WS_URL ? String((import.meta as any).env.VITE_WS_URL).replace(/\/$/, '') : API_BASE;

const TOKEN_KEY = 'gta7_auth_token';

export interface UserSession {
  id: string;
  username: string;
  token: string;
}

export class NetworkClient {
  socket: Socket | null = null;
  session: UserSession | null = null;
  latencyMs = 18;
  private listeners = new Map<string, Set<(data: any) => void>>();
  onStatusChange?: (status: 'online' | 'connecting' | 'offline', text: string) => void;
  onWakeupChange?: (waking: boolean) => void;

  constructor() {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      try {
        this.session = JSON.parse(saved);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
      }
    }
  }

  saveSession(s: UserSession | null) {
    this.session = s;
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  }

  async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.session?.token) headers['authorization'] = `Bearer ${this.session.token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.error || `Erro HTTP ${res.status}`);
    }
    return data as T;
  }

  async checkHealthWithWakeup(): Promise<boolean> {
    this.onStatusChange?.('connecting', 'Verificando servidor...');
    const t0 = performance.now();
    const slowTimer = setTimeout(() => this.onWakeupChange?.(true), 2200);
    try {
      await this.api('GET', '/health');
      this.latencyMs = Math.max(1, Math.round(performance.now() - t0));
      clearTimeout(slowTimer);
      this.onWakeupChange?.(false);
      this.onStatusChange?.('online', `Online (${this.latencyMs} ms)`);
      return true;
    } catch {
      clearTimeout(slowTimer);
      this.onStatusChange?.('offline', 'Servidor indisponível');
      return false;
    }
  }

  async restoreOrGuest(): Promise<UserSession | null> {
    await this.checkHealthWithWakeup();
    if (this.session?.token) {
      try {
        const me = await this.api<{ user: { id: string; username: string } }>('GET', '/api/v1/auth/me');
        this.saveSession({ id: me.user.id, username: me.user.username, token: this.session.token });
        this.connectSocket();
        return this.session;
      } catch {
        this.saveSession(null);
      }
    }
    return null;
  }

  async register(username: string, password: string): Promise<UserSession> {
    const r = await this.api<{ token: string; user: { id: string; username: string } }>('POST', '/api/v1/auth/register', { username, password });
    const s: UserSession = { id: r.user.id, username: r.user.username, token: r.token };
    this.saveSession(s);
    this.connectSocket();
    return s;
  }

  async login(username: string, password: string): Promise<UserSession> {
    const r = await this.api<{ token: string; user: { id: string; username: string } }>('POST', '/api/v1/auth/login', { username, password });
    const s: UserSession = { id: r.user.id, username: r.user.username, token: r.token };
    this.saveSession(s);
    this.connectSocket();
    return s;
  }

  async logout() {
    try {
      if (this.session) await this.api('POST', '/api/v1/auth/logout');
    } catch { /* ignore */ }
    this.socket?.disconnect();
    this.socket = null;
    this.saveSession(null);
  }

  connectSocket() {
    if (!this.session?.token) return;
    this.socket?.disconnect();
    const s = io(WS_BASE || undefined, {
      auth: { token: this.session.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    this.socket = s;

    s.on('connect', () => {
      this.onWakeupChange?.(false);
      this.onStatusChange?.('online', `Conectado • ${this.session?.username}`);
    });

    s.on('disconnect', () => {
      this.onStatusChange?.('connecting', 'Reconectando ao servidor...');
    });

    s.on('connect_error', () => {
      this.onStatusChange?.('offline', 'Falha de conexão • tentando novamente');
    });

    for (const evName of Object.values(EV)) {
      s.on(evName, (payload: any) => {
        const set = this.listeners.get(evName);
        if (set) for (const fn of set) fn(payload);
      });
    }
  }

  on(ev: string, fn: (data: any) => void) {
    let set = this.listeners.get(ev);
    if (!set) this.listeners.set(ev, (set = new Set()));
    set.add(fn);
    return () => set?.delete(fn);
  }

  emit<T = any>(ev: string, data?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        resolve({ ok: false, error: 'Sem conexão com o servidor' });
        return;
      }
      this.socket.emit(ev, data, (ack: Ack<T>) => resolve(ack ?? { ok: true, data: undefined as any }));
    });
  }

  emitFast(ev: string, data?: unknown) {
    if (this.socket?.connected) this.socket.emit(ev, data);
  }
}

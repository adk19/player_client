import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { urlConstant } from '../shared/constant/urlConstant';

export interface WatchlistItem {
  id: number;
  symbol: string;
  market_type: string;
  market?: string; // backward compat alias
}

@Injectable({ providedIn: 'root' })
export class WatchlistSocketService implements OnDestroy {
  private socket: Socket | null = null;
  private connected = false;

  private watchlistSubject = new BehaviorSubject<WatchlistItem[]>([]);
  private addWatchlistResponseSubject = new Subject<any>();
  private removeWatchlistResponseSubject = new Subject<any>();
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);

  // Pending operations when socket is not connected
  private pendingAdd: number[] = [];
  private pendingRemove: number[] = [];

  watchlist$ = this.watchlistSubject.asObservable();
  addWatchlistResponse$ = this.addWatchlistResponseSubject.asObservable();
  removeWatchlistResponse$ = this.removeWatchlistResponseSubject.asObservable();
  connectionStatus$ = this.connectionStatusSubject.asObservable();

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.socket?.connected) return;

    const token = sessionStorage.getItem('auth_token') || '';

    this.socket = io(urlConstant.WatchlistSocketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      auth: { token }
    });

    // Register get_my_watchlist ONCE at socket level (not inside connect handler)
    // Registering inside 'connect' causes duplicate listeners on every reconnect
    this.socket.on('get_my_watchlist', (res: any) => {
      if (res?.code === 0 && Array.isArray(res.data)) {
        this.watchlistSubject.next(res.data as WatchlistItem[]);
      }
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.connectionStatusSubject.next(true);
      // Flush pending operations first, then fetch latest watchlist
      this.flushPendingOperations();
      this.getMyWatchlist();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.connectionStatusSubject.next(false);
    });

    this.socket.on('connect_error', (err) => {
      console.warn('[WatchlistSocket] connect_error:', err?.message);
      this.connected = false;
      this.connectionStatusSubject.next(false);
    });
  }

  // ── get_my_watchlist — ack pattern, no payload ────────────────
  // Doc: no payload required, ack: { code, message, data: WatchlistItem[] }
  getMyWatchlist(): void {
    if (!this.socket?.connected) return;
    // Pass empty object as payload so server doesn't confuse callback as data
    this.socket.emit('get_my_watchlist', {}, (res: any) => {
      if (res?.code === 0 && Array.isArray(res.data)) {
        this.watchlistSubject.next(res.data as WatchlistItem[]);
      }
    });
  }

  // ── add_watchlist — ack pattern ───────────────────────────────
  // Doc: { instrument_id }, ack: { code, message }
  addWatchlist(instrumentId: number): void {
    if (!this.socket?.connected) {
      // Queue for when socket reconnects
      if (!this.pendingAdd.includes(instrumentId)) this.pendingAdd.push(instrumentId);
      return;
    }

    this.socket.emit('add_watchlist', { instrument_id: instrumentId }, (res: any) => {
      this.addWatchlistResponseSubject.next(res);
      if (res?.code === 0) this.getMyWatchlist();
    });
  }

  // ── remove_watchlist — ack pattern ───────────────────────────
  // Doc: { instrument_id }, ack: { code, message }
  removeWatchlist(instrumentId: number): void {
    if (!this.socket?.connected) {
      // Queue for when socket reconnects
      if (!this.pendingRemove.includes(instrumentId)) this.pendingRemove.push(instrumentId);
      return;
    }

    this.socket.emit('remove_watchlist', { instrument_id: instrumentId }, (res: any) => {
      this.removeWatchlistResponseSubject.next(res);
      if (res?.code === 0) this.getMyWatchlist();
    });
  }

  // ── Flush pending add/remove operations after reconnect ───────
  private flushPendingOperations(): void {
    const toAdd = [...this.pendingAdd];
    const toRemove = [...this.pendingRemove];
    this.pendingAdd = [];
    this.pendingRemove = [];

    for (const id of toAdd) {
      this.socket!.emit('add_watchlist', { instrument_id: id }, (res: any) => {
        this.addWatchlistResponseSubject.next(res);
      });
    }
    for (const id of toRemove) {
      this.socket!.emit('remove_watchlist', { instrument_id: id }, (res: any) => {
        this.removeWatchlistResponseSubject.next(res);
      });
    }
    // After flushing, a single getMyWatchlist will be called by the connect handler
  }

  testConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.socket?.connected) {
        resolve(true);
        return;
      }
      const t = setTimeout(() => resolve(false), 5000);
      this.socket?.once('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  getCurrentWatchlist(): WatchlistItem[] {
    return this.watchlistSubject.value;
  }

  isConnected(): boolean {
    return this.connected && (this.socket?.connected ?? false);
  }

  reconnect(): void {
    this.socket?.disconnect();
    this.socket?.connect();
  }

  disconnectForLogout(): void {
    if (this.socket) {
      try {
        this.socket.io.opts.reconnection = false;
      } catch { /* noop */ }
      try {
        this.socket.removeAllListeners();
      } catch { /* noop */ }
      try {
        this.socket.disconnect();
      } catch { /* noop */ }
      try {
        this.socket.close();
      } catch { /* noop */ }
      this.socket = null;
    }
    this.connected = false;
    this.connectionStatusSubject.next(false);
    this.watchlistSubject.next([]);
    this.pendingAdd = [];
    this.pendingRemove = [];
  }

  reconnectAfterLogin(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.socket?.connected) return;
    this.disconnectForLogout();
    this.connect();
  }

  ngOnDestroy(): void {
    this.disconnectForLogout();
    this.watchlistSubject.complete();
    this.addWatchlistResponseSubject.complete();
    this.removeWatchlistResponseSubject.complete();
  }
}

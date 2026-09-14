import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { urlConstant } from '../shared/constant/urlConstant';
import { AuthService } from '../shared/services/auth.service';
import { BinanceSocketService } from './binance-socket.service';

export interface Position {
  position_id: number;
  player_id?: number;
  market: string;
  type: number;         // 1 = BUY, 2 = SELL
  quantity: number;
  entry_price: number;
  current_price?: number;
  leverage: number;
  take_profit?: number;
  stop_loss?: number;
  unrealized_pl?: number;
  profit_loss?: number;
  status?: number;
  opened_at?: string;
  /** Present on socket payloads for margin reserved on this leg */
  used_margin?: number;
}

export interface OrderPlacePayload {
  symbol: string;
  market?: string;
  position_type_id: number;
  quantity: number;
  price: number;
  leverage?: number;
  order_type_id: number;   // 1=MARKET, 2=BUY_LIMIT, 3=SELL_LIMIT, 4=BUY_STOP, 5=SELL_STOP, 6=BUY_STOP_LIMIT, 7=SELL_STOP_LIMIT
  market_type?: number;           // 1=CRYPTO, 2=others
  stop_loss?: number;
  take_profit?: number;
  limit_price?: number;    // For BUY_STOP_LIMIT / SELL_STOP_LIMIT
  stop_price?: number;     // For BUY_STOP / SELL_STOP / BUY_STOP_LIMIT / SELL_STOP_LIMIT
  expiration?: string;     // GTC | Today | Specified | Specified Day
  expiration_date?: string;// ISO date string when expiration = Specified / Specified Day
  comment?: string;
}

export interface OrderUpdatePayload {
  position_id: number;
  stop_loss?: number;
  take_profit?: number;
}

export interface OrderClosePayload {
  position_id: number;
  exit_price: number;
  quantity?: number | null;
  reason?: string;
  market_type?: number;  // 1 = CRYPTO, 2 = others
}

export interface CloseAllPositionsPayload {
  // Backend usually knows the player from socket/session, but we still send it for clarity.
  player_id?: string | number;
}

@Injectable({ providedIn: 'root' })
export class TradingSocketService {
  private socket!: Socket;

  private positionsSubject = new BehaviorSubject<Position[]>([]);
  private pendingOrdersSubject = new BehaviorSubject<any[]>([]);
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);

  // Ack response subjects — components can subscribe to these
  private orderPlaceResponseSubject = new Subject<any>();
  private orderCloseResponseSubject = new Subject<any>();
  private orderUpdateResponseSubject = new Subject<any>();
  // Server-pushed events
  private positionClosedSubject = new Subject<any>();
  private orderExecutedSubject = new Subject<any>();
  private orderExpiredSubject = new Subject<any>();

  positions$ = this.positionsSubject.asObservable();
  pendingOrders$ = this.pendingOrdersSubject.asObservable();
  connectionStatus$ = this.connectionStatusSubject.asObservable();
  orderPlaceResponse$ = this.orderPlaceResponseSubject.asObservable();
  orderCloseResponse$ = this.orderCloseResponseSubject.asObservable();
  orderUpdateResponse$ = this.orderUpdateResponseSubject.asObservable();
  positionClosed$ = this.positionClosedSubject.asObservable();
  orderExecuted$ = this.orderExecutedSubject.asObservable();
  orderExpired$ = this.orderExpiredSubject.asObservable();

  private currentPlayerId = '';
  private balancePollingInterval: any;
  private isBalancePollingStarted = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 3000;

  constructor(
    private authService: AuthService,
    private binanceSocketService: BinanceSocketService
  ) {
    this.connect();
  }

  testConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.socket.connected) {
        resolve(true);
        return;
      }
      const t = setTimeout(() => resolve(false), 5000);
      this.socket.once('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  reconnect(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.socket?.connected) return;
    if (this.socket) {
      this.socket.io.opts.reconnection = true;
      this.socket.connect();
      return;
    }
    this.connect();
  }

  private destroySocket(): void {
    this.stopBalancePolling();
    if (!this.socket) return;
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
    this.socket = undefined as unknown as Socket;
  }

  private connect() {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.socket?.connected) return;

    this.destroySocket();

    const token = sessionStorage.getItem('auth_token') || '';
    const user = this.authService.currentUser;
    const playerId = user?.playerId || user?.userId || sessionStorage.getItem('player_id') || '';
    this.currentPlayerId = String(playerId);

    this.socket = io(urlConstant.TradingSocketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: 10000,
      auth: { token }
    });

    this.socket.on('connect', () => {
      // console.log('[TradingSocket] Connected');
      this.reconnectAttempts = 0;
      this.connectionStatusSubject.next(true);
      if (this.currentPlayerId) {
        this.fetchOpenPositions();
        this.fetchPendingOrders();
        this.startBalancePolling();
      }
    });

    this.socket.on('connect_error', (error: any) => {
      // console.error('[TradingSocket] Connection error:', error?.message);
      this.reconnectAttempts++;
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.connectionStatusSubject.next(false);
      }
      if (error?.message === 'AUTH_FAILED' && sessionStorage.getItem('auth_token')) {
        this.authService.logout();
      }
    });

    this.socket.on('disconnect', (reason) => {
      // console.log('[TradingSocket] Disconnected:', reason);
      this.connectionStatusSubject.next(false);
      this.stopBalancePolling();
    });

    this.socket.on('reconnect', () => {
      this.reconnectAttempts = 0;
    });

    // realtime_update — server pushes position updates via pg LISTEN
    this.socket.on('realtime_update', (data: any) => {
      if (this.currentPlayerId) {
        this.fetchOpenPositions();
        this.fetchPendingOrders();
      }
    });

    // close_position — server pushes when SL/TP/Liquidation hits
    this.socket.on('close_position', (data: any) => {
      this.positionClosedSubject.next(data);
      // Only refresh for current player; backend may broadcast to multiple sessions.
      const pidFromEvent = data?.player_id != null ? String(data.player_id) : data?.data?.player_id != null ? String(data.data.player_id) : null;
      const shouldRefresh = !!this.currentPlayerId && (!pidFromEvent || pidFromEvent === String(this.currentPlayerId));

      // If balance is part of event payload, update it immediately.
      const balRaw = data?.balance ?? data?.data?.balance;
      if (balRaw !== undefined && balRaw !== null && balRaw !== '') {
        const newBalance = Number(balRaw);
        if (Number.isFinite(newBalance)) {
          this.authService.updateBalance(newBalance);
          const raw = sessionStorage.getItem('auth_user');
          if (raw) {
            try {
              const u = JSON.parse(raw);
              u.balance = newBalance;
              sessionStorage.setItem('auth_user', JSON.stringify(u));
            } catch { }
          }
        }
      }

      if (shouldRefresh) {
        this.fetchOpenPositions();
        this.fetchPendingOrders();
      }
    });

    // order_executed — pending order (limit/stop) got triggered and became a position
    this.socket.on('order_executed', (data: any) => {
      this.orderExecutedSubject.next(data);
      if (this.currentPlayerId) {
        this.fetchOpenPositions();
        this.fetchPendingOrders(); // remove from pending list
      }
    });

    // order_expired — pending order expired, refresh positions list
    this.socket.on('order_expired', (data: any) => {
      this.orderExpiredSubject.next(data);
      if (this.currentPlayerId) {
        this.fetchOpenPositions();
        this.fetchPendingOrders(); // remove from pending list
      }
    });

    // balance_update — server pushes live balance data
    this.socket.on('balance_update', (res: any) => {
      if (res?.code === 0 && res?.data?.balance !== undefined) {
        const newBalance = Number(res.data.balance);
        this.authService.updateBalance(newBalance);
        const raw = sessionStorage.getItem('auth_user');
        if (raw) {
          try {
            const u = JSON.parse(raw);
            u.balance = newBalance;
            sessionStorage.setItem('auth_user', JSON.stringify(u));
          } catch { }
        }
      }
    });
  }

  // ── get_open_positions ────────────────────────────────────────
  fetchOpenPositions(playerId?: string) {
    const id = playerId || this.currentPlayerId;
    const playerIdNum = parseInt(id, 10);
    if (isNaN(playerIdNum)) return;

    this.socket.emit('get_open_positions', { player_id: playerIdNum }, (res: any) => {
      let payload = res;
      if (Array.isArray(res) && res.length > 0 && res[0] != null && typeof res[0] === 'object') {
        payload = res[0];
      }
      if (payload?.code === 0 && Array.isArray(payload.data)) {
        this.positionsSubject.next(this.mapPositions(payload.data));
      }
    });
  }

  // ── get_pending_orders ────────────────────────────────────────
  fetchPendingOrders(playerId?: string) {
    const id = playerId || this.currentPlayerId;
    const playerIdNum = parseInt(id, 10);
    if (isNaN(playerIdNum)) return;

    this.socket.emit('get_pending_orders', { player_id: playerIdNum }, (res: any) => {
      if (res?.code === 0 && Array.isArray(res.data)) {
        this.pendingOrdersSubject.next(res.data);
      }
    });
  }

  // ── pending_order_update ──────────────────────────────────────
  updatePendingOrder(payload: {
    order_id: number;
    stop_price?: number | null;
    limit_price?: number | null;
    expiration?: string;
    expiration_value?: string | null;
  }): Promise<any> {
    return new Promise((resolve) => {
      this.socket.emit('pending_order_update', payload, (res: any) => {
        if (res?.code === 0 || res?.success === true) {
          this.fetchPendingOrders();
        }
        resolve(res);
      });
    });
  }

  // ── cancel_order (pending order cancel) ──────────────────────
  cancelPendingOrder(orderId: number): Promise<any> {
    return new Promise((resolve) => {
      this.socket.emit('cancel_order', { order_id: orderId }, (res: any) => {
        if (res?.code === 0 || res?.success === true) {
          this.fetchPendingOrders();
          this.fetchOpenPositions();
        }
        resolve(res);
      });
    });
  }

  private mapPositions(raw: any[]): Position[] {
    return raw.map((p: any) => ({
      position_id: Number(p.position_id),
      player_id: Number(p.player_id),
      market: p.market,
      type: Number(p.position_type_id ?? p.type),
      quantity: parseFloat(p.quantity),
      entry_price: parseFloat(p.entry_price),
      current_price: p.current_price != null ? parseFloat(p.current_price) : undefined,
      leverage: parseFloat(p.leverage ?? p.leverage_used) || undefined,
      unrealized_pl: p.unrealized_pl != null ? parseFloat(p.unrealized_pl) : undefined,
      profit_loss: p.unrealized_pl != null ? parseFloat(p.unrealized_pl) : undefined,
      stop_loss: p.stop_loss != null ? parseFloat(p.stop_loss) : undefined,
      take_profit: p.take_profit != null ? parseFloat(p.take_profit) : undefined,
      status: p.status != null ? Number(p.status) : undefined,
      opened_at: p.opened_at,
      used_margin: p.used_margin != null && p.used_margin !== '' ? parseFloat(p.used_margin) : p.usedMargin != null && p.usedMargin !== '' ? parseFloat(p.usedMargin) : undefined
    }));
  }

  // ── order_place ───────────────────────────────────────────────
  placeOrder(payload: OrderPlacePayload): Promise<any> {
    return new Promise((resolve) => {
      this.socket.emit('order_place', payload, (res: any) => {
        this.orderPlaceResponseSubject.next(res);
        if (res?.code === 0) {
          this.fetchOpenPositions();
          this.fetchPendingOrders(); // pending order placed
        }
        // Force market resubscribe so prices never go blank post-trade
        this.binanceSocketService.forceResubscribeAllNow();
        resolve(res);
      });
    });
  }

  // ── order_update (SL/TP) ──────────────────────────────────────
  updateOrder(payload: OrderUpdatePayload): Promise<any> {
    return new Promise((resolve) => {
      this.socket.emit('order_update', payload, (res: any) => {
        this.orderUpdateResponseSubject.next(res);
        if (res?.code === 0) {
          this.fetchOpenPositions();
          this.fetchPendingOrders();
        }
        this.binanceSocketService.forceResubscribeAllNow();
        resolve(res);
      });
    });
  }

  // ── order_close ───────────────────────────────────────────────
  closeOrder(payload: OrderClosePayload): Promise<any> {
    return new Promise((resolve) => {
      const body = payload;
      this.socket.emit('order_close', body, (res: any) => {
        this.orderCloseResponseSubject.next(res);
        if (res?.success === true || res?.code === 0) {
          this.fetchOpenPositions();
          this.fetchPendingOrders();
        }
        this.binanceSocketService.forceResubscribeAllNow();
        resolve(res);
      });
    });
  }

  // ── close_all_positions (bulk) ────────────────────────────────
  closeAllPositions(payload: CloseAllPositionsPayload = {}): Promise<any> {
    return new Promise((resolve) => {
      // `currentPlayerId` is kept inside the service; we provide it here so backend
      // doesn't need to rely only on session.
      const body: CloseAllPositionsPayload = {
        ...payload,
        player_id: payload.player_id ?? this.currentPlayerId
      };

      this.socket.emit('close_all_positions', body, (res: any) => {
        if (res?.success === true || res?.code === 0) {
          this.fetchOpenPositions();
          this.fetchPendingOrders();
        }
        this.binanceSocketService.forceResubscribeAllNow();
        resolve(res);
      });
    });
  }

  // ── get_balance_data ──────────────────────────────────────────
  fetchBalance(): Promise<any> {
    return new Promise((resolve) => {
      this.socket.emit('get_balance_data', {}, (res: any) => {
        if (res?.code === 0 && res?.data?.balance !== undefined) {
          this.authService.updateBalance(res.data.balance);
          const raw = sessionStorage.getItem('auth_user');
          if (raw) {
            try {
              const u = JSON.parse(raw);
              u.balance = res.data.balance;
              sessionStorage.setItem('auth_user', JSON.stringify(u));
            } catch { }
          }
        }
        resolve(res);
      });
    });
  }

  private startBalancePolling() {
    if (this.isBalancePollingStarted) return;
    this.isBalancePollingStarted = true;
    this.balancePollingInterval = setInterval(() => {
      if (this.socket?.connected) this.fetchBalance();
    }, 5000); // 5s is enough — no need to hammer every 1s
  }

  private stopBalancePolling() {
    if (this.balancePollingInterval) {
      clearInterval(this.balancePollingInterval);
      this.balancePollingInterval = null;
      this.isBalancePollingStarted = false;
    }
  }

  setPlayerId(playerId: string) {
    this.currentPlayerId = playerId;
    if (this.socket?.connected) this.fetchOpenPositions();
  }

  onPositionsUpdate(cb: (p: Position[]) => void) {
    return this.positions$.subscribe(cb);
  }

  onConnectionStatus(cb: (c: boolean) => void) {
    return this.connectionStatus$.subscribe(cb);
  }

  disconnectForLogout(): void {
    this.destroySocket();
    this.connectionStatusSubject.next(false);
    this.positionsSubject.next([]);
    this.pendingOrdersSubject.next([]);
    this.currentPlayerId = '';
    this.reconnectAttempts = 0;
  }

  reconnectAfterLogin(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.socket?.connected) return;
    this.connect();
  }

  disconnect(): void {
    this.disconnectForLogout();
  }
}

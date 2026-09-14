import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { urlConstant } from '../shared/constant/urlConstant';
import { AuthService } from '../shared/services/auth.service';
import { MarketType } from '../shared/services/market.constants';

// Two physical sockets based on market protocol:
// 1. CRYPTO (Binance/BAPI) -> environment.CryptoWebSocketUrl
// 2. OTHERS (MT5/HUB)      -> environment.Mt5SocketUrl
const SOCKET_GROUPS = {
  BAPI_CRYPTO: [MarketType.CRYPTO],
  HUB_MT5: [
    MarketType.FOREX, MarketType.COMMODITY, MarketType.STOCK,
    MarketType.INDEX, MarketType.METAL,
    MarketType.ETFS, MarketType.FORWARDS, MarketType.MCX   // new types — all MT5
  ],
};

@Injectable({ providedIn: 'root' })
export class BinanceSocketService {
  // Two actual socket connections
  private bapiSocket!: Socket; // For Crypto (BAPI) -> uses subscribeSingleTicker
  private hubSocket!: Socket;  // For MT5 (HUB)    -> uses subscribeMiniTicker

  private connectionStatusSubject = new BehaviorSubject<Map<MarketType, boolean>>(new Map());
  connectionStatus$ = this.connectionStatusSubject.asObservable();

  // Market status tracking (symbol -> boolean)
  private marketStatusSubject = new BehaviorSubject<Map<string, boolean>>(new Map());
  marketStatus$ = this.marketStatusSubject.asObservable();

  // Reset status for a specific symbol (used during symbol switch)
  resetMarketStatus(symbol: string): void {
    const symbolUpper = symbol.toUpperCase();
    const currentStatus = this.marketStatusSubject.value;
    if (currentStatus.has(symbolUpper)) {
      const newStatus = new Map(currentStatus);
      newStatus.delete(symbolUpper);
      this.marketStatusSubject.next(newStatus);
    }
  }

  // Per-socket actual subscriptions
  private socketSubs = new Map<'BAPI_CRYPTO' | 'HUB_MT5', Set<string>>();

  // Owner-based tracking (ownerId -> Set of symbols)
  private miniTickerOwnerSubs = new Map<MarketType, Map<string, Set<string>>>();
  private singleTickerOwnerSubs = new Map<MarketType, Map<string, Set<string>>>();

  private klineSubs = new Map<MarketType, { symbol: string; interval: string, market?: string } | null>();
  private combinedSubs = new Map<MarketType, string | null>();

  private symbolMarketMap = new Map<string, string>();

  setSymbolMarket(symbol: string, market: string) {
    this.symbolMarketMap.set(symbol, market);
  }

  // Event handlers per marketType
  private miniTickerHandlers = new Map<MarketType, ((d: any) => void)[]>();
  private singleTickerHandlers = new Map<MarketType, ((d: any) => void)[]>();
  private klineHandlers = new Map<MarketType, ((d: any) => void)[]>();
  private combinedHandlers = new Map<MarketType, ((d: any) => void)[]>();
  private allTickerHandlers = new Map<MarketType, ((d: any) => void)[]>();
  private marketMiniTickerHandlers = new Map<MarketType, ((d: any) => void)[]>();

  // Last-tick cache so UI never stays blank after (re)subscribe/navigation.
  // We store last + previous because some streams can deliver partial ticks.
  // Keyed by a normalized symbol (uppercase alnum only) because many MT symbols include "/" or suffixes.
  private miniTickerCacheByNormSymbol = new Map<string, { last: any; prev: any }>();
  private singleTickerCacheByNormSymbol = new Map<string, { last: any; prev: any }>();
  private lastTickAtByNormSymbol = new Map<string, number>();

  // If a subscribed symbol doesn't receive ticks for this long, force re-subscribe.
  // This handles page switches / long-interval instruments so UI doesn't go blank waiting.
  private readonly STALE_TICK_MS = 30_000;
  private staleWatchdogTimer: any = null;

  constructor(private authService: AuthService) {
    this.initAllMarketTypes();
    // Eagerly connect both sockets on service init
    this.bapiSocket = this.createSocket('BAPI_CRYPTO');
    this.hubSocket = this.createSocket('HUB_MT5');
    this.startStaleWatchdog();
  }

  private get planId(): number {
    return this.authService.currentUser?.spreadId ?? 0;
  }

  // ── Init state for every market type ─────────────────────────
  private initAllMarketTypes() {
    this.socketSubs.set('BAPI_CRYPTO', new Set());
    this.socketSubs.set('HUB_MT5', new Set());

    const all = [...SOCKET_GROUPS.BAPI_CRYPTO, ...SOCKET_GROUPS.HUB_MT5];
    for (const mt of all) {
      this.miniTickerOwnerSubs.set(mt, new Map());
      this.singleTickerOwnerSubs.set(mt, new Map());
      this.klineSubs.set(mt, null);
      this.combinedSubs.set(mt, null);
      this.miniTickerHandlers.set(mt, []);
      this.singleTickerHandlers.set(mt, []);
      this.klineHandlers.set(mt, []);
      this.combinedHandlers.set(mt, []);
      this.allTickerHandlers.set(mt, []);
      this.marketMiniTickerHandlers.set(mt, []);
    }
  }

  // ── Create & wire a socket ────────────────────────────────────
  private createSocket(group: 'BAPI_CRYPTO' | 'HUB_MT5'): Socket {
    // Exact mapping as per instruction:
    // Crypto -> environment.CryptoWebSocketUrl (urlConstant.BinanceSocket)
    // MT5    -> environment.Mt5SocketUrl       (urlConstant.Mt5Socket)
    const url = group === 'BAPI_CRYPTO' ? urlConstant.BinanceSocket : urlConstant.Mt5Socket;
    const marketTypes = group === 'BAPI_CRYPTO' ? SOCKET_GROUPS.BAPI_CRYPTO : SOCKET_GROUPS.HUB_MT5;

    const socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    socket.on('connect', () => {
      // console.log(`[BinanceSocket][${group}] Connected to ${url}`);
      for (const mt of marketTypes) {
        this.updateStatus(mt, true);
      }
      // Re-subscribe everything after reconnect
      this.resubscribeAll(socket, marketTypes);
    });

    socket.on('disconnect', () => {
      // console.log(`[BinanceSocket][${group}] Disconnected`);
      for (const mt of marketTypes) this.updateStatus(mt, false);
    });

    socket.on('connect_error', (err) => {
      console.warn(`[BinanceSocket][${group}] Error connecting to ${url}:`, err?.message);
      for (const mt of marketTypes) this.updateStatus(mt, false);
    });

    // Wire incoming events → registered handlers
    socket.on('miniTicker', (data: any) => {
      this.cacheTicker('mini', data);
      this.updateMarketStatus(data);
      if (group === 'HUB_MT5') {
        // HUB sends miniTicker for ALL subscribed symbols regardless of market type.
        // Broadcast to ALL HUB market type handlers — each handler filters by symbol internally.
        for (const mt of marketTypes) {
          for (const h of this.miniTickerHandlers.get(mt) || []) h(data);
          for (const h of this.singleTickerHandlers.get(mt) || []) h(data);
        }
      } else {
        for (const mt of marketTypes) {
          for (const h of this.miniTickerHandlers.get(mt) || []) h(data);
        }
      }
    });

    socket.on('singleTicker', (data: any) => {
      this.cacheTicker('single', data);
      this.updateMarketStatus(data);
      for (const mt of marketTypes) {
        if (group === 'BAPI_CRYPTO') {
          // Route singleTicker to miniTicker handlers too (components may use either)
          for (const h of this.miniTickerHandlers.get(mt) || []) h(data);
        }
        for (const h of this.singleTickerHandlers.get(mt) || []) h(data);
      }
    });

    socket.on('kline', (data: any) => {
      for (const mt of marketTypes) {
        for (const h of this.klineHandlers.get(mt) || []) h(data);
      }
    });

    socket.on('combined', (data: any) => {
      for (const mt of marketTypes) {
        for (const h of this.combinedHandlers.get(mt) || []) h(data);
      }
    });

    socket.on('allTicker', (data: any) => {
      for (const mt of marketTypes) {
        for (const h of this.allTickerHandlers.get(mt) || []) h(data);
      }
    });

    socket.on('marketMiniTicker', (data: any) => {
      for (const mt of marketTypes) {
        for (const h of this.marketMiniTickerHandlers.get(mt) || []) h(data);
      }
    });

    return socket;
  }

  private normSymbol(symbol: any): string {
    return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private mergeTick(base: any, patch: any): any {
    // Preserve previous known fields when the incoming tick is partial
    if (!base) return patch;
    if (!patch) return base;
    return { ...base, ...patch };
  }

  private hasAnyPriceFields(d: any): boolean {
    if (!d) return false;
    return (
      d.b != null || d.bid != null ||
      d.a != null || d.ask != null ||
      d.c != null || d.ltp != null || d.lp != null
    );
  }

  private cacheTicker(kind: 'mini' | 'single', data: any): void {
    const s = data?.s ?? data?.symbol;
    if (!s) return;
    const key = this.normSymbol(s);
    if (!key) return;

    const store = kind === 'mini' ? this.miniTickerCacheByNormSymbol : this.singleTickerCacheByNormSymbol;
    const cur = store.get(key);
    const prevLast = cur?.last ?? null;
    const merged = this.mergeTick(prevLast, data);
    store.set(key, { prev: prevLast, last: merged });
    this.lastTickAtByNormSymbol.set(key, Date.now());
  }

  private startStaleWatchdog(): void {
    if (this.staleWatchdogTimer) return;
    this.staleWatchdogTimer = setInterval(() => {
      try {
        const now = Date.now();
        this.forceResubscribeStale('BAPI_CRYPTO', now);
        this.forceResubscribeStale('HUB_MT5', now);
      } catch { }
    }, 5000);
  }

  private stopStaleWatchdog(): void {
    if (!this.staleWatchdogTimer) return;
    clearInterval(this.staleWatchdogTimer);
    this.staleWatchdogTimer = null;
  }

  private tearDownSocket(socket: Socket | undefined): void {
    if (!socket) return;
    try {
      socket.io.opts.reconnection = false;
    } catch { }
    try {
      socket.removeAllListeners();
    } catch { }
    try {
      socket.disconnect();
    } catch { }
    try {
      socket.close();
    } catch { }
  }

  private setAllConnectionStatus(connected: boolean): void {
    const status = new Map<MarketType, boolean>();
    for (const mt of [...SOCKET_GROUPS.BAPI_CRYPTO, ...SOCKET_GROUPS.HUB_MT5]) {
      status.set(mt, connected);
    }
    this.connectionStatusSubject.next(status);
  }

  private forceResubscribeStale(group: 'BAPI_CRYPTO' | 'HUB_MT5', now: number): void {
    const socket = group === 'BAPI_CRYPTO' ? this.bapiSocket : this.hubSocket;
    if (!socket?.connected) return;

    const subs = this.socketSubs.get(group);
    if (!subs || subs.size === 0) return;

    const event = group === 'BAPI_CRYPTO' ? 'subscribeSingleTicker' : 'subscribeMiniTicker';
    // Re-subscribe only the stale ones
    for (const sym of subs) {
      const key = this.normSymbol(sym);
      const lastAt = this.lastTickAtByNormSymbol.get(key) ?? 0;
      if (now - lastAt > this.STALE_TICK_MS) {
        socket.emit(event, group === 'BAPI_CRYPTO' ? { symbol: sym, planID: this.planId } : sym);
        // If we have cached data, replay it again so UI never shows blank even while waiting.
        const marketTypes = SOCKET_GROUPS[group];
        for (const mt of marketTypes) {
          this.replayLastTicks('mini', [sym], mt);
          this.replayLastTicks('single', [sym], mt);
        }
        // Bump timestamp so we don't spam resub every interval
        this.lastTickAtByNormSymbol.set(key, now);
      }
    }
  }

  /**
   * Force re-subscribe of ALL currently tracked symbols (across all owners).
   * Useful on route changes to ensure server resumes pushing data immediately.
   */
  forceResubscribeAllNow(): void {
    this.forceResubscribeGroup('BAPI_CRYPTO');
    this.forceResubscribeGroup('HUB_MT5');
  }

  private forceResubscribeGroup(group: 'BAPI_CRYPTO' | 'HUB_MT5'): void {
    const socket = group === 'BAPI_CRYPTO' ? this.bapiSocket : this.hubSocket;
    if (!socket?.connected) return;

    const subs = this.socketSubs.get(group);
    if (!subs || subs.size === 0) return;

    const event = group === 'BAPI_CRYPTO' ? 'subscribeSingleTicker' : 'subscribeMiniTicker';
    const now = Date.now();

    for (const sym of subs) {
      socket.emit(event, group === 'BAPI_CRYPTO' ? { symbol: sym, planID: this.planId } : sym);
      this.lastTickAtByNormSymbol.set(this.normSymbol(sym), now);
    }

    // Replay cached ticks once so UI never blanks during navigation
    const marketTypes = SOCKET_GROUPS[group];
    for (const mt of marketTypes) {
      this.replayLastTicks('mini', Array.from(subs), mt);
      this.replayLastTicks('single', Array.from(subs), mt);
    }
  }

  private pickBestTick(kind: 'mini' | 'single', sym: string): any | null {
    const key = this.normSymbol(sym);
    const store = kind === 'mini' ? this.miniTickerCacheByNormSymbol : this.singleTickerCacheByNormSymbol;
    const cur = store.get(key);
    if (!cur) return null;
    if (this.hasAnyPriceFields(cur.last)) return cur.last;
    if (this.hasAnyPriceFields(cur.prev)) return cur.prev;
    return cur.last ?? cur.prev ?? null;
  }

  private replayLastTicks(
    kind: 'mini' | 'single',
    symbols: string[],
    marketType: MarketType
  ): void {
    if (!symbols?.length) return;
    const handlers = kind === 'mini'
      ? (this.miniTickerHandlers.get(marketType) || [])
      : (this.singleTickerHandlers.get(marketType) || []);
    if (!handlers.length) return;

    for (const sym of symbols) {
      const cached = this.pickBestTick(kind, sym);
      if (!cached) continue;
      // Defer so caller finishes registering handlers/subscriptions first.
      queueMicrotask(() => {
        for (const h of handlers) h(cached);
      });
    }
  }

  private updateMarketStatus(data: any): void {
    if (!data || !data.s) return;
    const symbol = data.s.toUpperCase();

    // st property is the trading status from ticker
    // If st is missing, we should be careful, but based on requirement, st: true means open
    const isTrading = data.st === true;

    const currentStatusMap = this.marketStatusSubject.value;
    if (currentStatusMap.get(symbol) !== isTrading) {
      const newStatusMap = new Map(currentStatusMap);
      newStatusMap.set(symbol, isTrading);
      this.marketStatusSubject.next(newStatusMap);
    }
  }

  // Re-subscribe all on reconnect
  private resubscribeAll(socket: Socket, marketTypes: MarketType[]) {
    const sampleMt = marketTypes[0];
    if (sampleMt === undefined) return;

    const group = this.getSocketGroup(sampleMt);

    // Cancel any pending debounced sync and rebuild from owner maps immediately
    if (this.syncDebounceTimers.has(group)) {
      clearTimeout(this.syncDebounceTimers.get(group));
      this.syncDebounceTimers.delete(group);
    }

    // On reconnect: clear socketSubs so _doSync treats everything as "toSub"
    // This ensures all symbols get re-subscribed fresh (server session reset on reconnect)
    this.socketSubs.set(group, new Set());

    // Re-subscribe kline/combined
    for (const mt of marketTypes) {
      const kl = this.klineSubs.get(mt);
      if (kl) socket.emit('subscribeKline', kl);
      const cb = this.combinedSubs.get(mt);
      if (cb) socket.emit('subscribeCombined', cb);
    }

    // Re-subscribe all ticker symbols from owner maps
    this._doSyncSocketSubscriptions(group);
  }

  // ── Socket resolver ───────────────────────────────────────────
  private socketFor(marketType: MarketType): Socket {
    return this.getSocketGroup(marketType) === 'BAPI_CRYPTO' ? this.bapiSocket : this.hubSocket;
  }

  private updateStatus(mt: MarketType, connected: boolean) {
    const m = new Map(this.connectionStatusSubject.value);
    m.set(mt, connected);
    this.connectionStatusSubject.next(m);
  }

  // ── isConnected ───────────────────────────────────────────────
  isConnected(marketType: MarketType = MarketType.CRYPTO): boolean {
    return this.socketFor(marketType).connected;
  }

  // ── Unified Subscription Management ──────────────────────────

  private getGlobalUnion(socketGroup: 'BAPI_CRYPTO' | 'HUB_MT5'): Set<string> {
    const union = new Set<string>();
    const marketTypes = SOCKET_GROUPS[socketGroup];

    for (const mt of marketTypes) {
      this.miniTickerOwnerSubs.get(mt)?.forEach(syms => {
        syms.forEach(s => union.add(s));
      });
      this.singleTickerOwnerSubs.get(mt)?.forEach(syms => {
        syms.forEach(s => union.add(s));
      });
    }

    return union;
  }

  // Debounce sync to prevent rapid consecutive calls from causing flicker
  private syncDebounceTimers = new Map<'BAPI_CRYPTO' | 'HUB_MT5', any>();

  private syncSocketSubscriptions(marketType: MarketType): void {
    const group = this.getSocketGroup(marketType);

    // Cancel any pending sync for this group
    if (this.syncDebounceTimers.has(group)) {
      clearTimeout(this.syncDebounceTimers.get(group));
    }

    // Schedule sync on next microtask — merges all calls within same JS turn
    this.syncDebounceTimers.set(group, setTimeout(() => {
      this.syncDebounceTimers.delete(group);
      this._doSyncSocketSubscriptions(group);
    }, 0));
  }

  private _doSyncSocketSubscriptions(group: 'BAPI_CRYPTO' | 'HUB_MT5'): void {
    const globalUnion = this.getGlobalUnion(group);
    const actualSubs = this.socketSubs.get(group)!;

    const toUnsub = Array.from(actualSubs).filter(s => !globalUnion.has(s));
    const toSub = Array.from(globalUnion).filter(s => !actualSubs.has(s));

    if (toUnsub.length) this.performUnsubscribe(toUnsub, group);
    if (toSub.length) this.performSubscribe(toSub, group);
  }

  private performSubscribe(symbols: string[], group: 'BAPI_CRYPTO' | 'HUB_MT5'): void {
    const socket = group === 'BAPI_CRYPTO' ? this.bapiSocket : this.hubSocket;
    const subs = this.socketSubs.get(group)!;
    const event = group === 'BAPI_CRYPTO' ? 'subscribeSingleTicker' : 'subscribeMiniTicker';
    symbols.forEach(s => {
      let payload: any = group === 'BAPI_CRYPTO' ? { symbol: s, planID: this.planId , market: 'futures-usdt'} : s;
      
      if (group === 'BAPI_CRYPTO') {
        const market = this.symbolMarketMap.get(s);
        if (market) {
          payload.market = market;
        }
      }

      socket.emit(event, payload);
      subs.add(s);
    });
  }

  private performUnsubscribe(symbols: string[], group: 'BAPI_CRYPTO' | 'HUB_MT5'): void {
    const socket = group === 'BAPI_CRYPTO' ? this.bapiSocket : this.hubSocket;
    const subs = this.socketSubs.get(group)!;

    if (group === 'HUB_MT5') {
      // HUB server's unsubscribeMiniTicker kills ALL subscriptions, not just one symbol.
      // So we NEVER send unsubscribe to HUB — just remove from our local tracking.
      // The server will stop sending data for symbols we no longer re-subscribe after reconnect.
      symbols.forEach(s => subs.delete(s));
      return;
    }

    // BAPI (CRYPTO) supports individual unsubscribe safely
    const event = 'unsubscribeSingleTicker';
    symbols.forEach(s => {
      let payload: any = { symbol: s, planID: this.planId };
      const market = this.symbolMarketMap.get(s);
      if (market) {
        payload.market = market;
      }
      socket.emit(event, payload);
      subs.delete(s);
    });
  }

  private getSocketGroup(marketType: MarketType | string | number): 'BAPI_CRYPTO' | 'HUB_MT5' {
    const mtNum = Number(marketType);
    const mtStr = String(marketType).toUpperCase().trim();
    if (mtNum === MarketType.CRYPTO || mtNum === 1 || mtStr === 'CRYPTO' || mtStr === '1' || mtStr === 'BINANCE') {
      return 'BAPI_CRYPTO';
    }
    if (SOCKET_GROUPS.BAPI_CRYPTO.includes(mtNum as MarketType)) return 'BAPI_CRYPTO';
    return 'HUB_MT5';
  }

  // ── Public API ───────────────────────────────────────────────

  updateMiniTickerSubscriptions(currentSymbols: string[], marketType: MarketType = MarketType.CRYPTO, ownerId: string): void {
    this.miniTickerOwnerSubs.get(marketType)!.set(ownerId, new Set(currentSymbols));
    // Guarantee at least one tick for UI: replay cached ticks immediately (if we have them)
    this.replayLastTicks('mini', currentSymbols, marketType);
    this.syncSocketSubscriptions(marketType);
  }

  /**
   * Batch update mini-ticker subscriptions for multiple market types at once.
   * Use this instead of calling updateMiniTickerSubscriptions 9 times — avoids
   * intermediate inconsistent states that can cause spurious unsubscribes.
   */
  updateMiniTickerSubscriptionsBatch(
    symbolsByType: Map<MarketType, string[]>,
    ownerId: string
  ): void {
    const allTypes = [...SOCKET_GROUPS.BAPI_CRYPTO, ...SOCKET_GROUPS.HUB_MT5];

    // 1. Update ALL owner maps first (no sync yet)
    for (const mt of allTypes) {
      const symbols = symbolsByType.get(mt) || [];
      this.miniTickerOwnerSubs.get(mt)!.set(ownerId, new Set(symbols));
      this.replayLastTicks('mini', symbols, mt);
    }

    // 2. Sync each socket group ONCE — not per market type
    this.syncSocketSubscriptions(SOCKET_GROUPS.BAPI_CRYPTO[0]); // CRYPTO → BAPI
    this.syncSocketSubscriptions(SOCKET_GROUPS.HUB_MT5[0]);     // FOREX  → HUB (representative)
  }

  updateSingleTickerSubscriptions(currentSymbols: string[], marketType: MarketType = MarketType.CRYPTO, ownerId: string): void {
    this.singleTickerOwnerSubs.get(marketType)!.set(ownerId, new Set(currentSymbols));
    this.replayLastTicks('single', currentSymbols, marketType);
    this.syncSocketSubscriptions(marketType);
  }

  onMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.miniTickerHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.miniTickerHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // Keep these for backward compatibility if needed, but they now use the unified system
  emitSubscribeSingleTicker(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    this.updateSingleTickerSubscriptions([symbol], marketType, 'legacy-single-' + symbol);
  }

  emitUnsubscribeSingleTicker(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    this.updateSingleTickerSubscriptions([], marketType, 'legacy-single-' + symbol);
  }

  emitSubscribeMiniTicker(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    this.updateMiniTickerSubscriptions([symbol], marketType, 'legacy-mini-' + symbol);
  }

  emitUnsubscribeMiniTicker(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    this.updateMiniTickerSubscriptions([], marketType, 'legacy-mini-' + symbol);
  }

  onSingleTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.singleTickerHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offSingleTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.singleTickerHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // ── kline ─────────────────────────────────────────────────────
  emitSubscribeKline(payload: { symbol: string; interval: string, market?: string }, marketType: MarketType = MarketType.CRYPTO): void {
    const socket = this.socketFor(marketType);
    const prev = this.klineSubs.get(marketType);
    if (prev && (prev.symbol !== payload.symbol || prev.interval !== payload.interval)) {
      socket.emit('unsubscribeKline', prev);
    }
    socket.emit('subscribeKline', payload);
    this.klineSubs.set(marketType, payload);
  }

  emitUnsubscribeKline(payload: { symbol: string; interval: string, market?: string }, marketType: MarketType = MarketType.CRYPTO): void {
    const socket = this.socketFor(marketType);
    socket.emit('unsubscribeKline', payload);
    const cur = this.klineSubs.get(marketType);
    if (cur?.symbol === payload.symbol && cur?.interval === payload.interval) {
      this.klineSubs.set(marketType, null);
    }
  }

  onKline(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.klineHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offKline(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.klineHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // ── combined ──────────────────────────────────────────────────
  emitSubscribeCombined(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    const socket = this.socketFor(marketType);
    const prev = this.combinedSubs.get(marketType);
    if (prev && prev !== symbol) socket.emit('unsubscribeCombined', prev);
    socket.emit('subscribeCombined', symbol);
    this.combinedSubs.set(marketType, symbol);
  }

  emitUnsubscribeCombined(symbol: string, marketType: MarketType = MarketType.CRYPTO): void {
    const socket = this.socketFor(marketType);
    socket.emit('unsubscribeCombined', symbol);
    if (this.combinedSubs.get(marketType) === symbol) this.combinedSubs.set(marketType, null);
  }

  onCombined(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.combinedHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offCombined(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.combinedHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // ── allTicker ─────────────────────────────────────────────────
  emitSubscribeTicker(marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('subscribeTiker');
  }

  emitUnsubscribeTicker(marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('unsubscribeTiker');
  }

  onAllTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.allTickerHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offAllTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.allTickerHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // ── allMiniTicker ─────────────────────────────────────────────
  emitSubscribeAllMiniTicker(marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('subscribeAllMiniTicker');
  }

  emitUnsubscribeAllMiniTicker(marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('unsubscribeAllMiniTicker');
  }

  onAllMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).on('allMiniTicker', handler);
  }

  offAllMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).off('allMiniTicker', handler);
  }

  // ── marketMiniTicker ──────────────────────────────────────────
  emitSubscribeMarketType(typeId: number, marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('subscribeMarketType', typeId);
  }

  emitUnsubscribeMarketType(typeId: number, marketType: MarketType = MarketType.CRYPTO): void {
    this.socketFor(marketType).emit('unsubscribeMarketType', typeId);
  }

  onMarketMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.marketMiniTickerHandlers.get(marketType)!;
    if (!list.includes(handler)) list.push(handler);
  }

  offMarketMiniTicker(handler: (d: any) => void, marketType: MarketType = MarketType.CRYPTO): void {
    const list = this.marketMiniTickerHandlers.get(marketType)!;
    const i = list.indexOf(handler);
    if (i > -1) list.splice(i, 1);
  }

  // ── unsubscribeAll ────────────────────────────────────────────
  unsubscribeAll(marketType: MarketType = MarketType.CRYPTO): void {
    const group = this.getSocketGroup(marketType);
    const socket = this.socketFor(marketType);

    // 1. Clean up kline/combined for THIS specific marketType
    const kl = this.klineSubs.get(marketType);
    if (kl) { socket.emit('unsubscribeKline', kl); this.klineSubs.set(marketType, null); }

    const cb = this.combinedSubs.get(marketType);
    if (cb) { socket.emit('unsubscribeCombined', cb); this.combinedSubs.set(marketType, null); }

    // 2. Clear ONLY this marketType's owners
    this.miniTickerOwnerSubs.get(marketType)?.clear();
    this.singleTickerOwnerSubs.get(marketType)?.clear();

    // 3. Sync the socket subscriptions (it will check other owners in the group)
    this.syncSocketSubscriptions(marketType);
  }

  // ── disconnect / reconnect ────────────────────────────────────
  disconnectForLogout(): void {
    this.stopStaleWatchdog();
    this.tearDownSocket(this.bapiSocket);
    this.tearDownSocket(this.hubSocket);
    this.setAllConnectionStatus(false);
    this.miniTickerCacheByNormSymbol.clear();
    this.singleTickerCacheByNormSymbol.clear();
    this.lastTickAtByNormSymbol.clear();
    this.marketStatusSubject.next(new Map());
    this.socketSubs.set('BAPI_CRYPTO', new Set());
    this.socketSubs.set('HUB_MT5', new Set());
  }

  disconnectAll(): void {
    this.disconnectForLogout();
  }

  reconnectAfterLogin(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    this.tearDownSocket(this.bapiSocket);
    this.tearDownSocket(this.hubSocket);
    this.bapiSocket = this.createSocket('BAPI_CRYPTO');
    this.hubSocket = this.createSocket('HUB_MT5');
    this.startStaleWatchdog();
  }

  reconnect(marketType: MarketType = MarketType.CRYPTO): void {
    const socket = this.socketFor(marketType);
    socket.disconnect();
    socket.connect();
  }

  getConnectionStatus(): Map<MarketType, boolean> {
    return new Map(this.connectionStatusSubject.value);
  }

  testConnection(marketType: MarketType = MarketType.CRYPTO): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = this.socketFor(marketType);
      if (socket.connected) {
        resolve(true);
        return;
      }
      const t = setTimeout(() => resolve(false), 5000);
      socket.once('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }
}

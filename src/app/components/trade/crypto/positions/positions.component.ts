import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, Input, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { combineLatest, filter, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, switchMap } from 'rxjs/operators';
import { BinanceSocketService } from '../../../../services/binance-socket.service';
import { PlayerService, PositionHistory } from '../../../../services/player.service';
import { PositionsService } from '../../../../services/positions.service';
import { Position, TradingSocketService } from '../../../../services/trading-socket.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { MARKET_MT_TY, MarketType } from '../../../../shared/services/market.constants';
import { BrandConfig, ExchangeRate, SharedService } from '../../../../shared/services/shared.service';
import {
  POSITIONS_TABLE_COLUMNS,
  PositionsColDef,
  PositionsTableKey,
  PROTECTED_COLUMN_IDS
} from './positions-table-columns';

import { BrandCurrencyPipe } from '../../../../shared/pipes/brand-currency.pipe';

@Component({
  selector: 'app-positions',
  standalone: true,
  imports: [CommonModule, FormsModule, BrandCurrencyPipe],
  templateUrl: './positions.component.html',
  styleUrls: ['./positions.component.scss']
})

export class PositionsComponent implements OnInit, OnDestroy {
  @Input() isInsideTradePage: boolean = false;
  @Input() isDesktopTradeLayout = false;
  positions: Position[] = [];
  positionHistory: PositionHistory[] = [];
  pendingOrders: any[] = [];

  activeTab: 'positions' | 'pending' | 'history' = 'positions';

  // Live prices for pending orders (symbol → {bid, ask})
  private pendingPrices: Map<string, { bid: number; ask: number }> = new Map();

  loading = true;

  private readonly historyRefresh$ = new Subject<void>();

  balance = 0;
  equity = 0;
  margin = 0;
  freeMargin = 0;
  marginLevel = 0;

  /** Sum of open positions P/L in brand currency (same basis as equity unrealized) */
  openPositionsTotalPnl = 0;

  closingAllPositions = false;

  // ── Resizable / hideable columns (desktop trade tables only) ───
  showColumnPicker = false;
  private readonly columnWidths: Record<PositionsTableKey, Record<string, number>> = {
    open: this.loadColumnWidths('open'),
    pending: this.loadColumnWidths('pending'),
    history: this.loadColumnWidths('history')
  };
  private readonly columnVisibility: Record<PositionsTableKey, Record<string, boolean>> = {
    open: this.loadColumnVisibility('open'),
    pending: this.loadColumnVisibility('pending'),
    history: this.loadColumnVisibility('history')
  };

  private resizing: {
    table: PositionsTableKey;
    colId: string;
    neighborId: string;
    startX: number;
    startW: number;
    neighborStartW: number;
  } | null = null;

  get activeTableKey(): PositionsTableKey {
    if (this.activeTab === 'pending') return 'pending';
    if (this.activeTab === 'history') return 'history';
    return 'open';
  }

  getTableColumns(table: PositionsTableKey): PositionsColDef[] {
    return POSITIONS_TABLE_COLUMNS[table];
  }

  getVisibleColumns(table: PositionsTableKey): PositionsColDef[] {
    return this.getTableColumns(table).filter(c => this.colV(table, c.id));
  }

  /** Shorthand for template visibility checks */
  colV(table: PositionsTableKey, colId: string): boolean {
    return this.columnVisibility[table]?.[colId] !== false;
  }

  isColProtected(colId: string): boolean {
    return PROTECTED_COLUMN_IDS.has(colId);
  }

  toggleColumnPicker(ev: Event): void {
    ev.stopPropagation();
    this.showColumnPicker = !this.showColumnPicker;
  }

  closeColumnPicker(): void {
    this.showColumnPicker = false;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showColumnPicker = false;
  }

  toggleColumnVisibility(table: PositionsTableKey, colId: string, ev: Event): void {
    ev.stopPropagation();
    if (this.isColProtected(colId)) return;
    const input = ev.target as HTMLInputElement | null;
    const next = input?.checked ?? !this.colV(table, colId);
    this.columnVisibility[table][colId] = next;
    this.saveColumnVisibility(table);
    this.cdr.markForCheck();
  }

  hideColumn(table: PositionsTableKey, colId: string, ev: Event): void {
    ev.stopPropagation();
    if (this.isColProtected(colId)) return;
    this.columnVisibility[table][colId] = false;
    this.saveColumnVisibility(table);
    this.cdr.markForCheck();
  }

  startResize(ev: PointerEvent, table: PositionsTableKey): void {
    if (!this.isDesktopTradeLayout) return;
    if (ev.pointerType && ev.pointerType !== 'mouse') return;

    const th = (ev.target as HTMLElement | null)?.closest('th') as HTMLTableCellElement | null;
    if (!th) return;

    const colId = th.getAttribute('data-col-id');
    if (!colId || !this.colV(table, colId)) return;

    const visibleIds = this.getVisibleColumns(table).map(c => c.id);
    const idx = visibleIds.indexOf(colId);
    if (idx < 0) return;

    let neighborId = visibleIds[idx + 1] ?? visibleIds[idx - 1];
    if (neighborId === colId) return;

    const map = this.columnWidths[table];
    const startW = map[colId] ?? 100;
    const neighborStartW = map[neighborId] ?? 100;

    ev.preventDefault();
    ev.stopPropagation();

    this.resizing = { table, colId, neighborId, startX: ev.clientX, startW, neighborStartW };
    document.body.classList.add('positions-col-resizing');

    window.addEventListener('pointermove', this.onResizeMove, { passive: false });
    window.addEventListener('pointerup', this.onResizeUp, { passive: true });
  }

  private onResizeMove = (ev: PointerEvent): void => {
    if (!this.resizing) return;
    ev.preventDefault();

    const { table, colId, neighborId, startX, startW, neighborStartW } = this.resizing;
    const map = this.columnWidths[table];
    const dx = ev.clientX - startX;
    const min = 60;
    const max = 520;

    let nextW = Math.round(startW + dx);
    let nextNeighbor = Math.round(neighborStartW - dx);

    if (nextW < min) {
      nextNeighbor -= min - nextW;
      nextW = min;
    } else if (nextW > max) {
      nextNeighbor -= max - nextW;
      nextW = max;
    }
    if (nextNeighbor < min) {
      nextW -= min - nextNeighbor;
      nextNeighbor = min;
    } else if (nextNeighbor > max) {
      nextW -= max - nextNeighbor;
      nextNeighbor = max;
    }

    map[colId] = Math.max(min, Math.min(max, nextW));
    map[neighborId] = Math.max(min, Math.min(max, nextNeighbor));
    this.cdr.markForCheck();
  };

  private onResizeUp = (): void => {
    if (!this.resizing) return;
    const { table } = this.resizing;
    this.saveColumnWidths(table);
    this.resizing = null;
    document.body.classList.remove('positions-col-resizing');
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeUp);
  };

  getTableColStyle(table: PositionsTableKey): Record<string, string> {
    const visible = this.getVisibleColumns(table);
    const map = this.columnWidths[table];
    const weights = visible.map(c => Math.max(60, map[c.id] ?? c.defaultWidth));
    const total = weights.reduce((s, w) => s + w, 0) || 1;
    const style: Record<string, string> = { width: '100%', tableLayout: 'fixed' };
    weights.forEach((w, i) => {
      style[`--pt-col-${i}`] = `${(w / total) * 100}%`;
    });
    return style;
  }

  private loadColumnWidths(table: PositionsTableKey): Record<string, number> {
    const defs = POSITIONS_TABLE_COLUMNS[table];
    const out: Record<string, number> = {};
    for (const d of defs) {
      out[d.id] = d.defaultWidth;
    }
    try {
      const raw = localStorage.getItem(`positionsTableColWidths:v3:${table}`);
      if (!raw) return out;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const d of defs) {
          const v = Number((parsed as Record<string, number>)[d.id]);
          if (Number.isFinite(v) && v >= 60) out[d.id] = v;
        }
      }
    } catch { /* noop */ }
    return out;
  }

  private saveColumnWidths(table: PositionsTableKey): void {
    try {
      localStorage.setItem(`positionsTableColWidths:v3:${table}`, JSON.stringify(this.columnWidths[table]));
    } catch { /* noop */ }
  }

  private loadColumnVisibility(table: PositionsTableKey): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const d of POSITIONS_TABLE_COLUMNS[table]) {
      out[d.id] = true;
    }
    try {
      const raw = localStorage.getItem(`positionsTableColVisibility:v1:${table}`);
      if (!raw) return out;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const d of POSITIONS_TABLE_COLUMNS[table]) {
          if (d.protected || PROTECTED_COLUMN_IDS.has(d.id)) {
            out[d.id] = true;
            continue;
          }
          const v = (parsed as Record<string, boolean>)[d.id];
          out[d.id] = v !== false;
        }
      }
    } catch { /* noop */ }
    return out;
  }

  private saveColumnVisibility(table: PositionsTableKey): void {
    try {
      localStorage.setItem(`positionsTableColVisibility:v1:${table}`, JSON.stringify(this.columnVisibility[table]));
    } catch { /* noop */ }
  }

  getHistoryOpenedAt(row: any): string {
    return String(row?.opened_at || row?.openedAt || row?.open_time || '');
  }

  getHistoryClosedAt(row: any): string {
    return String(row?.closed_at || row?.closedAt || row?.close_time || '');
  }

  editingPositionId: number | null = null;
  editingField: 'sl' | 'tp' | null = null;
  editingValue: string = '';

  // Pending order edit state
  editingOrderId: number | null = null;

  // Position detail offcanvas (for /orders page MT5 style)
  selectedPositionDetail: any = null;
  showPositionOffcanvas = false;
  positionOffcanvasClosing = false;

  openPositionDetail(position: any): void {
    this.closeAllOffcanvas();
    this.selectedPositionDetail = position;
    this.showPositionOffcanvas = true;
    this.positionOffcanvasClosing = false;
    document.body.style.overflow = 'hidden';
  }

  closePositionOffcanvas(): void {
    this.positionOffcanvasClosing = true;
    setTimeout(() => {
      this.showPositionOffcanvas = false;
      this.positionOffcanvasClosing = false;
      this.selectedPositionDetail = null;
      document.body.style.overflow = '';
    }, 320);
  }

  closePositionFromOffcanvas(): void {
    if (!this.selectedPositionDetail) return;
    this.closePosition(this.selectedPositionDetail);
    this.closePositionOffcanvas();
  }

  // Pending order detail offcanvas
  selectedOrderDetail: any = null;
  showOrderOffcanvas = false;
  orderOffcanvasClosing = false;

  openOrderDetail(order: any): void {
    this.closeAllOffcanvas();
    this.selectedOrderDetail = order;
    this.showOrderOffcanvas = true;
    this.orderOffcanvasClosing = false;
    document.body.style.overflow = 'hidden';
  }

  closeOrderOffcanvas(): void {
    this.orderOffcanvasClosing = true;
    setTimeout(() => {
      this.showOrderOffcanvas = false;
      this.orderOffcanvasClosing = false;
      this.selectedOrderDetail = null;
      document.body.style.overflow = '';
      this.cancelEditOrder();
    }, 320);
  }

  cancelOrderFromOffcanvas(): void {
    if (!this.selectedOrderDetail) return;
    this.cancelPendingOrder(this.selectedOrderDetail);
    this.closeOrderOffcanvas();
  }

  // History detail offcanvas
  selectedHistoryDetail: any = null;
  showHistoryOffcanvas = false;
  historyOffcanvasClosing = false;

  openHistoryDetail(h: any): void {
    this.closeAllOffcanvas();
    this.selectedHistoryDetail = h;
    this.showHistoryOffcanvas = true;
    this.historyOffcanvasClosing = false;
    document.body.style.overflow = 'hidden';
  }

  closeHistoryOffcanvas(): void {
    this.historyOffcanvasClosing = true;
    setTimeout(() => {
      this.showHistoryOffcanvas = false;
      this.historyOffcanvasClosing = false;
      this.selectedHistoryDetail = null;
      document.body.style.overflow = '';
    }, 320);
  }

  private closeAllOffcanvas(): void {
    this.showPositionOffcanvas = false;
    this.showOrderOffcanvas = false;
    this.showHistoryOffcanvas = false;
    this.positionOffcanvasClosing = false;
    this.orderOffcanvasClosing = false;
    this.historyOffcanvasClosing = false;
    this.selectedPositionDetail = null;
    this.selectedOrderDetail = null;
    this.selectedHistoryDetail = null;
  }
  editingOrderField: 'stop_price' | 'limit_price' | 'expiration' | 'stop_loss' | 'take_profit' | null = null;
  editingOrderValue: string = '';
  editingOrderExpirationDate: string = ''; // for Specified / Specified Day
  readonly EXPIRATION_TYPES = ['GTC', 'Today', 'Tomorrow', 'Custom Date', 'Custom DateTime'];

  // Real-time validation error for current editing input
  get editingError(): string | null {
    if (!this.editingPositionId || !this.editingField) return null;
    const pos = this.positions.find(p => p.position_id === this.editingPositionId);
    if (!pos) return null;
    const val = parseFloat(this.editingValue);
    if (!val || val <= 0) return null;
    const ref = pos.entry_price; // validate against entry price
    const isBuy = pos.type === 1;

    if (this.editingField === 'sl') {
      if (isBuy && val >= ref) return `BUY SL must be below entry (${ref.toFixed(2)})`;
      if (!isBuy && val <= ref) return `SELL SL must be above entry (${ref.toFixed(2)})`;
    }
    if (this.editingField === 'tp') {
      if (isBuy && val <= ref) return `BUY TP must be above entry (${ref.toFixed(2)})`;
      if (!isBuy && val >= ref) return `SELL TP must be below entry (${ref.toFixed(2)})`;
    }
    return null;
  }

  // Filter properties
  showFilterOffcanvas = false;
  filters = {
    symbol: '',
    startDate: '',
    endDate: '',
    pnl: 'all',
    type: 'all'
  };
  availableSymbols: string[] = [];
  filteredPositionHistory: PositionHistory[] = [];

  // Computed properties for header stats
  get totalPositions(): number {
    return this.positions.length;
  }

  get totalPnL(): number {
    return this.positions.reduce((sum, pos) => sum + this.getConvertedPnl(pos), 0);
  }

  get profitablePositions(): number {
    return this.positions.filter(pos => (pos.unrealized_pl || pos.profit_loss || 0) > 0).length;
  }

  get losingPositions(): number {
    return this.positions.filter(pos => (pos.unrealized_pl || pos.profit_loss || 0) < 0).length;
  }

  get winRate(): number {
    if (this.totalPositions === 0) return 0;
    return Math.round((this.profitablePositions / this.totalPositions) * 100);
  }

  get pnlClass(): string {
    if (this.totalPnL > 0) return 'positive';
    if (this.totalPnL < 0) return 'negative';
    return 'neutral';
  }

  private positionsSubscription: Subscription;
  private positionClosedSubscription: Subscription;
  private orderExecutedSubscription: Subscription;
  private orderExpiredSubscription: Subscription;
  private pendingOrdersSubscription: Subscription;

  private miniTickerHandlers: Map<MarketType, ((data: any) => void)> = new Map();

  private positionMarketTypes: Map<string, MarketType> = new Map();

  private activeMarketTypes: Set<MarketType> = new Set();

  private subscribedSymbolsByMarketType: Map<MarketType, Set<string>> = new Map();

  // Store bid/ask prices for each position
  private positionPrices: Map<string, { bid: number; ask: number }> = new Map();

  // Brand currency and exchange rates
  private brandConfig: BrandConfig | null = null;
  private exchangeRates: ExchangeRate[] = [];
  private subscriptions = new Subscription();

  // Stop level configuration (minimum distance from current price for SL/TP)
  private readonly STOP_LEVEL_CONFIG: Record<string, number> = {
    'CRYPTO': 10,      // 10 points minimum
    'FOREX': 5,        // 5 pips minimum
    'METAL': 50,       // 50 points minimum for XAUUSD, XAGUSD
    'INDEX': 10,       // 10 points minimum
    'STOCK': 0.1       // 0.1 minimum for stocks
  };

  private getStopLevel(marketType: MarketType): number {
    const typeName = MARKET_MT_TY[marketType];
    return this.STOP_LEVEL_CONFIG[typeName] || 10;
  }

  private getTickSize(market: string): number {
    const upperMarket = market.toUpperCase();
    if (upperMarket.includes('XAU') || upperMarket.includes('XAG')) {
      return 0.01;
    }
    if (upperMarket.includes('USDT') || upperMarket.includes('BUSD')) {
      return 0.01;
    }
    if (/^[A-Z]{6}$/.test(upperMarket)) {
      return 0.0001;
    }
    return 0.01;
  }

  private validateStopLossTakeProfit(
    positionType: number, // 1 = BUY, 2 = SELL
    currentPrice: number,
    stopLoss: number | undefined,
    takeProfit: number | undefined,
    market: string,
    entryPrice?: number  // validate against entry price, not current
  ): { valid: boolean; error?: string } {
    // Use entry price for SL/TP rules — direction is fixed at entry
    const refPrice = (entryPrice && entryPrice > 0) ? entryPrice : currentPrice;

    if (stopLoss !== undefined && stopLoss > 0) {
      if (positionType === 1) {
        if (stopLoss >= refPrice) return { valid: false, error: `BUY Stop Loss must be below entry price (${refPrice.toFixed(2)})` };
      } else {
        if (stopLoss <= refPrice) return { valid: false, error: `SELL Stop Loss must be above entry price (${refPrice.toFixed(2)})` };
      }
    }

    if (takeProfit !== undefined && takeProfit > 0) {
      if (positionType === 1) {
        if (takeProfit <= refPrice) return { valid: false, error: `BUY Take Profit must be above entry price (${refPrice.toFixed(2)})` };
      } else {
        if (takeProfit >= refPrice) return { valid: false, error: `SELL Take Profit must be below entry price (${refPrice.toFixed(2)})` };
      }
    }

    return { valid: true };
  }

  constructor(
    private tradingSocket: TradingSocketService,
    private binanceSocket: BinanceSocketService,
    private authService: AuthService,
    private positionsService: PositionsService,
    public sharedService: SharedService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {

    this.balance = this.authService.currentBalance || 0;

    this.positionsSubscription = this.tradingSocket.positions$.subscribe(positions => {
      this.positions = positions;
      this.loading = false;
      this.recalculateSummary();
      this.updatePositionMarketTypes();
      this.updateMiniTickerSubscriptions();
      this.updateTickerSubscriptions();
      // positions$ can emit multiple times on init/refresh; debounce history refresh to a single API call
      this.requestHistoryRefresh();
    });

    this.subscriptions.add(
      this.historyRefresh$.pipe(debounceTime(250),
        switchMap(() =>
          this.playerService.getPositionsHistory().pipe(
            catchError(() => of({ code: 1, data: [] } as any))
          )
        )
      ).subscribe((res: any) => {
        if (res?.code === 0 && Array.isArray(res?.data)) {
          this.positionHistory = res.data.map((item: any) => ({
            position_id: Number(item.position_id || 0),
            player_id: Number(item.player_id || 0),
            market: item.symbol || item.market || '',
            position_type_id: Number(item.position_type_id || 0),
            quantity: Number(item.quantity || 0),
            entry_price: Number(item.entry_price || 0),
            exit_price: Number(item.exit_price || 0),
            leverage_used: Number(item.leverage_used || 0),
            margin_used: Number(item.margin_used || 0),
            realized_pl: Number(item.profit || item.realized_pl || 0),
            close_reason: item.close_reason || '',
            opened_at: item.opened_at || '',
            closed_at: item.closed_at || ''
          }));
        } else {
          this.positionHistory = [];
        }
      })
    );

    // Setup mini-ticker handlers
    this.setupMiniTickerHandlers();

    // Listen for server-pushed close events (SL/TP/Liquidation)
    this.positionClosedSubscription = this.tradingSocket.positionClosed$.subscribe((data: any) => {
      if (!data?.success) return;

      const reason = data?.close_reason || 'CLOSED';
      const realizedPl: number = Number(data?.realized_pl ?? 0);
      const netPl: number = Number(data?.net_pl ?? realizedPl);
      const brokerage: number = Number(data?.brokerage ?? 0);
      const positionId = data?.position_id ?? '';

      const reasonLabels: Record<string, string> = {
        STOP_LOSS: 'Stop Loss Hit',
        TAKE_PROFIT: 'Take Profit Hit',
        LIQUIDATION: 'Liquidated',
        CASCADING_LIQUIDATION: 'Cascading Liquidation',
        MANUAL: 'Closed Manually',
      };
      const reasonLabel = reasonLabels[reason] || reason;

      const plSign = netPl >= 0 ? '+' : '';
      const plStr = `${plSign}${netPl.toFixed(2)}`;
      const brokerageStr = brokerage > 0 ? ` | Brokerage: ${brokerage.toFixed(2)}` : '';

      // Toast type: green for TP/profit, red for SL/liquidation
      const toastType = reason === 'TAKE_PROFIT' ? 1
        : (reason === 'STOP_LOSS' || reason.includes('LIQUIDATION')) ? 3
          : netPl >= 0 ? 1 : 2;

      const msg = `#${positionId} — ${reasonLabel} | P/L: ${plStr}${brokerageStr}`;
      this.sharedService.showAlert(toastType, msg);
    });

    // order_executed — pending order triggered, new position opened
    this.orderExecutedSubscription = this.tradingSocket.orderExecuted$.subscribe((data: any) => {
      const symbol = data?.symbol || data?.market || '';
      const side = data?.position_type_id === 1 ? 'BUY' : 'SELL';
      const price = data?.entry_price ?? data?.current_price ?? '';
      const priceStr = price ? ` @ ${Number(price).toFixed(2)}` : '';
      this.sharedService.showAlert(1, `Order Executed: ${side} ${symbol}${priceStr}`);
    });

    // order_expired — pending order expired
    this.orderExpiredSubscription = this.tradingSocket.orderExpired$.subscribe((data: any) => {
      const symbol = data?.symbol || data?.market || '';
      const msg = symbol ? `Order expired: ${symbol}` : 'A pending order has expired';
      this.sharedService.showAlert(2, msg);
    });

    // pending orders list
    this.pendingOrdersSubscription = this.tradingSocket.pendingOrders$.subscribe(orders => {
      this.pendingOrders = orders || [];
      this.updatePendingSubscriptions();
      this._updateCountdowns(); // immediate update
      if (this.pendingOrders.length > 0) {
        this._startCountdownTimer();
      } else {
        this._stopCountdownTimer();
      }
      this.cdr.markForCheck();
    });

    this.subscriptions.add(
      this.authService.balance$.subscribe(balance => {
        this.balance = Number(balance) || 0;
        this.recalculateSummary();
        this.cdr.markForCheck();
      })
    );

    const brandConfig$ = this.sharedService.brandConfig$.pipe(filter(config => !!config));
    const exchangeRates$ = this.sharedService.exchangeRates$.pipe(filter(rates => rates.length > 0));

    this.subscriptions.add(
      combineLatest([brandConfig$, exchangeRates$]).subscribe(([config, rates]) => {
        this.brandConfig = config;
        this.exchangeRates = rates;
        this.cdr.markForCheck(); // Trigger change detection as this can happen asynchronously
      })
    );

  }

  private updatePositionMarketTypes(): void {
    this.positionMarketTypes.clear();
    this.activeMarketTypes.clear();

    for (const position of this.positions) {
      const marketType = this.getMarketTypeFromSymbol(position.market);
      this.positionMarketTypes.set(position.market, marketType);
      this.activeMarketTypes.add(marketType);
    }
  }

  private getMarketTypeFromSymbol(symbol: string): MarketType {
    const upperSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Try allMarketsCache — check market_type first, then exchange
    if (this.sharedService.allMarketsCache?.length) {
      const found = this.sharedService.allMarketsCache.find(m =>
        m.market.toUpperCase().replace(/[^A-Z0-9]/g, '') === upperSymbol
      );
      if (found) {
        if (found.market_type_id === 1 || Number(found.market_type_id) === 1 || (found.path || '').toUpperCase().startsWith('CRYPTO')) {
          return MarketType.CRYPTO;
        }
        // market_type is most reliable
        const mt = (found.market_type || '').toUpperCase();
        if (mt === 'CRYPTO') return MarketType.CRYPTO;
        if (mt === 'FOREX') return MarketType.FOREX;
        if (mt === 'COMMODITY') return MarketType.COMMODITY;
        if (mt === 'METAL') return MarketType.METAL;
        if (mt === 'STOCK') return MarketType.STOCK;
        if (mt === 'INDEX') return MarketType.INDEX;
        if (mt === 'ETFS') return MarketType.ETFS;
        if (mt === 'FORWARDS') return MarketType.FORWARDS;
        if (mt === 'MCX') return MarketType.MCX;

        // exchange fallback
        const ex = (found.exchange || '').toUpperCase();
        if (ex === 'BINANCE' || ex === 'CRYPTO') return MarketType.CRYPTO;
        // MT = MT5 broker → HUB socket → default COMMODITY for unknown MT5 symbols
        if (ex === 'MT' || ex === 'MT5') return MarketType.COMMODITY;
        if (ex === 'FOREX') return MarketType.FOREX;
        if (ex === 'METAL') return MarketType.METAL;
        if (ex === 'COMMODITY') return MarketType.COMMODITY;
        if (ex === 'STOCK') return MarketType.STOCK;
        if (ex === 'INDEX') return MarketType.INDEX;
        if (ex === 'ETFS') return MarketType.ETFS;
        if (ex === 'FORWARDS') return MarketType.FORWARDS;
        if (ex === 'MCX') return MarketType.MCX;
      }
    }

    // Pattern fallback — only CRYPTO patterns are reliable
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(upperSymbol)) {
      return MarketType.CRYPTO;
    }
    if (/^[A-Z]{6}$/.test(upperSymbol)) return MarketType.FOREX;
    if (upperSymbol.startsWith('XAU') || upperSymbol.startsWith('XAG')) return MarketType.METAL;

    // Default → COMMODITY (MT5/HUB) — safer than CRYPTO for unknown symbols
    return MarketType.COMMODITY;
  }

  private setupMiniTickerHandlers(): void {
    // Register mini-ticker handler for each possible market type
    const allTypes = [
      MarketType.CRYPTO, MarketType.FOREX, MarketType.COMMODITY,
      MarketType.STOCK, MarketType.INDEX, MarketType.METAL, MarketType.ETFS, MarketType.FORWARDS, MarketType.MCX
    ];

    for (const mt of allTypes) {
      if (!this.miniTickerHandlers.has(mt)) {
        const handler = (data: any) => this.handleMiniTickerUpdate(data);
        this.miniTickerHandlers.set(mt, handler);
        this.binanceSocket.onMiniTicker(handler, mt);
      }
    }
  }

  private updateTickerSubscriptions(): void {
    // Just ensure handlers are set up
    this.setupMiniTickerHandlers();
  }

  private updateMiniTickerSubscriptions(): void {
    // Group symbols per marketType
    const symbolsByType = new Map<MarketType, string[]>();
    for (const pos of this.positions || []) {
      const symbol = String(pos.market || '');
      if (!symbol) continue;
      const marketType = this.getMarketTypeFromSymbol(symbol);
      const list = symbolsByType.get(marketType) || [];
      list.push(symbol);
      symbolsByType.set(marketType, list);
    }

    // Single batched call — avoids 9 separate syncSocketSubscriptions calls
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(symbolsByType, 'positions');

    // Track what we subscribed for cleanup
    this.subscribedSymbolsByMarketType.clear();
    for (const [mt, syms] of symbolsByType) {
      if (syms.length > 0) this.subscribedSymbolsByMarketType.set(mt, new Set(syms));
    }
  }

  ngOnInit() {
    const playerId = sessionStorage.getItem('player_id') || '';

    if (playerId) {
      this.tradingSocket.setPlayerId(playerId);
    }

    this.tradingSocket.fetchPendingOrders();
  }

  private requestHistoryRefresh(): void {
    this.historyRefresh$.next();
  }

  setActiveTab(tab: 'positions' | 'pending' | 'history'): void {
    this.activeTab = tab;
    if (tab === 'pending') {
      this.tradingSocket.fetchPendingOrders();
    }
    if (tab === 'history' && (!this.positionHistory || this.positionHistory.length === 0)) {
      this.requestHistoryRefresh();
    }
    this.cdr.markForCheck();
  }

  getSideLabel(positionTypeId: number): string {
    return positionTypeId === 1 ? 'BUY' : 'SELL';
  }

  getSideClass(positionTypeId: number): string {
    return positionTypeId === 1 ? 'buy' : 'sell';
  }

  /** Open position leverage from socket (`leverage` key). */
  formatPositionLeverage(position: { leverage?: number } | null | undefined): string {
    const n = Number(position?.leverage);
    if (!Number.isFinite(n) || n <= 0) {
      return '—';
    }
    return Number.isInteger(n) ? `${n}x` : `${n.toFixed(2)}x`;
  }

  formatSocketUsedMargin(row: unknown): string {
    const r = row as Record<string, unknown>;
    const raw = r['used_margin'] ?? r['usedMargin'];
    if (raw == null || raw === '') {
      return '—';
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return '—';
    }
    return this.sharedService.formatToBrandCurrency(n);
  }

  socketHasUsedMargin(row: unknown): boolean {
    const r = row as Record<string, unknown>;
    const raw = r['used_margin'] ?? r['usedMargin'];
    if (raw == null || raw === '') {
      return false;
    }
    return Number.isFinite(Number(raw));
  }

  getHistoryPlClass(h: PositionHistory): string {
    const pl = Number(h?.realized_pl || 0);
    if (pl > 0) return 'profit';
    if (pl < 0) return 'loss';
    return '';
  }

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeUp);
    document.body.classList.remove('positions-col-resizing');

    if (this.positionsSubscription) {
      this.positionsSubscription.unsubscribe();
    }
    if (this.positionClosedSubscription) {
      this.positionClosedSubscription.unsubscribe();
    }
    if (this.orderExecutedSubscription) {
      this.orderExecutedSubscription.unsubscribe();
    }
    if (this.orderExpiredSubscription) {
      this.orderExpiredSubscription.unsubscribe();
    }
    if (this.pendingOrdersSubscription) {
      this.pendingOrdersSubscription.unsubscribe();
    }
    this._stopCountdownTimer();
    this.subscriptions.unsubscribe();

    // Clean up mini-ticker handlers
    for (const [marketType, handler] of this.miniTickerHandlers) {
      this.binanceSocket.offMiniTicker(handler, marketType);
    }
    this.miniTickerHandlers.clear();

    // Unsubscribe all mini-tickers we subscribed for positions + pending
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(new Map(), 'positions');
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(new Map(), 'pending');
    this.subscribedSymbolsByMarketType.clear();
  }

  getTypeLabel(type: number): string {
    return type === 1 ? 'BUY' : 'SELL';
  }

  getTypeClass(type: number): string {
    return type === 1 ? 'buy' : 'sell';
  }

  // ── Pending Orders helpers ────────────────────────────────────

  readonly ORDER_TYPE_LABELS: Record<number, string> = {
    1: 'Market', 2: 'Buy Limit', 3: 'Sell Limit',
    4: 'Buy Stop', 5: 'Sell Stop', 6: 'Buy Stop Limit', 7: 'Sell Stop Limit'
  };

  getPendingOrderTypeLabel(orderTypeId: number): string {
    return this.ORDER_TYPE_LABELS[orderTypeId] || `Type ${orderTypeId}`;
  }

  getPendingOrderTypeClass(orderTypeId: number): string {
    return [2, 4, 6].includes(orderTypeId) ? 'buy' : 'sell';
  }

  /** Current live price for a pending order symbol */
  getPendingCurrentPrice(order: any): number {
    const sym = (order.symbol || order.market || '').toUpperCase();
    const prices = this.pendingPrices.get(sym);
    if (!prices) return 0;
    // BUY-side orders → use ask, SELL-side → use bid
    return [2, 4, 6].includes(order.order_type_id) ? prices.ask : prices.bid;
  }

  /** Distance from current price to trigger price */
  getPendingDistance(order: any): number {
    const current = this.getPendingCurrentPrice(order);
    const trigger = order.limit_price || order.stop_price || order.price || 0;
    if (!current || !trigger) return 0;
    return Math.abs(current - trigger);
  }

  /** Distance as percentage */
  getPendingDistancePct(order: any): number {
    const current = this.getPendingCurrentPrice(order);
    const trigger = order.limit_price || order.stop_price || order.price || 0;
    if (!current || !trigger) return 0;
    return Math.abs((current - trigger) / current) * 100;
  }

  /** Direction hint: price needs to go UP or DOWN to trigger */
  getPendingDirection(order: any): 'up' | 'down' | null {
    const current = this.getPendingCurrentPrice(order);
    const trigger = order.limit_price || order.stop_price || order.price || 0;
    if (!current || !trigger) return null;
    return trigger > current ? 'up' : 'down';
  }

  cancelPendingOrder(order: any): void {
    const orderId = order.id || order.order_id;
    if (!orderId) return;
    this.tradingSocket.cancelPendingOrder(orderId).then((res: any) => {
      if (res?.code === 0) {
        this.sharedService.showAlert(1, `Order #${orderId} cancelled`);
      } else {
        this.sharedService.showAlert(3, res?.message || 'Failed to cancel order');
      }
    });
  }

  // ── Pending Order Edit ────────────────────────────────────────

  startEditOrder(order: any, field: 'stop_price' | 'limit_price' | 'expiration' | 'stop_loss' | 'take_profit'): void {
    this.editingOrderId = order.id || order.order_id;
    this.editingOrderField = field;

    if (field === 'expiration') {
      this.editingOrderValue = this._backendToUiExpiration(order);
      // Pre-fill date input with existing expiration_value converted to local format
      if (order.expiration_value) {
        const d = new Date(order.expiration_value);
        if (isFinite(d.getTime())) {
          if (order.expiration === 'SPECIFIED_DAY') {
            // date only: YYYY-MM-DD
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, '0');
            const dy = String(d.getDate()).padStart(2, '0');
            this.editingOrderExpirationDate = `${y}-${mo}-${dy}`;
          } else {
            // datetime-local format: YYYY-MM-DDTHH:MM
            const pad = (n: number) => String(n).padStart(2, '0');
            this.editingOrderExpirationDate =
              `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          }
        } else {
          this.editingOrderExpirationDate = '';
        }
      } else {
        this.editingOrderExpirationDate = '';
      }
    } else {
      this.editingOrderValue = String(order[field] || '');
      this.editingOrderExpirationDate = '';
    }
  }

  cancelEditOrder(): void {
    this.editingOrderId = null;
    this.editingOrderField = null;
    this.editingOrderValue = '';
    this.editingOrderExpirationDate = '';
  }

  isEditingOrder(order: any, field: 'stop_price' | 'limit_price' | 'expiration' | 'stop_loss' | 'take_profit'): boolean {
    return this.editingOrderId === (order.id || order.order_id) && this.editingOrderField === field;
  }

  /** Inline validation error for the price being edited */
  getEditOrderError(order: any): string | null {
    if (!this.editingOrderField || this.editingOrderField === 'expiration') return null;
    const val = parseFloat(this.editingOrderValue);
    if (!val || val <= 0) return null;

    const ot = order.order_type_id;
    const isBuy = [2, 4, 6].includes(ot);
    const sym = order.symbol || order.market || '';
    const prices = this.pendingPrices.get(sym.toUpperCase());
    const ask = prices?.ask || 0;
    const bid = prices?.bid || 0;

    // Execution price = limit_price for limit/stop-limit, stop_price for stop orders
    const execPrice = [2, 3, 6, 7].includes(ot)
      ? (order.limit_price || order.price || 0)
      : (order.stop_price || order.price || 0);

    // ── SL validation ─────────────────────────────────────────
    if (this.editingOrderField === 'stop_loss') {
      if (execPrice > 0) {
        if (isBuy && val >= execPrice) return `SL must be below execution price (${execPrice.toFixed(5)})`;
        if (!isBuy && val <= execPrice) return `SL must be above execution price (${execPrice.toFixed(5)})`;
      }
      return null;
    }

    // ── TP validation ─────────────────────────────────────────
    if (this.editingOrderField === 'take_profit') {
      if (execPrice > 0) {
        if (isBuy && val <= execPrice) return `TP must be above execution price (${execPrice.toFixed(5)})`;
        if (!isBuy && val >= execPrice) return `TP must be below execution price (${execPrice.toFixed(5)})`;
      }
      return null;
    }

    // ── Price field validations ───────────────────────────────
    const stopPrice = this.editingOrderField === 'stop_price' ? val : (order.stop_price || order.price || 0);
    const limitPrice = this.editingOrderField === 'limit_price' ? val : (order.limit_price || 0);

    switch (ot) {
      case 2: if (ask > 0 && val >= ask) return `Must be below Ask (${ask.toFixed(5)})`; break;
      case 3: if (bid > 0 && val <= bid) return `Must be above Bid (${bid.toFixed(5)})`; break;
      case 4: if (ask > 0 && val <= ask) return `Must be above Ask (${ask.toFixed(5)})`; break;
      case 5: if (bid > 0 && val >= bid) return `Must be below Bid (${bid.toFixed(5)})`; break;
      case 6:
        if (this.editingOrderField === 'stop_price') {
          if (ask > 0 && val <= ask) return `Stop must be above Ask (${ask.toFixed(5)})`;
          if (limitPrice > 0 && val < limitPrice) return `Stop must be ≥ Limit (${limitPrice.toFixed(5)})`;
        }
        if (this.editingOrderField === 'limit_price') {
          if (stopPrice > 0 && val > stopPrice) return `Limit must be ≤ Stop (${stopPrice.toFixed(5)})`;
        }
        break;
      case 7:
        if (this.editingOrderField === 'stop_price') {
          if (bid > 0 && val >= bid) return `Stop must be below Bid (${bid.toFixed(5)})`;
          if (limitPrice > 0 && val > limitPrice) return `Stop must be ≤ Limit (${limitPrice.toFixed(5)})`;
        }
        if (this.editingOrderField === 'limit_price') {
          if (stopPrice > 0 && val < stopPrice) return `Limit must be ≥ Stop (${stopPrice.toFixed(5)})`;
        }
        break;
    }
    return null;
  }

  saveEditOrder(order: any): void {
    if (!this.editingOrderField || !this.editingOrderId) return;

    const payload: any = { order_id: this.editingOrderId };

    if (this.editingOrderField === 'expiration') {
      const uiVal = this.editingOrderValue; // 'GTC' | 'Today' | 'Tomorrow' | 'Custom Date' | 'Custom DateTime'
      let backendExp = 'GTC';
      let expValue: string | null = null;

      if (uiVal === 'Today') {
        backendExp = 'SPECIFIED';
        expValue = this._buildUtcDateTime('today');
      } else if (uiVal === 'Tomorrow') {
        backendExp = 'SPECIFIED';
        expValue = this._buildUtcDateTime('tomorrow');
      } else if (uiVal === 'Custom Date') {
        if (!this.editingOrderExpirationDate) {
          this.sharedService.showAlert(3, 'Please select a date'); return;
        }
        backendExp = 'SPECIFIED_DAY';
        expValue = this.editingOrderExpirationDate; // YYYY-MM-DD from date input
      } else if (uiVal === 'Custom DateTime') {
        if (!this.editingOrderExpirationDate) {
          this.sharedService.showAlert(3, 'Please select date and time'); return;
        }
        backendExp = 'SPECIFIED';
        expValue = this._localDateTimeToUtc(this.editingOrderExpirationDate); // local → UTC ISO
      }

      payload.expiration = backendExp;
      payload.expiration_value = expValue;
    } else {
      const val = parseFloat(this.editingOrderValue);
      if (!val || val <= 0) {
        this.sharedService.showAlert(3, 'Please enter a valid price'); return;
      }

      // Run validation
      const err = this.getEditOrderError(order);
      if (err) { this.sharedService.showAlert(3, err); return; }

      payload[this.editingOrderField] = val;

      // For SL/TP — just send the field, no need for price context
      if (this.editingOrderField === 'stop_loss' || this.editingOrderField === 'take_profit') {
        // payload already set above
      } else {
        // Always send both price fields so server has full context
        const ot = order.order_type_id;
        if ([6, 7].includes(ot)) {
          payload.stop_price = this.editingOrderField === 'stop_price' ? val : (order.stop_price || order.price || undefined);
          payload.limit_price = this.editingOrderField === 'limit_price' ? val : (order.limit_price || undefined);
        } else if (this.editingOrderField === 'stop_price') {
          payload.stop_price = val;
          if (order.limit_price) payload.limit_price = order.limit_price;
        } else {
          payload.limit_price = val;
          if (order.stop_price) payload.stop_price = order.stop_price;
        }
      }
    }

    this.tradingSocket.updatePendingOrder(payload).then((res: any) => {
      if (res?.code === 0 || res?.success === true) {
        this.sharedService.showAlert(1, `Order #${this.editingOrderId} updated`);
        this.cancelEditOrder();
      } else {
        this.sharedService.showAlert(3, res?.message || 'Failed to update order');
      }
    });
  }

  // ── Expiration UTC helpers ────────────────────────────────────

  /** Format expiration for display in customer's local timezone */
  formatExpiration(order: any): string {
    const exp = order.expiration || 'GTC';
    if (exp === 'GTC') return 'GTC';

    const val = order.expiration_value;
    if (!val) return exp;

    try {
      const d = new Date(val);
      if (!isFinite(d.getTime())) return exp;

      if (exp === 'SPECIFIED_DAY') {
        // Date only — show as local date
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
      }
      // SPECIFIED — show date + time in local timezone
      return d.toLocaleString(undefined, {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch { return exp; }
  }

  /** Map backend expiration to UI label for edit dropdown */
  private _backendToUiExpiration(order: any): string {
    const exp = order.expiration || 'GTC';
    if (exp === 'GTC') return 'GTC';
    if (exp === 'SPECIFIED_DAY') return 'Custom Date';
    // SPECIFIED — check if it was Today/Tomorrow or custom
    // We can't know for sure, so default to Custom DateTime for editing
    return 'Custom DateTime';
  }

  /** Convert local datetime-local string to UTC ISO */
  private _localDateTimeToUtc(localStr: string): string {
    return new Date(localStr).toISOString();
  }

  private _buildUtcDateTime(dayKey: 'today' | 'tomorrow'): string {
    const d = new Date();
    if (dayKey === 'tomorrow') d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0); // EOD local time
    return d.toISOString();   // UTC ISO string e.g. "2025-04-18T18:29:00.000Z"
  }

  /**
   * 'today' → today date string YYYY-MM-DD (local)
   * 'tomorrow' → tomorrow date string YYYY-MM-DD (local)
   */
  private _buildDateOnly(dayKey: 'today' | 'tomorrow'): string {
    const d = new Date();
    if (dayKey === 'tomorrow') d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }

  // ── Expiration countdown ─────────────────────────────────────
  private _countdownTimer: any = null;
  // Map of order id → countdown string
  expirationCountdowns = new Map<number, string>();

  private _startCountdownTimer(): void {
    if (this._countdownTimer) return;
    this._countdownTimer = setInterval(() => {
      this._updateCountdowns();
      this.cdr.markForCheck();
    }, 1000);
  }

  private _stopCountdownTimer(): void {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  private _updateCountdowns(): void {
    const now = Date.now();
    for (const order of this.pendingOrders) {
      const id = order.id || order.order_id;
      const exp = order.expiration || 'GTC';
      if (exp === 'GTC' || !order.expiration_value) {
        this.expirationCountdowns.set(id, '∞');
        continue;
      }
      const target = new Date(order.expiration_value).getTime();
      const diff = target - now;
      if (diff <= 0) {
        this.expirationCountdowns.set(id, 'Expired');
        continue;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const str = d > 0
        ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`
        : `${pad(h)}:${pad(m)}:${pad(s)}`;
      this.expirationCountdowns.set(id, str);
    }
  }

  getExpirationCountdown(order: any): string {
    const id = order.id || order.order_id;
    return this.expirationCountdowns.get(id) ?? '—';
  }

  /** Subscribe mini-ticker for all pending order symbols */
  private updatePendingSubscriptions(): void {
    const byType = new Map<MarketType, string[]>();
    for (const order of this.pendingOrders) {
      const sym = order.symbol || order.market || '';
      if (!sym) continue;
      const mt = this.getMarketTypeFromSymbol(sym);
      const list = byType.get(mt) || [];
      list.push(sym);
      byType.set(mt, list);
    }
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(byType, 'pending');
  }

  calculateProfitLoss(position: Position): number {

    if (!position.current_price) return 0;

    const priceDiff = position.type === 1

      ? (position.current_price - position.entry_price)

      : (position.entry_price - position.current_price);

    return priceDiff * position.quantity;

  }


  calculateProfitLossPercent(position: Position): number {

    if (!position.current_price || position.entry_price === 0) return 0;

    const priceDiff = position.type === 1

      ? (position.current_price - position.entry_price)

      : (position.entry_price - position.current_price);

    const plPercent = (priceDiff / position.entry_price) * 100 * position.leverage;

    return plPercent;

  }

  getProfitLossClass(position: Position): string {

    const pl = this.calculateProfitLoss(position);

    if (pl > 0) return 'profit';

    if (pl < 0) return 'loss';

    return '';

  }

  closePosition(position: Position) {
    const currentPrice = position.current_price || position.entry_price;
    const type = this.getMarketTypeFromSymbol(position.market) === MarketType.CRYPTO ? 1 : 2;
    this.tradingSocket.closeOrder({
      position_id: position.position_id,
      exit_price: currentPrice,
      market_type: type
    }).then((res: any) => {
      if (res?.success === true || res?.code === 0) {
        this.sharedService.showAlert(1, `Position for ${position.market} closed successfully.`);
      } else {
        this.sharedService.showAlert(2, res?.message || 'Failed to close position');
      }
    });
  }

  private cleanupMiniTickerSubscriptions(): void {
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(new Map(), 'positions');
    this.subscribedSymbolsByMarketType.clear();
  }

  // Method to get the quote currency from the market symbol
  getQuoteCurrency(market: string): string {
    if (market.includes('/')) {
      return market.split('/')[1];
    }
    const marketData = this.sharedService.allMarketsCache?.find(m => m.market === market);
    return marketData?.quote_currency_code || '';
  }

  getConvertedPnl(position: Position): number {
    const pnl = this.calculateProfitLoss(position);
    const quoteCurrency = this.getQuoteCurrency(position.market);
    return this.sharedService.convertValueToBrandCurrency(pnl, quoteCurrency);
  }

  formatWithBrandCurrency(value: number): string {
    if (this.brandConfig) {
      return this.sharedService.formatToBrandCurrency(value);
    }
    // Fallback to a simple format if brand config is not yet available
    return value.toFixed(2);
  }

  recalculateSummary() {
    this.balance = Number(this.authService.currentBalance) || 0;

    // Convert balance to brand currency
    // Since balance is typically in brand currency already or has its own currency code,
    // we need to be careful. User says "brand config se milne wali brand ki base currency ka symbol dikhaane ka"
    // and "brand config wali api se aayega pure panel us currency pe chalega".
    // If balance is already in brand base currency, no conversion.
    // If it's in a specific quote currency, we convert it.
    // For now, we assume balance display should use the brand symbol.

    let totalUnrealized = 0;
    let totalMargin = 0;

    for (const pos of this.positions || []) {
      const pl = this.getConvertedPnl(pos);
      totalUnrealized += pl;

      if (pos.entry_price && pos.quantity && pos.leverage) {
        const notional = pos.entry_price * pos.quantity;
        const quoteCurrency = this.getQuoteCurrency(pos.market);
        const marginInQuote = notional / pos.leverage;
        totalMargin += this.sharedService.convertValueToBrandCurrency(marginInQuote, quoteCurrency);
      }
    }

    this.openPositionsTotalPnl = totalUnrealized;
    this.equity = this.balance + totalUnrealized;
    this.margin = totalMargin;
    this.freeMargin = this.equity - this.margin;
    this.marginLevel = this.margin > 0 ? (this.equity / this.margin) * 100 : 0;
  }

  /** Sum of realized P/L for rows currently shown in History (brand currency). */
  get historyTotalRealizedPl(): number {
    return (this.positionHistory || []).reduce(
      (sum, h) => sum + Number(h?.realized_pl ?? 0),
      0
    );
  }

  /** Bottom-bar total label/value when inside trade page (desktop). */
  get tradePanelSummaryLabel(): string {
    if (this.activeTab === 'positions') return 'Total P/L';
    if (this.activeTab === 'history') return 'Total P/L';
    return 'Orders';
  }

  get tradePanelSummaryAmount(): number {
    if (this.activeTab === 'positions') return this.openPositionsTotalPnl;
    if (this.activeTab === 'history') return this.historyTotalRealizedPl;
    return 0;
  }

  get tradePanelSummaryValue(): string {
    if (this.activeTab === 'positions') return this.formatWithBrandCurrency(this.openPositionsTotalPnl);
    if (this.activeTab === 'history') {
      return this.sharedService.formatToBrandCurrency(this.historyTotalRealizedPl);
    }
    return String(this.pendingOrders?.length ?? 0);
  }

  get tradePanelSummaryUsesPlClass(): boolean {
    return this.activeTab === 'positions' || this.activeTab === 'history';
  }

  /** /orders page sticky bottom bar — P/L amount for active tab */
  get ordersPageBottomPnlAmount(): number {
    return this.activeTab === 'history' ? this.historyTotalRealizedPl : this.openPositionsTotalPnl;
  }

  get ordersPageBottomPnlValue(): string {
    if (this.activeTab === 'history') {
      return this.sharedService.formatToBrandCurrency(this.historyTotalRealizedPl);
    }
    return this.formatWithBrandCurrency(this.openPositionsTotalPnl);
  }

  get ordersPageBottomPnlClass(): string {
    const amount = this.ordersPageBottomPnlAmount;
    if (amount > 0) return 'positive';
    if (amount < 0) return 'negative';
    return 'neutral';
  }

  /** CSS classes for total P/L cells (`.total-amt.profit` / `.total-amt.loss`). */
  getPlTotalClass(amount: number): string {
    if (amount > 0) return 'profit';
    if (amount < 0) return 'loss';
    return '';
  }

  async closeAllPositions(): Promise<void> {
    const listLen = (this.positions || []).length;
    if (!listLen || this.closingAllPositions) return;

    this.closingAllPositions = true;
    this.cdr.markForCheck();

    try {
      // Bulk backend event: closes all positions for the player in one shot.
      const res = await this.tradingSocket.closeAllPositions();
      const ok = res?.success === true || res?.code === 0;

      // Backend shape (example):
      // { code, message, data: { total, succeeded, failed, remaining, results:[{position_id, success, message, error}] } }
      const total = Number(res?.data?.total ?? listLen);
      const succeeded = Number(res?.data?.succeeded ?? (ok ? total : 0));
      const failed = Number(res?.data?.failed ?? 0);

      if (ok) {
        // code === 0 => treat as full success
        this.sharedService.showAlert(1, res?.message || `Closed ${succeeded} position(s) successfully`);
      } else {
        // code !== 0 => partial or failed
        const baseMsg =
          res?.message ||
          `Closed ${succeeded} of ${total} position(s); ${failed} failed`;

        // Pick a compact error reason (avoid spamming).
        const results: any[] = Array.isArray(res?.data?.results) ? res.data.results : [];
        const failedResults = results.filter(r => r && r.success === false);
        const topReason =
          failedResults[0]?.message ||
          failedResults[0]?.error ||
          null;

        const msg = topReason ? `${baseMsg}. Reason: ${topReason}` : baseMsg;

        // If some succeeded => warning toast, else error toast.
        this.sharedService.showAlert(succeeded > 0 ? 2 : 3, msg);
      }
    } catch {
      this.sharedService.showAlert(3, 'Failed to close positions.');
    } finally {
      this.closingAllPositions = false;
      this.cdr.markForCheck();
    }
  }

  private handleMiniTickerUpdate(data: any): void {
    const symbol = data.s;
    const bid = parseFloat(data.b) || 0;
    const ask = parseFloat(data.a) || 0;

    // Store bid/ask prices for this symbol (used by both positions and pending orders)
    this.positionPrices.set(symbol.toUpperCase(), { bid, ask });
    this.pendingPrices.set(symbol.toUpperCase(), { bid, ask });

    this.updatePositionPrices(symbol);
    // Trigger CD for pending orders distance update
    if (this.pendingOrders.some(o => (o.symbol || o.market || '').toUpperCase() === symbol.toUpperCase())) {
      this.cdr.markForCheck();
    }
  }

  private updatePositionPrices(socketSymbol: string): void {
    const normSocketSym = socketSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prices = this.positionPrices.get(socketSymbol.toUpperCase());

    if (!prices) return;

    let changed = false;
    for (const pos of this.positions) {
      const normPosSym = pos.market.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normPosSym === normSocketSym) {
        // Use BID for SELL positions, ASK for BUY positions
        const currentPrice = pos.type === 2 ? prices.bid : prices.ask;

        if (pos.current_price !== currentPrice) {
          pos.current_price = currentPrice;

          // Keep these fields in-sync so header (totalPnL) updates
          const pl = this.calculateProfitLoss(pos);
          (pos as any).unrealized_pl = pl;
          (pos as any).profit_loss = pl;

          changed = true;
        }
      }
    }

    if (changed) {
      this.zone.run(() => {
        this.recalculateSummary();
        this.cdr.markForCheck();
      });
    }
  }

  trackByPositionId(index: number, position: Position): number {
    return position.position_id;
  }

  trackByHistoryId(index: number, h: PositionHistory): number {
    return h.position_id;
  }

  formatTime(utcTime?: string): string {
    if (!utcTime) return '-';

    try {
      const date = new Date(utcTime);
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      const day = localDate.getDate().toString().padStart(2, '0');
      const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
      const year = localDate.getFullYear();
      const hours = localDate.getHours().toString().padStart(2, '0');
      const minutes = localDate.getMinutes().toString().padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (error) {
      console.error('Error formatting time:', error);
      return '-';
    }
  }

  startEdit(position: Position, field: 'sl' | 'tp'): void {

    this.editingPositionId = position.position_id;
    this.editingField = field;
    if (field === 'sl') {
      this.editingValue = position.stop_loss ? position.stop_loss.toString() : '';
    } else if (field === 'tp') {
      this.editingValue = position.take_profit ? position.take_profit.toString() : '';
    }

  }

  cancelEdit(): void {
    this.editingPositionId = null;
    this.editingField = null;
    this.editingValue = '';
  }

  async saveEdit(position: Position): Promise<void> {
    if (!this.editingField) return;

    // Real-time validation check
    if (this.editingError) {
      this.sharedService.showAlert(3, this.editingError);
      return;
    }

    const positionId = position.position_id;

    const value = this.editingValue;

    const currentPrice = position.current_price || position.entry_price;

    if (this.editingField === 'tp') {
      const takeProfit = parseFloat(value);
      if (isNaN(takeProfit)) {
        this.sharedService.showAlert(3, 'Please enter a valid take profit value.');
        return;

      }

      // Validate Take Profit against entry price
      const validation = this.validateStopLossTakeProfit(
        position.type,
        currentPrice,
        undefined,
        takeProfit,
        position.market,
        position.entry_price
      );
      if (!validation.valid) {
        this.sharedService.showAlert(3, validation.error!);
        return;
      }

      this.positionsService.updateTakeProfit(positionId, takeProfit).subscribe({
        next: (res: any) => {
          this.tradingSocket.fetchOpenPositions();
          this.cancelEdit();
          const code = res?.code ?? 0;
          if (code === 0) this.sharedService.showAlert(1, `Take profit updated for ${position.market}`);
          else if (code === 1) this.sharedService.showAlert(3, res?.message || 'Failed to update take profit');
          else this.sharedService.showAlert(2, res?.message || 'Take profit update warning');
        },
        error: () => this.sharedService.showAlert(3, 'Failed to update take profit')
      });

    } else if (this.editingField === 'sl') {
      const stopLoss = parseFloat(value);
      if (isNaN(stopLoss)) {
        this.sharedService.showAlert(3, 'Please enter a valid stop loss value.');
        return;
      }

      // Validate Stop Loss against entry price
      const validation = this.validateStopLossTakeProfit(
        position.type,
        currentPrice,
        stopLoss,
        undefined,
        position.market,
        position.entry_price
      );
      if (!validation.valid) {
        this.sharedService.showAlert(3, validation.error!);
        return;
      }

      this.positionsService.updateStopLoss(positionId, stopLoss).subscribe({
        next: (res: any) => {
          this.tradingSocket.fetchOpenPositions();
          this.cancelEdit();
          const code = res?.code ?? 0;
          if (code === 0) this.sharedService.showAlert(1, `Stop loss updated for ${position.market}`);
          else if (code === 1) this.sharedService.showAlert(3, res?.message || 'Failed to update stop loss');
          else this.sharedService.showAlert(2, res?.message || 'Stop loss update warning');
        },
        error: () => this.sharedService.showAlert(3, 'Failed to update stop loss')
      });

    }

  }

  isEditing(position: Position, field: 'sl' | 'tp'): boolean {
    return this.editingPositionId === position.position_id && this.editingField === field;
  }

  // Filter methods
  toggleFilterOffcanvas(): void {
    this.showFilterOffcanvas = !this.showFilterOffcanvas;
    if (this.showFilterOffcanvas) {
      this.updateAvailableSymbols();
    }
  }

  updateAvailableSymbols(): void {
    const symbols = new Set<string>();
    for (const h of this.positionHistory) {
      if (h.market) {
        symbols.add(h.market);
      }
    }
    this.availableSymbols = Array.from(symbols).sort();
  }

  applyFilters(): void {
    this.filteredPositionHistory = this.positionHistory.filter(h => {
      // Symbol filter
      if (this.filters.symbol && h.market !== this.filters.symbol) {
        return false;
      }

      // Date range filter
      if (this.filters.startDate && h.opened_at) {
        const openedDate = new Date(h.opened_at);
        const startDate = new Date(this.filters.startDate);
        if (openedDate < startDate) {
          return false;
        }
      }
      if (this.filters.endDate && h.opened_at) {
        const openedDate = new Date(h.opened_at);
        const endDate = new Date(this.filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        if (openedDate > endDate) {
          return false;
        }
      }

      // Profit/Loss filter
      const pnl = h.realized_pl || 0;
      if (this.filters.pnl === 'profit' && pnl <= 0) {
        return false;
      }
      if (this.filters.pnl === 'loss' && pnl >= 0) {
        return false;
      }
      if (this.filters.pnl === 'neutral' && pnl !== 0) {
        return false;
      }

      // Buy/Sell filter
      if (this.filters.type === 'buy' && h.position_type_id !== 1) {
        return false;
      }
      if (this.filters.type === 'sell' && h.position_type_id !== 2) {
        return false;
      }

      return true;
    });
    this.showFilterOffcanvas = false;
  }

  clearFilters(): void {
    this.filters = {
      symbol: '',
      startDate: '',
      endDate: '',
      pnl: 'all',
      type: 'all'
    };
    this.filteredPositionHistory = [];
    this.showFilterOffcanvas = false;
  }
}
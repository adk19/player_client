import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, inject, NgZone, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { combineLatest, filter, forkJoin, Subscription } from 'rxjs';
import { BinanceSocketService } from '../../../services/binance-socket.service';
import {
  DashboardActivityData,
  DashboardActivityOpenOrder,
  DashboardActivityPosition,
  DashboardActivityTrade,
  DashboardAnalyticsData,
  DashboardSummaryData,
  PerformancePoint,
  PlayerService
} from '../../../services/player.service';
import { Position, TradingSocketService } from '../../../services/trading-socket.service';
import { AuthService } from '../../../shared/services/auth.service';
import { MarketType } from '../../../shared/services/market.constants';
import { BrandConfig, ExchangeRate, SharedService } from '../../../shared/services/shared.service';

@Component({
  selector: 'app-account-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './account-dashboard.component.html',
  styleUrls: ['./account-dashboard.component.scss']
})
export class AccountDashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('perfCanvas', { static: false }) perfCanvas?: ElementRef<HTMLCanvasElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private chartResizeTimer: ReturnType<typeof setTimeout> | null = null;
  private perfMoveRaf: number | null = null;

  // ── Live positions from socket ──
  private positionsSubscription?: Subscription;
  private balanceSubscription?: Subscription;
  private brandConfigSubscription?: Subscription;
  private exchangeRatesSubscription?: Subscription;
  private miniTickerHandlers: Map<MarketType, (data: any) => void> = new Map();
  private positionPrices: Map<string, { bid: number; ask: number }> = new Map();
  private brandConfig: BrandConfig | null = null;
  private exchangeRates: ExchangeRate[] = [];

  livePositions: DashboardActivityPosition[] = [];
  liveTotalUnrealizedPnl = 0;

  /** Hover / hit-testing for interactive performance chart */
  perfHoverIndex: number | null = null;
  perfTooltip: {
    visible: boolean;
    left: number;
    top: number;
    dateLong: string;
    dateIso: string;
    periodIdx: string;
    pnlText: string;
    pnlNeg: boolean;
    pnlRaw: string;
    deltaText: string;
    deltaVisible: boolean;
    deltaNeg: boolean;
    cumText: string;
    cumNeg: boolean;
    spanMin: string;
    spanMax: string;
    rangeLabel: string;
    extras: Array<{ label: string; value: string }>;
  } = {
      visible: false,
      left: 0,
      top: 0,
      dateLong: '',
      dateIso: '',
      periodIdx: '',
      pnlText: '',
      pnlNeg: false,
      pnlRaw: '',
      deltaText: '',
      deltaVisible: false,
      deltaNeg: false,
      cumText: '',
      cumNeg: false,
      spanMin: '',
      spanMax: '',
      rangeLabel: '',
      extras: []
    };

  private perfHit: {
    plotL: number;
    plotT: number;
    plotW: number;
    plotH: number;
    plotR: number;
    plotB: number;
    n: number;
  } | null = null;

  loading = true;
  activityLoading = false;
  analyticsLoading = false;
  error: string | null = null;

  summary: DashboardSummaryData | null = null;
  activity: DashboardActivityData | null = null;
  analytics: DashboardAnalyticsData | null = null;

  activeTab: 'positions' | 'orders' | 'trades' | 'transactions' = 'positions';

  activityPage = 1;
  activityLimit = 10;
  readonly activityLimitOptions = [10, 25, 50, 100];

  analyticsStart = '';
  analyticsEnd = '';

  constructor(
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef,
    public sharedService: SharedService,
    private tradingSocket: TradingSocketService,
    private binanceSocket: BinanceSocketService,
    private authService: AuthService
  ) {
    const end = new Date();
    const start = new Date(end.getFullYear(), 0, 1);
    this.analyticsEnd = this.toYmd(end);
    this.analyticsStart = this.toYmd(start);
  }

  ngOnInit(): void {
    this.loadAll();
    this.setupLivePositions();
    this.destroyRef.onDestroy(() => {
      if (this.chartResizeTimer != null) {
        clearTimeout(this.chartResizeTimer);
      }
      if (this.perfMoveRaf != null) {
        cancelAnimationFrame(this.perfMoveRaf);
      }
      this.teardownLivePositions();
    });
  }

  /** Full reload (same as initial) — used by page header Refresh */
  refresh(): void {
    this.loadAll();
  }

  // ── Live positions from trading socket ──────────────────────────

  private setupLivePositions(): void {
    const playerId = sessionStorage.getItem('player_id') || '';
    if (playerId) {
      this.tradingSocket.setPlayerId(playerId);
    }

    this.positionsSubscription = this.tradingSocket.positions$.subscribe((positions) => {
      this.updateLivePositions(positions);
    });

    this.balanceSubscription = this.authService.balance$.subscribe(() => {
      this.recalculateLivePnl();
    });

    const brandConfig$ = this.sharedService.brandConfig$.pipe(filter((c): c is BrandConfig => !!c));
    const exchangeRates$ = this.sharedService.exchangeRates$.pipe(filter((r) => r.length > 0));

    this.brandConfigSubscription = combineLatest([brandConfig$, exchangeRates$]).subscribe(
      ([config, rates]) => {
        this.brandConfig = config;
        this.exchangeRates = rates;
        this.recalculateLivePnl();
      }
    );

    this.setupMiniTickerHandlers();
  }

  private teardownLivePositions(): void {
    this.positionsSubscription?.unsubscribe();
    this.balanceSubscription?.unsubscribe();
    this.brandConfigSubscription?.unsubscribe();
    this.exchangeRatesSubscription?.unsubscribe();

    for (const [mt, handler] of this.miniTickerHandlers) {
      this.binanceSocket.offMiniTicker(handler, mt);
    }
    this.miniTickerHandlers.clear();
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(new Map(), 'dashboard');
  }

  private setupMiniTickerHandlers(): void {
    const allTypes = [
      MarketType.CRYPTO, MarketType.FOREX, MarketType.COMMODITY,
      MarketType.STOCK, MarketType.INDEX, MarketType.METAL,
      MarketType.ETFS, MarketType.FORWARDS, MarketType.MCX
    ];
    for (const mt of allTypes) {
      if (!this.miniTickerHandlers.has(mt)) {
        const handler = (data: any) => this.handleMiniTickerUpdate(data);
        this.miniTickerHandlers.set(mt, handler);
        this.binanceSocket.onMiniTicker(handler, mt);
      }
    }
  }

  private handleMiniTickerUpdate(data: any): void {
    const symbol = (data.s || '').toUpperCase();
    const bid = parseFloat(data.b) || 0;
    const ask = parseFloat(data.a) || 0;
    if (!symbol || (!bid && !ask)) return;

    this.positionPrices.set(symbol, { bid, ask });

    let changed = false;
    for (const pos of this.livePositions) {
      const normPos = pos.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normPos === symbol.replace(/[^A-Z0-9]/g, '')) {
        const currentPrice = pos.position_type_id === 2 ? bid : ask;
        if (currentPrice > 0 && pos.current_price !== currentPrice) {
          pos.current_price = currentPrice;
          pos.unrealized_pl = this.calcRawPnl(pos);
          changed = true;
        }
      }
    }

    if (changed) {
      this.zone.run(() => {
        this.recalculateLivePnl();
        this.cdr.markForCheck();
      });
    }
  }

  private updateLivePositions(positions: Position[]): void {
    this.livePositions = positions.map((p) => ({
      id: p.position_id,
      symbol: p.market,
      quantity: p.quantity,
      opened_at: (p as any).opened_at || '',
      stop_loss: p.stop_loss ?? null,
      entry_price: p.entry_price,
      margin_used: (p as any).used_margin ?? 0,
      take_profit: p.take_profit ?? null,
      current_price: p.current_price ?? p.entry_price,
      leverage_used: p.leverage ?? 0,
      unrealized_pl: p.unrealized_pl ?? p.profit_loss ?? 0,
      position_type_id: p.type
    }));
    this.recalculateLivePnl();
    this.updateMiniTickerSubscriptions();
    this.cdr.markForCheck();
  }

  private updateMiniTickerSubscriptions(): void {
    const byType = new Map<MarketType, string[]>();
    for (const pos of this.livePositions) {
      const sym = pos.symbol;
      if (!sym) continue;
      const mt = this.getMarketTypeFromSymbol(sym);
      const list = byType.get(mt) || [];
      list.push(sym);
      byType.set(mt, list);
    }
    this.binanceSocket.updateMiniTickerSubscriptionsBatch(byType, 'dashboard');
  }

  private getMarketTypeFromSymbol(symbol: string): MarketType {
    const upper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (this.sharedService.allMarketsCache?.length) {
      const found = this.sharedService.allMarketsCache.find(
        (m) => m.market.toUpperCase().replace(/[^A-Z0-9]/g, '') === upper
      );
      if (found) {
        if (found.market_type_id === 1 || Number(found.market_type_id) === 1 || (found.path || '').toUpperCase().startsWith('CRYPTO')) {
          return MarketType.CRYPTO;
        }
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

        const ex = (found.exchange || '').toUpperCase();
        if (ex === 'BINANCE' || ex === 'CRYPTO') return MarketType.CRYPTO;
        if (ex === 'MT' || ex === 'MT5') return MarketType.COMMODITY;
        if (ex === 'FOREX') return MarketType.FOREX;
        if (ex === 'METAL') return MarketType.METAL;
      }
    }
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(upper)) {
      return MarketType.CRYPTO;
    }
    if (/^[A-Z]{6}$/.test(upper)) return MarketType.FOREX;
    if (upper.startsWith('XAU') || upper.startsWith('XAG')) return MarketType.METAL;
    return MarketType.COMMODITY;
  }

  private calcRawPnl(pos: DashboardActivityPosition): number {
    if (!pos.current_price || !pos.entry_price) return 0;
    const diff = pos.position_type_id === 1
      ? pos.current_price - pos.entry_price
      : pos.entry_price - pos.current_price;
    return diff * pos.quantity;
  }

  private getQuoteCurrency(market: string): string {
    if (market.includes('/')) return market.split('/')[1];
    const marketData = this.sharedService.allMarketsCache?.find((m) => m.market === market);
    return marketData?.quote_currency_code || '';
  }

  private convertToBrandCurrency(value: number, quoteCurrency: string): number {
    if (!quoteCurrency || value === 0) return value;
    if (!this.brandConfig) return value;
    if (quoteCurrency === this.brandConfig.currency_code) return value;
    const rate = this.sharedService.getExchangeRate(quoteCurrency, this.brandConfig.currency_code);
    return rate != null ? value * rate : value;
  }

  private recalculateLivePnl(): void {
    let total = 0;
    for (const pos of this.livePositions) {
      const rawPnl = this.calcRawPnl(pos);
      const quote = this.getQuoteCurrency(pos.symbol);
      total += this.convertToBrandCurrency(rawPnl, quote);
    }
    this.liveTotalUnrealizedPnl = total;
  }

  ngAfterViewInit(): void {
    this.flushChartDraw();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.analytics) {
      return;
    }
    if (this.chartResizeTimer != null) {
      clearTimeout(this.chartResizeTimer);
    }
    this.chartResizeTimer = setTimeout(() => {
      this.chartResizeTimer = null;
      this.scheduleChartDraw();
    }, 120);
  }

  /** CD + layout: ensure #perfCanvas exists (inside *ngIf) before drawing */
  private flushChartDraw(): void {
    this.scheduleChartDraw();
    queueMicrotask(() => this.scheduleChartDraw());
    setTimeout(() => this.scheduleChartDraw(), 0);
    setTimeout(() => this.scheduleChartDraw(), 80);
  }

  private toYmd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  loadAll(): void {
    this.loading = true;
    this.error = null;

    forkJoin({
      summary: this.playerService.getDashboardSummary(),
      activity: this.playerService.postDashboardActivity({
        page: this.activityPage,
        limit: this.activityLimit
      }),
      analytics: this.playerService.postDashboardAnalytics({
        start_date: this.analyticsStart,
        end_date: this.analyticsEnd
      })
    }).subscribe({
      next: ({ summary, activity, analytics }) => {
        if (summary.code !== 0) {
          this.error = summary.message || 'Failed to load summary';
          this.loading = false;
          return;
        }
        if (activity.code !== 0) {
          this.error = activity.message || 'Failed to load activity';
          this.loading = false;
          return;
        }
        if (analytics.code !== 0) {
          this.error = analytics.message || 'Failed to load analytics';
          this.loading = false;
          return;
        }
        this.summary = summary.data;
        this.activity = activity.data;
        this.analytics = analytics.data;
        this.loading = false;
        this.clearPerfInteraction();
        this.cdr.detectChanges();
        this.flushChartDraw();
      },
      error: () => {
        this.error = 'Failed to load dashboard';
        this.loading = false;
      }
    });
  }

  loadActivityOnly(): void {
    this.activityLoading = true;
    this.playerService.postDashboardActivity({ page: this.activityPage, limit: this.activityLimit })
      .subscribe({
        next: (res) => {
          this.activityLoading = false;
          if (res.code === 0) this.activity = res.data;
          this.cdr.detectChanges();
        },
        error: () => {
          this.activityLoading = false;
        }
      });
  }

  loadAnalyticsOnly(): void {
    this.analyticsLoading = true;
    this.playerService.postDashboardAnalytics({
      start_date: this.analyticsStart,
      end_date: this.analyticsEnd
    }).subscribe({
      next: (res) => {
        this.analyticsLoading = false;
        if (res.code === 0) {
          this.analytics = res.data;
          this.clearPerfInteraction();
          this.cdr.detectChanges();
          this.flushChartDraw();
        }
      },
      error: () => {
        this.analyticsLoading = false;
      }
    });
  }

  onTabChange(tab: typeof this.activeTab): void {
    this.activeTab = tab;
    this.activityPage = 1;
    this.loadActivityOnly();
  }

  onActivityLimitChange(): void {
    this.activityPage = 1;
    this.loadActivityOnly();
  }

  prevActivityPage(): void {
    if (this.activityPage <= 1) return;
    this.activityPage--;
    this.loadActivityOnly();
  }

  nextActivityPage(): void {
    if (this.activityPage >= this.activityTotalPages) return;
    this.activityPage++;
    this.loadActivityOnly();
  }

  get activityTotalForTab(): number {
    if (!this.activity) return 0;
    switch (this.activeTab) {
      case 'positions':
        return this.activity.open_positions_total;
      case 'orders':
        return this.activity.open_orders_total;
      case 'trades':
        return this.activity.recent_trades_total;
      case 'transactions':
        return this.activity.recent_transactions_total;
      default:
        return 0;
    }
  }

  get activityTotalPages(): number {
    return Math.max(1, Math.ceil(this.activityTotalForTab / this.activityLimit));
  }

  get activityRangeLabel(): string {
    const total = this.activityTotalForTab;
    if (total === 0) return '0 of 0';
    const start = (this.activityPage - 1) * this.activityLimit + 1;
    const end = Math.min(this.activityPage * this.activityLimit, total);
    return `${start}–${end} of ${total}`;
  }

  /** Run after layout so canvas gets real width/height from CSS */
  private scheduleChartDraw(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.drawChartIfNeeded()));
  }

  private drawChartIfNeeded(): void {
    const canvas = this.perfCanvas?.nativeElement;
    if (!canvas) {
      return;
    }
    const pts = this.perfChart;
    if (!pts.length) {
      this.clearPerfInteraction(true);
      this.clearPerfCanvas(canvas);
      return;
    }
    this.drawChart(pts);
  }

  /** Prefer frame width; fall back to wrap / canvas client size */
  private measureCanvasCssSize(canvas: HTMLCanvasElement): { w: number; h: number } {
    const wrap = canvas.parentElement as HTMLElement | null;
    const frame = canvas.closest('.perf-chart-frame') as HTMLElement | null;
    let ref: HTMLElement = canvas;
    const fw = frame?.getBoundingClientRect().width ?? 0;
    if (frame && fw > 2) {
      ref = frame;
    } else if (wrap && (wrap.getBoundingClientRect().width ?? 0) > 2) {
      ref = wrap;
    }
    const cr = ref.getBoundingClientRect();
    let cssW = Math.floor(cr.width || canvas.clientWidth || 0);
    let cssH = Math.floor(cr.height || canvas.clientHeight || 0);
    if (cssH < 2 && wrap) {
      cssH = Math.floor(wrap.getBoundingClientRect().height || 0);
    }
    cssW = Math.max(240, cssW);
    cssH = Math.max(260, cssH);
    return { w: cssW, h: cssH };
  }

  private clearPerfCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const { w: cssW, h: cssH } = this.measureCanvasCssSize(canvas);
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  drawChart(points: PerformancePoint[]): void {
    const canvas = this.perfCanvas?.nativeElement;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const { w: cssW, h: cssH } = this.measureCanvasCssSize(canvas);

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const W = cssW;
    const H = cssH;
    const vals = points.map((p) => {
      const v = Number(p?.realized_pnl);
      return Number.isFinite(v) ? v : 0;
    });
    const n = vals.length;
    if (n < 1) {
      return;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const mainRgb = this.parseCssRgb(rootStyle.getPropertyValue('--main-text').trim(), '245, 247, 250');
    const mutedRgb = this.parseCssRgb(rootStyle.getPropertyValue('--normal-text').trim(), '154, 164, 178');
    const borderRgb = this.parseCssRgb(rootStyle.getPropertyValue('--border-light').trim(), '148, 163, 184');
    const primaryRgb = rootStyle.getPropertyValue('--primary-rgb').trim() || '37, 99, 235';

    let yDataMin = Math.min(0, ...vals);
    let yDataMax = Math.max(0, ...vals);
    if (yDataMin === yDataMax) {
      yDataMax = yDataMin + 1e-6;
    }
    const spanRaw = yDataMax - yDataMin;
    yDataMin -= spanRaw * 0.06;
    yDataMax += spanRaw * 0.06;
    const { lo: yMin, hi: yMax, step: yStep } = this.niceYAxis(yDataMin, yDataMax, 5);

    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) {
      (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: string }).imageSmoothingQuality = 'high';
    }

    const yTicks: number[] = [];
    let yt = yMin;
    let guard = 0;
    while (yt <= yMax + yStep * 0.00001 && guard < 24) {
      yTicks.push(Math.round(yt * 1e6) / 1e6);
      yt += yStep;
      guard++;
    }

    ctx.font = '500 10px system-ui, -apple-system, Segoe UI, sans-serif';
    let maxYLabel = 36;
    for (const yv of yTicks) {
      maxYLabel = Math.max(maxYLabel, ctx.measureText(this.formatPerfYAxis(yv)).width);
    }
    const marginLeft = Math.min(72, Math.max(40, Math.ceil(maxYLabel) + 14));
    const marginRight = 12;
    const marginTop = 14;
    const marginBottom = 38;
    const plotL = marginLeft;
    const plotT = marginTop;
    const plotW = W - marginLeft - marginRight;
    const plotH = H - marginTop - marginBottom;
    const plotR = plotL + plotW;
    const plotB = plotT + plotH;

    const yPx = (v: number) => plotT + ((yMax - v) / (yMax - yMin || 1)) * plotH;
    const xAt = (i: number) => (n <= 1 ? plotL + plotW / 2 : plotL + (i / (n - 1)) * plotW);

    // Chart backdrop
    const bgGrad = ctx.createLinearGradient(plotL, plotT, plotL, plotB);
    bgGrad.addColorStop(0, `rgba(${primaryRgb}, 0.08)`);
    bgGrad.addColorStop(0.45, `rgba(${primaryRgb}, 0.04)`);
    bgGrad.addColorStop(1, `rgba(${primaryRgb}, 0.015)`);
    ctx.fillStyle = bgGrad;
    this.roundRect(ctx, plotL, plotT, plotW, plotH, 10);
    ctx.fill();
    ctx.strokeStyle = `rgba(${borderRgb}, 0.35)`;
    ctx.lineWidth = 1;
    this.roundRect(ctx, plotL, plotT, plotW, plotH, 10);
    ctx.stroke();

    // Grid + Y labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const yv of yTicks) {
      const yy = yPx(yv);
      ctx.strokeStyle = `rgba(${borderRgb}, 0.38)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotL, yy);
      ctx.lineTo(plotR, yy);
      ctx.stroke();

      ctx.fillStyle = `rgb(${mutedRgb})`;
      ctx.fillText(this.formatPerfYAxis(yv), plotL - 6, yy);
    }

    // Zero baseline
    if (yMin < 0 && yMax > 0) {
      const yz = yPx(0);
      ctx.strokeStyle = `rgba(${mainRgb}, 0.4)`;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(plotL, yz);
      ctx.lineTo(plotR, yz);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Line + area (to zero baseline inside plot)
    const yZeroPx = yPx(0);
    const yz = Math.min(plotB, Math.max(plotT, yZeroPx));
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(xAt(i));
      ys.push(yPx(vals[i]));
    }

    ctx.beginPath();
    ctx.moveTo(xs[0], yz);
    for (let i = 0; i < n; i++) {
      ctx.lineTo(xs[i], ys[i]);
    }
    ctx.lineTo(xs[n - 1], yz);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(plotL, plotT, plotL, plotB);
    areaGrad.addColorStop(0, `rgba(${primaryRgb}, 0.14)`);
    areaGrad.addColorStop(0.55, `rgba(${primaryRgb}, 0.07)`);
    areaGrad.addColorStop(1, `rgba(${primaryRgb}, 0.02)`);
    ctx.fillStyle = areaGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) {
      ctx.lineTo(xs[i], ys[i]);
    }
    ctx.strokeStyle = `rgba(${primaryRgb}, 0.92)`;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Crosshair on hover (after line so on top)
    const hi = this.perfHoverIndex;
    if (hi != null && hi >= 0 && hi < n) {
      const cx = xs[hi];
      const cy = ys[hi];
      ctx.strokeStyle = `rgba(${primaryRgb}, 0.28)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, plotT + 2);
      ctx.lineTo(cx, plotB - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(plotL + 2, cy);
      ctx.lineTo(plotR - 2, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // X axis labels
    ctx.fillStyle = `rgb(${mutedRgb})`;
    ctx.font = '500 9px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = 9;
    const stepIdx = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = 0; i < n; i++) {
      if (i % stepIdx !== 0 && i !== n - 1 && i !== 0) {
        continue;
      }
      const cx = xAt(i);
      const label = this.formatPerfXAxis(points[i]?.date ?? '');
      ctx.fillText(label, cx, plotB + 6);
    }

    // Axis titles
    ctx.save();
    ctx.translate(Math.max(10, marginLeft / 2 - 2), plotT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = `rgba(${mutedRgb}, 0.95)`;
    ctx.font = '600 9px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P&L', 0, 0);
    ctx.restore();

    ctx.fillStyle = `rgba(${mutedRgb}, 0.95)`;
    ctx.font = '600 9px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Period', plotL + plotW / 2, H - 4);

    this.perfHit = { plotL, plotT, plotW, plotH, plotR, plotB, n };
  }

  /** Nearest data index for line chart from x inside plot */
  private nearestPerfIndex(relX: number, plotL: number, plotW: number, n: number): number {
    if (n <= 1) {
      return 0;
    }
    const t = (relX - plotL) / plotW;
    const idx = Math.round(t * (n - 1));
    return Math.max(0, Math.min(n - 1, idx));
  }

  private niceYAxis(lo: number, hi: number, maxTicks: number): { lo: number; hi: number; step: number } {
    const span = hi - lo || 1;
    const rough = span / Math.max(maxTicks - 1, 1);
    const step = this.niceNumber(rough, true);
    const a = Math.floor(lo / step) * step;
    const b = Math.ceil(hi / step) * step;
    return { lo: a, hi: b === a ? a + step : b, step };
  }

  private niceNumber(value: number, round: boolean): number {
    if (!Number.isFinite(value) || value === 0) {
      return 1;
    }
    const exp = Math.floor(Math.log10(Math.abs(value)));
    const f = value / Math.pow(10, exp);
    let nf: number;
    if (round) {
      if (f < 1.5) {
        nf = 1;
      } else if (f < 3) {
        nf = 2;
      } else if (f < 7) {
        nf = 5;
      } else {
        nf = 10;
      }
    } else if (f <= 1) {
      nf = 1;
    } else if (f <= 2) {
      nf = 2;
    } else if (f <= 5) {
      nf = 5;
    } else {
      nf = 10;
    }
    return nf * Math.pow(10, exp);
  }

  private formatPerfYAxis(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e9) {
      return `${(v / 1e9).toFixed(1)}B`;
    }
    if (a >= 1e6) {
      return `${(v / 1e6).toFixed(1)}M`;
    }
    if (a >= 1e3) {
      return `${(v / 1e3).toFixed(1)}k`;
    }
    if (a >= 100) {
      return v.toFixed(0);
    }
    if (a >= 10) {
      return v.toFixed(1);
    }
    return v.toFixed(2);
  }

  private formatPerfXAxis(raw: string): string {
    if (!raw) {
      return '—';
    }
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return raw.length > 6 ? raw.slice(5, 10) : raw;
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private formatPerfTooltipDate(raw: string): string {
    if (!raw) {
      return '—';
    }
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return raw;
    }
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  private formatPerfTooltipIso(raw: string): string {
    if (!raw) {
      return '—';
    }
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return raw.length >= 10 ? raw.slice(0, 10) : raw;
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatExtraFieldLabel(key: string): string {
    const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private perfTooltipExtrasFromRow(row: Record<string, unknown>): Array<{ label: string; value: string }> {
    const out: Array<{ label: string; value: string }> = [];
    const skip = new Set(['date', 'day', 'realized_pnl', 'realizedPnl', 'realizedPL']);
    for (const [k, val] of Object.entries(row)) {
      if (skip.has(k) || val === '' || val == null) {
        continue;
      }
      if (typeof val === 'number' && Number.isFinite(val)) {
        out.push({
          label: this.formatExtraFieldLabel(k),
          value: val.toLocaleString(undefined, { maximumFractionDigits: 8 })
        });
      } else if (typeof val === 'boolean') {
        out.push({ label: this.formatExtraFieldLabel(k), value: val ? 'Yes' : 'No' });
      } else if (typeof val === 'string') {
        out.push({ label: this.formatExtraFieldLabel(k), value: val });
      }
    }
    return out.slice(0, 10);
  }

  /** Reset hover + optional hit layout (e.g. empty chart). */
  clearPerfInteraction(clearHit = false): void {
    const hadHover = this.perfHoverIndex != null;
    this.perfHoverIndex = null;
    this.perfTooltip = {
      visible: false,
      left: 0,
      top: 0,
      dateLong: '',
      dateIso: '',
      periodIdx: '',
      pnlText: '',
      pnlNeg: false,
      pnlRaw: '',
      deltaText: '',
      deltaVisible: false,
      deltaNeg: false,
      cumText: '',
      cumNeg: false,
      spanMin: '',
      spanMax: '',
      rangeLabel: '',
      extras: []
    };
    if (clearHit) {
      this.perfHit = null;
    }
    if (hadHover) {
      this.scheduleChartDraw();
    }
    this.cdr.markForCheck();
  }

  onPerfPointerLeave(): void {
    this.clearPerfInteraction();
  }

  onPerfPointerMove(ev: MouseEvent): void {
    if (this.perfChartEmpty) {
      return;
    }
    const wrap = ev.currentTarget as HTMLElement;
    const cx = ev.clientX;
    const cy = ev.clientY;
    if (this.perfMoveRaf != null) {
      cancelAnimationFrame(this.perfMoveRaf);
    }
    this.perfMoveRaf = requestAnimationFrame(() => {
      this.perfMoveRaf = null;
      this.applyPerfPointerClientXY(cx, cy, wrap);
    });
  }

  onPerfTouchStart(ev: TouchEvent): void {
    if (this.perfChartEmpty || !ev.touches.length) {
      return;
    }
    const wrap = ev.currentTarget as HTMLElement;
    const t = ev.touches[0];
    this.applyPerfPointerClientXY(t.clientX, t.clientY, wrap);
  }

  onPerfTouchMove(ev: TouchEvent): void {
    if (this.perfChartEmpty || !ev.touches.length) {
      return;
    }
    const wrap = ev.currentTarget as HTMLElement;
    const t = ev.touches[0];
    if (this.perfMoveRaf != null) {
      cancelAnimationFrame(this.perfMoveRaf);
    }
    this.perfMoveRaf = requestAnimationFrame(() => {
      this.perfMoveRaf = null;
      this.applyPerfPointerClientXY(t.clientX, t.clientY, wrap);
    });
  }

  onPerfTouchEnd(): void {
    this.clearPerfInteraction();
  }

  private applyPerfPointerClientXY(clientX: number, clientY: number, wrap: HTMLElement): void {
    const hit = this.perfHit;
    const pts = this.perfChart;
    if (!hit || !pts.length) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < hit.plotL || x > hit.plotR || y < hit.plotT || y > hit.plotB) {
      this.clearPerfInteraction();
      return;
    }
    let idx = this.nearestPerfIndex(x, hit.plotL, hit.plotW, hit.n);
    idx = Math.max(0, Math.min(hit.n - 1, idx));
    const row = pts[idx] as unknown as Record<string, unknown>;
    const v = Number(row['realized_pnl'] ?? row['realizedPnl'] ?? row['realizedPL']);
    const val = Number.isFinite(v) ? v : 0;
    const dateStr = String(row['date'] ?? '');
    const vals = this.perfChart.map((p) => {
      const t = Number(p?.realized_pnl);
      return Number.isFinite(t) ? t : 0;
    });
    const prev = idx > 0 ? vals[idx - 1] : null;
    const delta = prev != null ? val - prev : null;
    let cum = 0;
    for (let i = 0; i <= idx; i++) {
      cum += vals[i] ?? 0;
    }
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);

    const pad = 10;
    const tw = 268;
    const th = 168;
    let left = x + 14;
    let top = y - th / 2;
    if (left + tw > rect.width - pad) {
      left = x - tw - 14;
    }
    left = Math.min(Math.max(pad, left), Math.max(pad, rect.width - tw - pad));
    top = Math.min(Math.max(pad, top), Math.max(pad, rect.height - th - pad));

    const prevIdx = this.perfHoverIndex;
    this.perfHoverIndex = idx;
    const extras = this.perfTooltipExtrasFromRow(row);
    this.perfTooltip = {
      visible: true,
      left,
      top,
      dateLong: this.formatPerfTooltipDate(dateStr),
      dateIso: this.formatPerfTooltipIso(dateStr),
      periodIdx: `${idx + 1} / ${hit.n}`,
      pnlText: `${val >= 0 ? '+' : ''}${this.brandFmt(val)}`,
      pnlNeg: val < 0,
      pnlRaw: val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }),
      deltaText:
        delta != null
          ? `${delta >= 0 ? '+' : ''}${delta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
          : '',
      deltaVisible: delta != null && idx > 0,
      deltaNeg: delta != null && delta < 0,
      cumText: `${cum >= 0 ? '+' : ''}${this.brandFmt(cum)}`,
      cumNeg: cum < 0,
      spanMin: mn.toLocaleString(undefined, { maximumFractionDigits: 4 }),
      spanMax: mx.toLocaleString(undefined, { maximumFractionDigits: 4 }),
      rangeLabel: `${this.analyticsStart} → ${this.analyticsEnd}`,
      extras
    };
    if (prevIdx !== idx) {
      this.scheduleChartDraw();
    }
    this.cdr.markForCheck();
  }

  private parseCssRgb(color: string, fallback: string): string {
    const trimmed = (color || '').trim();
    const m = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
      return `${m[1]}, ${m[2]}, ${m[3]}`;
    }
    let hex = trimmed.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r, g, b].some((x) => Number.isNaN(x))) {
        return `${r}, ${g}, ${b}`;
      }
    }
    return fallback;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  get profile() {
    return this.summary?.player_profile ?? null;
  }

  get wallet() {
    return this.summary?.wallet_info ?? null;
  }

  get margin() {
    return this.summary?.margin_info ?? null;
  }

  get trading() {
    return this.analytics?.trading_summary ?? null;
  }

  get pnl() {
    return this.analytics?.pnl_summary ?? null;
  }
  /** Normalize API shape (snake_case / camelCase) and numeric values */
  get perfChart(): PerformancePoint[] {
    const a = this.analytics as unknown as Record<string, unknown> | null | undefined;
    if (!a) {
      return [];
    }
    const raw =
      (a['performance_chart'] as unknown) ??
      (a['performanceChart'] as unknown) ??
      null;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map((row: unknown) => {
      const r = row as Record<string, unknown>;
      const v = Number(r['realized_pnl'] ?? r['realizedPnl'] ?? r['realizedPL']);
      return {
        date: String(r['date'] ?? r['day'] ?? ''),
        realized_pnl: Number.isFinite(v) ? v : 0
      };
    });
  }

  get transactions() {
    return this.activity?.recent_transactions ?? [];
  }

  get openPositions(): DashboardActivityPosition[] {
    return this.activity?.open_positions ?? [];
  }

  get openOrders(): DashboardActivityOpenOrder[] {
    return this.activity?.open_orders ?? [];
  }

  get recentTrades(): DashboardActivityTrade[] {
    return this.activity?.recent_trades ?? [];
  }

  get perfChartEmpty(): boolean {
    return !this.perfChart.length;
  }

  get winRatePct() {
    return this.trading?.win_rate ?? 0;
  }

  get totalTrades() {
    return this.trading?.total_trades ?? 0;
  }

  get winTrades() {
    return this.trading?.win_trades ?? 0;
  }

  get lossTrades() {
    return this.trading?.loss_trades ?? 0;
  }

  get pnlTotal(): number {
    const v = this.pnl?.realized_total;
    return v != null && Number.isFinite(v) ? v : 0;
  }

  get bestTrade() {
    return this.pnl?.best_trade ?? null;
  }

  get worstTrade() {
    return this.pnl?.worst_trade ?? null;
  }

  get bySymbol() {
    return this.pnl?.by_symbol ?? [];
  }

  get mostTraded() {
    return this.trading?.most_traded_symbols ?? [];
  }

  getPnlBarWidth(val: number): number {
    const all = this.bySymbol.map((s) => Math.abs(s.realized_pnl));
    const max = Math.max(...all, 1);
    return Math.min(100, Math.round((Math.abs(val) / max) * 100));
  }

  /** Coverage of equity over used margin — stable vs raw margin_level scaling */
  get marginHealthClass(): string {
    const u = this.margin?.used_margin ?? 0;
    const e = this.margin?.equity ?? 0;
    if (u <= 0) return 'safe';
    const ratio = e / u;
    if (ratio >= 2) return 'safe';
    if (ratio >= 1) return 'warn';
    return 'danger';
  }

  get marginLevelDisplay(): string {
    const ml = this.margin?.margin_level;
    if (ml == null || !Number.isFinite(ml)) return '—';
    return ml.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  get openPositionsCount(): number {
    return this.activity?.open_positions_total ?? 0;
  }
  get openOrdersCount(): number {
    return this.activity?.open_orders_total ?? 0;
  }

  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null || !Number.isFinite(v)) return '0';
    return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }

  formatDate(d: string): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  formatTime(d: string): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  orderStatusLabel(id: number): string {
    const m: Record<number, string> = {
      1: 'Pending',
      2: 'Filled',
      3: 'Partitally_Filled',
      4: 'Cancelled',
      5: 'Rejected',
      6: 'Expired'
    };
    return m[id] ?? `Status ${id}`;
  }

  txnClass(dir: string): string {
    return dir === 'CREDIT' ? 'pos' : 'neg';
  }

  txnSign(dir: string): string {
    return dir === 'CREDIT' ? '+' : '-';
  }
}

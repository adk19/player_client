import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewChecked, AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, inject, Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  Time,
} from 'lightweight-charts';
import { fromEvent, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { BinanceSocketService } from '../../../../services/binance-socket.service';
import { MarketDataService } from '../../../../services/market-data.service';
import type { Position } from '../../../../services/trading-socket.service';
import { WatchlistSocketService } from '../../../../services/watchlist-socket.service';
import { urlConstant } from '../../../../shared/constant/urlConstant';
import { MarketType } from '../../../../shared/services/market.constants';
import { SharedService } from '../../../../shared/services/shared.service';
import { TradingviewChartComponent } from '../tradingview-chart/tradingview-chart.component';

@Component({
  selector: 'app-crypto-chart-view',
  standalone: true,
  imports: [CommonModule, TradingviewChartComponent],
  templateUrl: './crypto-chart-view.component.html',
  styleUrls: ['./crypto-chart-view.component.scss'],
})
export class CryptoChartViewComponent
  implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy, OnChanges {
  @Input() symbol: string = '';
  @Input() theme: 'light' | 'dark' | 'auto' = 'auto';
  @Input() initialInterval?: string;
  @Input() currentSlug: string;
  @Input() pairDetail: any;

  isMarketClosed = false;
  private marketStatusSub?: Subscription;
  private watchlistSocket = inject(WatchlistSocketService);
  isWatchlisted: boolean = false;
  private watchlistSub?: Subscription;
  private currentWatchlist: any[] = [];

  private chartViewSingleTickerHandler?: (data: any) => void;
  singleTickerData: any = null;

  /** Holds the latest /v1/symbolInfo response for MT5/non-crypto symbols */
  symbolInfoData: any = null;
  private symbolInfoSub?: any;

  // Set to true when TradingView reports symbol unavailable — forces normal chart
  _tvFallback = false;

  get isTradingView(): boolean {
    if (this._tvFallback) return false;
    return this.pairDetail?.['is_tradingview'] === true;
  }

  get isMt5Chart(): boolean {
    const ex = (this.pairDetail?.exchange || '').toUpperCase();
    if (ex === 'MT' || ex === 'MT5') {
      return true;
    }
    const sym = this.symbol || this.pairDetail?.market;
    if (sym) {
      const svcMarkets = this.marketDataService?.markets;
      if (svcMarkets && Object.keys(svcMarkets).length > 0) {
        for (const type in svcMarkets) {
          const list = svcMarkets[type];
          if (!Array.isArray(list)) continue;
          const found = list.find((m: any) => m.market === sym);
          if (found) {
            const foundEx = (found.exchange || '').toUpperCase();
            if (foundEx === 'MT' || foundEx === 'MT5') {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  updateInfoBarFromPairDetail() {
    if (!this.pairDetail) return;

    const lp = this.livePrice != null ? Number(this.livePrice) : null;

    if (this.infoBar) {
      if (lp != null && lp > 0) {
        this.infoBar.close = lp;
        if (lp > this.infoBar.high) this.infoBar.high = lp;
        if (lp < this.infoBar.low) this.infoBar.low = lp;
        if (this.infoBar.open > 0) {
          this.infoBar.changePct = ((lp - this.infoBar.open) / this.infoBar.open) * 100;
          this.infoBar.isUp = lp >= this.infoBar.open;
        }
      }
      return;
    }

    const open = Number(this.pairDetail.open ?? this.pairDetail.close ?? this.pairDetail.ltp ?? lp ?? 0);
    const close = lp != null && lp > 0 ? lp : Number(this.pairDetail.close ?? this.pairDetail.ltp ?? 0);
    const high = Number(this.pairDetail.high ?? close ?? 0);
    const low = Number(this.pairDetail.low ?? close ?? 0);

    const changePct = Number(
      this.pairDetail.change_pct ??
      this.pairDetail.chgPct ??
      this.pairDetail.dailyChange ??
      (open > 0 ? ((close - open) / open) * 100 : 0)
    );

    this.infoBar = {
      time: '',
      open,
      high,
      low,
      close,
      changePct,
      absoluteChange: close - open,
      amplitudePct: open > 0 ? ((high - low) / open) * 100 : 0,
      isUp: close >= open
    };
  }

  @Input() livePrice: any;
  @Input() initialChartType?:
    | 'area'
    | 'candles'
    | 'bars'
    | 'histogram'
    | 'line'
    | 'baseline';

  /** Pending orders to draw as horizontal price lines on the chart */
  @Input() set pendingOrders(orders: any[]) {
    this._pendingOrders = orders || [];
    this._drawPendingOrderLines();
  }
  private _pendingOrders: any[] = [];

  /** Open positions — entry / SL / TP as price lines on the active symbol (lightweight chart only). */
  @Input() set openPositions(pos: Position[] | null | undefined) {
    this._openPositions = pos || [];
    this._drawOpenPositionLines();
  }
  private _openPositions: Position[] = [];

  // Map of order id → price line reference for cleanup
  private _pendingPriceLines = new Map<string | number, { series: any; line: any }>();
  /** Open position overlay lines (key: pos_<id>_<kind>) */
  private _positionPriceLines = new Map<string, { series: any; line: any }>();

  /** HTML overlays for entry markers (buy/sell dots + amount), synced to chart coords. */
  tradeMarkers: Array<{
    id: number;
    side: 'buy' | 'sell';
    label: string;
    left: number;
    top: number;
    visible: boolean;
  }> = [];

  private _activeSeriesForPendingLines(): any | null {
    // Price lines must be attached to the *visible* series for the current chart style.
    // Otherwise they can disappear when user switches chart type.
    switch (this.activeChartType) {
      case 'candles':
        return this.candleSeries || null;
      case 'area':
        return this.areaSeries || this.candleSeries || null;
      case 'bars':
        return this.barSeries || this.candleSeries || null;
      case 'histogram':
        return this.histogramSeries || this.candleSeries || null;
      case 'line':
        return this.lineSeries || this.candleSeries || null;
      case 'baseline':
        return (
          this.baselineSeries || this.areaSeries || this.candleSeries || null
        );
      default:
        return (
          this.candleSeries ||
          this.areaSeries ||
          this.lineSeries ||
          this.barSeries ||
          this.baselineSeries ||
          this.histogramSeries ||
          null
        );
    }
  }

  @Output() intervalChanged = new EventEmitter<string>();
  @Output() chartTypeChanged = new EventEmitter<'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline'>();
  @Output() klinePriceUpdate = new EventEmitter<number>();

  intervals: string[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

  activeInterval: string = '15m';
  currentChartType: string | 'Original' | 'Tradingview' | 'Depth' = 'Original';

  get displaySymbol(): string {
    return this.formatSymbol(this.symbol);
  }

  // Price display: kline close (via livePrice input) → infoBar close → 0
  get displayPrice(): number {
    if (this.isCryptoMarketType) {
      const c = this.livePrice && typeof this.livePrice === 'object'
        ? (this.livePrice?.c ?? this.livePrice?.['c'])
        : (this.pairDetail?.c ?? this.pairDetail?.['c']);
      if (c != null && Number.isFinite(Number(c)) && Number(c) > 0)
        return Number(c);
    }
    if (this.livePrice != null && Number.isFinite(Number(this.livePrice)) && Number(this.livePrice) > 0) {
      return Number(this.livePrice);
    }
    if (this.infoBar?.close && Number.isFinite(this.infoBar.close) && this.infoBar.close > 0) {
      return this.infoBar.close;
    }
    return 0;
  }

  get isCryptoMarketType(): boolean {
    try {
      const sym = this.symbol || this.pairDetail?.market;
      if (!sym) return false;
      const svcMkts2 = this.marketDataService?.markets;
      if (!svcMkts2 || typeof svcMkts2 !== 'object') return false;
      for (const marketType in svcMkts2) {
        const marketList = (svcMkts2 as any)[marketType];
        if (!Array.isArray(marketList)) continue;
        const found = marketList.find((m: any) => m?.market === sym);
        if (found) return String(marketType).toLowerCase() === 'crypto';
      }
    } catch { }
    // Conservative fallback — do not change existing behavior when we can't determine type.
    return false;
  }

  // Brand currency converted price shown beside pair-change
  get brandPrice(): { symbol: string; price: string } | '' {
    const price = this.displayPrice;
    if (!price) return '';
    const quoteCurrency = (this.pairDetail?.quote_currency_code || '') as string;
    const config = (this.sharedservice as any).brandConfigSubject?.getValue?.();
    if (!config) return '';
    const brandCurrency = config.currency_code as string;
    const symbol = (config.currency_symbol || '') as string;
    const decimals = (config.currency_decimal_places ?? 2) as number;

    // Same currency — just format with brand symbol, no conversion needed
    if (!quoteCurrency || quoteCurrency === brandCurrency) {
      return { symbol, price: price.toFixed(decimals) };
    }

    // Different currency — show only if an exchange rate exists
    const rate = this.sharedservice.getExchangeRate(quoteCurrency, brandCurrency);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) return '';
    const converted = price * rate;
    if (!Number.isFinite(converted) || converted <= 0) return '';
    return { symbol, price: converted.toFixed(decimals) };
  }

  isMobileChartExpanded = false;

  private readonly REALTIME_ANCHOR_FRACTION = 0.75;

  private applyRealtimeRightOffset() {
    if (!this.chart) return;

    try {
      const ts: any = this.chart.timeScale();
      const range = ts.getVisibleLogicalRange?.();
      if (!range || range.from == null || range.to == null) return;
      const visibleBars = Math.max(
        1,
        Math.round(Number(range.to) - Number(range.from)),
      );
      const f = Math.max(0.05, Math.min(0.95, this.REALTIME_ANCHOR_FRACTION));
      const rightBars = Math.max(1, Math.round(visibleBars * (1 - f)));
      ts.applyOptions?.({ rightOffset: rightBars });
    } catch { }
  }

  toggleMobileExpand() {
    if (window.innerWidth < 992) {
      this.isMobileChartExpanded = !this.isMobileChartExpanded;
      setTimeout(() => this.resize(), 50);
    }
  }

  @HostListener('window:resize') onWindowResize() {
    if (window.innerWidth >= 992 && this.isMobileChartExpanded) {
      this.isMobileChartExpanded = false;
    }
  }

  @ViewChild('chartContainer', { static: false })
  chartContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('tvContainer', { static: false })
  tvContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('depthContainer', { static: false })
  depthContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('intervalSegments') intervalSegments?: ElementRef<HTMLDivElement>;
  @ViewChild('chartTypeSegments') chartTypeSegments?: ElementRef<HTMLDivElement>;
  @ViewChild('intervalSegmentsInner') intervalSegmentsInner?: ElementRef<HTMLDivElement>;
  @ViewChild('chartTypeSegmentsInner') chartTypeSegmentsInner?: ElementRef<HTMLDivElement>;
  @ViewChild('crosshairPriceLabel') crosshairPriceLabel?: ElementRef<HTMLDivElement>;
  @ViewChild('crosshairTimeLabel') crosshairTimeLabel?: ElementRef<HTMLDivElement>;

  intervalIndicatorLeft = '0px';
  intervalIndicatorWidth = '0px';
  chartTypeIndicatorLeft = '0px';
  chartTypeIndicatorWidth = '0px';

  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private areaSeries?: ISeriesApi<'Area'>;
  private barSeries?: ISeriesApi<'Bar'>;
  private baselineSeries?: ISeriesApi<'Baseline'>;
  private histogramSeries?: ISeriesApi<'Histogram'>;
  private lineSeries?: ISeriesApi<'Line'>;

  private lastSmoothedArea?: number;
  private lastSmoothedLine?: number;
  private resizeSub?: Subscription;
  private themeMql?: MediaQueryList;
  private htmlClassObserver?: MutationObserver;

  private ws?: WebSocket;
  private klineHandler?: (msg: any) => void;
  private currentKlinePayload?: { symbol: string; interval: string };

  private depthTimer?: any;
  private tvWidget?: any;

  private _animationId?: number;
  private _lastBar?: {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  };
  private _targetBar?: {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
  };
  private _animStartTime?: number;
  private readonly ANIMATION_DURATION = 150;
  private _centerAnimId?: number;
  private vertLineEl?: HTMLDivElement;
  private horizLineEl?: HTMLDivElement;

  private priceTagEl?: HTMLDivElement;
  private gridRowsContainerEl?: HTMLDivElement;
  private gridRowEls: HTMLDivElement[] = [];

  private tenSecGridContainerEl?: HTMLDivElement;
  private tenSecGridLineEls: HTMLDivElement[] = [];

  private lastGridUpdateAt?: number;
  private liveAnimEnabled: boolean = true;

  private isLoadingMore: boolean = false;
  private autoScroll: boolean = true;
  private earliestOpenTimeMs: number | undefined;
  private fetchDebounce?: any;
  private lastFetchAt: number = 0;
  private lastFetchedEndTime?: number;
  private reachedDeadEnd: boolean = false;

  private loaderEl?: HTMLDivElement;
  private loaderImgEl?: HTMLImageElement;

  private countdownEl?: HTMLDivElement;

  private countdownTimerId?: number;

  private _inertiaId?: number;

  infoBar?: {
    time: string;

    open: number;
    high: number;
    low: number;
    close: number;

    changePct: number;
    absoluteChange?: number;
    amplitudePct: number;
    isUp: boolean;
  };

  private latestCandles: Array<{
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }> = [];

  private timeToIndex: Map<number, number> = new Map();
  private lastClosePrev: number = 0;

  private lastCandleTime: number | undefined;

  timeMode: boolean = false;

  showTypePanel = false;

  chartTypes: Array<{
    key: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline';
    label: string;
    icon: string;
    enabled: boolean;
  }> = [
      {
        key: 'area',
        label: 'Area',
        icon: 'fa-solid fa-chart-area',
        enabled: true,
      },
      {
        key: 'candles',
        label: 'Candles',
        icon: 'fa-solid fa-chart-column',
        enabled: true,
      },
      {
        key: 'bars',
        label: 'Bars',
        icon: 'fa-solid fa-chart-simple',
        enabled: true,
      },
      {
        key: 'histogram',
        label: 'Histogram',
        icon: 'fa-solid fa-chart-bar',
        enabled: true,
      },
      {
        key: 'line',
        label: 'Line',
        icon: 'fa-solid fa-chart-line',
        enabled: true,
      },
      {
        key: 'baseline',
        label: 'Baseline',
        icon: 'fa-solid fa-arrows-left-right-to-line',
        enabled: true,
      },
    ];

  activeChartType:
    | 'area'
    | 'candles'
    | 'bars'
    | 'histogram'
    | 'line'
    | 'baseline' = 'area';

  get activeChartTypeIcon(): string {
    const f = this.chartTypes.find((t) => t.key === this.activeChartType);
    return f?.icon || 'fa-solid fa-chart-column';
  }

  showTfPanel = false;

  toggleTfPanel(event: MouseEvent) {
    event.stopPropagation();
    this.showTfPanel = !this.showTfPanel;
  }

  applyInterval(itv: string) {
    this.showTfPanel = false;

    try {
      this.onIntervalChange(itv);
    } catch { }

    try {
      this.intervalChanged.emit(itv);
    } catch { }
  }

  @HostListener('document:click') onDocClick() {
    if (this.showTypePanel) this.showTypePanel = false;

    if (this.showTfPanel) this.showTfPanel = false;
  }

  toggleTypePanel(event: MouseEvent) {
    event.stopPropagation();

    this.showTypePanel = !this.showTypePanel;
  }

  applyChartType(t: {
    key: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline';
    enabled: boolean;
  }) {
    if (!t.enabled) return;

    this.activeChartType = t.key;

    this.showTypePanel = false;

    try {
      this.setChartStyle(t.key);
    } catch { }

    // Redraw pending order lines on the newly visible series
    try {
      this._drawPendingOrderLines();
    } catch { }
    try {
      this._drawOpenPositionLines();
    } catch { }

    try {
      this.chartTypeChanged.emit(this.activeChartType);
    } catch { }
  }

  updateSegIndicators(): void {
    this._updateIndicator(this.intervalSegments?.nativeElement, this.intervals.indexOf(this.activeInterval), (l, w) => {
      this.intervalIndicatorLeft = l;
      this.intervalIndicatorWidth = w;
    });
    this._updateIndicator(this.chartTypeSegments?.nativeElement, this.chartTypes.findIndex(t => t.key === this.activeChartType), (l, w) => {
      this.chartTypeIndicatorLeft = l;
      this.chartTypeIndicatorWidth = w;
    });
  }

  private _updateIndicator(
    container: HTMLDivElement | undefined,
    activeIdx: number,
    setter: (left: string, width: string) => void
  ): void {
    if (!container || activeIdx < 0) return;
    const btns = container.querySelectorAll<HTMLElement>('.seg-btn');
    const btn = btns[activeIdx];
    if (!btn) return;
    const left = btn.offsetLeft;
    const width = btn.offsetWidth;
    const curLeft = container.querySelector<HTMLElement>('.seg-indicator')?.style.left;
    const curWidth = container.querySelector<HTMLElement>('.seg-indicator')?.style.width;
    if (curLeft !== `${left}px` || curWidth !== `${width}px`) {
      Promise.resolve().then(() => {
        setter(`${left}px`, `${width}px`);
        this.cdr.markForCheck();
      });
    }
  }

  constructor(
    private http: HttpClient,
    public sharedservice: SharedService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private binanceSocket: BinanceSocketService,
  ) {
    this.marketDataService = inject(MarketDataService);
  }

  private readonly marketDataService: MarketDataService;

  /** When `is_tradingview` is true: crypto → BINANCE, non-crypto → PEPPERSTONE (TradingView). */
  get tradingViewUsesBinanceExchange(): boolean {
    const sym = (this.symbol || this.pairDetail?.market || '').trim();
    if (!sym) return false;
    return this.getMarketTypeFromSymbol(sym) === MarketType.CRYPTO;
  }

  private getMarketTypeFromSymbol(symbol: string): MarketType {
    // 1. Check MarketDataService markets — most accurate
    const svcMarkets = this.marketDataService.markets;
    if (Object.keys(svcMarkets).length > 0) {
      for (const type in svcMarkets) {
        const list = svcMarkets[type];
        if (!Array.isArray(list)) continue;
        const found = list.find((m: any) => m.market === symbol);
        if (found) {
          if (found.market_type_id === 1 || Number(found.market_type_id) === 1 || (found.exchange || '').toUpperCase() === 'BINANCE' || (found.path || '').toUpperCase().startsWith('CRYPTO')) {
            return MarketType.CRYPTO;
          }
          const mt = (found.market_type || type).toUpperCase();
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
          if (ex === 'MT' || ex === 'MT5') return MarketType.COMMODITY;
        }
      }
    }

    // 2. Pattern fallback — only CRYPTO patterns are reliable
    const u = symbol.toUpperCase();
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(u))
      return MarketType.CRYPTO;
    if (/^[A-Z]{6}$/.test(u)) return MarketType.FOREX;
    if (/^XAU|^XAG/.test(u)) return MarketType.METAL;
    if (
      /DOWJONES|NASDAQ|SP500|NIFTY|GERMANY|INDIA|USA|UK|JAPAN/.test(u) ||
      /\/\d+$/.test(u)
    )
      return MarketType.INDEX;

    // 3. Default → COMMODITY (MT5/HUB) — never default to CRYPTO for unknown symbols
    return MarketType.COMMODITY;
  }

  ngOnInit(): void {
    this.updateInfoBarFromPairDetail();
    // apply initial settings from parent (e.g. URL-driven interval/type)

    if (this.initialInterval) {
      this.activeInterval = this.initialInterval as any;
    }

    if (this.initialChartType) {
      this.activeChartType = this.initialChartType;
    }

    this.resizeSub = fromEvent(window, 'resize')
      .pipe(debounceTime(100))
      .subscribe(() => this.resize());

    // Subscribe to watchlist updates
    this.watchlistSub = this.watchlistSocket.watchlist$.subscribe((list) => {
      this.checkIfWatchlisted(list);
    });
    this.setupSingleTickerSubscription();
    this.marketStatusSub = this.binanceSocket.marketStatus$.subscribe(
      (statusMap) => {
        const isTrading = statusMap.get(this.symbol.toUpperCase());
        if (isTrading !== undefined) {
          this.isMarketClosed = !isTrading;
          this.cdr.markForCheck();
        }
      },
    );

    // Brand config can arrive after component init; wait for it so CSS var --primary is correct before chart/series creation.
    this.brandConfigSub = this.sharedservice.brandConfig$.subscribe((cfg) => {
      this._brandReady = !!cfg;
      this.refreshLoaderIcon();
      if (!this._brandReady) return;

      // If we deferred init waiting for brand config, initialize now.
      if (this._pendingInitDueToBrand && this.chartContainer && !this.chart && this.currentChartType === 'Original' && this.symbol) {
        this._pendingInitDueToBrand = false;
        try {
          if (this._brandInitRetryTimer) {
            clearTimeout(this._brandInitRetryTimer);
            this._brandInitRetryTimer = null;
          }
        } catch { }
        try {
          this.initChart();
        } catch { }
        try {
          this.loadDataAndStream();
        } catch { }
        try {
          this.resize();
        } catch { }
      }

      try {
        this.setChartStyle(this.activeChartType);
      } catch { }
      try {
        this.applyTheme();
      } catch { }
    });

    if (this.theme === 'auto') {
      if (window.matchMedia) {
        this.themeMql = window.matchMedia('(prefers-color-scheme: dark)');
        this.themeMql.addEventListener?.('change', () => this.applyTheme());
      }

      this.htmlClassObserver = new MutationObserver(() => this.applyTheme());
      this.htmlClassObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  private getLoaderIconSrc(): string | null {
    return this.sharedservice.brandFaviconUrl || null;
  }

  private refreshLoaderIcon() {
    if (!this.loaderImgEl) return;
    const src = this.getLoaderIconSrc();
    if (src) {
      this.loaderImgEl.src = src;
      this.loaderImgEl.style.visibility = 'visible';
      return;
    }
    this.loaderImgEl.removeAttribute('src');
    this.loaderImgEl.style.visibility = 'hidden';
  }

  private ensureCountdownElement() {
    if (this.countdownEl || !this.chartContainer) return;

    const el = document.createElement('div');
    el.className = 'chart-countdown';
    el.style.position = 'absolute';
    el.style.padding = '2px 6px';
    el.style.fontSize = '10px';
    el.style.lineHeight = '14px';
    el.style.borderRadius = '8px';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1';
    el.style.fontWeight = '700';
    el.style.minWidth = '42px';
    el.style.textAlign = 'center';
    this.styleCountdownByTheme(el);

    const host = this.chartContainer.nativeElement;

    if (getComputedStyle(host).position === 'static')
      host.style.position = 'relative';
    host.appendChild(el);
    this.countdownEl = el;
    this.updateCountdownPositionAndText();
  }

  private styleCountdownByTheme(el: HTMLDivElement) {
    const mode = this.resolveTheme();

    if (mode === 'dark') {
      el.style.background = 'rgba(255,255,255,0.14)';
      el.style.color = '#ffffff';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
      el.style.border = '1px solid rgba(255,255,255,0.18)';
    } else {
      el.style.background = 'rgba(0,0,0,0.08)';
      el.style.color = '#222';
      el.style.boxShadow = '0 2px 6px rgba(50,50,93,0.25)';
      el.style.border = '1px solid rgba(0,0,0,0.12)';
    }
  }

  private getIntervalMs(itv: string): number {
    switch (itv) {
      case '1s':
        return 1_000;

      case '1m':
        return 60_000;

      case '15m':
        return 900_000;

      case '1h':
        return 3_600_000;

      case '4h':
        return 14_400_000;

      case '1d':
        return 86_400_000;

      case '1w':
        return 604_800_000;

      case '1M':
        return 2_592_000_000;

      default:
        return 60_000;
    }
  }

  private formatRemaining(ms: number): string {
    if (ms < 0) ms = 0;

    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    if (h > 0)
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  private updateCountdownPositionAndText() {
    if (!this.chart || !this.chartContainer || !this.countdownEl || !this.latestCandles.length)
      return;

    try {
      const host = this.chartContainer.nativeElement;
      const rect = host.getBoundingClientRect();
      const last = this.latestCandles[this.latestCandles.length - 1];
      const ts: any = this.chart.timeScale();
      const xCoord = ts.timeToCoordinate?.(last.time);
      if (typeof xCoord !== 'number' || !isFinite(xCoord)) {
        this.countdownEl.style.display = 'none';
        return;
      }

      const itvMs = this.getIntervalMs(this.activeInterval);
      const lastOpenMs = (last.time as any) * 1000;
      const lastBoundary = Math.floor(lastOpenMs / itvMs) * itvMs;
      const nextBoundary = lastBoundary + itvMs;
      const now = Date.now();

      const remain = nextBoundary - now;

      this.countdownEl.textContent = this.formatRemaining(remain);
      let y: number | undefined;
      if (this.candleSeries) y = (this.candleSeries as any).priceToCoordinate?.(last.close);

      if (typeof y !== 'number' || !isFinite(y)) {
        this.countdownEl.style.display = 'none';
        return;
      }

      const offset = 8;

      const badgeW = Math.max(38, this.countdownEl.offsetWidth || 38);
      const badgeH = Math.max(18, this.countdownEl.offsetHeight || 18);
      const maxLeft = Math.max(0, rect.width - badgeW - 4);
      const left = Math.min(Math.round(xCoord + offset), Math.round(maxLeft));
      const maxTop = Math.max(0, rect.height - badgeH - 2);
      const desiredTop = Math.round(y - badgeH - 4);
      const top = Math.max(2, Math.min(desiredTop, maxTop));

      if (xCoord < -20 || xCoord > rect.width + 20) {
        this.countdownEl.style.display = 'none';
        return;
      }

      this.countdownEl.style.transform = `translate(${left}px, ${top}px)`;
      this.countdownEl.style.display = 'block';
      this.countdownEl.style.fontWeight = '700';
      this.countdownEl.style.textAlign = 'center';
      this.countdownEl.style.minWidth = '38px';
    } catch { }
  }

  private startCountdownTimer() {
    if (this.countdownTimerId) return;
    const freq = this.activeInterval === '1s' ? 100 : 250;
    this.countdownTimerId = window.setInterval(() => this.updateCountdownPositionAndText(), freq);
  }

  private stopCountdownTimer() {
    if (this.countdownTimerId) {
      try {
        clearInterval(this.countdownTimerId);
      } catch { }
      this.countdownTimerId = undefined;
    }
  }

  private formatSymbol(sym?: string): string {
    const s = (sym || '').toUpperCase();

    if (!s) return '';

    if (s.includes('/')) return s;

    const quotes = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'USD', 'EUR', 'INR'];

    for (const q of quotes) {
      if (s.endsWith(q) && s.length > q.length) {
        const base = s.slice(0, s.length - q.length);
        return `${base}/${q}`;
      }
    }

    const mid = Math.floor(s.length / 2);
    return `${s.slice(0, mid)}/${s.slice(mid)}`;
  }

  private shiftVisibleBy(deltaLogical: number) {
    try {
      const ts: any = this.chart?.timeScale();
      const lr = ts.getVisibleLogicalRange?.();
      if (!lr || lr.from == null || lr.to == null) return;
      ts.setVisibleLogicalRange({ from: Number(lr.from) + deltaLogical, to: Number(lr.to) + deltaLogical });
    } catch { }
  }

  private ensureLoaderOverlay() {
    if (this.loaderEl || !this.chartContainer) return;

    const el = document.createElement('div');

    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.display = 'none';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.backdropFilter = 'blur(5px)';
    el.style.zIndex = '2';
    el.style.pointerEvents = 'none';

    if (!document.getElementById('options-chart-loader-style')) {
      const st = document.createElement('style');

      st.id = 'options-chart-loader-style';

      st.textContent = `@keyframes pulse-zoom { 0% { transform: scale(0.9); opacity: 0.85; } 50% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(0.9); opacity: 0.85; } }`;

      document.head.appendChild(st);
    }

    const wrapper = document.createElement('div');

    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.width = '80px';
    wrapper.style.height = '80px';
    wrapper.style.borderRadius = '50%';
    wrapper.style.boxShadow = 'none';
    wrapper.className = 'logoloaderwrapper';

    const img = document.createElement('img');

    const loaderIconSrc = this.getLoaderIconSrc();
    if (loaderIconSrc) {
      img.src = loaderIconSrc;
      img.style.visibility = 'visible';
    } else {
      img.style.visibility = 'hidden';
    }

    img.alt = 'Loading';
    img.style.width = '60px';
    img.style.height = '60px';
    el.style.zIndex = '99';
    img.style.animation = 'pulse-zoom 1.7s ease-in-out infinite';
    img.style.boxShadow = 'none';
    wrapper.appendChild(img);
    el.appendChild(wrapper);

    const host = this.chartContainer.nativeElement;

    if (getComputedStyle(host).position === 'static')
      host.style.position = 'relative';

    host.appendChild(el);

    this.loaderEl = el;
    this.loaderImgEl = img;
  }

  private showLoader(message?: string) {
    if (!this.loaderEl) this.ensureLoaderOverlay();
    if (!this.loaderEl) return;
    this.loaderEl.style.display = 'flex';
  }

  private hideLoader() {
    if (this.loaderEl) this.loaderEl.style.display = 'none';
  }

  private renderGridRows(count: number) {
    if (!this.gridRowsContainerEl) return;

    const needed = Math.max(0, count);

    while (this.gridRowEls.length < needed) {
      const line = document.createElement('div');
      line.style.position = 'absolute';
      line.style.left = '0';
      line.style.right = '0';
      line.style.height = '1px';
      line.style.backgroundColor = this.resolveTheme() === 'dark' ? '#242634' : '#f5f5f5';
      this.gridRowsContainerEl.appendChild(line);
      this.gridRowEls.push(line);
    }

    while (this.gridRowEls.length > needed) {
      const last = this.gridRowEls.pop();

      last?.remove();
    }

    const step = 100 / (needed + 1);

    this.gridRowEls.forEach((line, i) => {
      const y = Math.round((i + 1) * step * 1000) / 1000;

      line.style.top = `calc(${y}% - 0.5px)`;
    });
  }

  private styleGridRows(color: string) {
    this.gridRowEls.forEach((l) => (l.style.backgroundColor = color));
  }

  // Track last known isTradingView state to detect transitions
  private _lastIsTradingView: boolean | null = null;
  private _viewInitialized = false;
  private _pendingChartInit = false;
  private brandConfigSub?: Subscription;
  private _brandReady = false;
  private _pendingInitDueToBrand = false;
  private _brandInitRetryTimer: any = null;
  private _brandInitRetryUntil = 0;

  ngAfterViewInit(): void {
    this._viewInitialized = true;
    this._lastIsTradingView = this.isTradingView;

    if (this.currentChartType === 'Original') {
      this.ensureOriginalChart();
    }
    setTimeout(() => this.updateSegIndicators(), 50);
  }

  ngAfterViewChecked(): void {
    if (this._pendingChartInit && this.chartContainer && this.currentChartType === 'Original') {
      this._pendingChartInit = false;
      try {
        this.destroyOriginal();
      } catch { }
      if (this.symbol) {
        this.initChart();
        this.loadDataAndStream();
        try {
          this.setChartStyle(this.activeChartType);
        } catch { }
        this.resize();
      }
    }
    this.updateSegIndicators();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialChartType'] && !changes['initialChartType'].firstChange) {
      const newType = changes['initialChartType'].currentValue;
      if (newType && newType !== this.activeChartType) {
        this.activeChartType = newType;
        try {
          this.setChartStyle(newType);
        } catch { }
      }
    }

    if (changes['symbol'] || changes['pairDetail']) {
      this.infoBar = undefined;
      this.updateInfoBarFromPairDetail();
      this.checkIfWatchlisted();
      this.setupSingleTickerSubscription();
      this.fetchSymbolInfo();
    } else {
      this.updateInfoBarFromPairDetail();
    }

    const symbolChanged = !!(
      changes['symbol'] && !changes['symbol'].firstChange
    );
    const pairDetailChanged = !!(
      changes['pairDetail'] && !changes['pairDetail'].firstChange
    );

    const nowTv = this.isTradingView;
    const wasTv = this._lastIsTradingView; // null on first change
    this._lastIsTradingView = nowTv;

    // We only want to reload or transition the chart if:
    // 1. The active symbol actually changed.
    // 2. The TradingView mode of the current symbol changed (wasTv !== nowTv).
    const isTvStateChanged = wasTv !== null && wasTv !== nowTv;

    if (!symbolChanged && !isTvStateChanged) {
      this.cdr.markForCheck();
      return;
    }

    this.currentChartType = 'Original';

    if (symbolChanged) {
      this.binanceSocket.resetMarketStatus(this.symbol);
      this.isMarketClosed = false;
      // Reset TV fallback for new symbol — it may support TradingView
      this._tvFallback = false;
    }

    this.cdr.markForCheck();

    if (!this._viewInitialized) return;

    if (nowTv && this.currentChartType === 'Tradingview') {
      // TradingView mode — tear down lightweight chart streams
      this.teardownKlineStream();
      return;
    }

    // Non-TV mode
    if (wasTv === true) {
      // Coming FROM TradingView — chartContainer may not be in DOM yet (was hidden by *ngIf)
      // destroyOriginal + reinit will happen in ngAfterViewChecked once DOM is ready
      this._pendingChartInit = true;
      this.cdr.markForCheck();
      return;
    }

    if (wasTv === null) {
      // First change — ngAfterViewInit already handled initial load, just reload data for new symbol
      if (this.currentChartType === 'Original') {
        if (!this.chart) this.initChart();
        if (this.symbol) this.loadDataAndStream();
        this.resize();
      }
      return;
    }

    // Normal non-TV symbol switch — chartContainer already in DOM
    if (this.currentChartType === 'Original') {
      if (!this.chart) this.initChart();
      if (this.symbol) this.loadDataAndStream();
      this.resize();
    }
  }

  ngOnDestroy(): void {
    this.cleanupAll();
    this.stopCountdownTimer();
    this.cleanupSingleTickerSubscription();
    if (this.symbolInfoSub) {
      this.symbolInfoSub.unsubscribe?.();
      this.symbolInfoSub = undefined;
    }
    if (this.watchlistSub) {
      this.watchlistSub.unsubscribe();
    }
    if (this.marketStatusSub) {
      this.marketStatusSub.unsubscribe();
    }
    if (this.brandConfigSub) {
      try {
        this.brandConfigSub.unsubscribe();
      } catch { }
    }
    try {
      if (this._brandInitRetryTimer) clearTimeout(this._brandInitRetryTimer);
    } catch { }

    try {
      this.countdownEl?.remove();
    } catch { }

    if (this.themeMql) {
      try {
        this.themeMql.removeEventListener?.('change', () => this.applyTheme());
      } catch { }
    }

    if (this.htmlClassObserver) {
      try {
        this.htmlClassObserver.disconnect();
      } catch { }
    }
  }

  // Called when TradingView widget reports symbol unavailable — fallback to normal chart
  onTvError(): void {
    this._tvFallback = true;
    this._pendingChartInit = true;
    this.cdr.markForCheck();
  }

  onIntervalChange(itv: string) {
    this.activeInterval = itv;
    this.liveAnimEnabled = itv !== '1m';
    if (this.isTradingView && this.currentChartType === 'Tradingview') {
      // TradingView child component picks up interval via @Input — no kline reload needed
      try {
        this.intervalChanged.emit(itv);
      } catch { }
      return;
    }

    if (this.currentChartType === 'Original') {
      if (this.symbol) this.loadDataAndStream();
    } else if (this.currentChartType === 'Tradingview') {
      this.ensureTradingView();
    } else if (this.currentChartType === 'Depth') {
      this.ensureDepthChart();
    }

    try {
      this.intervalChanged.emit(itv);
    } catch { }
  }

  resolveTheme(): 'light' | 'dark' {
    if (this.theme === 'auto') {
      const html = document.documentElement;
      if (html.classList.contains('light')) return 'light';
      if (html.classList.contains('dark')) return 'dark';
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }

    return this.theme;
  }

  private _readCssVar(name: string, fallback: string): string {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name)?.trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  private _rgbaFromHex(hex: string, alpha: number): string {
    const h = (hex || '').trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return `rgba(52, 151, 243, ${alpha})`;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  setChartType(type: 'Original' | 'Tradingview' | 'Depth') {
    if (this.currentChartType === type) return;

    this.currentChartType = type;

    if (type === 'Original') {
      this.destroyTv();
      this.destroyDepth();
      this._pendingChartInit = true;
      this.cdr.markForCheck();
    } else {
      setTimeout(() => {
        if (type === 'Tradingview') {
          this.destroyOriginal();
          this.destroyDepth();
          this.teardownKlineStream();
          if (!this.isTradingView) {
            this.ensureTradingView();
          }
        } else if (type === 'Depth') {
          this.destroyOriginal();
          this.destroyTv();
          this.teardownKlineStream();
          this.ensureDepthChart();
        }
      }, 0);
    }
  }

  private ensureOriginalChart() {
    if (!this.chartContainer) return;

    // Skip lightweight chart when TradingView chart type is active
    if (this.isTradingView && this.currentChartType === 'Tradingview') return;
    if (!this.chart) {
      this.initChart();
    }

    if (this.symbol) this.loadDataAndStream();

    // ensure visual style matches activeChartType (area/candles/...)

    try {
      this.setChartStyle(this.activeChartType);
    } catch { }
  }

  private initChart() {
    // If brand config hasn't arrived yet, delay chart init so CSS var --primary reflects brand primary_color.
    // Hard-stop after a short timeout to avoid deadlock if config fails.
    if (!this._brandReady) {
      const now = Date.now();
      if (!this._brandInitRetryUntil) this._brandInitRetryUntil = now + 1500;
      if (now < this._brandInitRetryUntil) {
        this._pendingInitDueToBrand = true;
        if (!this._brandInitRetryTimer) {
          this._brandInitRetryTimer = setTimeout(() => {
            this._brandInitRetryTimer = null;
            try { this.initChart(); } catch { }
          }, 50);
        }
        return;
      }
      // Timeout reached — proceed with whatever CSS vars exist.
      this._pendingInitDueToBrand = false;
    }

    const mode = this.resolveTheme();

    const textColor = mode === 'dark' ? '#B5BDC7' : '#444';

    const css = getComputedStyle(document.documentElement);
    // subtle grid/border lines on dark, not same as background
    const gridColor = css.getPropertyValue('--border-light')?.trim() || (mode === 'dark' ? '#20242c' : '#e9e9e9');

    const upVar = css.getPropertyValue('--green')?.trim() || '#0faf59';

    const downVar = css.getPropertyValue('--red')?.trim() || '#e85b4e';

    if (!this.chartContainer) return;

    this.chart = createChart(this.chartContainer.nativeElement, {
      layout: {
        // Transparent so the CSS checkered / paper background shows through.
        background: { color: 'transparent' },
        textColor,
        fontSize: 10 as any,
        attributionLogo: false as any,
      },

      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },

      timeScale: {
        borderColor: gridColor,
        timeVisible: true,
        secondsVisible: false,
        lockVisibleTimeRangeOnResize: true as any,
      },

      grid: {
        vertLines: {
          color: gridColor,
          style: LineStyle.Solid,
          visible: (this.activeInterval !== '1m') as any,
        },

        horzLines: {
          color: gridColor,
          style: LineStyle.Solid,
          visible: true as any,
        },
      },

      crosshair: {
        mode: 0,
        vertLine: { visible: false as any, labelVisible: false as any },
        horzLine: { visible: false as any, labelVisible: false as any },
      },

      autoSize: true,
    });

    this.vertLineEl?.remove();
    this.vertLineEl = undefined;

    this.horizLineEl?.remove();
    this.horizLineEl = undefined;

    this.gridRowsContainerEl?.remove();
    this.gridRowsContainerEl = undefined;

    this.gridRowEls = [];

    this.clearTenSecGrid();

    this.candleSeries = this.chart.addCandlestickSeries({
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      upColor: upVar,
      downColor: downVar,
      borderUpColor: upVar,
      borderDownColor: downVar,
      wickUpColor: upVar,
      wickDownColor: downVar,
      lastValueVisible: true,
      priceLineVisible: false,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      priceLineColor: gridColor,
    } as any);

    this.resize();

    try {
      if (this.autoScroll) this.applyRealtimeRightOffset();
    } catch { }

    this.applyTheme();

    this.ensureLoaderOverlay();

    // Draw pending order lines after chart is ready
    this._drawPendingOrderLines();
    this._drawOpenPositionLines();

    try {
      const tsApi: any = this.chart.timeScale();

      tsApi.subscribeVisibleTimeRangeChange?.(() => {
        this.updateTenSecGrid();
        this.onVisibleLogicalRangeChanged();
        this._updateTradeMarkers();
      });

      tsApi.subscribeVisibleLogicalRangeChange?.(() => {
        this.onVisibleLogicalRangeChanged();
        this.updateTenSecGrid();
        this._updateTradeMarkers();
      });
    } catch { }

    this.chart.subscribeCrosshairMove((param: any) => {
      if (!param || !param.time) {
        this.setInfoBarToLatest(true);
        this.hideCrosshairLabels();
        return;
      }

      const ts = typeof param.time === 'number' ? param.time : (param.time as any).timestamp;
      const idx = this.timeToIndex.get(ts);

      if (idx == null) {
        this.setInfoBarToLatest();
        return;
      }

      const c = this.latestCandles[idx];
      const prevClose = idx > 0 ? this.latestCandles[idx - 1].close : c.close;
      const info = this.composeInfo(c, prevClose);
      this.zone.run(() => {
        this.infoBar = info;
        this.cdr.markForCheck();
      });

      if (param.point) {
        this.showCrosshairLabels(param.point, c.close);
      }
    });
  }

  private ensurePriceTagElement() {
    if (this.priceTagEl || !this.chartContainer) return;

    const el = document.createElement('div');

    el.className = 'price-tag';
    const host = this.chartContainer.nativeElement;
    const cs = getComputedStyle(host);

    if (cs.position === 'static') host.style.position = 'relative';

    host.appendChild(el);
    this.priceTagEl = el;
  }

  // ── Pending Order Price Lines ─────────────────────────────────

  /**
   * Draw horizontal price lines for all pending orders on the active symbol.
   * Color coding:
   *   BUY_LIMIT  (2) → blue dashed   (below market — waiting for price to drop)
   *   SELL_LIMIT (3) → red dashed    (above market — waiting for price to rise)
   *   BUY_STOP   (4) → blue solid    (above market — breakout buy)
   *   SELL_STOP  (5) → red solid     (below market — breakdown sell)
   *   BUY_STOP_LIMIT  (6) → blue solid (stop) + blue dashed (limit)
   *   SELL_STOP_LIMIT (7) → red solid (stop) + red dashed (limit)
   */
  private _drawPendingOrderLines(): void {
    const series = this._activeSeriesForPendingLines();
    if (!series) return;

    // Remove all existing pending lines
    for (const [, ref] of this._pendingPriceLines) {
      try {
        (ref.series as any).removePriceLine(ref.line);
      } catch { }
    }
    this._pendingPriceLines.clear();

    const normSym = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chartSym = normSym(this.symbol || '');

    for (const order of this._pendingOrders) {
      const orderSym = normSym(order.symbol || order.market || '');
      if (orderSym !== chartSym) continue;

      const ot = order.order_type_id;
      const isBuy = [2, 4, 6].includes(ot);
      const color = isBuy ? '#2962FF' : '#F23645';
      const isDashed = [2, 3].includes(ot); // limit orders = dashed

      // Stop price line (for stop/stop-limit orders)
      if ([4, 5, 6, 7].includes(ot) && order.stop_price) {
        const lineId = `${order.id || order.order_id}_stop`;
        try {
          const line = (series as any).createPriceLine({
            price: Number(order.stop_price),
            color,
            lineWidth: 1,
            lineStyle: 0, // Solid
            axisLabelVisible: false,
            title: '',
          });
          this._pendingPriceLines.set(lineId, { series, line });
        } catch { }
      }

      // Limit / trigger price line
      const triggerPrice = order.limit_price || order.price;
      if (triggerPrice) {
        const lineId = `${order.id || order.order_id}_limit`;
        try {
          const line = (series as any).createPriceLine({
            price: Number(triggerPrice),
            color,
            lineWidth: 1,
            lineStyle: isDashed || [6, 7].includes(ot) ? 2 : 0, // Dashed for limit, solid for stop
            axisLabelVisible: false,
            title: '',
          });
          this._pendingPriceLines.set(lineId, { series, line });
        } catch { }
      }
    }
  }

  /**
   * Horizontal lines for open positions on this symbol: entry (solid), SL / TP (dashed).
   * Also refreshes HTML buy/sell markers at entry time/price.
   * Only for the embedded lightweight chart — not TradingView iframe.
   */
  private _drawOpenPositionLines(): void {
    if (this.isTradingView && this.currentChartType === 'Tradingview') {
      this.tradeMarkers = [];
      return;
    }

    const series = this._activeSeriesForPendingLines();
    if (!series) {
      this.tradeMarkers = [];
      return;
    }

    for (const [, ref] of this._positionPriceLines) {
      try {
        (ref.series as any).removePriceLine(ref.line);
      } catch {
        /* series may be gone */
      }
    }
    this._positionPriceLines.clear();

    const normSym = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chartSym = normSym(this.symbol || '');
    const detailSym = normSym(this.pairDetail?.market || '');

    // Exact match only — never startsWith (BTCUSD must not match BTCUSDT).
    const symMatch = (psym: string): boolean => {
      if (!psym) return false;
      return psym === chartSym || (!!detailSym && psym === detailSym);
    };

    for (const p of this._openPositions) {
      const psym = normSym(p.market || '');
      if (!symMatch(psym)) continue;

      const isBuy = p.type === 1;
      const entryColor = isBuy ? '#26a69a' : '#F23645';
      const pid = p.position_id;

      const entry = Number(p.entry_price);
      if (Number.isFinite(entry) && entry > 0) {
        const lineId = `pos_${pid}_entry`;
        try {
          const line = (series as any).createPriceLine({
            price: entry,
            color: entryColor,
            lineWidth: 1,
            lineStyle: 0,
            // Price only on the right axis — amount stays on the chart marker.
            axisLabelVisible: true,
            title: '',
          });
          this._positionPriceLines.set(lineId, { series, line });
        } catch {
          /* ignore */
        }
      }

      const sl = Number(p.stop_loss);
      if (Number.isFinite(sl) && sl > 0) {
        const lineId = `pos_${pid}_sl`;
        try {
          const line = (series as any).createPriceLine({
            price: sl,
            color: '#FF9800',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'SL',
          });
          this._positionPriceLines.set(lineId, { series, line });
        } catch {
          /* ignore */
        }
      }

      const tp = Number(p.take_profit);
      if (Number.isFinite(tp) && tp > 0) {
        const lineId = `pos_${pid}_tp`;
        try {
          const line = (series as any).createPriceLine({
            price: tp,
            color: '#4CAF50',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: 'TP',
          });
          this._positionPriceLines.set(lineId, { series, line });
        } catch {
          /* ignore */
        }
      }
    }

    this._updateTradeMarkers();
  }

  private _formatTradeMarkerLabel(p: Position): string {
    const amount = this._resolveTradeMarkerAmount(p);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    const config = (this.sharedservice as any).brandConfigSubject?.getValue?.();
    const symbol = (config?.currency_symbol || '').trim();
    const rounded =
      Math.abs(amount) >= 10 ? Math.round(amount) : Number(amount.toFixed(2));
    return `${symbol}${rounded}`;
  }

  private _resolveTradeMarkerAmount(p: Position): number {
    const margin = Number(p.used_margin);
    if (Number.isFinite(margin) && margin > 0) return margin;

    const qty = Number(p.quantity);
    const entry = Number(p.entry_price);
    if (!Number.isFinite(qty) || !Number.isFinite(entry) || qty <= 0 || entry <= 0) {
      return 0;
    }
    let notional = qty * entry;
    const quote = (this.pairDetail?.quote_currency_code || '') as string;
    const config = (this.sharedservice as any).brandConfigSubject?.getValue?.();
    const brand = (config?.currency_code || '') as string;
    if (quote && brand && quote !== brand) {
      const rate = this.sharedservice.getExchangeRate(quote, brand);
      if (rate && Number.isFinite(rate) && rate > 0) notional *= rate;
    }
    return notional;
  }

  private _positionOpenUnix(p: Position): number | null {
    if (!p.opened_at) return null;
    const ms = Date.parse(String(p.opened_at));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
  }

  /** Snap open time to nearest candle time so markers sit on bars. */
  private _snapToCandleTime(unixSec: number): number | null {
    if (!this.latestCandles.length) return unixSec;
    let best = this.latestCandles[0].time as number;
    let bestDist = Math.abs(best - unixSec);
    for (const c of this.latestCandles) {
      const t = c.time as number;
      const d = Math.abs(t - unixSec);
      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }
    return best;
  }

  private _updateTradeMarkers(): void {
    if (this.isTradingView && this.currentChartType === 'Tradingview') {
      this.tradeMarkers = [];
      return;
    }
    if (!this.chart) {
      this.tradeMarkers = [];
      return;
    }

    const series = this._activeSeriesForPendingLines();
    if (!series) {
      this.tradeMarkers = [];
      return;
    }

    const ts: any = this.chart.timeScale();
    const normSym = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const chartSym = normSym(this.symbol || '');
    const detailSym = normSym(this.pairDetail?.market || '');
    // Exact match only — never startsWith (BTCUSD must not match BTCUSDT).
    const symMatch = (psym: string): boolean => {
      if (!psym) return false;
      return psym === chartSym || (!!detailSym && psym === detailSym);
    };

    type Slot = { id: number; side: 'buy' | 'sell'; label: string; x: number; y: number };
    const slots: Slot[] = [];

    for (const p of this._openPositions) {
      if (!symMatch(normSym(p.market || ''))) continue;
      const entry = Number(p.entry_price);
      if (!Number.isFinite(entry) || entry <= 0) continue;

      const openUnix = this._positionOpenUnix(p);
      let x: number | null = null;
      if (openUnix != null) {
        const snapped = this._snapToCandleTime(openUnix);
        if (snapped != null) {
          x = ts.timeToCoordinate?.(snapped as Time);
        }
      }
      // Fallback: place near the right edge if time is unknown / off-scale
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        const last = this.latestCandles[this.latestCandles.length - 1];
        if (last) x = ts.timeToCoordinate?.(last.time as Time);
      }
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;

      const y = (series as any).priceToCoordinate?.(entry);
      if (typeof y !== 'number' || !Number.isFinite(y)) continue;

      slots.push({
        id: p.position_id,
        side: p.type === 1 ? 'buy' : 'sell',
        label: this._formatTradeMarkerLabel(p),
        x,
        y,
      });
    }

    // Cluster: nudge overlapping markers horizontally so they stay readable
    slots.sort((a, b) => a.x - b.x || a.y - b.y);
    const CLUSTER_PX = 22;
    const OFFSET = 26;
    for (let i = 1; i < slots.length; i++) {
      const prev = slots[i - 1];
      const cur = slots[i];
      if (Math.abs(cur.x - prev.x) < CLUSTER_PX && Math.abs(cur.y - prev.y) < CLUSTER_PX) {
        cur.x = prev.x + OFFSET;
      }
    }

    const next = slots.map((s) => {
      const hostW = this.chartContainer?.nativeElement?.clientWidth ?? 0;
      const priceScalePad = 72;
      const inPlot =
        s.x > 8 &&
        s.y > 8 &&
        (hostW <= 0 || s.x < hostW - priceScalePad);
      return {
        id: s.id,
        side: s.side,
        label: s.label,
        left: Math.round(s.x),
        top: Math.round(s.y),
        visible: inPlot,
      };
    });

    this.zone.run(() => {
      this.tradeMarkers = next;
      this.cdr.markForCheck();
    });
  }

  private updatePriceTag(price: number, yCoord?: number) {
    if (!this.chart || !this.candleSeries) return;

    this.ensurePriceTagElement();

    if (!this.priceTagEl) return;

    let y = yCoord;

    if (typeof y !== 'number') {
      y = (this.candleSeries as any).priceToCoordinate?.(price);
    }

    if (typeof y === 'number' && isFinite(y)) {
      const txt = Number(price).toFixed(2);
      this.priceTagEl.textContent = txt;
      this.priceTagEl.style.transform = `translateY(${Math.round(y)}px)`;
      this.priceTagEl.style.display = '';
      const prev = this.lastClosePrev || price;
      const isUp = price >= prev;
      this.priceTagEl.classList.toggle('up', isUp);
      this.priceTagEl.classList.toggle('down', !isUp);
    } else {
      this.priceTagEl.style.display = 'none';
    }
  }

  // ── TradingView-style crosshair axis labels ─────────────────
  private showCrosshairLabels(point: { x: number; y: number }, price: number) {
    if (!this.chart || !this.candleSeries) return;

    const priceEl = this.crosshairPriceLabel?.nativeElement;
    const timeEl = this.crosshairTimeLabel?.nativeElement;



    // Price label on right Y-axis
    if (priceEl) {
      const yCoord = (this.candleSeries as any).priceToCoordinate?.(price);

      if (typeof yCoord === 'number' && isFinite(yCoord)) {
        const txt = price >= 1000
          ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : price.toFixed(price < 1 ? 6 : 2);
        priceEl.textContent = txt;
        priceEl.style.top = `${Math.round(yCoord)}px`;
        priceEl.style.display = '';

      } else {
        priceEl.style.display = 'none';

      }
    }

    // Time label on bottom X-axis
    if (timeEl) {
      const timeScale = this.chart.timeScale();
      const timeVal = timeScale.coordinateToTime(point.x);

      if (timeVal != null) {
        const ts = typeof timeVal === 'number' ? timeVal : (timeVal as any)?.timestamp ?? 0;
        const dt = new Date(ts * 1000);
        const isDaily = ['1d', '1w', '1M'].includes(this.activeInterval);
        const timeStr = isDaily
          ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
          : dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        timeEl.textContent = timeStr;
        timeEl.style.left = `${Math.round(point.x)}px`;
        timeEl.style.display = '';

      } else {
        timeEl.style.display = 'none';

      }
    }
  }

  private hideCrosshairLabels() {
    const priceEl = this.crosshairPriceLabel?.nativeElement;
    const timeEl = this.crosshairTimeLabel?.nativeElement;
    if (priceEl) priceEl.style.display = 'none';
    if (timeEl) timeEl.style.display = 'none';
  }

  toggleTimeMode() {
    this.timeMode = !this.timeMode;

    if (this.timeMode) {
      if (this.chart && !this.areaSeries) {
        const mode = this.resolveTheme();

        const primary = this._readCssVar('--primary', '#3497f3');
        const lineColor = primary;
        const topColor = this._rgbaFromHex(primary, 0.25);
        const bottomColor = this._rgbaFromHex(primary, 0.0);

        this.areaSeries = this.chart.addAreaSeries({
          lineColor,
          topColor,
          bottomColor,
          lineWidth: 2,
          lastValueVisible: true,
        });
      }

      this.candleSeries?.applyOptions({ visible: false as any });

      if (this.areaSeries) {
        const areaData = this.latestCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }));

        this.areaSeries.setData(areaData as any);
      }
    } else {
      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }
      this.candleSeries?.applyOptions({ visible: true as any });
      if (this.candleSeries && this.latestCandles.length) {
        this.candleSeries.setData(this.latestCandles as any);
      }
    }

    this.updateArea1mMode();
    this.updateTenSecGrid();
  }

  setChartStyle(
    style: 'area' | 'candles' | 'bars' | 'baseline' | 'histogram' | 'line',
  ) {
    if (!this.chart) return;

    const css = getComputedStyle(document.documentElement);
    const upVar = css.getPropertyValue('--green')?.trim() || '#0faf59';
    const downVar = css.getPropertyValue('--red')?.trim() || '#e85b4e';

    if (style === 'area') {
      if (!this.timeMode) this.timeMode = true;

      if (!this.areaSeries) {
        const mode = this.resolveTheme();

        const primary = this._readCssVar('--primary', '#3497f3');
        const lineColor = primary;
        const topColor = this._rgbaFromHex(primary, 0.25);
        const bottomColor = this._rgbaFromHex(primary, 0.0);

        this.areaSeries = this.chart.addAreaSeries({
          lineColor,
          topColor,
          bottomColor,
          lineWidth: 2,
          lastValueVisible: true,
        });
      }

      this.candleSeries?.applyOptions({ visible: false as any });

      // If area series already exists (created before brand color applied), refresh its colors from CSS var.
      try {
        const primary = this._readCssVar('--primary', upVar);
        this.areaSeries?.applyOptions({ lineColor: primary, topColor: this._rgbaFromHex(primary, 0.25), bottomColor: this._rgbaFromHex(primary, 0.0), } as any);
      } catch { }

      this.barSeries?.applyOptions({ visible: false as any });
      if (this.baselineSeries) this.baselineSeries.applyOptions({ visible: false } as any);
      if (this.histogramSeries) this.histogramSeries.applyOptions({ visible: false } as any);
      this.lineSeries?.applyOptions({ visible: false as any });
      this.lastSmoothedArea = undefined;

      if (this.areaSeries) {
        const raw = this.latestCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }));
        const areaData = this.smoothArray(raw, 0.35);
        this.areaSeries.setData(areaData as any);
      }
    } else if (style === 'candles') {
      if (this.timeMode) this.timeMode = false;
      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }

      this.candleSeries?.applyOptions({ visible: true as any });
      this.barSeries?.applyOptions({ visible: false as any });
      if (this.baselineSeries) this.baselineSeries.applyOptions({ visible: false } as any);
      if (this.histogramSeries) this.histogramSeries.applyOptions({ visible: false } as any);
      this.lineSeries?.applyOptions({ visible: false as any });
      if (this.candleSeries && this.latestCandles.length) {
        this.candleSeries.setData(this.latestCandles as any);
      }

      this.enforceSquareGrid();
    } else if (style === 'bars') {
      if (this.timeMode) this.timeMode = false;

      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }

      if (!this.barSeries) {
        this.barSeries = this.chart.addBarSeries({
          upColor: upVar,
          downColor: downVar,
          thinBars: false,
        } as any);
      }

      this.candleSeries?.applyOptions({ visible: false as any });
      if (this.baselineSeries) this.baselineSeries.applyOptions({ visible: false } as any);
      if (this.histogramSeries) this.histogramSeries.applyOptions({ visible: false } as any);

      this.lineSeries?.applyOptions({ visible: false as any });

      this.barSeries?.applyOptions({ visible: true as any });

      if (this.barSeries && this.latestCandles.length) {
        this.barSeries.setData(this.latestCandles as any);
      }

      this.bumpSpacingForBars();
    } else if (style === 'baseline') {
      if (this.timeMode) this.timeMode = false;

      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }

      if (this.baselineSeries) {
        try {
          this.chart?.removeSeries(this.baselineSeries);
        } catch { }
        this.baselineSeries = undefined;
      }

      const canUseBaseline =
        typeof (this.chart as any).addBaselineSeries === 'function';

      if (canUseBaseline) {
        try {
          this.baselineSeries = this.chart.addBaselineSeries({
            topLineColor: upVar,
            topFillColor1: 'rgba(34, 171, 148, 0.35)',
            topFillColor2: 'rgba(34, 171, 148, 0.00)',
            bottomLineColor: downVar,
            bottomFillColor1: 'rgba(242, 54, 69, 0.35)',
            bottomFillColor2: 'rgba(242, 54, 69, 0.00)',
            lineWidth: 2,
            priceLineVisible: true,
            priceScaleId: 'right',
            crosshairMarkerVisible: false,
          } as any);
        } catch {
          this.baselineSeries = undefined;
          const up = this._readCssVar('--primary', upVar);
          this.areaSeries = this.chart.addAreaSeries({
            lineColor: up,
            topColor: this._rgbaFromHex(up, 0.25),
            bottomColor: this._rgbaFromHex(up, 0.0),
            lineWidth: 2,
            lastValueVisible: true,
          } as any);
        }
      } else {
        const up = this._readCssVar('--primary', upVar);
        const down = downVar;
        this.areaSeries = this.chart.addAreaSeries({
          lineColor: up,
          topColor: this._rgbaFromHex(up, 0.25),
          bottomColor: this._rgbaFromHex(up, 0.0),
          lineWidth: 2,
          lastValueVisible: true,
        } as any);
      }

      this.candleSeries?.applyOptions({ visible: false as any });
      this.barSeries?.applyOptions({ visible: false as any });
      if (this.histogramSeries) this.histogramSeries.applyOptions({ visible: false } as any);
      this.lineSeries?.applyOptions({ visible: false as any });
      this.baselineSeries?.applyOptions({ visible: true } as any);

      if (this.areaSeries && !this.baselineSeries)
        this.areaSeries.applyOptions({ visible: true } as any);

      if (this.latestCandles.length) {
        const data = this.latestCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }));

        if (this.baselineSeries) {
          this.baselineSeries.setData(data as any);

          try {
            const prev = this.latestCandles.length > 1 ? this.latestCandles[this.latestCandles.length - 2].close : this.latestCandles[this.latestCandles.length - 1].close;
            const base = Number.isFinite(this.lastClosePrev) ? this.lastClosePrev : prev;
            if (Number.isFinite(base)) {
              this.baselineSeries.applyOptions({ baseValue: { type: 'price', price: base } } as any);
            }
          } catch { }
        } else if (this.areaSeries) {
          this.areaSeries.setData(data as any);
        }
      }

      this.enforceSquareGrid();
    } else if (style === 'histogram') {
      if (this.timeMode) this.timeMode = false;

      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }

      if (!this.histogramSeries) {
        this.histogramSeries = this.chart.addHistogramSeries({
          color: '#9aa0a6',
          priceFormat: { type: 'volume' } as any,
          priceScaleId: '',
        } as any);

        try {
          (this.histogramSeries as any).priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        } catch { }
      } else {
        try {
          (this.histogramSeries as any).priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        } catch { }
      }

      this.candleSeries?.applyOptions({ visible: false as any });
      this.barSeries?.applyOptions({ visible: false as any });
      if (this.baselineSeries) this.baselineSeries.applyOptions({ visible: false } as any);
      if (this.lineSeries) this.lineSeries.applyOptions({ visible: false } as any);
      this.histogramSeries?.applyOptions({ visible: true } as any);
      if (this.histogramSeries && this.latestCandles.length) {
        const hist = this.latestCandles.map((c, i) => ({
          time: c.time,
          value: c.volume ?? 0,
          color: i === 0 ? '#999' : c.close >= this.latestCandles[i - 1].close ? upVar : downVar,
        }));

        this.histogramSeries.setData(hist as any);
      }

      this.enforceSquareGrid();
    } else if (style === 'line') {
      if (this.timeMode) this.timeMode = false;

      if (this.areaSeries) {
        try {
          this.chart?.removeSeries(this.areaSeries);
        } catch { }
        this.areaSeries = undefined;
      }

      if (!this.lineSeries) {
        const color = this._readCssVar('--primary', '#3497f3');
        this.lineSeries = this.chart.addLineSeries({
          color,
          lineWidth: 2,
        } as any);
      }

      // If line series already exists (created before brand color applied), refresh its color from CSS var.
      try {
        const primary = this._readCssVar('--primary', '#3497f3');
        this.lineSeries?.applyOptions({ color: primary } as any);
      } catch { }

      this.candleSeries?.applyOptions({ visible: false as any });

      this.barSeries?.applyOptions({ visible: false as any });

      if (this.baselineSeries) this.baselineSeries.applyOptions({ visible: false } as any);
      if (this.histogramSeries) this.histogramSeries.applyOptions({ visible: false } as any);

      this.lineSeries?.applyOptions({ visible: true } as any);
      this.lastSmoothedLine = undefined;

      if (this.lineSeries && this.latestCandles.length) {
        const raw = this.latestCandles.map((c) => ({
          time: c.time,
          value: c.close,
        }));

        const data = this.smoothArray(raw, 0.35);
        this.lineSeries.setData(data as any);
      }

      this.enforceSquareGrid();
    }

    this.updateArea1mMode();
    this.updateTenSecGrid();
  }

  private bumpSpacingForBars() {
    try {
      const ts: any = this.chart?.timeScale();

      if (!ts) return;

      const cur = ts.getBarSpacing?.();

      if (typeof cur === 'number' && isFinite(cur)) {
        ts.setBarSpacing(Math.min(cur * 1.25, cur + 12));
      }
    } catch { }
  }

  private smoothArray(
    arr: Array<{ time: Time; value: number }>,

    alpha: number,
  ): Array<{ time: Time; value: number }> {
    const a = Math.max(0, Math.min(1, alpha || 0));
    if (!arr || !arr.length || a === 0) return arr;
    let ema: number | undefined = undefined;
    const out: Array<{ time: Time; value: number }> = [];

    for (const p of arr) {
      const v = Number(p.value);
      if (!Number.isFinite(v)) {
        out.push(p);
        continue;
      }

      ema = ema === undefined ? v : a * v + (1 - a) * ema;
      out.push({ time: p.time, value: ema });
    }

    return out;
  }

  private stepEma(kind: 'area' | 'line', v: number, alpha: number): number {
    const a = Math.max(0, Math.min(1, alpha || 0));

    const x = Number(v);

    if (!Number.isFinite(x) || a === 0) return v;

    if (kind === 'area') {
      this.lastSmoothedArea = this.lastSmoothedArea === undefined ? x : a * x + (1 - a) * (this.lastSmoothedArea as number);
      return this.lastSmoothedArea as number;
    } else {
      this.lastSmoothedLine = this.lastSmoothedLine === undefined ? x : a * x + (1 - a) * (this.lastSmoothedLine as number);
      return this.lastSmoothedLine as number;
    }
  }

  private resize() {
    const el = this.chartContainer?.nativeElement;

    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width || el.clientWidth));
    const height = Math.max(0, Math.floor(rect.height || el.clientHeight));

    if (width && height) {
      this.enforceSquareGrid();

      this.renderGridRows(10);
      try {
        if (this.autoScroll) this.animateCenterToLast(350, 0.75);
      } catch { }
      try {
        if (this.autoScroll) this.applyRealtimeRightOffset();
      } catch { }
    }
  }

  private applyTheme() {
    const mode = this.resolveTheme();
    const textColor = mode === 'dark' ? '#B5BDC7' : '#444';
    const gridColor =
      getComputedStyle(document.documentElement).getPropertyValue('--border-light')?.trim() ||
      (mode === 'dark' ? '#20242c' : '#e9e9e9');

    if (this.chart) {
      this.chart.applyOptions({
        layout: { background: { color: 'transparent' }, textColor },

        grid: {
          vertLines: {
            color: gridColor,
            style: LineStyle.Solid,
            visible: (this.activeInterval !== '1m') as any,
          },

          horzLines: {
            color: gridColor,
            style: LineStyle.Solid,
            visible: true as any,
          },
        },

        rightPriceScale: { borderColor: gridColor },

        timeScale: { borderColor: gridColor },
      });

      this.chart.applyOptions({
        crosshair: {
          mode: 0,
          vertLine: { visible: false as any, labelVisible: false as any },
          horzLine: { visible: false as any, labelVisible: false as any },
        },
      });

      this.styleGridRows(gridColor);

      const priceLineColor = getComputedStyle(document.documentElement).getPropertyValue('--primary')?.trim() || (mode === 'dark' ? '#6b7280' : '#9ca3af');

      this.candleSeries?.applyOptions({
        priceLineVisible: false,
        priceLineWidth: 1,
        priceLineStyle: LineStyle.Dashed,
        priceLineColor,
      } as any);

      this.updateTenSecGrid();
    }

    if (this.loaderEl && this.loaderEl.firstElementChild) {
      const wrapper = this.loaderEl.firstElementChild as HTMLElement;

      if (mode === 'dark') {
        wrapper.style.background = 'rgba(0,0,0,0.22)';

        wrapper.style.boxShadow =
          'rgba(50, 50, 93, 0.25) 0px 6px 12px -2px, rgba(0, 0, 0, 0.3) 0px 3px 7px -3px';
      } else {
        wrapper.style.background = 'rgba(255,255,255,0.95)';
        wrapper.style.boxShadow =
          'rgba(50, 50, 93, 0.25) 0px 6px 12px -2px, rgba(0, 0, 0, 0.3) 0px 3px 7px -3px';
      }
    }
    const dAny = (this as any)._depthApplyTheme;
    if (typeof dAny === 'function') dAny();
  }

  private loadDataAndStream() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch { }
    }
    if (!this.symbol) return;

    // TradingView mode — skip klines API + kline socket subscription entirely
    if (this.isTradingView && this.currentChartType === 'Tradingview') return;

    // Use symbol as-is — no forced uppercase (backend expects original case)
    const sym = this.symbol;
    const itv = this.activeInterval;
    const limit = 100;
    let url: string;

    // Determine market type from MarketDataService
    let isCrypto = false;
    let aid: number | null = null;
    let marketName = 'CRYPTO';
    const svcMarkets = this.marketDataService.markets;
    if (Object.keys(svcMarkets).length > 0) {
      for (const marketType in svcMarkets) {
        const marketList = svcMarkets[marketType];
        if (Array.isArray(marketList)) {
          const found = marketList.find((m: any) => m.market === sym || m.market === sym.toUpperCase());
          if (found) {
            isCrypto = marketType.toLowerCase() === 'crypto';
            marketName = (found.market_type || marketType || 'CRYPTO').toString().toUpperCase();
            if (isCrypto) {
              if (found.market_sub_type_id === 2) {
                marketName = 'futures-usdt';
              } else if (found.market_sub_type_id === 1) {
                marketName = 'spot';
              }
            }
            aid = found.market_id ?? found.aid ?? null;
            break;
          }
        }
      }
    }

    // Fallback: check pairDetail
    if (!isCrypto && !aid) {
      aid = this.pairDetail?.aid ?? this.pairDetail?.market_id ?? this.pairDetail?.accountId ?? null;
    }
    if (this.pairDetail?.market_type) {
      marketName = String(this.pairDetail.market_type).toUpperCase();
      if (this.pairDetail?.market_type?.toUpperCase() === 'CRYPTO') {
        if (this.pairDetail?.market_sub_type_id === 2) {
          marketName = 'futures-usdt';
        } else if (this.pairDetail?.market_sub_type_id === 1) {
          marketName = 'spot';
        }
      }
    }

    if (isCrypto) {
      this.binanceSocket.setSymbolMarket(sym, marketName);
    }

    if (isCrypto) {
      url = urlConstant.klines(sym, itv, limit, marketName);
    } else {
      url = urlConstant.mtKlines(sym, itv, limit, aid);
    }

    // Start kline socket stream immediately — don't wait for HTTP
    this.startStream(sym, itv, isCrypto ? marketName : undefined);

    this.showLoader('Loading data…');

    try {
      this.baselineSeries?.applyOptions({ visible: false } as any);
    } catch { }

    this.http.get<any>(url).subscribe((res) => {
      const rows = Array.isArray(res) ? res : res && Array.isArray(res.data) ? res.data : [];

      const rowsSorted = [...rows].sort((a, b) => {
        const ta = a && a.length ? Number(a[0]) : 0;
        const tb = b && b.length ? Number(b[0]) : 0;
        return ta - tb;
      });

      const candles: Array<{
        time: Time;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }> = [];

      let lastTime = -Infinity;

      for (const r of rowsSorted as any[]) {
        if (!r || r.length < 6) {
          continue;
        }

        const t = Number(r[0]);

        if (!Number.isFinite(t)) {
          continue;
        }

        if (t <= lastTime) {
          // skip duplicate or out-of-order timestamps to keep data strictly increasing for Lightweight Charts

          continue;
        }

        lastTime = t;

        candles.push({
          time: (t / 1000) as Time,
          open: parseFloat(r[1]),
          high: parseFloat(r[2]),
          low: parseFloat(r[3]),
          close: parseFloat(r[4]),
          volume: parseFloat(r[5]),
        });
      }

      this.candleSeries?.setData(candles);

      if (this.areaSeries) {
        this.lastSmoothedArea = undefined;
        const raw = candles.map((c) => ({ time: c.time, value: c.close }));
        this.areaSeries.setData(this.smoothArray(raw, 0.35) as any);
      }

      if (this.barSeries) {
        this.barSeries.setData(candles as any);
      }

      if (this.lineSeries) {
        this.lastSmoothedLine = undefined;
        const raw = candles.map((c) => ({ time: c.time, value: c.close }));
        this.lineSeries.setData(this.smoothArray(raw, 0.35) as any);
      }

      if (this.baselineSeries) {
        const data = candles.map((c) => ({ time: c.time, value: c.close }));

        this.baselineSeries.setData(data as any);

        try {
          const prev = candles.length > 1 ? candles[candles.length - 2].close : candles[candles.length - 1]?.close;
          const base = Number.isFinite(this.lastClosePrev) ? this.lastClosePrev : prev;

          if (Number.isFinite(base)) {
            this.baselineSeries.applyOptions({
              baseValue: { type: 'price', price: base },
            } as any);
          }
        } catch { }

        try {
          this.baselineSeries.applyOptions({ visible: (this.activeChartType === 'baseline') } as any);
        } catch { }
      }

      if (this.histogramSeries) {
        const css = getComputedStyle(document.documentElement);

        const upVar = css.getPropertyValue('--green')?.trim() || '#22ab94';

        const downVar = css.getPropertyValue('--red')?.trim() || '#f23645';

        const hist = candles.map((c, i) => ({
          time: c.time,
          value: c.volume ?? 0,
          color: i === 0 ? '#999' : c.close >= candles[i - 1].close ? upVar : downVar,
        }));

        this.histogramSeries.setData(hist as any);
      }

      this.latestCandles = candles;
      this.earliestOpenTimeMs = candles.length ? (candles[0].time as number) * 1000 : undefined;
      this.reachedDeadEnd = false;
      this.timeToIndex.clear();

      for (let i = 0; i < candles.length; i++) {
        this.timeToIndex.set(candles[i].time as number, i);
      }

      // Reset lastCandleTime to avoid blocking first live update (like test HTML file)

      if (candles.length > 0) {
        this.lastCandleTime = candles[candles.length - 1].time as number;
      } else {
        this.lastCandleTime = undefined;
      }

      if (candles.length >= 1) {
        const n = candles.length;

        this.lastClosePrev = candles[n - 1].close;

        this.updatePriceTag(candles[n - 1].close);
      }

      this.enforceSquareGrid();

      try {
        (this.chart as any)?.timeScale?.().fitContent?.();
      } catch { }

      try {
        if (this.autoScroll) this.applyRealtimeRightOffset();
      } catch { }

      // startStream already called before HTTP — no duplicate needed

      this.setInfoBarToLatest(true);
      this.updateArea1mMode();
      this.updateTenSecGrid();

      this.autoScroll = true;

      try {
        this._drawPendingOrderLines();
      } catch {
        /* ignore */
      }
      try {
        this._drawOpenPositionLines();
      } catch {
        /* ignore */
      }

      this.hideLoader();
    });
  }

  private onVisibleLogicalRangeChanged() {
    if (!this.chart) return;

    try {
      const ts: any = this.chart.timeScale();

      const range = ts.getVisibleLogicalRange?.();
      if (!range || range.from == null || range.to == null) return;
      const total = this.latestCandles.length - 1;
      let nearRight = false;
      if (total >= 0) {
        nearRight = total - Number(range.to) <= 2;
        this.autoScroll = !!nearRight;
      }

      // `range.from` can stay high depending on whitespace/offset; prefer barsBefore when available.
      let nearLeft = false;
      try {
        const barsInfo = ts.barsInLogicalRange?.(range);
        const barsBefore = barsInfo?.barsBefore;
        if (typeof barsBefore === 'number') {
          nearLeft = barsBefore <= 10;
        }
      } catch { }
      if (!nearLeft) nearLeft = Number(range.from) <= 15;

      const shouldFetchOlder = !nearRight && nearLeft && !this.isLoadingMore && !this.reachedDeadEnd;

      if (shouldFetchOlder) {
        if (this.fetchDebounce) clearTimeout(this.fetchDebounce);

        this.fetchDebounce = setTimeout(() => {
          const now = Date.now();
          if (now - this.lastFetchAt < 1500) return;
          this.lastFetchAt = now;
          this.fetchMoreHistory();
        }, 250);
      }
    } catch { }
  }

  private fetchMoreHistory() {
    if (this.isLoadingMore || this.reachedDeadEnd) return;
    if (!this.symbol) return;

    const sym = this.symbol;
    const itv = this.activeInterval;
    if (!this.earliestOpenTimeMs) return;
    const supported = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
    if (supported.indexOf(itv) === -1) return;
    this.isLoadingMore = true;

    const endTime = this.earliestOpenTimeMs - 1;

    if (this.lastFetchedEndTime && this.lastFetchedEndTime === endTime) {
      this.isLoadingMore = false;
      return;
    }

    this.lastFetchedEndTime = endTime;
    const limit = 100;
    let url: string;

    // Check market type from MarketDataService

    let isCrypto = false;
    let marketName = 'CRYPTO';

    const svcMkts2 = this.marketDataService.markets;
    if (Object.keys(svcMkts2).length > 0) {
      for (const marketType in svcMkts2) {
        const marketList = svcMkts2[marketType];
        if (Array.isArray(marketList)) {
          const found = marketList.find((m: any) => m.market === sym);
          if (found) {
            isCrypto = marketType.toLowerCase() === 'crypto';
            marketName = (found.market_type || marketType || 'CRYPTO').toString().toUpperCase();
            if (isCrypto) {
              if (found.market_sub_type_id === 2) {
                marketName = 'futures-usdt';
              } else if (found.market_sub_type_id === 1) {
                marketName = 'spot';
              }
            }
            break;
          }
        }
      }
    }

    if (this.pairDetail?.market_type) {
      marketName = String(this.pairDetail.market_type).toUpperCase();
      if (this.pairDetail?.market_type?.toUpperCase() === 'CRYPTO') {
        if (this.pairDetail?.market_sub_type_id === 2) {
          marketName = 'futures-usdt';
        } else if (this.pairDetail?.market_sub_type_id === 1) {
          marketName = 'spot';
        }
      }
    }

    const mtAccountId = !isCrypto ? (this.pairDetail?.aid ?? this.pairDetail?.accountId ?? this.pairDetail?.mtAccountId) : undefined;

    if (isCrypto) {
      url = urlConstant.klinesWithEndTime(sym, itv, endTime, limit, marketName);
    } else {
      if (!mtAccountId) {
        this.isLoadingMore = false;
        return;
      }

      url = urlConstant.mtKlinesWithEndTime(sym, itv, endTime, limit);
    }

    let prevRange: any;

    try {
      prevRange = (this.chart as any).timeScale().getVisibleLogicalRange?.();
    } catch { }

    this.showLoader('Loading earlier data…');

    this.http.get<any>(url).subscribe({
      next: (res) => {
        try {
          const rows = Array.isArray(res) ? res : res && Array.isArray(res.data) ? res.data : [];

          if (!rows || rows.length === 0) {
            this.reachedDeadEnd = true;
            this.isLoadingMore = false;
            this.hideLoader();
            return;
          }

          const older = rows.map((r) => ({
            time: (r[0] / 1000) as Time,
            open: parseFloat(r[1]),
            high: parseFloat(r[2]),
            low: parseFloat(r[3]),
            close: parseFloat(r[4]),
            volume: parseFloat(r[5]),
          }));

          if (!older.length) {
            this.reachedDeadEnd = true;
            this.isLoadingMore = false;
            this.hideLoader();
            return;
          }

          const existingTimes = new Set(this.latestCandles.map((c) => c.time as number));
          const newCandles = older.filter((c) => !existingTimes.has(c.time as number));

          if (!newCandles.length) {
            this.reachedDeadEnd = true;
            this.isLoadingMore = false;
            this.hideLoader();
            return;
          }

          const normalizedOlder = newCandles.map((c) => ({
            ...c,
            volume: Number(c.volume ?? 0),
          }));

          const normalizedLatest = this.latestCandles.map((c) => ({
            ...c,
            volume: Number(c.volume ?? 0),
          }));

          const combined = normalizedOlder.concat(normalizedLatest).sort((a, b) => (a.time as number) - (b.time as number));
          this.latestCandles = combined;
          this.earliestOpenTimeMs = (combined[0].time as number) * 1000;

          if (this.candleSeries) this.candleSeries.setData(combined as any);
          if (this.areaSeries) {
            const data = combined.map((c: { time: any; close: any; }) => ({ time: c.time, value: c.close }));
            this.areaSeries.setData(data as any);
          }

          if (this.baselineSeries) {
            const data = combined.map((c) => ({
              time: c.time,
              value: c.close,
            }));

            this.baselineSeries.setData(data as any);

            try {
              const n = combined.length;
              const prev = n > 1 ? combined[n - 2].close : combined[n - 1]?.close;
              const base = Number.isFinite(prev) ? prev : undefined;

              if (Number.isFinite(base as any)) {
                this.baselineSeries.applyOptions({
                  baseValue: { type: 'price', price: base as number },
                } as any);
              }
            } catch { }
          }

          this.timeToIndex.clear();

          for (let i = 0; i < combined.length; i++)
            this.timeToIndex.set(combined[i].time as number, i);

          if (prevRange && prevRange.from != null && prevRange.to != null) {
            const added = newCandles.length;

            (this.chart as any).timeScale().setVisibleLogicalRange({
              from: Number(prevRange.from) + added,
              to: Number(prevRange.to) + added,
            });
          }
        } catch { }

        this.isLoadingMore = false;
        this.hideLoader();
      },
      error: () => {
        this.isLoadingMore = false;
        this.hideLoader();
      }
    });
  }

  private enforceSquareGrid() {
    try {
      if (!this.chart || !this.chartContainer) return;
      const rect = this.chartContainer.nativeElement.getBoundingClientRect();
      const h = rect.height || this.chartContainer.nativeElement.clientHeight;

      if (!h) return;
      const rows = 6;
      const base = Math.floor(h / rows);
      const cell = Math.max(8, Math.floor(base * 1.2));
      (this.chart as any).timeScale().setBarSpacing(cell);
      this.updateTenSecGrid();
    } catch { }
  }

  private startStream(sym: string, itv: string, marketName?: string) {
    const stream = `${sym.toLowerCase()}@kline_${itv}`;

    this.teardownKlineStream();

    // Determine market type from symbol for correct socket routing

    const marketType = this.getMarketTypeFromSymbol(sym);
    const payload: any = { symbol: sym, interval: itv };
    if (marketName) {
      payload.market = marketName;
    }
    this.binanceSocket.emitSubscribeKline(payload, marketType);
    this.currentKlinePayload = payload;

    const handler = (msg: any) => {
      try {
        let k: any;

        if (Array.isArray(msg) && msg.length >= 2 && typeof msg[1] === 'object') {
          k = msg[1].k;
        } else if (msg && typeof msg === 'object') {
          const data = (msg as any).data ?? msg;

          k = (data as any).k ?? data;
        }

        if (!k) {
          return;
        }

        let timeVal = Number(k.t);

        if (!Number.isFinite(timeVal)) {
          return;
        }

        if (timeVal > 20000000000) timeVal = Math.floor(timeVal / 1000);

        timeVal = Math.floor(timeVal);

        if (timeVal <= 0) {
          console.warn('Time value <= 0:', timeVal);

          return;
        }

        const bar = {
          time: timeVal as Time,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };

        // Emit the close price to parent component

        this.klinePriceUpdate.emit(bar.close);

        // Out-of-order updates can crash LightweightCharts internally

        if (
          Number.isFinite(this.lastCandleTime) &&
          (bar.time as number) < this.lastCandleTime
        ) {
          console.warn(
            'Out-of-order update detected, skipping:',
            bar.time,
            'last:',
            this.lastCandleTime,
          );

          return;
        }

        const lastIdxBefore = this.latestCandles.length - 1;
        const prevCloseRef = lastIdxBefore >= 0 ? this.latestCandles[lastIdxBefore].close : bar.close;
        this.lastClosePrev = prevCloseRef;
        const nowTs = Date.now();

        if (!this.lastGridUpdateAt || nowTs - this.lastGridUpdateAt >= 120) {
          this.updateTenSecGrid();
          this.lastGridUpdateAt = nowTs;
        }

        const ts = bar.time as number;

        const lastIdx = this.latestCandles.length - 1;

        if (
          lastIdx >= 0 &&
          (this.latestCandles[lastIdx]?.time as number) === ts
        ) {
          this.latestCandles[lastIdx] = bar as any;
        } else {
          this.latestCandles.push(bar as any);

          this.timeToIndex.set(ts, this.latestCandles.length - 1);
        }

        try {
          if (this.candleSeries) this.candleSeries.update(bar as any);

          if (this.barSeries) this.barSeries.update(bar as any);

          if (this.areaSeries) {
            const sv = this.stepEma('area', bar.close, 0.35);

            this.areaSeries.update({ time: bar.time, value: sv } as any);
          }

          if (this.lineSeries) {
            const sv = this.stepEma('line', bar.close, 0.35);

            (this.lineSeries as any).update({
              time: bar.time,
              value: sv,
            } as any);
          }

          if (this.baselineSeries) {
            this.baselineSeries.update({
              time: bar.time,
              value: bar.close,
            } as any);

            try {
              const base = Number.isFinite(this.lastClosePrev) ? this.lastClosePrev : bar.close;

              if (Number.isFinite(base)) {
                this.baselineSeries.applyOptions({
                  baseValue: { type: 'price', price: base },
                } as any);
              }
            } catch { }
          }

          if (this.histogramSeries) {
            const prev = this.lastClosePrev || bar.close;

            const css = getComputedStyle(document.documentElement);
            const upVar = css.getPropertyValue('--green')?.trim() || '#22ab94';
            const downVar = css.getPropertyValue('--red')?.trim() || '#f23645';
            const color = bar.close >= prev ? upVar : downVar;

            (this.histogramSeries as any).update({ time: bar.time, value: bar.volume ?? 0, color } as any);
          }
        } catch (e) {
          console.error('Chart update failed:', e, bar);

          return;
        }

        this.lastCandleTime = bar.time as number;
        this.setInfoBarToLatest(true);

        // Update price tag with current close price
        this.updatePriceTag(bar.close);
        // Only auto-scroll if user is already near latest data

        try {
          if (this.chart && this.latestCandles.length > 0 && this.autoScroll) {
            const ts: any = this.chart.timeScale();
            const lastIndex = this.latestCandles.length - 1;
            const range = ts.getVisibleLogicalRange?.();

            let nearRight = true;

            if (range && range.from != null && range.to != null) {
              const toNum = Number(range.to);

              // consider "near real-time" if right edge is within 2 bars of last index

              nearRight = lastIndex - toNum <= 2;
            }

            if (nearRight) {
              try {
                this.applyRealtimeRightOffset();
              } catch { }

              const r = ts.getVisibleLogicalRange?.();
              const visibleBars = r && r.from != null && r.to != null ? Math.max(1, Math.round(Number(r.to) - Number(r.from))) : 25;
              const off = Math.max(1, Math.round(visibleBars * (1 - this.REALTIME_ANCHOR_FRACTION)));

              ts.scrollToPosition?.(off, false);
            }
          }
        } catch { }
      } catch { }
    };

    this.klineHandler = handler;

    this.binanceSocket.onKline(handler, marketType);
  }

  private teardownKlineStream() {
    const marketType = this.currentKlinePayload ? this.getMarketTypeFromSymbol(this.currentKlinePayload.symbol) : MarketType.CRYPTO;

    if (this.klineHandler) {
      try {
        this.binanceSocket.offKline(this.klineHandler, marketType);
      } catch { }

      this.klineHandler = undefined;
    }

    if (this.currentKlinePayload) {
      try {
        this.binanceSocket.emitUnsubscribeKline(this.currentKlinePayload, marketType);
      } catch { }

      this.currentKlinePayload = undefined;
    }
  }

  private animateCenterToLast(durationMs = 300, positionFraction = 0.5) {
    if (!this.chart || !this.latestCandles.length) return;

    try {
      const ts: any = this.chart.timeScale();
      const lastIndex = this.latestCandles.length - 1;
      const cur = ts.getVisibleLogicalRange?.();
      const fixedVisibleCount = 25;
      const curFrom = Number(cur?.from ?? lastIndex - fixedVisibleCount);
      const curTo = Number(cur?.to ?? lastIndex);

      let width = curTo - curFrom;

      if (!isFinite(width) || width <= 0) width = fixedVisibleCount;

      const f = Math.max(0.05, Math.min(0.95, positionFraction));
      const total = fixedVisibleCount;
      let left = Math.floor(total * f);
      let right = total - left;

      if (left < 1) {
        left = 1;
        right = total - left;
      }

      if (right < 1) {
        right = 1;
        left = total - right;
      }

      const targetFrom = lastIndex - left;
      const targetTo = lastIndex + right;
      const startFrom = curFrom;
      const startTo = curTo;
      const start = performance.now();

      if (this._centerAnimId) cancelAnimationFrame(this._centerAnimId);

      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      const step = () => {
        const now = performance.now();
        const t = Math.min(1, (now - start) / Math.max(1, durationMs));
        const e = easeOutCubic(t);
        const from = startFrom + (targetFrom - startFrom) * e;
        const to = startTo + (targetTo - startTo) * e;

        try {
          ts.setVisibleLogicalRange({ from, to });
        } catch { }

        if (t < 1) {
          this._centerAnimId = requestAnimationFrame(step);
        } else {
          this._centerAnimId = undefined;
        }
      };

      this._centerAnimId = requestAnimationFrame(step);
    } catch { }
  }

  private isArea1m(): boolean {
    return this.timeMode && this.activeInterval === '1m';
  }

  private clearTenSecGrid() {
    if (this.tenSecGridLineEls.length) {
      for (const ln of this.tenSecGridLineEls) ln.remove();
    }

    this.tenSecGridLineEls = [];

    if (this.tenSecGridContainerEl) {
      this.tenSecGridContainerEl.remove();

      this.tenSecGridContainerEl = undefined;
    }
  }

  private updateArea1mMode() {
    if (!this.chart) return;

    const gridColor = this.resolveTheme() === 'dark' ? '#242634' : '#f5f5f5';

    if (this.isArea1m()) {
      this.chart.applyOptions({
        timeScale: { timeVisible: true, secondsVisible: true } as any,
      });

      this.clearTenSecGrid();
    } else {
      this.chart.applyOptions({
        timeScale: { timeVisible: true, secondsVisible: false } as any,
      });

      this.clearTenSecGrid();
    }
  }

  private updateTenSecGrid(forceRecreate = false) {
    return;
  }

  private composeInfo(
    c: { time: Time; open: number; high: number; low: number; close: number },
    prevClose: number,
  ) {
    const changePct = prevClose ? ((c.close - prevClose) / prevClose) * 100 : 0;
    const amplitudePct = prevClose ? ((c.high - c.low) / prevClose) * 100 : 0;
    const dt = new Date((c.time as number) * 1000);
    const timeStr = dt.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      time: timeStr,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      changePct,
      absoluteChange: prevClose ? c.close - prevClose : c.close - c.open,
      amplitudePct,
      isUp: c.close >= c.open,
    };
  }

  private setInfoBarToLatest(runInZone = false) {
    const n = this.latestCandles.length;
    if (!n) return;
    const last = this.latestCandles[n - 1];
    const prev = n > 1 ? this.latestCandles[n - 2] : last;
    const info = this.composeInfo(last, prev.close);
    if (runInZone) {
      this.zone.run(() => {
        this.infoBar = info;
        this.cdr.markForCheck();
      });
    } else {
      this.infoBar = info;
    }
  }

  private ensureTradingView() {
    if (!this.tvContainer) return;
    const w = window as any;
    const init = () => {
      this.destroyTv();
      const mode = this.resolveTheme();
      const containerId = `tv_${Math.random().toString(36).slice(2)}`;
      this.tvContainer!.nativeElement.id = containerId;
      const intervalMap: Record<string, string> = {
        '1m': '1',
        '15m': '15',
        '1h': '60',
        '4h': '240',
        '1d': 'D',
        '1w': 'W',
      };

      if (!this.symbol) return;

      const symU = this.symbol.toUpperCase();
      const tvEx = this.tradingViewUsesBinanceExchange
        ? 'BINANCE'
        : 'PEPPERSTONE';

      this.tvWidget = new w.TradingView.widget({
        autosize: true,
        symbol: `${tvEx}:${symU}`,
        interval: intervalMap[this.activeInterval] || '15',
        container_id: containerId,
        theme: mode,
        timezone: 'Etc/UTC',
        hide_side_toolbar: false,
        allow_symbol_change: false,
        studies: [],
        locale: 'en',
        toolbar_bg: 'transparent',
      });
    };

    if (!w.TradingView) {
      const s = document.createElement('script');
      s.src = 'https://s3.tradingview.com/tv.js';
      s.onload = () => init();
      document.body.appendChild(s);
    } else {
      init();
    }
  }

  private destroyTv() {
    try {
      if (this.tvContainer?.nativeElement) this.tvContainer.nativeElement.innerHTML = '';
      this.tvWidget = undefined;
    } catch { }
  }

  private ensureDepthChart() {
    if (!this.depthContainer) return;

    const w = window as any;

    const init = () => {
      this.destroyDepth();

      const el = this.depthContainer!.nativeElement;
      const echarts = w.echarts;
      const chart = echarts.init(el);

      const apply = (asks: number[][], bids: number[][]) => {
        const mode = this.resolveTheme();
        const text = mode === 'dark' ? '#B5BDC7' : '#444';
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--layout-bg')?.trim() || (mode === 'dark' ? '#1c1f2d' : '#ffffff');
        const gridLine = mode === 'dark' ? '#333943' : '#f5f5f5';
        const css = getComputedStyle(document.documentElement);
        const upVar = css.getPropertyValue('--green')?.trim() || '#0faf59';
        const downVar = css.getPropertyValue('--red')?.trim() || '#e85b4e';

        const mid = (() => {
          const bestBid = bids.length ? bids[0][0] : 0;
          const bestAsk = asks.length ? asks[0][0] : 0;
          return bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
        })();

        chart.setOption({
          backgroundColor: bg,
          textStyle: { color: text },
          animation: false,
          grid: { left: 50, right: 16, top: 8, bottom: 28 },
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross', lineStyle: { color: gridLine } },
            backgroundColor: '#fff',
            borderColor: 'rgba(0,0,0,0.08)',
            borderWidth: 1,
            textStyle: { color: '#333' },
            confine: true,
            padding: [8, 10],

            formatter: (params: any) => {
              const p = Array.isArray(params) ? params[0] || params : params;
              const price = +p.value[0];
              const amount = +p.value[1];
              const pct = mid ? ((price - mid) / mid) * 100 : 0;
              const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
              const pctColor = pct >= 0 ? '#f23645' : '#22ab94';
              const fmtAmt = amount >= 1000 ? `${(amount / 1000).toFixed(2).replace(/\.0+$/, '')}K` : amount.toFixed(2);

              const fmtPrice = new Intl.NumberFormat('en-US', {
                maximumFractionDigits: 2,
              }).format(price);

              return `
                  <div style="font-size:12px;">

                    <div style="display:flex;justify-content:space-between;gap:12px;">
                      <span>Range</span><span style="color:${pctColor};font-weight:600">${pctStr}</span>
                    </div>

                    <div style="display:flex;justify-content:space-between;gap:12px;">
                      <span>Price</span><span>${fmtPrice}</span>
                    </div>

                    <div style="display:flex;justify-content:space-between;gap:12px;">
                      <span>Amount</span><span>${fmtAmt}</span>
                    </div>

                  </div>`;
            },
          },

          xAxis: {
            type: 'value',
            boundaryGap: false,
            axisLine: { lineStyle: { color: gridLine } },
            splitLine: { show: true, lineStyle: { color: gridLine } },
            axisLabel: { color: text },
          },

          yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: gridLine } },
            splitLine: { show: true, lineStyle: { color: gridLine } },
            axisLabel: { color: text },
          },

          series: [
            {
              name: 'Bids',
              type: 'line',
              step: 'end',
              symbol: 'none',
              areaStyle: { color: upVar, opacity: 0.22 },
              lineStyle: { color: upVar, width: 1.5 },
              data: bids,
              markLine: {
                symbol: 'none',
                data: mid ? [{ xAxis: mid }] : [],
                lineStyle: { color: '#59606d' },
              },
            },

            {
              name: 'Asks',
              type: 'line',
              step: 'end',
              symbol: 'none',
              areaStyle: { color: downVar, opacity: 0.22 },
              lineStyle: { color: downVar, width: 1.5 },
              data: asks,
            },
          ],
        });
      };

      (this as any)._depthApplyTheme = () => {
        const mode = this.resolveTheme();
        const text = mode === 'dark' ? '#B5BDC7' : '#444';
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--layout-bg')?.trim() || (mode === 'dark' ? '#1c1f2d' : '#ffffff');

        const gridLine = mode === 'dark' ? '#333943' : '#f5f5f5';

        chart.setOption({
          backgroundColor: bg,

          textStyle: { color: text },

          xAxis: {
            axisLine: { lineStyle: { color: gridLine } },
            splitLine: { show: true, lineStyle: { color: gridLine } },
          },

          yAxis: {
            axisLine: { lineStyle: { color: gridLine } },
            splitLine: { show: true, lineStyle: { color: gridLine } },
          },
        });
      };

      const load = () => {
        if (!this.symbol) return;

        const sym = this.symbol.toUpperCase();

        fetch(urlConstant.depth(sym, 1000)).then((r) => r.json()).then((d) => {
          const asksRaw: [number, number][] = (d.asks || []).map((x: any) => [+x[0], +x[1]]).sort((a: any, b: any) => a[0] - b[0]);
          const bidsRawAsc: [number, number][] = (d.bids || []).map((x: any) => [+x[0], +x[1]]).sort((a: any, b: any) => a[0] - b[0]);
          const bestBid0 = bidsRawAsc[bidsRawAsc.length - 1]?.[0] || 0;
          const bestAsk0 = asksRaw[0]?.[0] || 0;
          const mid0 = bestBid0 && bestAsk0 ? (bestBid0 + bestAsk0) / 2 : bestBid0 || bestAsk0 || 0;
          const bidsSide = bidsRawAsc.filter(([p]) => p <= mid0);
          const asksSide = asksRaw.filter(([p]) => p >= mid0);

          let sum = 0;
          const asks: number[][] = [[mid0, 0]];

          for (const [p, q] of asksSide) {
            sum += q;
            asks.push([p, +sum.toFixed(6)]);
          }

          const bidsCum: Array<[number, number]> = [];
          let s2 = 0;

          for (const [p, q] of bidsSide) {
            s2 += q;
            bidsCum.push([p, +s2.toFixed(6)]);
          }

          const totalAtMid = bidsCum[bidsCum.length - 1]?.[1] || 0;

          const bids: number[][] = [];

          if (bidsCum.length) bids.push([mid0, 0]);

          for (const [p, c] of bidsCum) {
            bids.push([p, +(totalAtMid - c).toFixed(6)]);
          }

          const bestBid = bestBid0;
          const bestAsk = bestAsk0;

          const midPrice =
            bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
          const minBid = bidsSide[0]?.[0] || bestBid;
          const maxAsk = asksSide[asksSide.length - 1]?.[0] || bestAsk;
          const minPrice = minBid;
          const maxPrice = maxAsk;
          const maxQty = Math.max(asks.length ? asks[asks.length - 1][1] : 0, bids.length ? Math.max(...bids.map((x) => x[1])) : 0);

          const mode = this.resolveTheme();

          const text = mode === 'dark' ? '#B5BDC7' : '#444';

          const bg = getComputedStyle(document.documentElement).getPropertyValue('--layout-bg')?.trim() || (mode === 'dark' ? '#1c1f2d' : '#ffffff');

          const gridLine = mode === 'dark' ? '#333943' : '#f5f5f5';

          chart.setOption({
            backgroundColor: bg,

            textStyle: { color: text },

            xAxis: {
              min: minPrice,
              max: maxPrice,

              axisLine: { lineStyle: { color: gridLine } },

              splitLine: { show: true, lineStyle: { color: gridLine } },
              axisLabel: {
                color: text,
                formatter: (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v),
              },
            },
            yAxis: {
              min: 0,
              max: maxQty * 1.05,
              axisLine: { lineStyle: { color: gridLine } },
              splitLine: { show: true, lineStyle: { color: gridLine } },
              axisLabel: {
                color: text,
                formatter: (v: number) => v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(v)),
              },
            },
          });

          apply(asks, bids);
        }).catch(() => { });
      };

      load();

      this.depthTimer = setInterval(load, 2000);

      const onResize = () => chart.resize();

      window.addEventListener('resize', onResize);

      (this as any)._depthCleanup = () => {
        try {
          window.removeEventListener('resize', onResize);
          chart.dispose();
        } catch { }
      };
    };

    if (!w.echarts) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
      s.onload = () => init();
      document.body.appendChild(s);
    } else {
      init();
    }
  }

  private destroyDepth() {
    try {
      if (this.depthTimer) clearInterval(this.depthTimer);
    } catch { }

    try {
      if ((this as any)._depthCleanup) {
        (this as any)._depthCleanup();
        (this as any)._depthCleanup = undefined;
      }
    } catch { }

    try {
      if (this.depthContainer?.nativeElement)
        this.depthContainer.nativeElement.innerHTML = '';
    } catch { }
  }

  private _clearPriceLineOverlays(): void {
    for (const [, ref] of this._pendingPriceLines) {
      try {
        (ref.series as any).removePriceLine(ref.line);
      } catch {
      }
    }
    this._pendingPriceLines.clear();
    for (const [, ref] of this._positionPriceLines) {
      try {
        (ref.series as any).removePriceLine(ref.line);
      } catch {
        /* ignore */
      }
    }
    this._positionPriceLines.clear();
  }

  private destroyOriginal() {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = undefined;
      }
    } catch { }

    this.teardownKlineStream();

    // Cancel any pending animations/inertia that may reference chart/series

    if (this._animationId) {
      try {
        cancelAnimationFrame(this._animationId);
      } catch { }
      this._animationId = undefined;
    }

    if (this._centerAnimId) {
      try {
        cancelAnimationFrame(this._centerAnimId);
      } catch { }
      this._centerAnimId = undefined;
    }

    if (this._inertiaId) {
      try {
        cancelAnimationFrame(this._inertiaId);
      } catch { }
      this._inertiaId = undefined;
    }

    this._clearPriceLineOverlays();

    try {
      this.chart?.remove();
    } catch { }

    try {
      if (this.chartContainer?.nativeElement)
        this.chartContainer.nativeElement.innerHTML = '';
    } catch { }

    try {
      if ((this as any)._panCleanup) {
        (this as any)._panCleanup();
        (this as any)._panCleanup = undefined;
      }
    } catch { }

    // Clear series/chart references so later events can't accidentally use them

    this.candleSeries = undefined;
    this.areaSeries = undefined;
    this.barSeries = undefined;
    this.baselineSeries = undefined;
    this.histogramSeries = undefined;
    this.lineSeries = undefined;
    this.chart = undefined;
  }

  private cleanupAll() {
    this.destroyOriginal();
    this.destroyTv();
    this.destroyDepth();
  }

  // ── Watchlist / Favorites toggle ────────────────────────────
  checkIfWatchlisted(list?: any[]) {
    if (list) {
      this.currentWatchlist = list;
    }
    const currentSym = this.symbol || this.pairDetail?.market;
    if (!currentSym) {
      this.isWatchlisted = false;
      return;
    }
    this.isWatchlisted = this.currentWatchlist.some(
      (w) => (w.symbol || '').toUpperCase() === currentSym.toUpperCase()
    );
  }

  toggleWatchlist(event: MouseEvent) {
    event.stopPropagation();
    const marketId = this.pairDetail?.market_id || this.pairDetail?.aid || this.pairDetail?.id;
    if (!marketId) return;

    if (this.isWatchlisted) {
      this.watchlistSocket.removeWatchlist(marketId);
    } else {
      this.watchlistSocket.addWatchlist(marketId);
    }
  }

  // ── Single Ticker stream subscription ───────────────────────
  private getMarketType(): MarketType {
    const sym = this.symbol || this.pairDetail?.market || '';
    if (this.pairDetail) {
      if (this.pairDetail.market_type_id === 1 || Number(this.pairDetail.market_type_id) === 1 || (this.pairDetail.exchange || '').toUpperCase() === 'BINANCE' || (this.pairDetail.path || '').toUpperCase().startsWith('CRYPTO')) {
        return MarketType.CRYPTO;
      }
    }
    return this.getMarketTypeFromSymbol(sym);
  }

  private setupSingleTickerSubscription() {
    this.cleanupSingleTickerSubscription();

    const sym = this.symbol || this.pairDetail?.market;
    if (!sym) return;

    const mt = this.getMarketType();

    this.chartViewSingleTickerHandler = (data: any) => {
      try {
        const incomingSymbol = (data.s || '').toUpperCase();
        const normIncoming = incomingSymbol.replace(/[^A-Z0-9]/g, '');
        const currentActive = (this.symbol || this.pairDetail?.market || '').toUpperCase();
        const normActive = currentActive.replace(/[^A-Z0-9]/g, '');

        if (normIncoming !== normActive) return;

        this.singleTickerData = data;
        this.cdr.markForCheck();
      } catch { }
    };

    this.binanceSocket.onSingleTicker(this.chartViewSingleTickerHandler, mt);
    this.binanceSocket.updateSingleTickerSubscriptions([sym], mt, 'crypto-chart-view');
  }

  private cleanupSingleTickerSubscription() {
    if (this.chartViewSingleTickerHandler) {
      const mt = this.getMarketType();
      this.binanceSocket.offSingleTicker(this.chartViewSingleTickerHandler, mt);
      this.binanceSocket.updateSingleTickerSubscriptions([], mt, 'crypto-chart-view');
      this.chartViewSingleTickerHandler = undefined;
    }
    this.singleTickerData = null;
  }

  /** Fetches /v1/symbolInfo for MT5/non-crypto markets to populate pair-stats-row */
  private fetchSymbolInfo() {
    const sym = (this.symbol || this.pairDetail?.market || '').toUpperCase();
    if (!sym) return;

    // Only fetch for non-crypto markets (MT5: FOREX, METAL, STOCK, INDEX, etc.)
    if (this.isCryptoMarketType) {
      this.symbolInfoData = null;
      return;
    }

    if (this.symbolInfoSub) {
      this.symbolInfoSub.unsubscribe?.();
      this.symbolInfoSub = undefined;
    }

    this.symbolInfoSub = this.http
      .get<any>(`${urlConstant.symbolInfo(sym)}`)
      .subscribe({
        next: (data) => {
          if (data && data.s) {
            this.symbolInfoData = data;
            this.cdr.markForCheck();
          }
        },
        error: () => { this.symbolInfoData = null; }
      });
  }

  // ── Stats Getters ───────────────────────────────────────────

  /** Parses the P field from symbolInfo, e.g. "+0.66%" → 0.66 */
  get symbolInfoChangePct(): number | null {
    const p = this.symbolInfoData?.P;
    if (p == null) return null;
    const parsed = parseFloat(String(p).replace('%', ''));
    return isFinite(parsed) ? parsed : null;
  }

  get absoluteChange(): number {
    // symbolInfo (MT5): N = net change absolute
    if (!this.isCryptoMarketType && this.symbolInfoData?.N != null) {
      return Number(this.symbolInfoData.N);
    }
    if (this.infoBar && this.infoBar.absoluteChange != null) {
      return this.infoBar.absoluteChange;
    }
    const o = this.singleTickerData?.o ?? this.infoBar?.open ?? this.pairDetail?.open;
    if (o == null) return 0;
    const c = this.displayPrice;
    return c - Number(o);
  }

  get changePct(): number {
    // symbolInfo (MT5): P = percent change string like "+0.66%"
    if (!this.isCryptoMarketType) {
      const pct = this.symbolInfoChangePct;
      if (pct != null) return pct;
    }
    return this.infoBar?.changePct ?? 0;
  }

  get quoteVolume(): number {
    if (this.singleTickerData?.q != null) {
      return Number(this.singleTickerData.q);
    }
    const v = this.singleTickerData?.v ?? this.pairDetail?.volume;
    if (v != null && this.displayPrice) {
      return Number(v) * this.displayPrice;
    }
    return 0;
  }

  /** True when we have enough data to show the stats row */
  get hasStatsData(): boolean {
    if (this.singleTickerData) return true;
    if (this.symbolInfoData) return true;
    if (this.infoBar) return true;
    if (this.pairDetail) return true;
    return false;
  }

  get baseSymbol(): string {
    return (this.pairDetail?.base_currency_code || '').toUpperCase() ||
      (this.symbol || '').replace(/(USDT|USDC|BUSD|FDUSD|TRY|BTC|ETH|BNB|EUR|GBP|AUD|CAD)$/i, '').toUpperCase();
  }

  get quoteSymbol(): string {
    return (this.pairDetail?.quote_currency_code || '').toUpperCase() ||
      (this.symbol || '').replace(this.baseSymbol, '').toUpperCase();
  }

  get tokenNetworks(): string {
    const base = this.baseSymbol;
    switch (base) {
      case 'SOL': return 'SOL (2)';
      case 'BTC': return 'BTC (1)';
      case 'ETH': return 'ERC20 (3)';
      case 'BNB': return 'BSC (1)';
      case 'USDT': return 'TRC20 | ERC20';
      case 'USDC': return 'ERC20 | SOL';
      case 'XRP': return 'Ripple';
      case 'ADA': return 'Cardano';
      case 'DOT': return 'Polkadot';
      case 'DOGE': return 'Doge';
      case 'MATIC': case 'POL': return 'Polygon (2)';
      default: return base ? `${base}` : 'Mainnet';
    }
  }

  get tokenTags(): string[] {
    const base = this.baseSymbol;
    switch (base) {
      case 'SOL': return ['Layer 1 / Layer 2', 'Solana', 'Vol', 'Hot'];
      case 'BTC': return ['Layer 1', 'Store of Value', 'POW', 'Hot'];
      case 'ETH': return ['Layer 1', 'Smart Contract', 'Defi', 'POS', 'Hot'];
      case 'BNB': return ['Layer 1', 'Smart Contract', 'POS', 'Hot'];
      case 'USDT': return ['Stablecoin', 'Pegged', 'Fiat-backed'];
      case 'USDC': return ['Stablecoin', 'Pegged', 'Fiat-backed'];
      case 'XRP': return ['Payment', 'POS'];
      case 'ADA': return ['Layer 1', 'POS'];
      case 'DOT': return ['Layer 0', 'Interoperability'];
      case 'DOGE': return ['Meme', 'POW'];
      case 'MATIC': case 'POL': return ['Layer 2', 'Scaling', 'POS'];
      default: return ['Crypto', 'Vol'];
    }
  }
}
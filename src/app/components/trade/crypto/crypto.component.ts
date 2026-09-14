import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, HostListener, Inject, NgZone, OnDestroy, OnInit, PLATFORM_ID, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BinanceSocketService } from '../../../services/binance-socket.service';
import {
  buildLeverageTicks,
  clampLeverage,
  getLeverageSourceDescription,
  isLeverageAllowed,
  resolvePlanMarketTypeId,
  resolveTradeLeverage,
  type LeverageResolveResult
} from '../../../services/leverage-resolver';
import { MarketDataService } from '../../../services/market-data.service';
import { MarketHoursService } from '../../../services/market-hours.service';
import { PlayerDetailsService } from '../../../services/player-details.service';
import { TradingSocketService, type Position } from '../../../services/trading-socket.service';
import { WatchlistSocketService } from '../../../services/watchlist-socket.service';
import { urlConstant } from '../../../shared/constant/urlConstant';
import { AuthService } from '../../../shared/services/auth.service';
import { MARKET_MT_TY, MARKET_MT_TY_CODE, MarketType, SLUG_TO_MARKET } from '../../../shared/services/market.constants';
import { SharedService } from '../../../shared/services/shared.service';
import { CryptoChartViewComponent } from './crypto-chart-view/crypto-chart-view.component';
import { PositionsComponent } from './positions/positions.component';
import { WatchlistComponent } from './watchlist/watchlist.component';

@Component({
  selector: 'app-crypto',
  standalone: true,
  imports: [CommonModule, FormsModule, CryptoChartViewComponent, PositionsComponent, WatchlistComponent],
  templateUrl: './crypto.component.html',
  styleUrls: ['./crypto.component.scss', './crypto-desktop-layout.scss']
})

export class CryptoComponent implements OnInit, OnDestroy {
  base: string = '';
  quote: string = '';
  market: string = null;
  marketList: string[] = [];
  marketKey: string = null;
  marketType: MarketType = MarketType.CRYPTO;
  currentSlug: string = 'crypto';
  marketTypeLoading: MarketType | null = null;

  /** Desktop trade layout (>992px) — resizable column / row sizes */
  isDesktopLayout = false;
  leftColWidth = 380;
  rightColWidth = 380;
  positionsRowHeight = 220;
  activeResizeMode: 'left' | 'right' | 'positions' | null = null;
  private layoutResizeStartX = 0;
  private layoutResizeStartY = 0;
  private layoutResizeStartLeft = 0;
  private layoutResizeStartRight = 0;
  private layoutResizeStartPositions = 0;
  private layoutResizePointerId = -1;
  private layoutResizeCleanup: (() => void) | null = null;
  private static readonly DESKTOP_BP = 993;
  private static readonly LAYOUT_KEY = 'trade_desktop_layout_v1';
  /** Soft minimums only — max bounds come from the live shell size */
  private readonly LAYOUT_MIN_LEFT = 380;
  /** Market Execution panel — not narrower than this */
  private readonly LAYOUT_MIN_RIGHT = 380;
  private readonly LAYOUT_MIN_POSITIONS = 40;
  private readonly LAYOUT_MIN_TOP = 80;
  private readonly LAYOUT_RESIZER_H = 10;
  private readonly LAYOUT_MIN_CENTER = 160;



  // Market type tabs - dynamically generated from MarketType enum

  get marketTypes() {

    return Object.values(MarketType)
      .filter(value => typeof value === 'number')
      .map((value) => {
        const marketType = value as MarketType;
        const typeName = MARKET_MT_TY[marketType];

        return {
          key: typeName,
          label: typeName.charAt(0) + typeName.slice(1).toLowerCase(),
          value: marketType
        };
      });
  }


  switchMarketType(marketType: MarketType) {
    if (this.marketType === marketType) return;
    this.marketTypeLoading = marketType;
    // Call API first to get pairs

    let exUrl: string;

    if (marketType === MarketType.CRYPTO) {
      exUrl = urlConstant.exchangeInfo;
    } else {
      exUrl = urlConstant.mtExchangeInfo(MARKET_MT_TY_CODE[marketType]);
    }

    this.http.get<any>(exUrl).subscribe(info => {
      let pairs: Array<{ symbol: string; base: string; quote: string; description?: string; aid?: any; bid?: any; ask?: any; ltp?: any; chgPct?: any }> = [];

      if (marketType === MarketType.CRYPTO) {

        const payload = info?.symbols ? info : (info?.exchangeData || info);

        const syms = (payload?.symbols || []).filter((s: any) => s.status === 'TRADING');

        pairs = syms.map((s: any) => ({

          symbol: s.symbol,

          base: s.baseAsset,

          quote: s.quoteAsset,

        }));

      } else {

        const tyName = MARKET_MT_TY[marketType];

        const rows = (info as any[]).filter(r => !tyName || r.ty === tyName);

        pairs = rows.map((r: any) => ({

          symbol: r.s,

          base: r.s,

          quote: r.ty || '',

        }));

      }


      if (pairs.length > 0) {
        const firstPair = pairs[0].symbol;

        // Navigate to new URL with first pair
        this.router.navigate(['/trade'], {

          queryParams: {
            market: firstPair,
            timeframe: this.activeInterval || '15m',
            chart: this.activeChartType || 'area'
          },
          queryParamsHandling: 'merge'

        });



        this.marketType = marketType;

        this.currentSlug = 'crypto';



        // Clear existing data

        this.allPairs = [];

        this.filteredPairs = [];

        this.viewPairs = [];

        this.pairsLoading = true;



        // Set pairs directly from API response

        this.allPairs = pairs;

        this.load24hStats();

        this.connectCombinedStreams();

      }
      this.marketTypeLoading = null;
    });
  }

  // Floating timeframe controls

  @ViewChild('chart') chart!: CryptoChartViewComponent;

  showTfPanel = false;

  intervals: string[] = ['1m', '15m', '1h', '4h', '1d', '1w'];

  activeInterval: string = '15m';



  // Floating pair manager (top-left)

  showPairModal = false;

  showPairInfo = false;

  searchQuery = '';

  activePairTab: 'all' | 'starred' = 'all';

  starred = new Set<string>();

  // selected pairs shown in top bar

  selectedPairs: Array<{ symbol: string; base: string; quote: string }> = [];

  // minimal model for list entries

  allPairs: Array<{ symbol: string; description?: string; aid?: any; base: string; quote: string; bid?: any; ask?: any; ltp?: any; chgPct?: any; market_type?: string;[key: string]: any }> = [];

  filteredPairs: Array<{ symbol: string; base: string; quote: string }> = [];

  change24h: Record<string, number> = {};

  lastPrice: Record<string, number> = {};

  marketStats: {
    high24h?: number;
    low24h?: number;
    volume24h?: number;
    priceChangePercent?: number;
    prevClosePrice?: number;
    lastPrice?: number;
  } = {};

  private priceUpdateInterval: any;
  currentTime = new Date();

  // Market data storage

  high24h: { [key: string]: number } = {};
  low24h: { [key: string]: number } = {};
  volume24h: { [key: string]: number } = {};

  // Global tickers for movers/list

  tickers: Record<string, { s: string; last: number; prev: number; chgPct: number; prevChg?: number; q: number; h?: number; l?: number; bid?: number; ask?: number }> = {};

  // WebSocket related

  private miniFlushTimer?: any;
  private miniTickerSubscribed = false;
  private miniTickerHandler?: (data: any) => void;

  private allMiniTickerHandler?: (data: any[]) => void;



  private allTickerHandler?: (data: any[]) => void;

  private singleTickerHandler?: (data: any) => void;

  private combinedHandler?: (data: any) => void;



  // Movers / sidebar state

  readonly QUOTE_TABS_BASE = ['USDT', 'USDC', 'FDUSD', 'BNB', 'BTC', 'TUSD', 'TRY', 'EUR', 'BRL', 'GBP', 'AUD', 'CAD'];

  tabs: string[] = ['Liked', 'NEW'];

  favorites = new Set<string>();

  moverView: Array<{ symbol: string; base: string; quote: string; chgPct: number; info: string; time: number; icon: 'up' | 'down'; cat: string }> = [];

  private moversAll: Array<{ symbol: string; base: string; quote: string; chgPct: number; info: string; time: number; icon: 'up' | 'down'; cat: string }> = [];

  private moversTimer?: any;

  private pairsTimer?: any;

  private searchDebounce?: any;

  visiblePairs: Array<{ symbol: string; base: string; quote: string }> = [];

  private visibleCount = 100;

  visibleSet = new Set<string>();

  pairsLoading = true;

  pairSearchTxt: string = '';

  topMoverActive: string = 'Change';

  topMoverTabs: string[] = ['All', 'Change', 'New High/Low', 'Fluctuation', 'Volume'];



  // Right panel / order book

  activeRightTab: 'Overview' | 'History' = 'Overview';

  asks: { price: number; amount: number; total: number }[] = [];

  bids: { price: number; amount: number; total: number }[] = [];

  mixedLevels: { side: 'ask' | 'bid'; price: number; amount: number; total: number }[] = [];

  private pendingAsks: [string, string][] = [];

  private pendingBids: [string, string][] = [];

  private bookTimer?: any;



  // Active market stats for header

  lastPriceNow = 0;

  prevLastPriceNow = 0;

  priceUp = false;

  open24h = 0;

  baseVol24h = 0;

  quoteVol24h = 0;

  trades24h = 0;

  bestBidNow = 0;

  bestAskNow = 0;

  // Debounced display values — updated max once per 250ms to prevent flicker
  displayBid = 0;
  displayAsk = 0;
  displayBidStr = '-';
  displayAskStr = '-';
  private _priceFlushTimer: any;

  private flushDisplayPrices() {
    if (this._priceFlushTimer) return;
    this._priceFlushTimer = setTimeout(() => {
      this._priceFlushTimer = null;
      const bid = this.bestBidNow;
      const ask = this.bestAskNow;
      if (bid !== this.displayBid) {
        this.displayBid = bid;
        this.displayBidStr = this.smartFormatPrice(bid);
      }
      if (ask !== this.displayAsk) {
        this.displayAsk = ask;
        this.displayAskStr = this.smartFormatPrice(ask);
      }
      this.refreshVolumeFromBrandAmountMode();
    }, 250);
  }

  smartFormatPrice(v: number): string {
    if (!v || !Number.isFinite(v)) return '-';
    if (v >= 10000) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1000) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    if (v >= 1) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
    if (v >= 0.01) return v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
    return v.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
  }



  // Trade slip state

  slipPending = false;

  slipDurationSec = 60;

  slipInvest = 1000;

  slipInvestStep = 100;

  slipMinInvest = 10;

  slipMaxInvest = 100000;



  get walletBalanceNumber(): number {
    return Number(this.authService.currentBalance) || 0;
  }

  get walletBalanceDisplay(): string {
    return this.sharedService.formatToBrandCurrency(this.walletBalanceNumber);
  }

  // ── Order Type Constants ──────────────────────────────────────
  showTradePanel = false;

  openTradePanel(): void {
    if (!this.hasMarketSelected) return;
    this.syncTradeLeverageFromProfile(false);
    this.showTradePanel = true;
    this.refreshVolumeFromBrandAmountMode();
    document.body.style.overflow = 'hidden';
  }
  closeTradePanel(): void {
    this.closeLeveragePicker();
    this.showTradePanel = false;
    document.body.style.overflow = '';
  }

  get isTradeMobileViewport(): boolean {
    return !this.isDesktopLayout;
  }

  get leverageMarketTypeId(): number | null {
    return this.resolveLeverageMarketTypeId(this.activeSymbol);
  }

  private resolveLeverageMarketTypeId(symbol: string): number | null {
    const sym = (symbol || '').trim();
    if (!sym) return null;
    const pd = this.getPairDetail(sym);
    const fromPair = pd?.['market_type_id'];
    const marketTypeName = this.resolveLeverageMarketTypeName(symbol, pd);
    const plan = this.playerDetailsService.details?.leverage_plan;
    if (plan) {
      const resolved = resolvePlanMarketTypeId(plan, {
        marketTypeId: fromPair != null && Number.isFinite(Number(fromPair)) ? Number(fromPair) : null,
        marketTypeName
      });
      if (resolved != null) return resolved;
    }
    if (fromPair != null && Number.isFinite(Number(fromPair))) {
      return Number(fromPair);
    }
    const mt = this.getMarketTypeFromSymbol(sym);
    return MARKET_MT_TY_CODE[mt] ?? mt ?? null;
  }

  /** Prefer pair market_type, then page market, then symbol heuristic — for plan name matching. */
  private resolveLeverageMarketTypeName(
    symbol: string,
    pd?: Record<string, any> | null
  ): string | null {
    const fromPair = (pd?.['market_type'] as string)?.trim();
    if (fromPair) return fromPair;
    const fromPage = MARKET_MT_TY[this.marketType];
    if (fromPage) return fromPage;
    const inferred = this.getMarketTypeFromSymbol(symbol);
    return MARKET_MT_TY[inferred] ?? null;
  }

  get leverageProfileReady(): boolean {
    return !!this.playerDetailsService.details?.leverage_plan;
  }

  get leverageMaxHint(): string {
    if (!this.leverageProfileReady) {
      return 'Loading leverage from your profile…';
    }
    return getLeverageSourceDescription({
      defaultLeverage: this.tradeLeverage,
      maxLeverage: this.leverageMax,
      minLeverage: this.leverageMin,
      planDefaultLeverage: this.leveragePlanDefault,
      source: this.leverageSource,
      sourceLabel: this.leverageSourceDescription
    });
  }

  private normalizeLeverageSymbol(symbol: string): string {
    return (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Symbol changed — close picker, set leverage to profile max for that market. */
  applySymbolLeverageChange(symbol: string): void {
    this.closeLeveragePicker();
    this.syncTradeLeverageFromProfile(true, symbol);
    this.cdr.markForCheck();
  }

  /** Keep trade leverage within current symbol bounds before order submit. */
  private ensureTradeLeverageInBounds(): void {
    this.syncTradeLeverageFromProfile(false, this.activeSymbol);
    this.tradeLeverage = clampLeverage(
      this.tradeLeverage,
      this.leverageMin,
      this.leverageMax
    );
    this.leveragePickerDraft = this.tradeLeverage;
  }

  get leverageSliderTicks(): number[] {
    return buildLeverageTicks(this.leverageMax, 6);
  }

  /** 0–100 for slider fill (theme-aware CSS var). */
  get leverageSliderFillPct(): number {
    const span = this.leverageMax - this.leverageMin;
    if (span <= 0) return 0;
    const pct =
      ((this.leveragePickerDraft - this.leverageMin) / span) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  leverageTickPosition(tick: number): number {
    const span = this.leverageMax - this.leverageMin;
    if (span <= 0) return 0;
    return ((tick - this.leverageMin) / span) * 100;
  }

  /** Visual minor ticks between major leverage labels (4 per segment). */
  get leverageSliderMinorMarkPositions(): number[] {
    const majors = this.leverageSliderTicks.map((t) => this.leverageTickPosition(t));
    const minors: number[] = [];
    const perSegment = 4;
    for (let i = 0; i < majors.length - 1; i++) {
      const start = majors[i];
      const end = majors[i + 1];
      const step = (end - start) / (perSegment + 1);
      for (let j = 1; j <= perSegment; j++) {
        minors.push(start + step * j);
      }
    }
    return minors;
  }

  isLeverageTickActive(tick: number): boolean {
    return Math.abs(tick - this.leveragePickerDraft) < 0.5;
  }

  get leveragePickerSideLabel(): string {
    if (this.isPendingOrder) {
      return this.isBuySidePending ? 'Long' : 'Short';
    }
    const c = this.selectedOrderType?.color;
    if (c === 'buy') return 'Long';
    if (c === 'sell') return 'Short';
    return 'Trade';
  }

  get leveragePickerSideClass(): string {
    const label = this.leveragePickerSideLabel;
    if (label === 'Long') return 'ts-lev-side--long';
    if (label === 'Short') return 'ts-lev-side--short';
    return '';
  }

  syncTradeLeverageFromProfile(resetToDefault = false, symbolOverride?: string): void {
    const symbol = (symbolOverride ?? this.activeSymbol ?? '').trim();
    if (!symbol) {
      this.tradeLeverage = 1;
      this.leveragePickerDraft = 1;
      this.leverageMin = 1;
      this.leverageMax = 1;
      return;
    }

    if (
      symbolOverride &&
      this.normalizeLeverageSymbol(this.activeSymbol) !==
      this.normalizeLeverageSymbol(symbolOverride)
    ) {
      return;
    }

    const pd = this.getPairDetail(symbol);
    const plan = this.playerDetailsService.details?.leverage_plan;
    const resolved = resolveTradeLeverage(plan, {
      symbol,
      marketTypeId: this.resolveLeverageMarketTypeId(symbol),
      marketTypeName: this.resolveLeverageMarketTypeName(symbol, pd)
    });
    this.leverageMin = resolved.minLeverage;
    this.leverageMax = resolved.maxLeverage;
    this.leverageSource = resolved.source;
    this.leverageSourceDescription = resolved.sourceLabel;
    this.leveragePlanDefault = resolved.planDefaultLeverage;

    if (resetToDefault) {
      this.tradeLeverage = resolved.defaultLeverage;
    } else {
      this.tradeLeverage = clampLeverage(
        this.tradeLeverage,
        this.leverageMin,
        this.leverageMax
      );
    }
    this.leveragePickerDraft = clampLeverage(
      this.showLeveragePicker ? this.leveragePickerDraft : this.tradeLeverage,
      this.leverageMin,
      this.leverageMax
    );
  }

  openLeveragePicker(event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    if (!this.hasMarketSelected) return;
    if (this.showLeveragePicker) {
      this.closeLeveragePicker();
      return;
    }
    this.syncTradeLeverageFromProfile(false, this.activeSymbol);
    this.leveragePickerDraft = clampLeverage(
      this.tradeLeverage,
      this.leverageMin,
      this.leverageMax
    );
    this.updateLeveragePopoverPosition();
    this.showLeveragePicker = true;
    this.leverageIgnoreOutsideClick = true;
    setTimeout(() => {
      this.leverageIgnoreOutsideClick = false;
    }, 0);
  }

  private updateLeveragePopoverPosition(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.leveragePopoverStyle = {};
      return;
    }
    const gear = document.querySelector('.ts-leverage-gear-btn') as HTMLElement | null;
    if (!gear) {
      this.leveragePopoverStyle = { top: '120px', right: '16px' };
      return;
    }
    const rect = gear.getBoundingClientRect();
    const width = 280;
    const gap = 6;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const top = rect.bottom + gap;
    this.leveragePopoverStyle = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      zIndex: '100000000002',
      backgroundColor: 'var(--layout-bg)',
      background: 'var(--layout-bg)'
    };
  }

  closeLeveragePicker(): void {
    this.showLeveragePicker = false;
  }

  confirmLeveragePicker(): void {
    this.tradeLeverage = clampLeverage(
      this.leveragePickerDraft,
      this.leverageMin,
      this.leverageMax
    );
    this.leveragePickerDraft = this.tradeLeverage;
    this.closeLeveragePicker();
  }

  stepLeveragePickerDraft(delta: number): void {
    this.leveragePickerDraft = clampLeverage(
      this.leveragePickerDraft + delta,
      this.leverageMin,
      this.leverageMax
    );
  }

  onLeveragePickerDraftInput(): void {
    const clamped = clampLeverage(
      this.leveragePickerDraft,
      this.leverageMin,
      this.leverageMax
    );
    if (clamped !== this.leveragePickerDraft) {
      this.leveragePickerDraft = clamped;
    }
  }

  onLeveragePickerBlur(): void {
    this.onLeveragePickerDraftInput();
  }

  onLeveragePickerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmLeveragePicker();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClickCloseLeveragePicker(ev: MouseEvent): void {
    if (!this.showLeveragePicker || this.leverageIgnoreOutsideClick) return;
    const t = ev.target as HTMLElement | null;
    if (
      t?.closest('.ts-leverage-gear-btn') ||
      t?.closest('.ts-leverage-popover') ||
      t?.closest('.ts-leverage-offcanvas') ||
      t?.closest('.ts-lev-picker') ||
      t?.closest('.ts-leverage-offcanvas-backdrop')
    ) {
      return;
    }
    this.closeLeveragePicker();
  }

  @HostListener('window:resize')
  onResizeRepositionLeveragePopover(): void {
    if (this.showLeveragePicker && !this.isTradeMobileViewport) {
      this.updateLeveragePopoverPosition();
    }
  }
  readonly ORDER_TYPES = [
    { id: 1, label: 'Market Execution', color: 'default' },
    { id: 2, label: 'Buy Limit', color: 'buy' },
    { id: 3, label: 'Sell Limit', color: 'sell' },
    { id: 4, label: 'Buy Stop', color: 'buy' },
    { id: 5, label: 'Sell Stop', color: 'sell' },
    { id: 6, label: 'Buy Stop Limit', color: 'buy' },
    { id: 7, label: 'Sell Stop Limit', color: 'sell' },
  ];

  // UI expiration options — maps to backend enums automatically
  readonly EXPIRATION_TYPES = ['GTC', 'Today', 'Tomorrow', 'Custom Date', 'Custom DateTime'];

  // Active order type (1 = Market Execution by default)
  selectedOrderTypeId = 1;
  showOrderTypeDropdown = false;
  showVolumeModeDropdown = false;

  get selectedOrderType() {
    return this.ORDER_TYPES.find(t => t.id === this.selectedOrderTypeId)!;
  }

  // Is current order type a pending/limit/stop order (not market)?
  get isPendingOrder(): boolean {
    return this.selectedOrderTypeId !== 1;
  }

  // Does this order type need a stop_price field?
  get needsStopPrice(): boolean {
    return [4, 5, 6, 7].includes(this.selectedOrderTypeId);
  }

  // Does this order type need a limit_price field (stop-limit types)?
  get needsLimitPrice(): boolean {
    return [6, 7].includes(this.selectedOrderTypeId);
  }

  // Is this a BUY-side pending order?
  get isBuySidePending(): boolean {
    return [2, 4, 6].includes(this.selectedOrderTypeId);
  }

  // Is this a SELL-side pending order?
  get isSellSidePending(): boolean {
    return [3, 5, 7].includes(this.selectedOrderTypeId);
  }

  selectOrderType(id: number): void {
    this.selectedOrderTypeId = id;
    this.showOrderTypeDropdown = false;
    // Reset pending order fields on type change
    this.tradeSlip.limitPrice = 0;
    this.tradeSlip.stopPrice = 0;
    this.tradeSlip.stopLoss = 0;
    this.tradeSlip.takeProfit = 0;
    this.tradeSlip.expiration = 'GTC';
    this.tradeSlip.expirationDate = '';
    // Pre-fill price with current market price as starting point
    const refPrice = this.bestBidNow || this.bestAskNow || 0;
    if (refPrice > 0) {
      this.tradeSlip.limitPrice = +refPrice.toFixed(this.pairDecimalPlaces);
      this.tradeSlip.stopPrice = +refPrice.toFixed(this.pairDecimalPlaces);
    }
  }

  toggleVolumeModeDropdown(): void {
    if (!this.hasMarketSelected) return;
    this.showVolumeModeDropdown = !this.showVolumeModeDropdown;
  }

  selectVolumeMode(mode: 'lots' | 'qty' | 'amount'): void {
    this.showVolumeModeDropdown = false;
    this.setTradeVolumeInputMode(mode);
  }

  // Pending orders for chart lines
  chartPendingOrders: any[] = [];

  /** Open positions for entry / SL / TP lines on the lightweight chart */
  chartOpenPositions: Position[] = [];

  // MT5-style trade slip model

  tradeSlip = {
    volume: 0.1,
    stopLoss: 0,
    takeProfit: 0,
    limitPrice: 0,   // For BUY_LIMIT / SELL_LIMIT / BUY_STOP_LIMIT / SELL_STOP_LIMIT
    stopPrice: 0,    // For BUY_STOP / SELL_STOP / BUY_STOP_LIMIT / SELL_STOP_LIMIT
    expiration: 'GTC' as string,
    expirationDate: '' as string,
    comment: ''
  };

  tradeSlipVolumeStep = 0.1;

  readonly TRADE_SLIP_VOLUME_PRESETS: number[] = [0.01, 0.05, 0.1, 0.5, 1];

  /** Active market's quantity-per-lot (lot_size from pair detail). Defaults to 1 if not set. */
  get activeLotSize(): number {
    const pair = this.getPairDetail(this.activeSymbol);
    const size = (pair as any)?.lot_size;
    return size != null ? Number(size) : 1;
  }

  /** Actual quantity sent to API = volume (in lots) × lot_size per lot. */
  get tradeSlipQuantity(): number {
    if (this.tradeVolumeInputMode === 'qty') {
      return this.tradeSlip.volume || 0;
    }
    return (this.tradeSlip.volume || 0) * this.activeLotSize;
  }

  get tradeSlipVolumeLots(): number {
    if (this.tradeVolumeInputMode === 'qty') {
      return (this.tradeSlip.volume || 0) / this.activeLotSize;
    }
    return this.tradeSlip.volume || 0;
  }

  get volumePresets(): number[] {
    if (this.tradeVolumeInputMode === 'qty') {
      return this.TRADE_SLIP_VOLUME_PRESETS.map(v => +(v * this.activeLotSize).toFixed(4));
    }
    return this.TRADE_SLIP_VOLUME_PRESETS;
  }

  get tradeVolumeStep(): number {
    if (this.tradeVolumeInputMode === 'qty') {
      return this.activeLotSize >= 1 ? 1 : 0.01;
    }
    return this.tradeSlipVolumeStep;
  }

  /** User chooses lots (backend quantity) OR wallet-currency notional; API always gets lots. */
  tradeVolumeInputMode: 'lots' | 'qty' | 'amount' = 'lots';
  /** Desired notional in brand currency (e.g. INR) when `tradeVolumeInputMode === 'amount'`. */
  tradeSlipBrandAmount = 0;
  tradeSlipBrandAmountStep = 100;
  readonly TRADE_SLIP_BRAND_AMOUNT_PRESETS: number[] = [1000, 2500, 5000, 10000];

  /** Active order leverage (1..max from player profile for this symbol / market type). */
  tradeLeverage = 1;
  leverageMin = 1;
  leverageMax = 1;
  leverageSource: LeverageResolveResult['source'] = 'fallback';
  leverageSourceDescription = '';
  leveragePlanDefault = 1;
  showLeveragePicker = false;
  leveragePickerDraft = 1;
  leveragePopoverStyle: Record<string, string> = {};
  private leverageIgnoreOutsideClick = false;

  /** Amount → lots: preserve precision for display + `quantity` sent to API (not limited to 2 dp). */
  readonly TRADE_VOLUME_DECIMALS_AMOUNT = 8;
  readonly TRADE_VOLUME_MIN_AMOUNT = 1e-8;

  // Market status tracking
  isMarketOpen: boolean = true;
  private _marketTickTimer: any;

  // Stored market status — updated by 1-second timer, never computed in getter
  marketHoursStatus: { isOpen: boolean; nextCloseUtc: Date | null; nextOpenUtc: Date | null; reason: string } | null = null;
  marketCloseCountdown = '';
  marketOpenCountdown = '';
  todayMarketSessions: Array<{ start: string; end: string }> = [];

  // Real-time SL/TP validation errors (shown in template)
  get slError(): string | null {
    const sl = this.tradeSlip.stopLoss;
    if (!sl || sl <= 0) return null;
    const buyPrice = this.bestAskNow || 0;
    const sellPrice = this.bestBidNow || 0;
    // BUY: SL must be below ask
    if (sl >= buyPrice && buyPrice > 0) return `SL must be below ${buyPrice.toFixed(2)}`;
    // SELL: SL must be above bid
    if (sl <= sellPrice && sellPrice > 0) return `SL must be above ${sellPrice.toFixed(2)}`;
    return null;
  }

  get tpError(): string | null {
    const tp = this.tradeSlip.takeProfit;
    if (!tp || tp <= 0) return null;
    const buyPrice = this.bestAskNow || 0;
    const sellPrice = this.bestBidNow || 0;
    // BUY: TP must be above ask
    if (tp <= buyPrice && buyPrice > 0) return `TP must be above ${buyPrice.toFixed(2)}`;
    // SELL: TP must be below bid
    if (tp >= sellPrice && sellPrice > 0) return `TP must be below ${sellPrice.toFixed(2)}`;
    return null;
  }

  get slErrorBuy(): string | null {
    const sl = this.tradeSlip.stopLoss;
    if (!sl || sl <= 0) return null;
    const price = this.bestAskNow || 0;
    if (price > 0 && sl >= price) return `SL must be below ${price.toFixed(2)}`;
    return null;
  }

  get tpErrorBuy(): string | null {
    const tp = this.tradeSlip.takeProfit;
    if (!tp || tp <= 0) return null;
    const price = this.bestAskNow || 0;
    if (price > 0 && tp <= price) return `TP must be above ${price.toFixed(2)}`;
    return null;
  }

  get slErrorSell(): string | null {
    const sl = this.tradeSlip.stopLoss;
    if (!sl || sl <= 0) return null;
    const price = this.bestBidNow || 0;
    if (price > 0 && sl <= price) return `SL must be above ${price.toFixed(2)}`;
    return null;
  }

  get tpErrorSell(): string | null {
    const tp = this.tradeSlip.takeProfit;
    if (!tp || tp <= 0) return null;
    const price = this.bestBidNow || 0;
    if (price > 0 && tp >= price) return `TP must be below ${price.toFixed(2)}`;
    return null;
  }

  // Disable buy/sell buttons if SL/TP invalid, price is zero, market is closed, or exchange rate missing
  get buyDisabled(): boolean {
    if (!this.leverageProfileReady) return true;
    if (this.isExchangeRateMissing) return true;
    if (!this.computedMarketOpen) return true;
    if (!this.bestAskNow || this.bestAskNow <= 0) return true;
    return !!(this.slErrorBuy || this.tpErrorBuy);
  }

  get sellDisabled(): boolean {
    if (!this.leverageProfileReady) return true;
    if (this.isExchangeRateMissing) return true;
    if (!this.computedMarketOpen) return true;
    if (!this.bestBidNow || this.bestBidNow <= 0) return true;
    return !!(this.slErrorSell || this.tpErrorSell);
  }

  /** Pair has scheduled sessions from API (forex, stocks, etc.). */
  get hasTradingHours(): boolean {
    const pd = this.getPairDetail(this.activeSymbol);
    const th = pd?.['trading_hours'];
    return Array.isArray(th) && th.length > 0;
  }

  /** Scheduled markets require a valid utcg before trading is allowed. */
  get isUtcgMissing(): boolean {
    if (!this.hasTradingHours) return false;
    const pd = this.getPairDetail(this.activeSymbol);
    return !this.marketHours.isValidUtcOffset(pd?.['utcg'] as string | undefined);
  }

  /**
   * Market open/closed — scheduled markets need valid utcg + open session.
   * 24/7 symbols (no trading_hours) use socket isMarketOpen only.
   */
  get computedMarketOpen(): boolean {
    if (this.hasTradingHours) {
      if (this.isUtcgMissing) return false;
      if (this.marketHoursStatus !== null) return this.marketHoursStatus.isOpen;
      return false;
    }
    return this.isMarketOpen;
  }

  // ── Trade Guide — shown below trade slip on desktop (992px+) ──
  get tradeSlipPrice(): number {
    if (this.isPendingOrder) {
      return this.tradeSlip.limitPrice || this.tradeSlip.stopPrice || this.bestAskNow || this.lastPriceNow || 0;
    }
    return this.bestAskNow || this.lastPriceNow || 0;
  }

  get tradeNotionalUSD(): number {
    const price = this.tradeSlipPrice;
    return price * this.tradeSlipQuantity;
  }

  get tradeNotionalBrand(): string {
    const notional = this.tradeNotionalUSD;
    if (!notional) return '—';
    const pd = this.getPairDetail(this.activeSymbol);
    const quoteCurrency = (pd?.['quote_currency_code'] as string) || 'USD';
    const converted = this.sharedService.convertValueToBrandCurrency(notional, quoteCurrency);
    return this.sharedService.formatToBrandCurrency(converted || notional);
  }

  get hasTradeNotionalBrand(): boolean {
    return (this.tradeNotionalUSD ?? 0) > 0;
  }

  get tradeMarginRequiredRaw(): string {
    const price = this.tradeSlipPrice;
    if (!price || !this.tradeLeverage) return '—';
    const pd = this.getPairDetail(this.activeSymbol);
    const quoteCurrency = (pd?.['quote_currency_code'] as string) || 'USD';
    const margin = (price * this.tradeSlipQuantity) / this.tradeLeverage;
    return `${margin.toFixed(2)} ${quoteCurrency}`;
  }

  get tradeMarginRequiredBrand(): string {
    const price = this.tradeSlipPrice;
    if (!price || !this.tradeLeverage) return '—';
    const pd = this.getPairDetail(this.activeSymbol);
    const quoteCurrency = (pd?.['quote_currency_code'] as string) || 'USD';
    const margin = (price * this.tradeSlipQuantity) / this.tradeLeverage;
    const converted = this.sharedService.convertValueToBrandCurrency(margin, quoteCurrency);
    return this.sharedService.formatToBrandCurrency(converted || margin);
  }

  get hasTradeMarginRequiredBrand(): boolean {
    return this.tradeNotionalUSD > 0 && this.tradeLeverage > 0;
  }

  /** True when the active symbol's quote currency has no exchange rate to brand currency */
  get isExchangeRateMissing(): boolean {
    const pd = this.getPairDetail(this.activeSymbol);
    const quoteCurrency = (pd?.['quote_currency_code'] as string) || '';
    if (!quoteCurrency) return false;
    const brandCurrency = this.sharedService.getBrandCurrencyCode();
    if (!brandCurrency || quoteCurrency === brandCurrency) return false;
    return this.sharedService.getExchangeRate(quoteCurrency) === null;
  }

  get tradeNotionalRaw(): string {
    const price = this.tradeSlipPrice;
    if (!price) return '—';
    const pd = this.getPairDetail(this.activeSymbol);
    const quoteCurrency = (pd?.['quote_currency_code'] as string) || 'USD';
    const notional = price * this.tradeSlipQuantity;
    return `${notional.toFixed(2)} ${quoteCurrency}`;
  }

  get pairDecimalPlaces(): number {
    return (this.getPairDetail(this.activeSymbol)?.['decimal_places'] as number) ?? 2;
  }

  // ── Market Hours (from trading_hours + utcg) ──────────────
  private _refreshMarketHoursStatus(): void {
    const pd = this.getPairDetail(this.activeSymbol);
    const tradingHours = pd?.['trading_hours'];
    if (!Array.isArray(tradingHours) || !tradingHours.length) {
      this.marketHoursStatus = null;
      this.marketCloseCountdown = '';
      this.marketOpenCountdown = '';
      this.todayMarketSessions = [];
      return;
    }
    const utcg = pd?.['utcg'] as string | undefined;
    if (!this.marketHours.isValidUtcOffset(utcg)) {
      this.marketHoursStatus = {
        isOpen: false,
        nextOpenUtc: null,
        nextCloseUtc: null,
        reason: 'UTC offset unavailable'
      };
      this.marketCloseCountdown = '';
      this.marketOpenCountdown = '';
      this.todayMarketSessions = [];
      return;
    }
    const input = { utcg: utcg!, trading_hours: tradingHours as any[] };
    const now = new Date();
    this.marketHoursStatus = this.marketHours.isMarketOpen(input, now);
    this.todayMarketSessions = this.marketHours.getTodaySessions(input, now);
    this.marketCloseCountdown = this.marketHoursStatus?.isOpen ? this.marketHours.getCountdown(this.marketHoursStatus.nextCloseUtc, now) : '';
    this.marketOpenCountdown = !this.marketHoursStatus?.isOpen ? this.marketHours.getCountdown(this.marketHoursStatus?.nextOpenUtc ?? null, now) : '';
  }

  // Default values - can be adjusted per market type
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
    // Determine tick size based on market
    const upperMarket = market.toUpperCase();

    // XAUUSD, XAGUSD - 0.01
    if (upperMarket.includes('XAU') || upperMarket.includes('XAG')) {
      return 0.01;
    }

    // Most crypto pairs - 0.01 or 0.001
    if (upperMarket.includes('USDT') || upperMarket.includes('BUSD')) {
      return 0.01;
    }

    // Forex pairs - 0.0001
    if (/^[A-Z]{6}$/.test(upperMarket)) {
      return 0.0001;
    }

    return 0.01; // Default
  }

  private validateStopLossTakeProfit(
    side: 'buy' | 'sell',
    entryPrice: number,
    stopLoss: number | undefined,
    takeProfit: number | undefined,
    market: string
  ): { valid: boolean; error?: string } {
    const tickSize = this.getTickSize(market);
    const stopLevel = this.getStopLevel(this.marketType);
    const minDistance = stopLevel * tickSize;

    // Validate Stop Loss
    if (stopLoss !== undefined && stopLoss > 0) {
      if (side === 'buy') {
        // BUY: SL must be BELOW entry price
        if (stopLoss >= entryPrice) {
          return {
            valid: false,
            error: `For BUY orders, Stop Loss must be below entry price (${entryPrice.toFixed(2)}). Current SL: ${stopLoss.toFixed(2)}`
          };
        }
      } else {
        // SELL: SL must be ABOVE entry price
        if (stopLoss <= entryPrice) {
          return {
            valid: false,
            error: `For SELL orders, Stop Loss must be above entry price (${entryPrice.toFixed(2)}). Current SL: ${stopLoss.toFixed(2)}`
          };
        }
      }

      // Check minimum distance
      const slDistance = Math.abs(entryPrice - stopLoss);
      if (slDistance < minDistance) {
        return {
          valid: false,
          error: `Stop Loss is too close to entry price. Minimum distance: ${minDistance.toFixed(4)}. Current distance: ${slDistance.toFixed(4)}`
        };
      }
    }

    // Validate Take Profit
    if (takeProfit !== undefined && takeProfit > 0) {
      if (side === 'buy') {
        // BUY: TP must be ABOVE entry price
        if (takeProfit <= entryPrice) {
          return {
            valid: false,
            error: `For BUY orders, Take Profit must be above entry price (${entryPrice.toFixed(2)}). Current TP: ${takeProfit.toFixed(2)}`
          };
        }
      } else {
        // SELL: TP must be BELOW entry price
        if (takeProfit >= entryPrice) {
          return {
            valid: false,
            error: `For SELL orders, Take Profit must be below entry price (${entryPrice.toFixed(2)}). Current TP: ${takeProfit.toFixed(2)}`
          };
        }
      }

      // Check minimum distance
      const tpDistance = Math.abs(entryPrice - takeProfit);
      if (tpDistance < minDistance) {
        return {
          valid: false,
          error: `Take Profit is too close to entry price. Minimum distance: ${minDistance.toFixed(4)}. Current distance: ${tpDistance.toFixed(4)}`
        };
      }
    }

    return { valid: true };
  }

  clampVolume() {
    let v = Number(this.tradeSlip.volume);
    if (this.tradeVolumeInputMode === 'amount') {
      if (!Number.isFinite(v) || v < this.TRADE_VOLUME_MIN_AMOUNT) v = this.TRADE_VOLUME_MIN_AMOUNT;
      if (v > 100) v = 100;
      this.tradeSlip.volume = +v.toFixed(this.TRADE_VOLUME_DECIMALS_AMOUNT);
      return;
    }
    if (this.tradeVolumeInputMode === 'qty') {
      if (!Number.isFinite(v) || v < 0.01) v = 0.01;
      if (v > 1000000) v = 1000000;
      this.tradeSlip.volume = +v.toFixed(4);
      return;
    }
    if (!Number.isFinite(v) || v < 0.01) v = 0.01;
    if (v > 100) v = 100;
    this.tradeSlip.volume = +v.toFixed(2);
  }

  setTradeSlipVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.tradeSlip.volume = v;
    this.clampVolume();
  }

  isTradeSlipVolumePresetActive(v: number): boolean {
    const cur = Number(this.tradeSlip.volume);
    if (!Number.isFinite(cur)) return false;
    const eps = this.tradeVolumeInputMode === 'amount' ? 1e-10 : 1e-6;
    return Math.abs(cur - v) < eps;
  }

  increaseTradeSlipVolume() {
    const step = this.tradeVolumeStep;
    const next = +(this.tradeSlip.volume + step).toFixed(4);
    this.tradeSlip.volume = this.tradeVolumeInputMode === 'qty' ? Math.min(1000000, next) : Math.min(100, next);
  }

  decreaseTradeSlipVolume() {
    const step = this.tradeVolumeStep;
    const next = +(this.tradeSlip.volume - step).toFixed(4);
    this.tradeSlip.volume = Math.max(0.01, next);
  }

  get brandCurrencyCode(): string {
    return this.sharedService.getBrandCurrencyCode() || '';
  }

  /** Quote currency of active symbol (USDT, USD, …). */
  getActiveQuoteCurrency(): string {
    const pd = this.getPairDetail(this.activeSymbol);
    return ((pd?.['quote_currency_code'] as string) || '').trim();
  }

  /** Mid / best available price for converting brand amount ↔ lots (not order execution). */
  get estExecPriceForAmountMode(): number {
    const a = this.bestAskNow || 0;
    const b = this.bestBidNow || 0;
    if (a > 0 && b > 0) return (a + b) / 2;
    return a || b || this.lastPriceNow || 0;
  }

  get amountModeRateAvailable(): boolean {
    const quote = this.getActiveQuoteCurrency();
    const brand = this.sharedService.getBrandCurrencyCode();
    if (!quote || !brand) return false;
    if (quote === brand) return true;
    const r = this.sharedService.getExchangeRate(quote, brand);
    return r != null && Number.isFinite(r) && r > 0;
  }

  setTradeVolumeInputMode(mode: 'lots' | 'qty' | 'amount'): void {
    if (mode === this.tradeVolumeInputMode) return;
    if (mode === 'amount' && !this.amountModeRateAvailable) {
      this.sharedService.showAlert(4, 'Add exchange rates from the symbol quote currency to your wallet currency to use amount mode.');
      return;
    }
    const prevMode = this.tradeVolumeInputMode;
    this.tradeVolumeInputMode = mode;
    if (mode === 'amount') {
      this.syncBrandAmountFromLots();
      this.applyBrandAmountToVolume();
    } else if (mode === 'qty') {
      if (prevMode === 'lots') {
        this.tradeSlip.volume = +(this.tradeSlip.volume * this.activeLotSize).toFixed(4);
      } else if (prevMode === 'amount') {
        this.tradeSlip.volume = +(this.tradeSlip.volume * this.activeLotSize).toFixed(4);
      }
      this.clampVolume();
    } else if (mode === 'lots') {
      if (prevMode === 'qty') {
        this.tradeSlip.volume = +(this.tradeSlip.volume / this.activeLotSize).toFixed(4);
      }
      this.clampVolume();
    }
    this.cdr.markForCheck();
  }

  /** Quote-currency notional from brand-currency amount (e.g. INR → USDT). */
  computeNotionalQuoteFromBrand(brandAmt: number): number | null {
    if (!Number.isFinite(brandAmt) || brandAmt <= 0) return null;
    const quote = this.getActiveQuoteCurrency();
    const brand = this.sharedService.getBrandCurrencyCode();
    if (!quote || !brand) return null;
    if (quote === brand) return brandAmt;
    const r = this.sharedService.getExchangeRate(quote, brand);
    if (r == null || !Number.isFinite(r) || r <= 0) return null;
    return brandAmt / r;
  }

  computeVolumeFromBrandAmount(brandAmt: number): number {
    const price = this.estExecPriceForAmountMode;
    const nq = this.computeNotionalQuoteFromBrand(brandAmt);
    if (!price || price <= 0 || nq == null || nq <= 0) return this.TRADE_VOLUME_MIN_AMOUNT;
    const vol = nq / (price * this.activeLotSize);
    if (!Number.isFinite(vol) || vol <= 0) return this.TRADE_VOLUME_MIN_AMOUNT;
    return Math.min(100, Math.max(this.TRADE_VOLUME_MIN_AMOUNT, vol));
  }

  computeBrandAmountFromVolume(vol: number): number {
    const price = this.estExecPriceForAmountMode;
    if (!Number.isFinite(vol) || vol <= 0 || !price || price <= 0) return 0;
    const nq = vol * price * this.activeLotSize;
    const quote = this.getActiveQuoteCurrency();
    const brand = this.sharedService.getBrandCurrencyCode();
    if (!quote || !brand) return 0;
    if (quote === brand) return +nq.toFixed(2);
    const r = this.sharedService.getExchangeRate(quote, brand);
    if (r == null || !Number.isFinite(r) || r <= 0) return 0;
    return +(nq * r).toFixed(2);
  }

  syncBrandAmountFromLots(): void {
    const vol = this.tradeVolumeInputMode === 'qty'
      ? (Number(this.tradeSlip.volume) || 0) / this.activeLotSize
      : (Number(this.tradeSlip.volume) || 0);
    this.tradeSlipBrandAmount = this.computeBrandAmountFromVolume(vol);
  }

  applyBrandAmountToVolume(): void {
    let ba = Number(this.tradeSlipBrandAmount);
    if (!Number.isFinite(ba) || ba < 0) ba = 0;
    if (ba <= 0) {
      this.tradeSlip.volume = this.tradeVolumeInputMode === 'qty'
        ? this.TRADE_VOLUME_MIN_AMOUNT * this.activeLotSize
        : this.TRADE_VOLUME_MIN_AMOUNT;
      this.clampVolume();
      return;
    }
    const v = this.computeVolumeFromBrandAmount(ba);
    this.tradeSlip.volume = this.tradeVolumeInputMode === 'qty'
      ? +(v * this.activeLotSize).toFixed(4)
      : v;
    this.clampVolume();
  }

  clampBrandAmount(): void {
    let ba = Number(this.tradeSlipBrandAmount);
    if (!Number.isFinite(ba) || ba < 0) ba = 0;
    const cap = this.maxBrandAmountSoftCap();
    if (cap > 0 && ba > cap) ba = cap;
    this.tradeSlipBrandAmount = +ba.toFixed(2);
    this.applyBrandAmountToVolume();
  }

  /** Soft cap so presets / typing stay reasonable (balance or 100 lots, whichever larger). */
  maxBrandAmountSoftCap(): number {
    const bal = Number(this.authService.currentBalance) || 0;
    const from100Lots = this.computeBrandAmountFromVolume(100);
    const base = Math.max(from100Lots, bal > 0 ? bal : 0);
    return Math.max(base, 1);
  }

  increaseTradeSlipBrandAmount(): void {
    const next = +(Number(this.tradeSlipBrandAmount) + this.tradeSlipBrandAmountStep).toFixed(2);
    this.tradeSlipBrandAmount = next;
    this.clampBrandAmount();
  }

  decreaseTradeSlipBrandAmount(): void {
    const next = +(Number(this.tradeSlipBrandAmount) - this.tradeSlipBrandAmountStep).toFixed(2);
    this.tradeSlipBrandAmount = Math.max(0, next);
    this.clampBrandAmount();
  }

  setTradeSlipBrandAmountPreset(amt: number): void {
    if (!Number.isFinite(amt) || amt < 0) return;
    this.tradeSlipBrandAmount = +amt.toFixed(2);
    this.clampBrandAmount();
  }

  isTradeSlipBrandAmountPresetActive(amt: number): boolean {
    return Math.abs(Number(this.tradeSlipBrandAmount) - amt) < 0.005;
  }

  isBrandAmountPresetDisabled(amt: number): boolean {
    const cap = this.maxBrandAmountSoftCap();
    return cap > 0 && amt > cap * 1.0001;
  }

  setBrandAmountPercentOfBalance(pct: number): void {
    const bal = Number(this.authService.currentBalance) || 0;
    if (bal <= 0 || !Number.isFinite(pct) || pct <= 0) return;
    this.tradeSlipBrandAmount = +(bal * (pct / 100)).toFixed(2);
    this.clampBrandAmount();
  }

  onTradeSlipBrandAmountInput(): void {
    this.applyBrandAmountToVolume();
  }

  private refreshVolumeFromBrandAmountMode(): void {
    if (this.tradeVolumeInputMode !== 'amount') return;
    if (!this.amountModeRateAvailable) return;
    const ba = Number(this.tradeSlipBrandAmount);
    if (!Number.isFinite(ba) || ba <= 0) return;
    const v = this.computeVolumeFromBrandAmount(ba);
    this.tradeSlip.volume = v;
    this.clampVolume();
  }

  private assertCanPlaceTrade(): boolean {
    if (this.isExchangeRateMissing) {
      this.sharedService.showAlert(3, 'Trading is not available for this symbol\'s currency yet.');
      return false;
    }
    if (this.isUtcgMissing) {
      this.sharedService.showAlert(3, 'Market timezone (UTC offset) is not available. Trading is disabled.');
      return false;
    }
    if (!this.computedMarketOpen) {
      this.sharedService.showAlert(3, 'Market is closed. You cannot place trades right now.');
      return false;
    }
    return true;
  }

  private assertLeverageForOrder(): boolean {
    const plan = this.playerDetailsService.details?.leverage_plan;
    if (!plan) {
      this.sharedService.showAlert(3, 'Leverage profile is still loading. Please try again in a moment.');
      return false;
    }
    const pd = this.getPairDetail(this.activeSymbol);
    const input = {
      symbol: this.activeSymbol,
      marketTypeId: this.resolveLeverageMarketTypeId(this.activeSymbol),
      marketTypeName: this.resolveLeverageMarketTypeName(this.activeSymbol, pd)
    };
    this.ensureTradeLeverageInBounds();
    if (!isLeverageAllowed(this.tradeLeverage, plan, input)) {
      const resolved = resolveTradeLeverage(plan, input);
      this.sharedService.showAlert(
        3,
        `Leverage must be between ${resolved.minLeverage}x and ${resolved.maxLeverage}x (${getLeverageSourceDescription(resolved)}).`
      );
      this.tradeLeverage = resolved.maxLeverage;
      this.leveragePickerDraft = this.tradeLeverage;
      return false;
    }
    return true;
  }

  submitMarketOrder(side: 'buy' | 'sell') {
    console.log("submitMarketOrder click:", {
      symbol: this.activeSymbol,
      volume: this.tradeSlip.volume,
      activeLotSize: this.activeLotSize,
      tradeSlipQuantity: this.tradeSlipQuantity
    });
    if (!this.assertCanPlaceTrade()) return;
    if (!this.assertLeverageForOrder()) return;
    if (this.tradeVolumeInputMode === 'amount') {
      this.refreshVolumeFromBrandAmountMode();
    }
    this.ensureTradeLeverageInBounds();
    const position_type_id = side === 'buy' ? 1 : 2;
    const price = position_type_id === 1 ? this.bestAskNow : this.bestBidNow;
    const symbol = this.activeSymbol;

    const validation = this.validateStopLossTakeProfit(
      side, price,
      this.tradeSlip.stopLoss,
      this.tradeSlip.takeProfit,
      symbol
    );

    if (!validation.valid) {
      this.sharedService.showAlert(3, validation.error!);
      return;
    }

    this.tradingSocket.placeOrder({
      symbol,
      position_type_id,
      quantity: this.tradeSlipQuantity,
      price,
      order_type_id: 1,
      market_type: this.marketType === 1 ? 1 : 2,
      leverage: this.tradeLeverage,
      take_profit: this.tradeSlip.takeProfit || undefined,
      stop_loss: this.tradeSlip.stopLoss || undefined,
    }).then((res: any) => {
      if (res?.code === 0) {
        this.sharedService.showAlert(1, `${side.toUpperCase()} order placed for ${symbol}`);
        this.closeTradePanel();
      } else if (res?.code === 15) {
        this.sharedService.showAlert(2, res.message || 'Validation error');
      } else {
        this.sharedService.showAlert(2, res?.message || 'Order failed');
      }
    });
  }

  submitPendingOrder(): void {
    console.log("submitPendingOrder click:", {
      symbol: this.activeSymbol,
      volume: this.tradeSlip.volume,
      activeLotSize: this.activeLotSize,
      tradeSlipQuantity: this.tradeSlipQuantity
    });
    if (!this.assertCanPlaceTrade()) return;
    if (!this.assertLeverageForOrder()) return;
    if (this.tradeVolumeInputMode === 'amount') {
      this.refreshVolumeFromBrandAmountMode();
    }
    this.ensureTradeLeverageInBounds();
    const ot = this.selectedOrderTypeId;
    const symbol = this.activeSymbol;
    const position_type_id = this.isBuySidePending ? 1 : 2;
    const currentAsk = this.bestAskNow || 0;
    const currentBid = this.bestBidNow || 0;
    const dp = this.pairDecimalPlaces;

    const limitPrice = this.tradeSlip.limitPrice || 0;
    const stopPrice = this.tradeSlip.stopPrice || 0;
    const sl = this.tradeSlip.stopLoss || 0;
    const tp = this.tradeSlip.takeProfit || 0;

    // ── Volume ────────────────────────────────────────────────
    if (!this.tradeSlip.volume || this.tradeSlip.volume <= 0) {
      this.sharedService.showAlert(3, 'Please enter a valid volume'); return;
    }

    // ── Price field validation per order type ─────────────────
    switch (ot) {
      case 2: // BUY_LIMIT — limit price must be BELOW current ask
        if (limitPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Price'); return; }
        if (currentAsk > 0 && limitPrice >= currentAsk) {
          this.sharedService.showAlert(3, `Buy Limit price must be below current Ask (${currentAsk.toFixed(dp)})`); return;
        }
        break;

      case 3: // SELL_LIMIT — limit price must be ABOVE current bid
        if (limitPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Price'); return; }
        if (currentBid > 0 && limitPrice <= currentBid) {
          this.sharedService.showAlert(3, `Sell Limit price must be above current Bid (${currentBid.toFixed(dp)})`); return;
        }
        break;

      case 4: // BUY_STOP — stop price must be ABOVE current ask
        if (stopPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Stop Price'); return; }
        if (currentAsk > 0 && stopPrice <= currentAsk) {
          this.sharedService.showAlert(3, `Buy Stop price must be above current Ask (${currentAsk.toFixed(dp)})`); return;
        }
        break;

      case 5: // SELL_STOP — stop price must be BELOW current bid
        if (stopPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Stop Price'); return; }
        if (currentBid > 0 && stopPrice >= currentBid) {
          this.sharedService.showAlert(3, `Sell Stop price must be below current Bid (${currentBid.toFixed(dp)})`); return;
        }
        break;

      case 6: // BUY_STOP_LIMIT — stop > ask, limit <= stop (MT5 style)
        if (stopPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Stop Price'); return; }
        if (limitPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Limit Price'); return; }
        if (currentAsk > 0 && stopPrice <= currentAsk) {
          this.sharedService.showAlert(3, `Buy Stop Limit: Stop price must be above current Ask (${currentAsk.toFixed(dp)})`); return;
        }
        if (limitPrice > stopPrice) {
          this.sharedService.showAlert(3, `Buy Stop Limit: Limit price must be ≤ Stop price (${stopPrice.toFixed(dp)})`); return;
        }
        break;

      case 7: // SELL_STOP_LIMIT — stop < bid, limit >= stop (MT5 style)
        if (stopPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Stop Price'); return; }
        if (limitPrice <= 0) { this.sharedService.showAlert(3, 'Please enter a Limit Price'); return; }
        if (currentBid > 0 && stopPrice >= currentBid) {
          this.sharedService.showAlert(3, `Sell Stop Limit: Stop price must be below current Bid (${currentBid.toFixed(dp)})`); return;
        }
        if (limitPrice < stopPrice) {
          this.sharedService.showAlert(3, `Sell Stop Limit: Limit price must be ≥ Stop price (${stopPrice.toFixed(dp)})`); return;
        }
        break;
    }

    // ── SL/TP validation against the execution price ─────────
    // For stop-limit orders: use limitPrice (actual fill price), not stopPrice (trigger)
    // For stop orders: use stopPrice (market execution at trigger)
    // For limit orders: use limitPrice
    const refPrice = [6, 7].includes(ot) ? limitPrice
      : this.needsStopPrice ? stopPrice
        : limitPrice;
    if (sl > 0 && refPrice > 0) {
      if (position_type_id === 1 && sl >= refPrice) {
        this.sharedService.showAlert(3, `Stop Loss must be below order price (${refPrice.toFixed(dp)})`); return;
      }
      if (position_type_id === 2 && sl <= refPrice) {
        this.sharedService.showAlert(3, `Stop Loss must be above order price (${refPrice.toFixed(dp)})`); return;
      }
    }
    if (tp > 0 && refPrice > 0) {
      if (position_type_id === 1 && tp <= refPrice) {
        this.sharedService.showAlert(3, `Take Profit must be above order price (${refPrice.toFixed(dp)})`); return;
      }
      if (position_type_id === 2 && tp >= refPrice) {
        this.sharedService.showAlert(3, `Take Profit must be below order price (${refPrice.toFixed(dp)})`); return;
      }
    }

    // ── Expiration ────────────────────────────────────────────
    // UI: GTC | Today | Tomorrow | Custom Date | Custom DateTime
    // Backend mapping:
    //   GTC           → expiration='GTC',           expiration_value=null
    //   Today         → expiration='SPECIFIED',      expiration_value=today 23:59 UTC ISO
    //   Tomorrow      → expiration='SPECIFIED',      expiration_value=tomorrow 23:59 UTC ISO
    //   Custom Date   → expiration='SPECIFIED_DAY',  expiration_value='YYYY-MM-DD'
    //   Custom DateTime → expiration='SPECIFIED',    expiration_value=UTC ISO datetime
    let backendExpiration = 'GTC';
    let expirationValue: string | null = null;

    if (this.tradeSlip.expiration === 'Today') {
      backendExpiration = 'SPECIFIED';
      expirationValue = this._buildUtcDateTime('today');
    } else if (this.tradeSlip.expiration === 'Tomorrow') {
      backendExpiration = 'SPECIFIED';
      expirationValue = this._buildUtcDateTime('tomorrow');
    } else if (this.tradeSlip.expiration === 'Custom Date') {
      if (!this.tradeSlip.expirationDate) {
        this.sharedService.showAlert(3, 'Please select a date'); return;
      }
      backendExpiration = 'SPECIFIED_DAY';
      expirationValue = this.tradeSlip.expirationDate; // already YYYY-MM-DD from date input
    } else if (this.tradeSlip.expiration === 'Custom DateTime') {
      if (!this.tradeSlip.expirationDate) {
        this.sharedService.showAlert(3, 'Please select a date and time'); return;
      }
      backendExpiration = 'SPECIFIED';
      // Convert local datetime-local value to UTC ISO
      expirationValue = new Date(this.tradeSlip.expirationDate).toISOString();
    }

    // ── Build payload ─────────────────────────────────────────
    const price = this.needsStopPrice ? stopPrice : limitPrice;

    const payload: any = {
      symbol,
      position_type_id,
      quantity: this.tradeSlipQuantity,
      price,
      order_type_id: ot,
      market_type: this.marketType === MarketType.CRYPTO ? 1 : 2,
      leverage: this.tradeLeverage,
      stop_loss: sl || undefined,
      take_profit: tp || undefined,
      expiration: backendExpiration,
      expiration_value: expirationValue,
    };

    if ([2, 3, 6, 7].includes(ot)) payload.limit_price = limitPrice || undefined;
    if ([4, 5, 6, 7].includes(ot)) payload.stop_price = stopPrice || undefined;

    this.tradingSocket.placeOrder(payload).then((res: any) => {
      if (res?.code === 0) {
        this.sharedService.showAlert(1, `${this.selectedOrderType.label} order placed for ${symbol}`);
        this.closeTradePanel();
        // Reset price fields after success
        this.tradeSlip.limitPrice = 0;
        this.tradeSlip.stopPrice = 0;
        this.tradeSlip.stopLoss = 0;
        this.tradeSlip.takeProfit = 0;
      } else if (res?.code === 15) {
        this.sharedService.showAlert(2, res.message || 'Validation error');
      } else {
        this.sharedService.showAlert(2, res?.message || 'Order failed');
      }
    });
  }

  // Pending order price steppers
  stepLimitPrice(delta: number): void {
    const step = this.priceStep;
    this.tradeSlip.limitPrice = +Math.max(0, (this.tradeSlip.limitPrice || 0) + delta * step).toFixed(this.pairDecimalPlaces);
  }

  stepStopPrice(delta: number): void {
    const step = this.priceStep;
    this.tradeSlip.stopPrice = +Math.max(0, (this.tradeSlip.stopPrice || 0) + delta * step).toFixed(this.pairDecimalPlaces);
  }

  stepSlPrice(delta: number): void {
    const step = this.priceStep;
    this.tradeSlip.stopLoss = +Math.max(0, (this.tradeSlip.stopLoss || 0) + delta * step).toFixed(this.pairDecimalPlaces);
  }

  stepTpPrice(delta: number): void {
    const step = this.priceStep;
    this.tradeSlip.takeProfit = +Math.max(0, (this.tradeSlip.takeProfit || 0) + delta * step).toFixed(this.pairDecimalPlaces);
  }

  get priceStep(): number {
    const dp = this.pairDecimalPlaces;
    return dp >= 4 ? 0.0001 : dp >= 2 ? 0.01 : 1;
  }

  // ── Expiration UTC helpers ────────────────────────────────────
  get todayDateStr(): string {
    return this._buildDateOnly('today');
  }

  get todayDateTimeStr(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private _buildUtcDateTime(dayKey: 'today' | 'tomorrow'): string {
    const d = new Date();
    if (dayKey === 'tomorrow') d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d.toISOString(); // UTC ISO e.g. "2025-04-18T18:29:00.000Z"
  }

  private _buildDateOnly(dayKey: 'today' | 'tomorrow'): string {
    const d = new Date();
    if (dayKey === 'tomorrow') d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }

  /** Live hint shown below price field — tells user where current price is */
  get pendingPriceHint(): string {
    const ask = this.bestAskNow || 0;
    const bid = this.bestBidNow || 0;
    const dp = this.pairDecimalPlaces;
    if (!ask && !bid) return '';
    switch (this.selectedOrderTypeId) {
      case 2: return `Current Ask: ${ask.toFixed(dp)} — set price below this`;
      case 3: return `Current Bid: ${bid.toFixed(dp)} — set price above this`;
      case 4: return `Current Ask: ${ask.toFixed(dp)} — set price above this`;
      case 5: return `Current Bid: ${bid.toFixed(dp)} — set price below this`;
      case 6: return `Current Ask: ${ask.toFixed(dp)} — Stop > Ask, Limit ≤ Stop`;
      case 7: return `Current Bid: ${bid.toFixed(dp)} — Stop < Bid, Limit ≥ Stop`;
      default: return '';
    }
  }

  /** Inline error shown below price field in pending order form */
  get pendingPriceError(): string | null {
    const lp = this.tradeSlip.limitPrice || 0;
    const sp = this.tradeSlip.stopPrice || 0;
    const ask = this.bestAskNow || 0;
    const bid = this.bestBidNow || 0;
    const dp = this.pairDecimalPlaces;
    switch (this.selectedOrderTypeId) {
      case 2: if (ask > 0 && lp >= ask) return `Must be below Ask (${ask.toFixed(dp)})`; break;
      case 3: if (bid > 0 && lp <= bid) return `Must be above Bid (${bid.toFixed(dp)})`; break;
      case 4: if (ask > 0 && sp <= ask) return `Must be above Ask (${ask.toFixed(dp)})`; break;
      case 5: if (bid > 0 && sp >= bid) return `Must be below Bid (${bid.toFixed(dp)})`; break;
      case 6: if (ask > 0 && sp <= ask) return `Stop must be above Ask (${ask.toFixed(dp)})`; break;
      case 7: if (bid > 0 && sp >= bid) return `Stop must be below Bid (${bid.toFixed(dp)})`; break;
    }
    return null;
  }

  get pendingLimitPriceError(): string | null {
    const lp = this.tradeSlip.limitPrice || 0;
    const sp = this.tradeSlip.stopPrice || 0;
    const dp = this.pairDecimalPlaces;
    // BUY_STOP_LIMIT (MT5): limit must be <= stop
    if (this.selectedOrderTypeId === 6 && lp > 0 && sp > 0 && lp > sp)
      return `Limit price must be ≤ Stop price (${sp.toFixed(dp)})`;
    // SELL_STOP_LIMIT (MT5): limit must be >= stop
    if (this.selectedOrderTypeId === 7 && lp > 0 && sp > 0 && lp < sp)
      return `Limit price must be ≥ Stop price (${sp.toFixed(dp)})`;
    return null;
  }

  // Is pending order button enabled?
  get pendingOrderValid(): boolean {
    if (!this.leverageProfileReady) return false;
    if (this.isExchangeRateMissing) return false;
    if (!this.computedMarketOpen) return false;
    if (!this.tradeSlip.volume || this.tradeSlip.volume <= 0) return false;

    const limitPrice = this.tradeSlip.limitPrice || 0;
    const stopPrice = this.tradeSlip.stopPrice || 0;
    const ask = this.bestAskNow || 0;
    const bid = this.bestBidNow || 0;

    switch (this.selectedOrderTypeId) {
      case 2: return limitPrice > 0 && (ask <= 0 || limitPrice < ask);
      case 3: return limitPrice > 0 && (bid <= 0 || limitPrice > bid);
      case 4: return stopPrice > 0 && (ask <= 0 || stopPrice > ask);
      case 5: return stopPrice > 0 && (bid <= 0 || stopPrice < bid);
      // BUY_STOP_LIMIT: stopPrice > ask AND limitPrice <= stopPrice (MT5 style)
      case 6: return stopPrice > 0 && limitPrice > 0 && limitPrice <= stopPrice && (ask <= 0 || stopPrice > ask);
      // SELL_STOP_LIMIT: stopPrice < bid AND limitPrice >= stopPrice (MT5 style)
      case 7: return stopPrice > 0 && limitPrice > 0 && limitPrice >= stopPrice && (bid <= 0 || stopPrice < bid);
      default: return false;
    }
  }

  onKlinePriceUpdate(price: number) {
    this.lastPriceNow = price;
    this.lastPrice[this.activeSymbol] = price;
  }

  activeChartType: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline' = 'candles';
  showTypePanel = false;

  chartTypes: Array<{ key: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline'; label: string; icon: string; enabled: boolean }> = [
    { key: 'area', label: 'Area', icon: 'fa-solid fa-chart-area', enabled: true },
    { key: 'candles', label: 'Candles', icon: 'fa-solid fa-chart-column', enabled: true },
    { key: 'bars', label: 'Bars', icon: 'fa-solid fa-chart-simple', enabled: true },
    { key: 'histogram', label: 'Histogram', icon: 'fa-solid fa-chart-bar', enabled: true },
    { key: 'line', label: 'Line', icon: 'fa-solid fa-chart-line', enabled: true },
    { key: 'baseline', label: 'Baseline', icon: 'fa-solid fa-arrows-left-right-to-line', enabled: true },
  ];

  get activeChartTypeIcon(): string {
    const f = this.chartTypes.find(t => t.key === this.activeChartType);
    return f?.icon || 'fa-solid fa-chart-column';
  }

  private updateMarketData() {
    if (!this.base || !this.quote) return;
    this.currentTime = new Date();
    const symbol = `${this.base}${this.quote}`;

    const isCrypto = this.marketType === MarketType.CRYPTO || this.getMarketTypeFromSymbol(symbol) === MarketType.CRYPTO;
    const url = isCrypto ? urlConstant.ticker24hr(symbol) : urlConstant.symbolInfo(symbol);
    this.http.get<any>(url).subscribe({

      next: (data) => {
        if (!data) return;

        const high24h = parseFloat(data.highPrice ?? data.high ?? data.h ?? 0);
        const low24h = parseFloat(data.lowPrice ?? data.low ?? data.l ?? 0);
        const volume24h = parseFloat(data.volume ?? data.v ?? 0);
        const priceChangePercent = parseFloat(data.priceChangePercent ?? data.change ?? data.chgPct ?? 0);
        const prevClosePrice = parseFloat(data.prevClosePrice ?? data.prevClose ?? data.prev ?? 0);
        const lastPriceVal = parseFloat(data.lastPrice ?? data.last ?? data.ltp ?? data.price ?? data.ask ?? data.bid ?? 0);

        this.marketStats = {

          high24h: Number.isFinite(high24h) ? high24h : 0,

          low24h: Number.isFinite(low24h) ? low24h : 0,

          volume24h: Number.isFinite(volume24h) ? volume24h : 0,

          priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : 0,

          prevClosePrice: Number.isFinite(prevClosePrice) ? prevClosePrice : 0,

          lastPrice: Number.isFinite(lastPriceVal) ? lastPriceVal : 0

        };



        // Update lastPrice and change24h for the current pair

        this.lastPrice[symbol] = this.marketStats.lastPrice!;

        this.change24h[symbol] = this.marketStats.priceChangePercent!;

      },

      error: (error) => {

        console.error('Error fetching market data:', error);

      }

    });

  }



  private setupPriceUpdates() {
    // Clear any existing interval
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }

    // Update immediately and then every 5 seconds

    this.updateMarketData();

    // this.priceUpdateInterval = setInterval(() => this.updateMarketData(), 5000);



    // Also update the time every second for the UI

    setInterval(() => {

      this.currentTime = new Date();

    }, 1000);

  }



  private connectCombinedStreams() {

    if (!this.marketKey) return;

    // Unsubscribe previous handlers if any

    if (this.allTickerHandler) {
      this.binanceSocket.offAllTicker(this.allTickerHandler);
      this.allTickerHandler = undefined;
    }

    if (this.singleTickerHandler) {
      this.binanceSocket.offSingleTicker(this.singleTickerHandler);
      this.singleTickerHandler = undefined;
    }

    if (this.combinedHandler) {
      this.binanceSocket.offCombined(this.combinedHandler);
      this.combinedHandler = undefined;
    }



    // Subscribe to required streams for the active market
    const marketKey = this.marketKey;
    const mt = this.marketType;

    this.binanceSocket.updateSingleTickerSubscriptions([marketKey], mt, 'active-trade-stats');
    this.binanceSocket.emitSubscribeCombined(marketKey, mt);



    // Global 24h tickers array (used for movers, tabs, etc.)

    const allTickerHandler = (data: any) => {

      try {

        if (!Array.isArray(data)) return;

        for (const item of data) {

          const s = item.s as string;
          const last = parseFloat(item.c);
          const chgPct = parseFloat(item.P);
          const q = item.q ? parseFloat(item.q) : 0;
          const prev = this.tickers[s]?.last ?? last;
          const prevChg = this.tickers[s]?.chgPct ?? chgPct;
          const prevH = this.tickers[s]?.h;
          const prevL = this.tickers[s]?.l;
          const h = item.h !== undefined ? parseFloat(item.h) : prevH;
          const l = item.l !== undefined ? parseFloat(item.l) : prevL;
          this.tickers[s] = { s, last, prev, chgPct, prevChg, q, h, l, bid: item.b, ask: item.a };

          // If current active symbol is in this list, update its market status
          if (s.toUpperCase().replace(/[^A-Z0-9]/g, '') === this.activeSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
            if (item.st !== undefined) {
              this.isMarketOpen = String(item.st).toLowerCase() === 'true';
            }
          }

          if (typeof h === 'number' && typeof prevH === 'number' && h > prevH) this.pushMoverEvent(s, chgPct, 'New High', 'up', 'New High/Low');
          if (typeof l === 'number' && typeof prevL === 'number' && l < prevL) this.pushMoverEvent(s, chgPct, 'New Low', 'down', 'New High/Low');

        }

        this.refreshTabsFromTickers();

        this.scheduleRefreshPairs();

        this.scheduleRefreshMovers();

      } catch { }

    };



    this.allTickerHandler = allTickerHandler;

    this.binanceSocket.onAllTicker(allTickerHandler);



    // Single 24h ticker for the active market
    const singleTickerHandler = (data: any) => {
      try {
        const incomingSymbol = (data.s || '').toUpperCase();
        const normIncoming = incomingSymbol.replace(/[^A-Z0-9]/g, '');
        const currentActive = (this.activeSymbol || '').toUpperCase();
        const normActive = currentActive.replace(/[^A-Z0-9]/g, '');

        if (normIncoming !== normActive) return;

        // Update market open/closed status from 'st' key
        if (data.st !== undefined) {
          this.isMarketOpen = String(data.st).toLowerCase() === 'true';
        }

        const nextLast = parseFloat(data.c);
        if (Number.isFinite(nextLast)) {
          this.priceUp = nextLast >= this.prevLastPriceNow;
          this.prevLastPriceNow = nextLast;
          this.lastPrice[this.activeSymbol] = nextLast;
        }

        if (data.o != null) this.open24h = Number.parseFloat(data.o) || 0;
        if (data.v != null) this.baseVol24h = Number.parseFloat(data.v) || 0;
        if (data.q != null) this.quoteVol24h = Number.parseFloat(data.q) || 0;
        if (data.n != null) this.trades24h = Number(data.n) || 0;

        const b = parseFloat(data.b);
        const a = parseFloat(data.a);
        if (Number.isFinite(b)) this.bestBidNow = b;
        if (Number.isFinite(a)) this.bestAskNow = a;
        this.flushDisplayPrices();
        this.refreshVolumeFromBrandAmountMode();

        if (data.P != null) this.change24h[this.activeSymbol] = Number.parseFloat(data.P) || 0;
      } catch { }
    };



    this.singleTickerHandler = singleTickerHandler;

    this.binanceSocket.onSingleTicker(singleTickerHandler);

    // Order book depth for the active market
    // const combinedHandler = (data: any) => {
    //   try {
    //     const asksArr = (data.a ?? data.asks ?? []) as [string, string][];
    //     const bidsArr = (data.b ?? data.bids ?? []) as [string, string][]
    //     if (asksArr?.length) this.pendingAsks = asksArr.slice(0, 20);
    //     if (bidsArr?.length) this.pendingBids = bidsArr.slice(0, 20);
    //     if (!this.bookTimer) {
    //       this.bookTimer = setTimeout(() => {
    //         this.asks = this.computeLevels(this.pendingAsks, 'asks');
    //         this.bids = this.computeLevels(this.pendingBids, 'bids');
    //         this.computeMixed();
    //         this.bookTimer = undefined;
    //       }, 150);
    //     }
    //   } catch { }
    // };    
    // this.combinedHandler = combinedHandler;
    // this.binanceSocket.onCombined(combinedHandler);

  }

  private computeLevels(levels: [string, string][], side: 'asks' | 'bids') {

    const rows: { price: number; amount: number; total: number }[] = [];

    let cumulative = 0;

    for (const [p, q] of levels) {

      const price = parseFloat(p);
      const amount = parseFloat(q);
      const quote = price * amount;
      cumulative += quote;
      rows.push({ price, amount, total: cumulative });
    }

    if (side === 'asks') rows.sort((a, b) => a.price - b.price); else rows.sort((a, b) => b.price - a.price);

    return rows;
  }

  ngOnDestroy(): void {
    this.playerDetailsSub?.unsubscribe();
    this.detachLayoutResizeListeners();
    this.endLayoutResize();

    // Clear all intervals and timeouts

    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = undefined;
    }

    // Clean up miniTicker subscriptions and timers
    if (this.miniTickerHandler) {
      const mt = this.getMarketTypeFromSymbol(this.activeSymbol);
      this.binanceSocket.offMiniTicker(this.miniTickerHandler, mt);
      this.binanceSocket.updateMiniTickerSubscriptions([], mt, 'active-trade');
      this.miniTickerHandler = undefined;
    }

    if (this.allMiniTickerHandler) {
      this.binanceSocket.offMarketMiniTicker(this.allMiniTickerHandler);
      this.allMiniTickerHandler = undefined;
    }

    if (this.miniFlushTimer) {
      clearInterval(this.miniFlushTimer);
      this.miniFlushTimer = undefined;
    }

    // Clean up combined stream subscriptions
    if (this.allTickerHandler) {
      this.binanceSocket.offAllTicker(this.allTickerHandler);
      this.allTickerHandler = undefined;
    }

    if (this.singleTickerHandler) {
      const mt = this.marketType;
      this.binanceSocket.offSingleTicker(this.singleTickerHandler, mt);
      this.binanceSocket.updateSingleTickerSubscriptions([], mt, 'active-trade-stats');
      this.singleTickerHandler = undefined;
    }

    if (this.combinedHandler) {
      this.binanceSocket.offCombined(this.combinedHandler);
      this.combinedHandler = undefined;
    }

    // Clear other timers

    if (this.moversTimer) clearTimeout(this.moversTimer);

    if (this.bookTimer) clearTimeout(this.bookTimer);

    if (this.pairsTimer) clearTimeout(this.pairsTimer);

    if (this._priceFlushTimer) clearTimeout(this._priceFlushTimer);

    if (this._marketTickTimer) { clearInterval(this._marketTickTimer); this._marketTickTimer = undefined; }
  }


  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public sharedService: SharedService,
    private binanceSocket: BinanceSocketService,
    private tradingSocket: TradingSocketService,
    private authService: AuthService,
    private watchlistSocketService: WatchlistSocketService,
    private zone: NgZone,
    private marketHours: MarketHoursService,
    private marketDataService: MarketDataService,
    private playerDetailsService: PlayerDetailsService,

    @Inject(PLATFORM_ID) private platformId: any

  ) { }

  private playerDetailsSub?: { unsubscribe(): void };

  private getMarketTypeFromSymbol(symbol: string): MarketType {
    // 1. Check allPairs first — has market_type from API
    const pair = this.allPairs.find(p => p.symbol === symbol || p['market'] === symbol);
    if (pair) {
      if (pair['market_type_id'] === 1 || Number(pair['market_type_id']) === 1 || (pair['exchange'] || '').toUpperCase() === 'BINANCE' || (pair['path'] || '').toUpperCase().startsWith('CRYPTO')) {
        return MarketType.CRYPTO;
      }
      if (pair.market_type) {
        const mt = (pair.market_type as string).toUpperCase();
        if (mt === 'CRYPTO') return MarketType.CRYPTO;
        if (mt === 'FOREX') return MarketType.FOREX;
        if (mt === 'COMMODITY') return MarketType.COMMODITY;
        if (mt === 'METAL') return MarketType.METAL;
        if (mt === 'STOCK') return MarketType.STOCK;
        if (mt === 'INDEX') return MarketType.INDEX;
        if (mt === 'ETFS') return MarketType.ETFS;
        if (mt === 'FORWARDS') return MarketType.FORWARDS;
        if (mt === 'MCX') return MarketType.MCX;
      }
    }

    // 2. Check MarketDataService markets — check market_type field inside each item too
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
          // Prefer market_type field over the key name
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
          // exchange: MT → HUB
          const ex = (found.exchange || '').toUpperCase();
          if (ex === 'MT' || ex === 'MT5') return MarketType.COMMODITY;
        }
      }
    }

    // 3. Pattern fallback
    const u = symbol.toUpperCase();
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(u)) return MarketType.CRYPTO;
    if (/^[A-Z]{6}$/.test(u)) return MarketType.FOREX;
    if (/^XAU|^XAG/.test(u)) return MarketType.METAL;
    if (/DOWJONES|NASDAQ|SP500/.test(u)) return MarketType.INDEX;

    // 4. Default — COMMODITY (MT5/HUB) for unknown
    return MarketType.COMMODITY;
  }


  ngOnInit(): void {

    if (!isPlatformBrowser(this.platformId)) return;

    this.loadDesktopLayout();
    this.updateDesktopLayout();

    const parentSlug = this.route.parent?.snapshot.paramMap.get('slug') || 'crypto';
    this.currentSlug = parentSlug;
    this.marketType = SLUG_TO_MARKET[parentSlug] ?? MarketType.CRYPTO;

    // 1-second tick — drives realtime market status, countdown, buy/sell lock
    // Run OUTSIDE Angular zone to avoid ExpressionChangedAfterItHasBeenCheckedError
    this.zone.runOutsideAngular(() => {
      this._marketTickTimer = setInterval(() => {
        this.zone.run(() => {
          this._refreshMarketHoursStatus();
          this.cdr.markForCheck();
        });
      }, 1000);
    });

    // Subscribe to market status updates from BinanceSocketService
    // This picks up cached st values from watchlist subscriptions immediately on symbol switch
    this.binanceSocket.marketStatus$.subscribe(statusMap => {
      if (!this.activeSymbol) return;
      const sym = this.activeSymbol.toUpperCase();
      if (statusMap.has(sym)) {
        this.isMarketOpen = statusMap.get(sym)!;
      }
    });

    // Subscribe to pending orders for chart price lines
    this.tradingSocket.pendingOrders$.subscribe(orders => {
      this.chartPendingOrders = orders || [];
    });

    this.tradingSocket.positions$.subscribe((pos) => {
      this.chartOpenPositions = Array.isArray(pos) ? [...pos] : [];
    });

    if (!this.playerDetailsService.details) {
      this.playerDetailsService.refresh().subscribe();
    }

    this.playerDetailsSub = this.playerDetailsService.details$.subscribe(() => {
      if (this.activeSymbol) {
        this.syncTradeLeverageFromProfile(false, this.activeSymbol);
        this.cdr.markForCheck();
      }
    });
    if (this.playerDetailsService.details && this.activeSymbol) {
      this.syncTradeLeverageFromProfile(true, this.activeSymbol);
    }

    this.route.queryParamMap.subscribe(params => {
      const marketParam = params.get('market');
      const timeframe = (params.get('timeframe') || '15m');
      const chartType = (params.get('chart') || 'area') as any;

      if (!marketParam) {
        const user = this.authService?.currentUser;
        const playerId = user?.playerId || user?.userId || user?.player_id || '';

        if (playerId) {
          const watchlist = this.watchlistSocketService?.getCurrentWatchlist();

          if (watchlist && watchlist.length > 0) {
            // Use MarketDataService to convert market IDs to symbols
            const allMarkets = this.marketDataService.allMarkets;
            if (allMarkets.length > 0) {
              const firstMarketId = watchlist[0];
              const firstMarket = allMarkets.find((m: any) => m.market_id === firstMarketId);
              if (firstMarket && typeof firstMarket === 'object' && 'market' in firstMarket) {
                const firstMarketSymbol = (firstMarket as any).market || '';

                this.router.navigate(['/trade'], {
                  queryParams: {
                    market: firstMarketSymbol,
                    timeframe: '15m',
                    chart: 'candles'
                  },
                  replaceUrl: true
                });
                return;
              }
            }
          }
        }
      }

      this.market = marketParam || '';
      this.marketKey = this.market || '';

      // Reset prices and market status for new market
      this.bestBidNow = 0;
      this.bestAskNow = 0;
      this.lastPriceNow = 0;
      this.displayBid = 0;
      this.displayAsk = 0;
      this.displayBidStr = '-';
      this.displayAskStr = '-';
      if (this._priceFlushTimer) { clearTimeout(this._priceFlushTimer); this._priceFlushTimer = null; }
      this.isMarketOpen = true;
      // Reset order type to Market Execution on symbol change
      this.selectedOrderTypeId = 1;
      this.showOrderTypeDropdown = false;
      this.tradeSlip.limitPrice = 0;
      this.tradeSlip.stopPrice = 0;
      this.tradeSlip.stopLoss = 0;
      this.tradeSlip.takeProfit = 0;
      this.tradeSlip.expiration = 'GTC';
      this.tradeSlip.expirationDate = '';
      this.tradeVolumeInputMode = 'lots';

      // Clear stale market status from previous symbol
      if (marketParam) {
        this.binanceSocket.resetMarketStatus(marketParam);
      }

      if (marketParam) {
        const { base, quote } = this.splitSymbol(marketParam);
        this.base = base;
        this.quote = quote;

        this.marketList = [this.base, this.quote];

      } else {

        this.base = '';

        this.quote = '';

        this.marketList = [];

      }


      this.activeInterval = timeframe as any;
      this.activeChartType = chartType;

      // Detect market type from symbol immediately — don't wait for pairs to load
      if (marketParam) {
        this.marketType = this.getMarketTypeFromSymbol(marketParam);
        this.applySymbolLeverageChange(marketParam);
      } else {
        this.closeLeveragePicker();
        this.syncTradeLeverageFromProfile(true);
      }

      const pairDetail = this.getPairDetail(marketParam);

      // Refresh market hours status for new symbol
      this._refreshMarketHoursStatus();

      // Always load markets & mini-ticker so left panel works,
      // but only start price/depth streams when a market is selected.
      this.loadBinancePairs();
      this.ensureMiniTicker();
      if (marketParam) {
        // Subscribe miniTicker immediately — don't wait for loadBinancePairs
        this.subscribeToCurrentSymbolMiniTicker();
        this.setupPriceUpdates();
        this.connectCombinedStreams();
      }

      // initial left list and movers view

      this.refreshViewPairs();

      this.refreshTopMoversView();

    });

  }


  private updateVisibleSet() {

    this.visibleSet = new Set(this.visiblePairs.map(p => p.symbol));

  }

  getPairDetail(market: string) {
    let pair = this.allPairs.find(f => f.symbol == market);
    return pair;
  }

  private loadBinancePairs() {
    // Load player's mapped markets from API
    this.loadPlayerMarkets();
  }

  private loadPlayerMarkets() {

    this.pairsLoading = true;

    // If MarketDataService already has data — use it immediately (no sessionStorage needed)
    if (this.marketDataService.isLoaded && this.marketDataService.allMarkets.length > 0) {
      this.populatePairsFromMarketData(this.marketDataService.markets);
      this.pairsLoading = false;
      return;
    }

    // Subscribe to MarketDataService — apply when data arrives
    const sub = this.marketDataService.state$.subscribe(state => {
      if (state.loaded && Object.keys(state.markets).length > 0) {
        sub.unsubscribe();
        this.populatePairsFromMarketData(state.markets);
        this.pairsLoading = false;
      }
    });
  }

  public populatePairsFromMarketData(marketData: any) {
    this.allPairs = [];
    if (!marketData || typeof marketData !== 'object') {

      this.applySearchFilter();

      this.refreshViewPairs();

      this.refreshTopMoversView();

      return;

    }

    const marketsByType = Array.isArray(marketData)

      ? marketData.reduce((acc: Record<string, any[]>, item: any) => {

        const ty = item?.type || item?.quote || 'UNKNOWN';

        acc[ty] = acc[ty] || [];

        acc[ty].push(item);

        return acc;

      }, {})

      : marketData;


    for (const marketType of Object.keys(marketsByType)) {
      const markets = marketsByType[marketType];
      if (!Array.isArray(markets)) continue;
      for (const market of markets) {
        const symbolRaw = market?.market || market?.symbol || '';
        const symbol = symbolRaw || '';
        const base = market?.base || symbolRaw || symbol;
        const aid = market?.market_id ?? market?.aid ?? market?.account_id ?? null;
        this.allPairs.push({
          // Spread full market object first — preserves all keys from API
          ...market,
          // Then override/add computed fields
          symbol,
          base,
          quote: (marketType || market?.quote_currency_code || market?.quote || ''),
          aid,
          bid: market?.bid ?? 0,
          ask: market?.ask ?? 0,
          ltp: market?.ltp ?? market?.close ?? 0,
          chgPct: 0,
          // Explicit key aliases for convenience
          description: market?.description || null,
          logo_url: market?.logo_url || null,
          market_type: market?.market_type || marketType || null,
          market_type_id: market?.market_type_id ?? null,
          base_currency_code: market?.base_currency_code || null,
          base_currency_name: market?.base_currency_name || null,
          quote_currency_code: market?.quote_currency_code || null,
          quote_currency_name: market?.quote_currency_name || null,
          decimal_places: market?.decimal_places ?? 2,
          expiry_type: market?.expiry_type || null,
          market_id: market?.market_id ?? aid,
          status: market?.status ?? true,
          exchange: market?.exchange || null,
          path: market?.path || null,
        });
      }
    }

    this.allPairs.sort((a, b) => a.symbol.localeCompare(b.symbol));
    this.applySearchFilter();
    this.refreshViewPairs();
    this.refreshTopMoversView();
    // Refresh market hours now that allPairs has trading_hours data
    this._refreshMarketHoursStatus();
    if (this.activeSymbol) {
      this.syncTradeLeverageFromProfile(true);
    }
  }

  private load24hStats() {

    if (this.marketType !== MarketType.CRYPTO) {

      this.ensureMiniTicker();

      return;

    }

    const tUrl = urlConstant.ticker24hr();

    this.http.get<any[]>(tUrl).subscribe(list => {

      const map: Record<string, number> = {};

      for (const r of list) {

        const sym = r.symbol as string;

        const change = parseFloat(r.priceChangePercent);

        if (Number.isFinite(change)) map[sym] = change;

        const lp = parseFloat(r.lastPrice);

        if (Number.isFinite(lp)) this.lastPrice[sym] = lp;

      }

      this.change24h = map;

      this.ensureMiniTicker();

    });

  }

  selectPairFromModal(p: { symbol: string; base: string; quote: string }) {

    // add to selected list (if not exists) and activate

    this.addPair(p);

    this.setActivePair(p.symbol);

    this.showPairModal = false;

  }

  applyChartType(t: { key: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline'; enabled: boolean }) {

    if (!t.enabled) return;

    this.activeChartType = t.key;

    this.showTypePanel = false;

    // Map to child chart behavior

    try {

      if (t.key === 'area') {
        this.chart.setChartStyle('area');

      } else if (t.key === 'candles') {
        this.chart.setChartStyle('candles');

      } else if (t.key === 'bars') {
        this.chart.setChartStyle('bars');

      } else if (t.key === 'histogram') {
        this.chart.setChartStyle('histogram');

      } else if (t.key === 'line') {
        this.chart.setChartStyle('line');
      } else if (t.key === 'baseline') {
        this.chart.setChartStyle('baseline');
      }
    } catch { }

    this.navigateToCurrent();

  }

  // ===== Movers helpers =====

  private pushMoverEvent(symbol: string, chgPct: number, info: string, icon: 'up' | 'down', cat: string) {
    const now = Math.floor(Date.now() / 1000);
    const { base, quote } = this.splitSymbol(symbol);
    const existing = this.moversAll.find(x => x.symbol === symbol && x.cat === cat && x.info === info);
    if (existing) {
      existing.chgPct = chgPct;
      existing.time = now;
    } else {
      this.moversAll.unshift({ symbol, base, quote, chgPct, info, time: now, icon, cat });
      if (this.moversAll.length > 100) this.moversAll.length = 100;
    }
  }

  private scheduleRefreshPairs() {
    if (this.pairsTimer) return;
    this.pairsTimer = setTimeout(() => {
      // Rebuild left pairs table (including NEW tab) on ticker updates
      this.refreshViewPairs();
      this.pairsTimer = undefined;
    }, 150);
  }

  private scheduleRefreshMovers() {
    if (this.moversTimer) return;
    this.moversTimer = setTimeout(() => {
      this.refreshTopMoversView();
      this.moversTimer = undefined;
    }, 300);

  }

  private refreshTabsFromTickers() {

    if (this.marketType === MarketType.CRYPTO) {

      this.tabs = ['Liked', 'NEW'];

    } else {
      const quotesFound = new Set<string>();
      for (const s of Object.keys(this.tickers)) {
        const q = this.findQuote(s);
        if (q) quotesFound.add(q);
      }
      const dynamicQuotes = this.QUOTE_TABS_BASE.filter(q => quotesFound.has(q));
      this.tabs = ['Liked', 'NEW', ...dynamicQuotes];
    }

    if (!this.tabs.includes(this.activePairTab === 'all' ? 'Liked' : this.activePairTab)) {
      this.activePairTab = 'all';
    }
  }

  private findQuote(symbol: string): string | null {
    for (const q of this.QUOTE_TABS_BASE) {
      if (symbol.endsWith(q)) return q;
    }
    return null;
  }

  private splitSymbol(symbol: string): { base: string; quote: string } {
    const q = this.findQuote(symbol);
    if (!q) return { base: symbol, quote: '' };
    return { base: symbol.slice(0, symbol.length - q.length), quote: q };
  }

  goToWatchlist(): void {
    this.router.navigate(['/watchlist']);
  }

  get hasMarketSelected(): boolean {
    return !!(this.market && String(this.market).trim().length > 0);
  }

  /** Grid columns: watchlist | grip | chart | grip | order panel */
  get tradeTopGridColumns(): string | null {
    if (!this.isDesktopLayout) return null;
    return `${this.leftColWidth}px 10px minmax(0, 1fr) 10px ${this.rightColWidth}px`;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateDesktopLayout();
  }

  startLayoutResize(mode: 'left' | 'right' | 'positions', event: PointerEvent): void {
    if (!this.isDesktopLayout || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    this.detachLayoutResizeListeners();

    this.activeResizeMode = mode;
    this.layoutResizePointerId = event.pointerId;
    this.layoutResizeStartX = event.clientX;
    this.layoutResizeStartY = event.clientY;
    this.layoutResizeStartLeft = this.leftColWidth;
    this.layoutResizeStartRight = this.rightColWidth;
    this.layoutResizeStartPositions = this.positionsRowHeight;

    document.body.classList.add('trade-layout-resizing');
    document.body.classList.toggle('trade-layout-resizing--row', mode === 'positions');
    document.body.classList.toggle('trade-layout-resizing--col', mode !== 'positions');

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.layoutResizePointerId) return;
      e.preventDefault();
      this.onLayoutResizeMove(e);
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.layoutResizePointerId) return;
      this.detachLayoutResizeListeners();
      this.endLayoutResize();
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    this.layoutResizeCleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
    };

    const handle = event.currentTarget as HTMLElement | null;
    try {
      handle?.setPointerCapture(event.pointerId);
    } catch { /* unsupported */ }
  }

  private onLayoutResizeMove(event: PointerEvent): void {
    if (!this.activeResizeMode) return;

    const dx = event.clientX - this.layoutResizeStartX;
    const dy = event.clientY - this.layoutResizeStartY;

    if (this.activeResizeMode === 'left') {
      const b = this.getLeftWidthBounds();
      this.leftColWidth = this.clampLayout(this.layoutResizeStartLeft + dx, b.min, b.max);
    } else if (this.activeResizeMode === 'right') {
      const b = this.getRightWidthBounds();
      this.rightColWidth = this.clampLayout(this.layoutResizeStartRight - dx, b.min, b.max);
    } else if (this.activeResizeMode === 'positions') {
      const b = this.getPositionsHeightBounds();
      // Drag up → positions taller; drag down → positions shorter
      this.positionsRowHeight = this.clampLayout(
        this.layoutResizeStartPositions - dy,
        b.min,
        b.max
      );
    }

    this.cdr.markForCheck();
  }

  private detachLayoutResizeListeners(): void {
    this.layoutResizeCleanup?.();
    this.layoutResizeCleanup = null;
    this.layoutResizePointerId = -1;
  }

  private endLayoutResize(): void {
    const wasActive = !!this.activeResizeMode;
    this.activeResizeMode = null;
    document.body.classList.remove(
      'trade-layout-resizing',
      'trade-layout-resizing--row',
      'trade-layout-resizing--col'
    );
    if (wasActive) {
      this.saveDesktopLayout();
    }
    this.cdr.markForCheck();
  }

  private updateDesktopLayout(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.isDesktopLayout = window.innerWidth >= CryptoComponent.DESKTOP_BP;
    if (this.isDesktopLayout) {
      this.normalizeDesktopLayout();
    }
    this.cdr.markForCheck();
  }

  private loadDesktopLayout(): void {
    try {
      const raw = localStorage.getItem(CryptoComponent.LAYOUT_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (typeof v.left === 'number') {
        this.leftColWidth = v.left;
      }
      if (typeof v.right === 'number') {
        this.rightColWidth = v.right;
      }
      if (typeof v.positions === 'number') {
        this.positionsRowHeight = v.positions;
      }
      this.normalizeDesktopLayout();
    } catch { /* ignore */ }
  }

  private getTradeLayoutShell(): HTMLElement | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return document.querySelector('.main-trade-shell') as HTMLElement | null;
  }

  private getPositionsHeightBounds(): { min: number; max: number } {
    const shell = this.getTradeLayoutShell();
    const shellH = shell?.clientHeight ?? 400;
    const max = Math.max(
      this.LAYOUT_MIN_POSITIONS,
      shellH - this.LAYOUT_MIN_TOP - this.LAYOUT_RESIZER_H
    );
    return { min: this.LAYOUT_MIN_POSITIONS, max };
  }

  private getLeftWidthBounds(): { min: number; max: number } {
    const shell = this.getTradeLayoutShell();
    const w = shell?.clientWidth ?? 1200;
    const resizers = this.LAYOUT_RESIZER_H * 2;
    const max = Math.max(
      this.LAYOUT_MIN_LEFT,
      w - this.LAYOUT_MIN_RIGHT - this.LAYOUT_MIN_CENTER - resizers
    );
    return { min: this.LAYOUT_MIN_LEFT, max };
  }

  private getRightWidthBounds(): { min: number; max: number } {
    const shell = this.getTradeLayoutShell();
    const w = shell?.clientWidth ?? 1200;
    const resizers = this.LAYOUT_RESIZER_H * 2;
    const max = Math.max(
      this.LAYOUT_MIN_RIGHT,
      w - this.LAYOUT_MIN_LEFT - this.LAYOUT_MIN_CENTER - resizers
    );
    return { min: this.LAYOUT_MIN_RIGHT, max };
  }

  private normalizeDesktopLayout(): void {
    const pos = this.getPositionsHeightBounds();
    this.positionsRowHeight = this.clampLayout(this.positionsRowHeight, pos.min, pos.max);
    const left = this.getLeftWidthBounds();
    this.leftColWidth = this.clampLayout(this.leftColWidth, left.min, left.max);
    const right = this.getRightWidthBounds();
    this.rightColWidth = this.clampLayout(this.rightColWidth, right.min, right.max);
  }

  private saveDesktopLayout(): void {
    try {
      localStorage.setItem(
        CryptoComponent.LAYOUT_KEY,
        JSON.stringify({
          left: this.leftColWidth,
          right: this.rightColWidth,
          positions: this.positionsRowHeight
        })
      );
    } catch { /* ignore */ }
  }

  private clampLayout(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.showOrderTypeDropdown) this.showOrderTypeDropdown = false;
    if (this.showVolumeModeDropdown) this.showVolumeModeDropdown = false;
  }

  private refreshTopMoversView() {
    const active = this.topMoverActive;
    let list: Array<{ symbol: string; base: string; quote: string; chgPct: number; info: string; time: number; icon: 'up' | 'down'; cat: string }> = [];
    const entries = Object.values(this.tickers);

    const hasTickers = entries.length > 0;

    if (active === 'All') {
      const recent = [...this.moversAll].sort((a, b) => b.time - a.time).slice(0, 20);
      if (recent.length) {
        list = recent;
      } else if (hasTickers) {
        const mapped = entries.map(t => {
          const { base, quote } = this.splitSymbol(t.s);
          const icon = (t.chgPct >= 0 ? 'up' : 'down') as 'up' | 'down';
          const info = t.chgPct >= 0 ? 'Rally' : 'Pullback';
          return { symbol: t.s, base, quote, chgPct: t.chgPct, info, time: Math.floor(Date.now() / 1000), icon, cat: 'Change' };
        });

        mapped.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));
        list = mapped.slice(0, 20);
      } else {

        // Fallback: use allPairs + REST 24h data when tickers are still empty

        for (const p of this.allPairs || []) {
          const sym = p.symbol;
          const chg = this.change24h[sym] ?? 0;
          const { base, quote } = this.splitSymbol(sym);
          const icon = (chg >= 0 ? 'up' : 'down') as 'up' | 'down';
          const info = chg >= 0 ? 'Rally' : 'Pullback';
          list.push({ symbol: sym, base, quote, chgPct: chg, info, time: Math.floor(Date.now() / 1000), icon, cat: 'Change' });

        }

        list.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));

        list = list.slice(0, 20);

      }

    } else if (active === 'New High/Low') {

      list = this.moversAll.filter(x => x.cat === 'New High/Low').sort((a, b) => b.time - a.time).slice(0, 20);

      if (list.length === 0 && !hasTickers) {

        // Fallback: show top gainers/losers from allPairs

        for (const p of this.allPairs || []) {

          const sym = p.symbol;

          const chg = this.change24h[sym] ?? 0;

          const { base, quote } = this.splitSymbol(sym);

          const icon = (chg >= 0 ? 'up' : 'down') as 'up' | 'down';

          const info = chg >= 0 ? 'Rally' : 'Pullback';

          list.push({ symbol: sym, base, quote, chgPct: chg, info, time: Math.floor(Date.now() / 1000), icon, cat: 'Change' });

        }

        list.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));

        list = list.slice(0, 20);

      }

    } else if (active === 'Change') {

      if (hasTickers) {
        const mapped = entries.map(t => {
          const { base, quote } = this.splitSymbol(t.s);
          const icon = (t.chgPct >= 0 ? 'up' : 'down') as 'up' | 'down';
          const info = t.chgPct >= 0 ? 'Rally' : 'Pullback';
          return { symbol: t.s, base, quote, chgPct: t.chgPct, info, time: Math.floor(Date.now() / 1000), icon, cat: 'Change' };
        });

        mapped.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));
        list = mapped.slice(0, 20);
      } else {

        // Fallback: use allPairs + REST 24h data

        for (const p of this.allPairs || []) {
          const sym = p.symbol;
          const chg = this.change24h[sym] ?? 0;
          const { base, quote } = this.splitSymbol(sym);
          const icon = (chg >= 0 ? 'up' : 'down') as 'up' | 'down';
          const info = chg >= 0 ? 'Rally' : 'Pullback';
          list.push({ symbol: sym, base, quote, chgPct: chg, info, time: Math.floor(Date.now() / 1000), icon, cat: 'Change' });
        }

        list.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));
        list = list.slice(0, 20);
      }

    } else if (active === 'Volume') {

      if (hasTickers) {

        const mapped = entries.map(t => {
          const { base, quote } = this.splitSymbol(t.s);
          return { symbol: t.s, base, quote, chgPct: t.chgPct, info: 'High Vol', time: Math.floor(Date.now() / 1000), icon: (t.chgPct >= 0 ? 'up' : 'down') as 'up' | 'down', cat: 'Volume', q: t.q } as any;
        });

        mapped.sort((a: any, b: any) => (b.q || 0) - (a.q || 0));
        list = mapped.slice(0, 20).map((x: any) => ({ symbol: x.symbol, base: x.base, quote: x.quote, chgPct: x.chgPct, info: 'High Vol', time: x.time, icon: x.icon, cat: 'Volume' }));

      } else {

        // Fallback: use allPairs sorted by change (volume not available in REST)

        for (const p of this.allPairs || []) {
          const sym = p.symbol;
          const chg = this.change24h[sym] ?? 0;
          const { base, quote } = this.splitSymbol(sym);
          const icon = (chg >= 0 ? 'up' : 'down') as 'up' | 'down';
          list.push({ symbol: sym, base, quote, chgPct: chg, info: 'High Vol', time: Math.floor(Date.now() / 1000), icon, cat: 'Volume' });
        }

        list.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));
        list = list.slice(0, 20);

      }

    } else if (active === 'Fluctuation') {
      if (hasTickers) {
        const mapped = entries.map(t => {
          const delta = (t.chgPct ?? 0) - (t.prevChg ?? 0);
          const { base, quote } = this.splitSymbol(t.s);
          const icon = (delta >= 0 ? 'up' : 'down') as 'up' | 'down';
          return { symbol: t.s, base, quote, chgPct: delta, info: 'Volatility', time: Math.floor(Date.now() / 1000), icon, cat: 'Fluctuation' };
        });

        mapped.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));

        list = mapped.slice(0, 20);

      } else {

        // Fallback: use allPairs sorted by change (fluctuation not available without prevChg)

        for (const p of this.allPairs || []) {
          const sym = p.symbol;
          const chg = this.change24h[sym] ?? 0;
          const { base, quote } = this.splitSymbol(sym);
          const icon = (chg >= 0 ? 'up' : 'down') as 'up' | 'down';
          list.push({ symbol: sym, base, quote, chgPct: chg, info: 'Volatility', time: Math.floor(Date.now() / 1000), icon, cat: 'Fluctuation' });
        }
        list.sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct));
        list = list.slice(0, 20);
      }
    }
    this.moverView = list;
  }

  formatTime(unixSeconds: number): string {

    try {
      const d = new Date(unixSeconds * 1000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    } catch { return ''; }
  }

  // ===== Trade slip & active market helpers =====
  get activeSymbol(): string {

    const s1 = (this.base + this.quote);
    if (s1) return s1;
    const first = this.selectedPairs && this.selectedPairs.length ? this.selectedPairs[0].symbol : '';
    if (first) return first;
    return (this.marketKey || '');

  }

  get activeSessionChange(): number | null {
    return this.change24h[this.activeSymbol] ?? null;

  }

  get activeChangePct(): number {
    return this.change24h[this.activeSymbol] ?? 0;
  }

  get activeChangeClass(): string {
    const v = this.activeChangePct;
    return v > 0 ? 'up' : (v < 0 ? 'down' : '');
  }

  priceOf(sym: string): number | null {
    if (sym === this.activeSymbol) {
      // Primary: kline close price
      // if (Number.isFinite(this.lastPriceNow) && this.lastPriceNow > 0) {
      //   return this.lastPriceNow;
      // }
      // Fallback: miniTicker bid price (available immediately on subscribe)
      if (Number.isFinite(this.bestBidNow) && this.bestBidNow > 0) {
        return this.bestBidNow;
      }
      // Fallback 2: ticker last price
      // const t = this.tickers[sym];
      // if (t && Number.isFinite(t.last) && t.last > 0) return t.last;
    }
    return null;
  }

  get displayTime(): string {

    const m = Math.floor(this.slipDurationSec / 60);

    const s = this.slipDurationSec % 60;

    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  decTime() { this.slipDurationSec = Math.max(30, this.slipDurationSec - 30); }

  incTime() { this.slipDurationSec = Math.min(60 * 60, this.slipDurationSec + 30); }

  onTimeInput(val: string) {

    if (!val) return;

    let secs = NaN;

    const str = (val || '').trim();

    const mmss = str.match(/^(\d{1,2})[:.](\d{1,2})$/);

    if (mmss) {
      const m = parseInt(mmss[1], 10);
      const s = parseInt(mmss[2], 10);
      if (!isNaN(m) && !isNaN(s)) secs = m * 60 + s;

    } else {
      const n = parseInt(str, 10);
      if (!isNaN(n)) secs = n;
    }

    if (isNaN(secs)) return;

    secs = Math.max(30, Math.min(3600, secs));

    this.slipDurationSec = secs;

  }

  decInvest() { this.slipInvest = Math.max(this.slipMinInvest, this.slipInvest - this.slipInvestStep); }

  incInvest() { this.slipInvest = Math.min(this.slipMaxInvest, this.slipInvest + this.slipInvestStep); }

  normalizeInvest() {

    let v = Number(this.slipInvest);

    if (!Number.isFinite(v)) v = this.slipMinInvest;

    v = Math.max(this.slipMinInvest, Math.min(this.slipMaxInvest, v));

    if (this.slipInvestStep > 0) {

      const base = this.slipMinInvest;

      const steps = Math.round((v - base) / this.slipInvestStep);

      v = base + steps * this.slipInvestStep;

    }

    this.slipInvest = v;

  }


  get payoutPercent(): number {
    const ch = this.change24h[this.activeSymbol] || 0;
    const pct = 90 + Math.min(5, Math.max(0, Math.abs(ch) / 4));
    return Math.max(80, Math.min(95, +pct.toFixed(0)));
  }

  get payoutAmount(): number {
    return +(this.slipInvest * (1 + this.payoutPercent / 100)).toFixed(2);
  }

  closePairInfo() {
    this.showPairInfo = false;
  }

  // ===== Navigation helpers and click handlers =====

  private normalizeMarketParam(): string {

    return this.market || '';

  }

  private navigateTo(market: string, timeframe?: string, chart?: string) {

    const tf = timeframe || this.activeInterval || '15m';

    const ch = chart || this.activeChartType || 'area';

    this.router.navigate([

      '/trade'

    ], {

      queryParams: { market, timeframe: tf, chart: ch }

    });

  }

  private navigateToCurrent() {

    const market = this.normalizeMarketParam();

    this.navigateTo(market);

  }

  openSymbol(symbol: string) {

    const sym = String(symbol || '');

    const { base, quote } = this.splitSymbol(sym);
    this.base = base;
    this.quote = quote;

    this.market = sym;

    this.marketKey = sym;

    this.marketList = [this.base, this.quote];

    this.applySymbolLeverageChange(sym);

    try { this.chart?.onIntervalChange(this.activeInterval); } catch { }

    this.navigateTo(sym);

  }

  applyInterval(itv: string) {

    this.activeInterval = itv;

    try { this.chart?.onIntervalChange(itv); } catch { }

    this.navigateToCurrent();

  }

  onChildIntervalChange(itv: string) {

    if (!itv || this.activeInterval === itv) return;

    this.applyInterval(itv);

  }

  // MiniTicker subscription (already used in loadBinancePairs)

  private lastSubscribedMarketType: MarketType | null = null;

  private ensureMiniTicker() {
    // Re-subscribe if market type changed
    if (this.miniTickerSubscribed && this.lastSubscribedMarketType === this.marketType) return;

    // If market type changed, unsubscribe old
    if (this.miniTickerSubscribed && this.lastSubscribedMarketType !== null && this.lastSubscribedMarketType !== this.marketType) {
      this.binanceSocket.emitUnsubscribeMarketType(this.lastSubscribedMarketType, this.lastSubscribedMarketType);
    }

    this.miniTickerSubscribed = true;
    this.lastSubscribedMarketType = this.marketType;

    // Subscribe to market-type specific stream
    this.binanceSocket.emitSubscribeMarketType(this.marketType);



    const handler = (msg: any) => {

      try {
        if (!Array.isArray(msg)) return;

        // Support two shapes:

        // 1) Direct array-of-tickers: [ { ... }, { ... } ]

        // 2) MT5 envelope: [ "marketMiniTicker", [ { ... }, { ... } ] ]

        let arr: any = msg;

        if (msg.length === 2 && msg[0] === 'marketMiniTicker' && Array.isArray(msg[1])) {

          arr = msg[1];

        }

        if (!Array.isArray(arr)) return;



        const updates: { [key: string]: number } = {};



        for (const t of arr) {

          const s = t.s as string;

          const c = parseFloat(t.c);

          const o = parseFloat(t.o);

          const h = parseFloat(t.h);

          const l = parseFloat(t.l);

          const v = parseFloat(t.v);



          if (!Number.isFinite(c)) continue;

          updates[s] = c;

          let chgPct = NaN;

          if (typeof (t as any).d === 'string') {
            const dStr = String((t as any).d).replace('%', '');
            const dNum = parseFloat(dStr);
            if (Number.isFinite(dNum)) chgPct = dNum;
          }

          if (!Number.isFinite(chgPct) && Number.isFinite(o) && o !== 0) {
            chgPct = ((c - o) / o) * 100;
          }

          const prevTicker = this.tickers[s];

          const prevLast = prevTicker?.last ?? c;

          const prevChg = prevTicker?.chgPct ?? (Number.isFinite(chgPct) ? chgPct : 0);

          const qVolRaw = (t as any).q != null ? parseFloat((t as any).q) : NaN;



          const hNow = Number.isFinite(h) ? h : prevTicker?.h;

          const lNow = Number.isFinite(l) ? l : prevTicker?.l;

          const qNow = Number.isFinite(qVolRaw) ? qVolRaw : (prevTicker?.q ?? 0);

          const chVal = Number.isFinite(chgPct) ? chgPct : (prevTicker?.chgPct ?? 0);



          const bidRaw = (t as any).b != null ? parseFloat((t as any).b) : NaN;

          const askRaw = (t as any).a != null ? parseFloat((t as any).a) : NaN;

          const bidNow = Number.isFinite(bidRaw) ? bidRaw : (prevTicker?.bid ?? 0);

          const askNow = Number.isFinite(askRaw) ? askRaw : (prevTicker?.ask ?? 0);


          this.tickers[s] = { s, last: c, prev: prevLast, chgPct: chVal, prevChg, q: qNow, h: hNow, l: lNow, bid: bidNow, ask: askNow };

          if (Number.isFinite(chVal)) this.change24h[s] = chVal;
          if (Number.isFinite(h)) this.high24h[s] = h;
          if (Number.isFinite(l)) this.low24h[s] = l;
          if (Number.isFinite(v)) this.volume24h[s] = v;
        }

        for (const [symbol, price] of Object.entries(updates)) {
          const isActive = symbol === this.activeSymbol;
          const isSelected = this.selectedPairs.some(sp => sp.symbol === symbol);
          const isVisible = this.visibleSet.has(symbol);
          if (isActive || isSelected || this.showPairModal || isVisible) {
            this.lastPrice[symbol] = price as number;
          }
        }

        // Refresh viewPairs to show live price updates in all-pairs-ctx
        this.scheduleRefreshPairs();
      } catch { }
    };



    this.allMiniTickerHandler = handler;

    this.binanceSocket.onAllMiniTicker(handler);

    this.binanceSocket.onMarketMiniTicker(handler);

  }

  private subscribeToCurrentSymbolMiniTicker() {
    if (!this.activeSymbol) return;

    // Clean up previous handler if exists
    if (this.miniTickerHandler) {
      const oldMt = this.getMarketTypeFromSymbol(this.activeSymbol);
      this.binanceSocket.offMiniTicker(this.miniTickerHandler, oldMt);
    }

    // Create new handler for current symbol

    this.miniTickerHandler = (data: any) => {
      this.handleCurrentSymbolMiniTicker(data);
    };

    // Subscribe to mini-ticker with correct market type
    const marketType = this.getMarketTypeFromSymbol(this.activeSymbol);

    this.binanceSocket.onMiniTicker(this.miniTickerHandler, marketType);

    this.binanceSocket.updateMiniTickerSubscriptions([this.activeSymbol], marketType, 'active-trade');
  }

  private handleCurrentSymbolMiniTicker(data: any) {
    try {
      const symbol = data.s;
      const normIncoming = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const normActive = (this.activeSymbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (normIncoming !== normActive) return;

      const bid = data.b != null ? parseFloat(data.b) : null;
      const ask = data.a != null ? parseFloat(data.a) : null;
      const lastPrice = data.c != null ? parseFloat(data.c) : null;

      // Run inside Angular zone so change detection fires immediately
      this.zone.run(() => {
        if (data.st !== undefined) {
          this.isMarketOpen = String(data.st).toLowerCase() === 'true';
        }
        if (bid !== null && Number.isFinite(bid)) { this.bestBidNow = bid; }
        if (ask !== null && Number.isFinite(ask)) { this.bestAskNow = ask; }
        if (lastPrice !== null && Number.isFinite(lastPrice)) {
          this.lastPriceNow = lastPrice;
          this.lastPrice[this.activeSymbol] = lastPrice;
        }
        this.flushDisplayPrices();
        this.refreshVolumeFromBrandAmountMode();
        this.tickers[symbol] = {
          s: symbol,
          last: lastPrice || this.tickers[symbol]?.last || 0,
          prev: this.tickers[symbol]?.last || lastPrice || 0,
          chgPct: this.parsePercentage(data.d),
          bid: bid || 0,
          ask: ask || 0,
          q: this.tickers[symbol]?.q || 0
        };
      });
    } catch (e) {
      console.error('Error handling mini-ticker:', e);
    }
  }


  private parsePercentage(value: string): number {

    if (!value) return 0;

    const parsed = parseFloat(value.toString().replace('%', '').replace('+', ''));

    return isNaN(parsed) ? 0 : parsed;

  }

  // List view state for left pairs table

  activeDisplayPair: string = 'NEW';

  viewPairs: Array<{ symbol: string; base: string; quote: string; last: number; prev: number; chgPct: number; bid: number; ask: number }> = [];


  toggleFavorite(symbol: string, event?: MouseEvent) {

    if (event) event.stopPropagation();

    if (this.favorites.has(symbol)) this.favorites.delete(symbol); else this.favorites.add(symbol);

    this.favorites = new Set(this.favorites);

    this.refreshViewPairs();
  }

  refreshViewPairs() {
    const items: Array<{ symbol: string; base: string; quote: string; last: number; prev: number; chgPct: number; bid: number; ask: number }> = [];
    const pushFromTicker = (s: string) => {
      const { base, quote } = this.splitSymbol(s);
      const t = this.tickers[s];
      items.push({ symbol: s, base, quote, last: t?.last ?? 0, prev: t?.prev ?? 0, chgPct: t?.chgPct ?? 0, bid: t?.bid ?? 0, ask: t?.ask ?? 0 });
    };

    const hasTickers = Object.keys(this.tickers).length > 0;

    if (hasTickers) {

      if (this.activeDisplayPair === 'NEW') {
        for (const s of Object.keys(this.tickers)) pushFromTicker(s);
      } else if (this.activeDisplayPair === 'Liked') {
        for (const s of this.favorites) if (this.tickers[s]) pushFromTicker(s);
      } else {
        for (const s of Object.keys(this.tickers)) {
          const q = this.findQuote(s);
          if (q === this.activeDisplayPair) pushFromTicker(s);
        }
      }
    } else {

      // Fallback: use allPairs + REST 24h data when tickers map is still empty

      for (const p of this.allPairs || []) {

        const sym = p.symbol;

        const last = this.lastPrice[sym] ?? 0;

        const chg = this.change24h[sym] ?? 0;

        items.push({ symbol: sym, base: p.base, quote: p.quote, last, prev: last, chgPct: chg, bid: p.bid ? p.bid : 0, ask: p.ask ? p.ask : 0 });

      }

    }



    let filtered = items;



    const txt = (this.pairSearchTxt || '').trim().toUpperCase();

    if (txt) filtered = filtered.filter(x => (x.base + '/' + x.quote).toUpperCase().includes(txt));



    filtered.sort((a, b) => {

      if (b.chgPct !== a.chgPct) return b.chgPct - a.chgPct;

      const qa = this.tickers[a.symbol]?.q || 0;

      const qb = this.tickers[b.symbol]?.q || 0;

      return qb - qa;

    });



    this.viewPairs = filtered.slice(0, 150);

  }

  onChangeActiveTab(tab: string) {

    this.activeDisplayPair = tab as any;

    this.refreshViewPairs();

  }

  onChangeTopMoverTab(tab: string) {

    this.topMoverActive = tab;

    this.refreshTopMoversView();

  }

  private applySearchFilter() {

    // Base list: sab pairs jo exchangeInfo se aaye

    let list = this.allPairs || [];



    // Starred tab filter

    if (this.activePairTab === 'starred') {
      list = list.filter(p => this.starred.has(p.symbol));
    }

    // Search text filter

    const q = (this.searchQuery || '').trim().toUpperCase();

    if (q) {
      list = list.filter(p =>
        p.symbol.toUpperCase().includes(q) ||
        (p.base + '/' + p.quote).toUpperCase().includes(q)
      );
    }



    // Result arrays

    this.filteredPairs = list;

    this.visibleCount = Math.min(this.visibleCount || 100, this.filteredPairs.length || 0);

    if (!this.visibleCount) this.visibleCount = Math.min(100, this.filteredPairs.length || 0);

    this.visiblePairs = this.filteredPairs.slice(0, this.visibleCount);

    this.updateVisibleSet();

  }



  private addPair(p: { symbol: string; base: string; quote: string }) {

    if (!p) return;

    const sym = (p.symbol || '').toUpperCase();

    if (!sym) return;



    if (!this.selectedPairs.find(sp => sp.symbol === sym)) {
      this.selectedPairs.push({
        symbol: sym,
        base: (p.base || ''),
        quote: (p.quote || '')
      });
    }
  }

  private setActivePair(sym: string) {
    if (!sym) return;
    const p = this.selectedPairs.find(sp => sp.symbol === sym);
    if (!p) return;

    this.market = p.symbol;
    this.marketList = [p.base, p.quote];
    this.marketKey = p.symbol;
    this.base = p.base;
    this.quote = p.quote;



    // Agar combined streams / chart active symbol pe depend karte hain

    try {

      this.connectCombinedStreams();

      this.chart?.onIntervalChange(this.activeInterval);

    } catch { }

  }



  private computeMixed() {
    const combined: { side: 'ask' | 'bid'; price: number; amount: number; total: number }[] = [];

    for (const a of this.asks || []) {
      combined.push({ side: 'ask', price: a.price, amount: a.amount, total: a.total });
    }

    for (const b of this.bids || []) {
      combined.push({ side: 'bid', price: b.price, amount: b.amount, total: b.total });
    }

    const lp = this.lastPriceNow || 0;
    combined.sort((x, y) => {
      const dx = Math.abs(x.price - lp);
      const dy = Math.abs(y.price - lp);
      if (dx !== dy) return dx - dy;
      if (x.side !== y.side) return x.side === 'bid' ? -1 : 1;
      if (x.side === 'bid') return y.price - x.price;
      return x.price - y.price;
    });

    this.mixedLevels = combined;
  }



  // child chart notifies when user switches chart type

  onChildChartTypeChange(type: 'area' | 'candles' | 'bars' | 'histogram' | 'line' | 'baseline') {
    if (!type || this.activeChartType === type) return;
    this.activeChartType = type;
    this.navigateToCurrent();
  }

  // Handle market selection from watchlist

  onMarketSelected(event: { symbol: string; marketType: string; path?: string }) {

    const { symbol, marketType, path } = event;
    // marketType from watchlist is a string like 'STOCK', 'FOREX', etc.

    // Convert to MarketType enum via SLUG_TO_MARKET / MARKET_MT_TY so slug resolves correctly.

    const mtKey = (marketType || '').toLowerCase();
    // Navigate to the market

    this.router.navigate(['/trade'], {
      queryParams: {
        market: symbol,
        timeframe: this.activeInterval || '15m',
        chart: this.activeChartType || 'area',
        path: path || ''
      },
      queryParamsHandling: 'merge'
    });

  }
}
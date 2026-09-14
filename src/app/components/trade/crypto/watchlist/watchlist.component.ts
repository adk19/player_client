import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { BinanceSocketService } from '../../../../services/binance-socket.service';
import { MarketDataService } from '../../../../services/market-data.service';
import { MarketHoursService } from '../../../../services/market-hours.service';
import { WatchlistSocketService } from '../../../../services/watchlist-socket.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { MarketType } from '../../../../shared/services/market.constants';
import { SharedService } from '../../../../shared/services/shared.service';

interface Market {
  symbol: string;
  bid: number | null;
  ask: number | null;
  dailyChange: number;
  ltp: number | null;
  marketType?: string;
  exchange?: string;
  previousLtp?: number | null;
  isMarketOpen?: boolean;
  path?: string;
  // Full market data from allMarketsCache
  market_id?: number;
  market_type_id?: number;
  description?: string;
  market_type?: string;
  company_name?: string;
  logo_url?: string | null;
  decimal_places?: number;
  trading_hours?: any[];
  utcg?: string;
  base_currency_code?: string;
  quote_currency_code?: string;
  base_currency_name?: string;
  quote_currency_name?: string;
  expiry_type?: string;
  is_tradingview?: boolean;
  spread?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  [key: string]: any; // allow any extra fields from API
}

interface MarketTypeInfo {
  type_id: number;
  type: string;
}

interface MarketData {
  market_id: number;
  market: string;
  description?: string;
  exchange: string;
  market_type?: string;
  bid: number | null;
  ask: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  path?: string;
}

interface MarketGroup {
  name: string;
  fullPath: string;
  level: number;
  expanded: boolean;
  children: MarketGroup[];
  symbols: MarketData[];
  totalSymbols?: number;
  watchlistCount?: number;
}

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './watchlist.component.html',
  styleUrls: ['./watchlist.component.scss']
})
export class WatchlistComponent implements OnInit, OnDestroy {
  @Input() isInsideTradePage: boolean = false;
  watchlist: Market[] = [];
  selectedSymbol: string | null = null;
  searchText: string = '';

  isSearchFocused: boolean = false;
  private searchSubject = new Subject<string>();
  /** Debounced search for selected market-type view (market-list) */
  private marketListSearchSubject = new Subject<string>();

  @Output() marketSelected = new EventEmitter<{ symbol: string; marketType: string; path?: string }>();

  // Search state
  isSearchExpanded = false;
  searchView: 'market-types' | 'market-list' | 'search-results' = 'market-types';
  selectedMarketType: string | null = null;

  // View mode for standalone watchlist (not inside trade page)
  watchlistView: 'simple' | 'advanced' = 'simple';

  // Edit mode state
  isEditMode = false;
  selectedItems: Set<string> = new Set();

  // Mini-ticker handler references per market type
  private miniTickerHandlers: Map<MarketType, (data: any) => void> = new Map();
  private watchlistByNormSymbol: Map<string, Market> = new Map();
  private rafScheduled = false;

  pathGroups: MarketGroup[] = [];
  marketTypes: MarketTypeInfo[] = [];
  markets: { [key: string]: MarketData[] } = {};
  filteredMarkets: MarketData[] = [];
  fullMarketHierarchy: MarketGroup[] = [];
  marketHierarchy: MarketGroup[] = [];
  filteredHierarchy: MarketGroup[] = [];
  marketHierarchyRoot: MarketGroup | null = null;
  expandedGroups: Set<string> = new Set();

  // Windowed list rendering (prevents UI hang for 1000+ rows)
  @ViewChild('marketListScroller') marketListScroller?: ElementRef<HTMLElement>;
  @ViewChild('searchResultsScroller') searchResultsScroller?: ElementRef<HTMLElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  isMarketListLoading = false;
  isSearchResultsLoading = false;

  visibleMarkets: MarketData[] = [];
  visibleFilteredMarkets: MarketData[] = [];
  private flatMarketSource: MarketData[] = [];
  private flatMarketAll: MarketData[] = [];

  // Flat list progressive rendering (instead of scroll virtualization)
  private readonly FLAT_PAGE_SIZE = 80;
  private flatVisibleCount = this.FLAT_PAGE_SIZE;

  // Global search progressive rendering (removes large spacers)
  private readonly SEARCH_PAGE_SIZE = 80;
  private searchVisibleCount = this.SEARCH_PAGE_SIZE;

  // Group-level windowing state
  groupVisibleSymbols: Map<string, MarketData[]> = new Map();
  groupTopSpacers: Map<string, number> = new Map();
  groupBottomSpacers: Map<string, number> = new Map();
  private groupSymbolRenderCount: Map<string, number> = new Map();
  private readonly GROUP_SYMBOL_PAGE_SIZE = 60;

  private allMarketsCache: MarketData[] = [];
  private hierarchyBuilt = false;
  private watchlistSymbolSet = new Set<string>();
  private readonly ITEM_HEIGHT_PX = 56;
  private readonly GROUP_HEADER_HEIGHT = 44;
  private readonly BUFFER_ITEMS = 10;
  marketListTopSpacerPx = 0;
  marketListBottomSpacerPx = 0;
  searchTopSpacerPx = 0;
  searchBottomSpacerPx = 0;

  private readonly WATCHLIST_KEY = 'watchlist';
  private readonly SESSION_STORAGE_KEY = 'watchlist_markets';
  private currentPlayerId: string | null = null;
  private marketStatusInterval: any = null;
  // 1-second tick for realtime status-dot updates
  _marketTick = 0;
  private _marketTickTimer: any = null;

  constructor(
    private binanceSocketService: BinanceSocketService,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private watchlistSocketService: WatchlistSocketService,
    private sharedService: SharedService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private marketHoursSvc: MarketHoursService,
    private marketDataService: MarketDataService
  ) {
    // Subscribe to auth changes to reload watchlist when user logs in/out
    this.authService.user$.subscribe(user => {
      this.updateCurrentPlayerId();
    });
  }

  private updateWatchlistFromSocketItems(items: any[]): void {
    if (!Array.isArray(items)) {
      this.watchlist = [];
      this.rebuildWatchlistIndex();
      this.binanceSocketService.updateMiniTickerSubscriptionsBatch(new Map(), 'watchlist'); // unsubscribe all
      this.isSearchExpanded = false;
      return;
    }

    const newWatchlist: Market[] = items
      .map((x: any) => {
        const symbol = String(x?.symbol ?? x?.market ?? '');
        if (!symbol) return null;
        const bid = x?.bid !== undefined && x?.bid !== null ? Number(x.bid) : null;
        const ask = x?.ask !== undefined && x?.ask !== null ? Number(x.ask) : null;
        const ltp = x?.ltp !== undefined && x?.ltp !== null ? Number(x.ltp) : null;
        // Preserve existing prices if already in watchlist (avoid price flicker on re-fetch)
        const existing = this.watchlistByNormSymbol.get(this.normSymbol(symbol));

        // Merge full market data from allMarketsCache
        const cached = this.allMarketsBySymbol.get(symbol) || null;

        return {
          // Spread all cached market data first (trading_hours, utcg, decimal_places, etc.)
          ...(cached ? cached : {}),
          // Then override with watchlist-specific fields
          symbol,
          bid: existing?.bid ?? (Number.isFinite(bid as any) ? bid : null),
          ask: existing?.ask ?? (Number.isFinite(ask as any) ? ask : null),
          dailyChange: existing?.dailyChange ?? 0,
          ltp: existing?.ltp ?? (Number.isFinite(ltp as any) ? ltp : null),
          marketType: String(x?.market_type ?? x?.markettype ?? x?.marketType ?? cached?.market_type ?? ''),
          exchange: String(x?.exchange ?? cached?.exchange ?? ''),
          path: String(x?.path ?? cached?.path ?? ''),
          isMarketOpen: existing?.isMarketOpen ?? true,
          // Explicit fields from cache for easy access
          market_id: cached?.market_id ?? x?.id ?? null,
          market_type_id: cached?.market_type_id ?? null,
          description: cached?.description ?? null,
          logo_url: cached?.logo_url ?? null,
          decimal_places: cached?.decimal_places ?? 2,
          trading_hours: cached?.trading_hours ?? [],
          utcg: cached?.utcg ?? null,
          base_currency_code: cached?.base_currency_code ?? null,
          quote_currency_code: cached?.quote_currency_code ?? null,
          base_currency_name: cached?.base_currency_name ?? null,
          quote_currency_name: cached?.quote_currency_name ?? null,
          expiry_type: cached?.expiry_type ?? null,
          is_tradingview: cached?.is_tradingview ?? false,
          high: existing?.high ?? null,
          low: existing?.low ?? null,
          open: existing?.open ?? null,
        } as Market;
      })
      .filter((x: any) => !!x);

    // Guarantee no blanks: if bid/ask missing but LTP exists, use LTP as fallback display value.
    for (const m of newWatchlist) {
      if ((m.bid === null || m.bid === undefined) && m.ltp !== null && m.ltp !== undefined) m.bid = m.ltp;
      if ((m.ask === null || m.ask === undefined) && m.ltp !== null && m.ltp !== undefined) m.ask = m.ltp;
    }

    this.watchlist = newWatchlist;
    this.rebuildWatchlistIndex();
    // Update hierarchy counts (cheap) now that watchlist changed
    this.recomputeHierarchyCounts();
    this.updateMiniTickerSubscriptions();
    // Compute market open/closed status from trading_hours
    this.refreshMarketOpenStatus();

    if (this.watchlist.length === 0) {
      // Keep search closed — user opens it from the search field when needed
      this.isSearchExpanded = false;
    } else if (this.isSearchExpanded && this.searchView !== 'market-list' && this.searchView !== 'search-results') {
      this.isSearchExpanded = false;
    }
  }

  ngOnInit(): void {
    this.updateCurrentPlayerId();
    this.loadMarketData();
    this.setupWatchlistSocket();
    this.setupMiniTickerSubscription();

    // Refresh market open/closed status every minute (markets open/close on schedule)
    this.zone.runOutsideAngular(() => {
      this.marketStatusInterval = setInterval(() => {
        this.zone.run(() => {
          this.refreshMarketOpenStatus();
          this.cdr.markForCheck();
        });
      }, 60_000);
    });

    // 1-second tick for realtime status-dot (drives isMarketOpen re-evaluation)
    this.zone.runOutsideAngular(() => {
      this._marketTickTimer = setInterval(() => {
        this.zone.run(() => {
          this._marketTick++;
          if (this._marketTick % 60 === 0) this.refreshMarketOpenStatus();
          this.cdr.markForCheck();
        });
      }, 1000);
    });

    // Check for path in URL to auto-expand hierarchy
    this.route.queryParams.subscribe(params => {
      const path = params['path'];
      if (path) {
        this.expandPath(path);
      }
    });

    // Debounced search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.filterMarkets(query);
    });

    // Debounced market-list search (inside selected type)
    this.marketListSearchSubject.pipe(
      debounceTime(120),
      distinctUntilChanged()
    ).subscribe(query => {
      if (this.searchView !== 'market-list') return;

      const qRaw = String(query || '').trim();

      // Tree mode: filter hierarchy outside Angular (prevents UI freeze)
      if (this.filteredHierarchy.length > 0) {
        this.zone.runOutsideAngular(() => {
          const next = qRaw ? this.filterHierarchy(this.marketHierarchy, qRaw) : this.marketHierarchy;
          this.zone.run(() => {
            this.filteredHierarchy = next;
            // When searching inside a tree, auto-expand so user actually sees matches.
            if (qRaw) {
              this.expandAllGroups(next);
            }
            this.cdr.markForCheck();
          });
        });
        return;
      }

      // Flat mode: filter within type + keep virtualization
      const all = this.flatMarketAll || [];
      const q = qRaw.toLowerCase();

      this.zone.runOutsideAngular(() => {
        const next = !q
          ? all
          : all.filter(m =>
            String(m.market || '').toLowerCase().includes(q) ||
            String(m.description || '').toLowerCase().includes(q)
          );

        this.zone.run(() => {
          this.flatMarketSource = next;
          this.flatVisibleCount = this.FLAT_PAGE_SIZE;
          const el = this.marketListScroller?.nativeElement;
          if (el) el.scrollTop = 0;
          this.resetMarketListWindowing();
          this.cdr.markForCheck();
        });
      });
    });
  }

  private expandAllGroups(groups: MarketGroup[]): void {
    const walk = (g: MarketGroup) => {
      this.expandedGroups.add(g.fullPath);
      if (!this.groupSymbolRenderCount.has(g.fullPath)) {
        this.groupSymbolRenderCount.set(g.fullPath, this.GROUP_SYMBOL_PAGE_SIZE);
      }
      for (const c of (g.children || [])) walk(c);
    };
    for (const g of (groups || [])) walk(g);
  }

  private expandPath(path: string): void {
    // Only expand folders when the user is already browsing markets.
    // Never open the search panel from URL path changes (symbol select sets ?path=...).
    if (!this.isSearchExpanded || this.searchView !== 'market-list') {
      return;
    }

    const parts = this.splitPath(path);
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}\\${parts[i]}` : parts[i];
      this.expandedGroups.add(current);
    }
    this.cdr.markForCheck();
  }

  onSearchFocus(): void {
    this.isSearchFocused = true;
  }

  onSearchBlur(): void {
    this.isSearchFocused = false;
  }

  onClearSearch(event: MouseEvent, input: HTMLInputElement): void {
    this.isSearchExpanded = false;
    this.isSearchFocused = false;
    this.searchText = '';
    this.searchSubject.next('');

    event.stopPropagation();
    input.blur();
  }

  ngOnDestroy(): void {
    if (this.marketStatusInterval) { clearInterval(this.marketStatusInterval); this.marketStatusInterval = null; }
    if (this._marketTickTimer) { clearInterval(this._marketTickTimer); this._marketTickTimer = null; }
    this.cleanupMiniTickerSubscription();
    this.cleanupWatchlistSocket();
    this.searchSubject.complete();
  }

  private getCurrentPlayerId(): string | null {
    const user = this.authService.currentUser;
    if (!user) return null;
    return String(user.playerId || user.userId || user.player_id || '');
  }

  private updateCurrentPlayerId(): void {
    const newPlayerId = this.getCurrentPlayerId();
    if (newPlayerId !== this.currentPlayerId) {
      this.currentPlayerId = newPlayerId;
      if (this.currentPlayerId) {
        this.loadWatchlistFromSocket();
      } else {
        this.watchlist = [];
        this.rebuildWatchlistIndex();
        this.binanceSocketService.updateMiniTickerSubscriptionsBatch(new Map(), 'watchlist'); // unsubscribe all on logout
      }
    }
  }

  private loadWatchlistFromSocket(): void {
    const playerId = this.getCurrentPlayerId();
    if (!playerId) {
      // console.log('[Watchlist] No player ID found, showing empty watchlist');
      this.watchlist = [];
      this.rebuildWatchlistIndex();
      this.binanceSocketService.updateMiniTickerSubscriptionsBatch(new Map(), 'watchlist'); // unsubscribe all
      this.isSearchExpanded = false;
      return;
    }

    // console.log('[Watchlist] Loading watchlist from socket for player:', playerId);
    this.watchlistSocketService.getMyWatchlist();
  }

  private setupWatchlistSocket(): void {
    this.watchlistSocketService.watchlist$.subscribe((items: any[]) => {
      this.updateWatchlistFromSocketItems(items);
    });

    this.watchlistSocketService.addWatchlistResponse$.subscribe((response) => {
      if (response?.code !== 0) {
        console.error('[Watchlist] Failed to add:', response?.message);
      }
    });

    this.watchlistSocketService.removeWatchlistResponse$.subscribe((response) => {
      if (response?.code !== 0) {
        console.error('[Watchlist] Failed to remove:', response?.message);
      }
    });
  }

  private cleanupWatchlistSocket(): void {
    // Cleanup handled by service
  }

  private loadMarketData(): void {
    // If MarketDataService already has data — use it immediately
    if (this.marketDataService.isLoaded && this.marketDataService.allMarkets.length > 0) {
      this._applyFromService();
      return;
    }
    // Data not ready yet — subscribe and apply when it arrives
    const sub = this.marketDataService.state$.subscribe(state => {
      if (state.loaded && Object.keys(state.markets).length > 0) {
        sub.unsubscribe();
        this._applyFromService();
      }
    });
  }

  /** Pull data from MarketDataService into component state */
  private _applyFromService(): void {
    this.markets = this.marketDataService.markets;
    this.marketTypes = this.marketDataService.market_types;
    this.allMarketsCache = Object.values(this.markets).flat();
    this.sharedService.allMarketsCache = this.allMarketsCache;
    this.rebuildAllMarketsIndex();
    // Always rebuild hierarchy fresh
    this.hierarchyBuilt = false;
    this.generatePathGroups();
    this.refreshMarketOpenStatus();
    // If search is open on market-list view, re-trigger hierarchy for selected type
    if (this.isSearchExpanded && this.searchView === 'market-list' && this.selectedMarketType) {
      this.updateMarketHierarchy();
      setTimeout(() => {
        this.isMarketListLoading = false;
        for (const group of this.filteredHierarchy) {
          this.expandedGroups.add(group.fullPath);
          if (!this.groupSymbolRenderCount.has(group.fullPath)) {
            this.groupSymbolRenderCount.set(group.fullPath, this.GROUP_SYMBOL_PAGE_SIZE);
          }
        }
        if (this.filteredHierarchy.length === 0) this.resetMarketListWindowing();
        this.cdr.markForCheck();
      }, 50);
    }
    // Re-merge watchlist items with full market data
    if (this.watchlist.length > 0) {
      this.watchlist = this.watchlist.map(item => {
        const cached = this.allMarketsBySymbol.get(item.symbol);
        if (!cached) return item;
        return {
          ...cached, ...item,
          bid: item.bid, ask: item.ask, ltp: item.ltp, dailyChange: item.dailyChange,
          trading_hours: item.trading_hours?.length ? item.trading_hours : (cached.trading_hours ?? []),
          utcg: item.utcg ?? cached.utcg,
          decimal_places: item.decimal_places ?? cached.decimal_places ?? 2,
          logo_url: item.logo_url ?? cached.logo_url,
          description: item.description ?? cached.description,
          base_currency_code: item.base_currency_code ?? cached.base_currency_code,
          quote_currency_code: item.quote_currency_code ?? cached.quote_currency_code,
          is_tradingview: item.is_tradingview ?? cached.is_tradingview ?? false,
          market_type: item.market_type ?? cached.market_type,
          exchange: item.exchange ?? cached.exchange,
          path: item.path ?? cached.path,
        } as any;
      });
      this.rebuildWatchlistIndex();
      this.refreshMarketOpenStatus();
    }
    this.cdr.markForCheck();
  }

  private generatePathGroups(): void {
    if (!this.allMarketsCache.length) return;

    // Build hierarchy once (expensive). Counts can be recomputed cheaply.
    if (!this.hierarchyBuilt || this.fullMarketHierarchy.length === 0) {
      this.fullMarketHierarchy = this.groupByPath(this.allMarketsCache);
      this.pathGroups = [...this.fullMarketHierarchy];
      this.hierarchyBuilt = true;
    }

    this.recomputeHierarchyCounts();
  }

  private rebuildWatchlistSymbolSet(): void {
    this.watchlistSymbolSet.clear();
    for (const w of this.watchlist) {
      this.watchlistSymbolSet.add(String(w.symbol || ''));
    }
  }

  private recomputeHierarchyCounts(): void {
    // Only counts are recomputed; hierarchy structure stays stable.
    this.rebuildWatchlistSymbolSet();

    const updateCounts = (group: MarketGroup) => {
      let total = group.symbols.length;
      let watchlist = 0;

      for (const s of group.symbols) {
        if (this.watchlistSymbolSet.has(String(s.market))) watchlist++;
      }

      for (const child of group.children) {
        updateCounts(child);
        total += child.totalSymbols || 0;
        watchlist += child.watchlistCount || 0;
      }

      group.totalSymbols = total;
      group.watchlistCount = watchlist;
    };

    for (const group of this.fullMarketHierarchy) updateCounts(group);
  }

  onSearchClick(): void {
    if (!this.isSearchExpanded) {
      this.isSearchExpanded = true;
      this.searchView = this.searchText.trim() ? 'search-results' : 'market-types';
      this.selectedMarketType = null;
      this.filteredMarkets = [];

      if (this.allMarketsCache.length > 0) {
        if (this.fullMarketHierarchy.length === 0) this.generatePathGroups();
        if (this.searchText.trim()) {
          this.onSearchTextChange();
        }
      } else {
        // Market data not yet loaded — load it; UI updates reactively
        this.loadMarketData();
      }
    }
  }

  /** Focus the toolbar search only when the user opened browse/search intentionally. */
  private focusSearchInput(): void {
    if (!this.isSearchExpanded) return;
    queueMicrotask(() => {
      const el = this.searchInput?.nativeElement;
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
    });
  }

  onSearchTextChange(): void {
    const query = this.searchText.trim();

    // If we are already in the hierarchy view, just filter it
    if (this.searchView === 'market-list') {
      // IMPORTANT: Market-list can be huge (e.g. CRYPTO 3500+). Debounce always.
      this.marketListSearchSubject.next(query);
      return;
    }

    // Otherwise, it's a global search
    if (query) {
      this.searchView = 'search-results';
      this.searchSubject.next(query);
    } else {
      // If query is cleared, and we are not in market-list, go back to types
      if (this.searchView === 'search-results') {
        this.searchView = 'market-types';
      }
      this.filteredMarkets = [];
      this.visibleFilteredMarkets = [];
      this.searchTopSpacerPx = 0;
      this.searchBottomSpacerPx = 0;
      this.searchSubject.next('');
    }
  }

  private filterMarkets(query: string): void {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.filteredMarkets = [];
      this.visibleFilteredMarkets = [];
      this.searchTopSpacerPx = 0;
      this.searchBottomSpacerPx = 0;
      return;
    }

    this.isSearchResultsLoading = true;

    // Use a small delay to let the UI show the loading state
    setTimeout(() => {
      if (!this.allMarketsCache.length) {
        this.allMarketsCache = Object.values(this.markets).flat();
      }

      this.filteredMarkets = this.allMarketsCache.filter(market =>
        market.market.toLowerCase().includes(q) ||
        (market.exchange && market.exchange.toLowerCase().includes(q))
      );
      this.isSearchResultsLoading = false;
      this.searchVisibleCount = this.SEARCH_PAGE_SIZE;
      this.visibleFilteredMarkets = this.filteredMarkets.slice(0, this.searchVisibleCount);
      this.searchTopSpacerPx = 0;
      this.searchBottomSpacerPx = 0;
      const el = this.searchResultsScroller?.nativeElement;
      if (el) el.scrollTop = 0;
      this.cdr.markForCheck();
    }, 0);
  }

  selectMarketType(type: string): void {
    this.selectedMarketType = type;
    this.searchView = 'market-list';
    this.isSearchExpanded = true;
    this.searchText = '';
    this.expandedGroups.clear();
    this.flatMarketSource = [];
    this.flatMarketAll = [];
    this.flatVisibleCount = this.FLAT_PAGE_SIZE;

    this.isMarketListLoading = true;
    this.focusSearchInput();

    // Reset flat list windowing state
    this.visibleMarkets = [];
    this.marketListTopSpacerPx = 0;
    this.marketListBottomSpacerPx = 0;

    this.updateMarketHierarchy();

    // Let skeleton render
    setTimeout(() => {
      this.isMarketListLoading = false;

      // Auto-expand first-level groups so user sees content immediately
      for (const group of this.filteredHierarchy) {
        this.expandedGroups.add(group.fullPath);
        if (!this.groupSymbolRenderCount.has(group.fullPath)) {
          this.groupSymbolRenderCount.set(group.fullPath, this.GROUP_SYMBOL_PAGE_SIZE);
        }
      }

      // If hierarchy failed or is empty, initialize the flat list windowing
      if (this.filteredHierarchy.length === 0) {
        this.resetMarketListWindowing();
      }

      this.cdr.markForCheck();
    }, 300);
  }

  private updateMarketHierarchy(): void {
    if (!this.selectedMarketType) return;

    // In our hierarchy, top-level groups often come from `path` like "Stocks\\India\\NSE\\..." while
    // market-type labels may be "STOCK", "INDEX", etc. So we match by a normalized key.
    const keyOf = (v: string) =>
      String(v || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/s$/, ''); // Stocks -> stock

    const wantedKey = keyOf(this.selectedMarketType);
    const rootGroup = this.fullMarketHierarchy.find(g => keyOf(g.name) === wantedKey);

    if (rootGroup) {
      const isHugeFlatList = (rootGroup.children?.length || 0) === 0 && (rootGroup.symbols?.length || 0) >= 500;

      if (isHugeFlatList) {
        // Prevent UI freeze: do not render 1000s of symbols under one expanded tree node.
        // Use flat virtualized list instead (CRYPTO has 3500+ pairs).
        this.marketHierarchy = [];
        this.filteredHierarchy = [];
        this.marketHierarchyRoot = null;
        this.flatMarketAll = this.flattenSymbols(rootGroup);
        this.flatMarketSource = this.flatMarketAll;
        this.visibleMarkets = [];
        this.flatVisibleCount = this.FLAT_PAGE_SIZE;
        this.resetMarketListWindowing();
      } else {
        // Normal tree mode
        this.marketHierarchyRoot = rootGroup;
        this.marketHierarchy = [rootGroup];
        this.filteredHierarchy = [rootGroup];
        this.visibleMarkets = [];
      }
    } else {
      // Fallback if no hierarchical data found for this type:
      // Just show symbols matching this type from the markets dictionary
      this.marketHierarchy = [];
      this.marketHierarchyRoot = null;
      // No hierarchy found: fallback to flat list from markets dict (if present)
      this.flatMarketAll = this.markets[this.selectedMarketType!] || [];
      this.flatMarketSource = this.flatMarketAll;
      this.visibleMarkets = this.markets[this.selectedMarketType!] || [];
      this.filteredHierarchy = [];
      this.flatVisibleCount = this.FLAT_PAGE_SIZE;
      this.resetMarketListWindowing();
    }
    this.cdr.markForCheck();
  }

  private flattenSymbols(group: MarketGroup): MarketData[] {
    const out: MarketData[] = [];
    const walk = (g: MarketGroup) => {
      if (Array.isArray(g.symbols) && g.symbols.length) out.push(...g.symbols);
      if (Array.isArray(g.children) && g.children.length) {
        for (const c of g.children) walk(c);
      }
    };
    walk(group);
    // Stable ordering
    out.sort((a, b) => String(a.market).localeCompare(String(b.market)));
    return out;
  }

  goBack(): void {
    if (this.searchView === 'market-list') {
      this.searchView = 'market-types';
      this.selectedMarketType = null;
      this.searchText = '';
      this.marketHierarchy = [];
      this.filteredHierarchy = [];
      this.flatMarketSource = [];
      this.focusSearchInput();
      this.flatMarketAll = [];
    } else if (this.searchView === 'search-results') {
      this.searchView = 'market-types';
      this.searchText = '';
      this.filteredMarkets = [];
      this.isSearchResultsLoading = false;
      this.visibleFilteredMarkets = [];
      this.searchTopSpacerPx = 0;
      this.searchBottomSpacerPx = 0;
    }
  }

  closeSearch(): void {
    this.isSearchExpanded = false;
    this.searchView = 'market-types';
    this.searchText = '';
    this.selectedMarketType = null;
    this.filteredMarkets = [];
    this.marketHierarchy = [];
    this.filteredHierarchy = [];
    this.flatMarketSource = [];
    this.flatMarketAll = [];

    this.isMarketListLoading = false;
    this.isSearchResultsLoading = false;
    this.visibleMarkets = [];
    this.visibleFilteredMarkets = [];
    this.marketListTopSpacerPx = 0;
    this.marketListBottomSpacerPx = 0;
    this.searchTopSpacerPx = 0;
    this.searchBottomSpacerPx = 0;
    this.flatVisibleCount = this.FLAT_PAGE_SIZE;
    this.searchVisibleCount = this.SEARCH_PAGE_SIZE;

    // Drop focus so symbol selection / URL updates cannot re-open search via focus handlers
    queueMicrotask(() => this.searchInput?.nativeElement?.blur());
  }

  // ===== Windowing helpers =====
  onMarketListScroll(event: Event): void {
    // No-op: in flat mode we use "Load more" instead of scroll-based virtualization.
  }

  private resetMarketListWindowing(): void {
    if (!this.selectedMarketType) return;
    // If hierarchy is active, we don't use the flat windowed list
    if (this.filteredHierarchy.length > 0) return;
    const all = this.flatMarketSource.length
      ? this.flatMarketSource
      : (this.flatMarketAll.length ? this.flatMarketAll : (this.markets[this.selectedMarketType] || []));
    const total = all.length;
    if (total === 0) {
      this.visibleMarkets = [];
      return;
    }
    const count = Math.min(total, Math.max(0, this.flatVisibleCount));
    this.visibleMarkets = all.slice(0, count);
    this.marketListTopSpacerPx = 0;
    this.marketListBottomSpacerPx = 0;
  }

  private updateMarketListWindow(scrollTop: number, viewportHeight: number): void {
    if (!this.selectedMarketType) return;
    // If hierarchy is active, we don't use the flat windowed list
    if (this.filteredHierarchy.length > 0) return;
    // Backward compat: re-use progressive rendering
    this.resetMarketListWindowing();
  }

  canLoadMoreFlatMarkets(): boolean {
    if (!this.selectedMarketType) return false;
    if (this.filteredHierarchy.length > 0) return false;
    const all = this.flatMarketSource.length
      ? this.flatMarketSource
      : (this.flatMarketAll.length ? this.flatMarketAll : (this.markets[this.selectedMarketType] || []));
    return this.visibleMarkets.length < all.length;
  }

  loadMoreFlatMarkets(): void {
    if (!this.selectedMarketType) return;
    if (this.filteredHierarchy.length > 0) return;
    const all = this.flatMarketSource.length
      ? this.flatMarketSource
      : (this.flatMarketAll.length ? this.flatMarketAll : (this.markets[this.selectedMarketType] || []));
    const total = all.length;
    if (total === 0) return;

    this.flatVisibleCount = Math.min(total, this.flatVisibleCount + this.FLAT_PAGE_SIZE);
    this.visibleMarkets = all.slice(0, this.flatVisibleCount);
    this.cdr.markForCheck();
  }

  onSearchResultsScroll(event: Event): void {
    // No-op: search results use "Load more" instead of virtualization.
  }

  private resetSearchWindowing(): void {
    // Backward compat: progressive slice
    this.searchVisibleCount = this.SEARCH_PAGE_SIZE;
    this.visibleFilteredMarkets = (this.filteredMarkets || []).slice(0, this.searchVisibleCount);
    this.searchTopSpacerPx = 0;
    this.searchBottomSpacerPx = 0;
  }

  private updateSearchWindow(scrollTop: number, viewportHeight: number): void {
    // Backward compat: progressive slice
    this.visibleFilteredMarkets = (this.filteredMarkets || []).slice(0, this.searchVisibleCount);
    this.searchTopSpacerPx = 0;
    this.searchBottomSpacerPx = 0;
  }

  canLoadMoreSearchResults(): boolean {
    const all = this.filteredMarkets || [];
    return this.visibleFilteredMarkets.length < all.length;
  }

  loadMoreSearchResults(): void {
    const all = this.filteredMarkets || [];
    const total = all.length;
    if (total === 0) return;
    this.searchVisibleCount = Math.min(total, this.searchVisibleCount + this.SEARCH_PAGE_SIZE);
    this.visibleFilteredMarkets = all.slice(0, this.searchVisibleCount);
    this.cdr.markForCheck();
  }

  getMarketCount(type: string): number {
    return this.markets[type]?.length || 0;
  }

  getWatchlistCount(type: string): number {
    const typeMarkets = this.markets[type] || [];
    return typeMarkets.filter(m => this.watchlist.some(w => w.symbol === m.market)).length;
  }

  isMarketInWatchlist(market: string): boolean {
    return this.watchlist.some(w => w.symbol === market);
  }

  isMarketOpen(symbol: string): boolean {
    // Use pre-built map for O(1) lookup
    const cached = this.marketStatusCache.get(symbol);
    if (cached !== undefined) return cached;
    // Not in cache — compute on-demand (for search results / non-watchlist items)
    return this.computeMarketOpen(symbol, new Date());
  }

  /** Pre-computed open/closed status map — symbol → boolean */
  private marketStatusCache = new Map<string, boolean>();

  /** Recompute isMarketOpen for all watchlist items.
   * Priority: socket st field > trading_hours calculation > default true
   */
  private refreshMarketOpenStatus(): void {
    const now = new Date();
    for (const m of this.watchlist) {
      // Only compute from trading_hours if socket hasn't given us a value yet
      // Socket st field is the most accurate real-time source
      if (m.isMarketOpen === undefined || m.isMarketOpen === null) {
        const open = this.computeMarketOpen(m.symbol, now);
        this.marketStatusCache.set(m.symbol, open);
        m.isMarketOpen = open;
      }
      // If socket already set isMarketOpen, just update the cache — don't override
      this.marketStatusCache.set(m.symbol, m.isMarketOpen ?? true);
    }
    this.cdr.markForCheck();
  }

  private computeMarketOpen(symbol: string, now: Date): boolean {
    // O(1) lookup via pre-built symbol→market map
    const mkt = this.allMarketsBySymbol.get(symbol);
    const th = (mkt as any)?.trading_hours;
    const utcg = (mkt as any)?.utcg;
    if (th?.length && utcg) {
      return this.marketHoursSvc.isOpen({ utcg, trading_hours: th }, now);
    }
    // No trading_hours → CRYPTO or unknown → treat as always open
    return true;
  }

  /** O(1) symbol → market lookup map, rebuilt when allMarketsCache changes */
  private allMarketsBySymbol = new Map<string, any>();

  private rebuildAllMarketsIndex(): void {
    this.allMarketsBySymbol.clear();
    for (const m of this.allMarketsCache) {
      this.allMarketsBySymbol.set(m.market, m);
    }
  }

  toggleMarketInWatchlist(market: MarketData, marketType?: string): void {
    const index = this.watchlist.findIndex(w => w.symbol === market.market);
    if (index > -1) {
      // Remove from watchlist (optimistic)
      this.watchlist.splice(index, 1);
      this.rebuildWatchlistIndex();
      this.recomputeHierarchyCounts();
      this.updateMiniTickerSubscriptions(); // unsubscribe removed symbol immediately
      this.watchlistSocketService.removeWatchlist(market.market_id);
      this.binanceSocketService.forceResubscribeAllNow();
    } else {
      // Add to watchlist (optimistic)
      const resolvedMarketType = marketType || market.exchange || 'CRYPTO';
      // Compute initial open status immediately from trading_hours
      const initialOpen = this.computeMarketOpen(market.market, new Date());
      const newMarket: Market = {
        symbol: market.market,
        bid: market.bid,
        ask: market.ask,
        dailyChange: 0,
        ltp: market.ltp,
        marketType: resolvedMarketType,
        exchange: market.exchange,
        path: market.path,
        isMarketOpen: initialOpen
      };
      this.watchlist.push(newMarket);
      this.rebuildWatchlistIndex();
      this.recomputeHierarchyCounts();
      this.updateMiniTickerSubscriptions(); // subscribe new symbol immediately
      this.refreshMarketOpenStatus();
      this.watchlistSocketService.addWatchlist(market.market_id);
      this.binanceSocketService.forceResubscribeAllNow();
    }
    this.cdr.markForCheck();
  }

  selectSymbol(symbol: string): void {
    // Close browse/search when a symbol is chosen from the watchlist
    if (this.isSearchExpanded) {
      this.closeSearch();
    }

    // 1. Try to find in active watchlist
    let market = this.watchlist.find(w => w.symbol === symbol);
    let marketType = market?.marketType || 'CRYPTO';
    let path = market?.path || '';

    // 2. If not in watchlist, look in all markets cache (browsing mode)
    if (!market) {
      const cached = this.allMarketsCache.find(m => m.market === symbol);
      if (cached) {
        marketType = cached.exchange || 'CRYPTO';
        path = cached.path || '';
      }
    }

    this.selectedSymbol = symbol;

    if (!this.isInsideTradePage) {
      // Full page mode - redirect to trade page
      this.router.navigate(['/trade'], { queryParams: { market: symbol, path: path } });
    } else {
      // Inside trade page - emit event to change market
      this.marketSelected.emit({
        symbol: symbol,
        marketType: marketType,
        path: path
      });
    }
  }

  updatePrice(symbol: string, bid: number | null, ask: number | null, ltp: number | null): void {
    const market = this.watchlistByNormSymbol.get(this.normSymbol(symbol));
    if (market) {
      market.bid = bid;
      market.ask = ask;
      market.ltp = ltp;
    }
  }

  updateDailyChange(symbol: string, change: number): void {
    const market = this.watchlistByNormSymbol.get(this.normSymbol(symbol));
    if (market) {
      market.dailyChange = change;
    }
  }

  private normSymbol(symbol: string): string {
    return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private rebuildWatchlistIndex(): void {
    this.watchlistByNormSymbol.clear();
    for (const m of this.watchlist) {
      this.watchlistByNormSymbol.set(this.normSymbol(m.symbol), m);
    }
  }

  private scheduleUiTick(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this.rafScheduled = false;
        this.zone.run(() => this.cdr.markForCheck());
      });
    });
  }

  getFlashDir(market: any): string {
    return (market as any).flashDir || '';
  }

  removeFromWatchlistBySymbol(symbol: string): void {
    const allMarkets = Object.values(this.markets).flat();
    const marketData = allMarkets.find((m: any) => m.market === symbol);
    if (marketData) {
      const idx = this.watchlist.findIndex(w => w.symbol === symbol);
      if (idx > -1) {
        this.watchlist.splice(idx, 1);
        this.rebuildWatchlistIndex();
        this.recomputeHierarchyCounts();
        this.updateMiniTickerSubscriptions();
        this.watchlistSocketService.removeWatchlist((marketData as any).market_id);
        this.cdr.markForCheck();
      }
    }
  }

  isPriceUp(market: Market): boolean {
    // Always show arrow based on daily change
    return market.dailyChange >= 0;
  }

  isPriceDown(market: Market): boolean {
    // Always show arrow based on daily change
    return market.dailyChange < 0;
  }

  isPriceChanged(market: Market): boolean {
    // Check if price has changed recently (compare ltp with previousLtp)
    if (!market.ltp || !market.previousLtp) return false;
    return market.ltp !== market.previousLtp;
  }

  formatPrice(value: number | null | undefined): string {

    if (value === null || value === undefined) return '-';
    if (typeof value !== 'number' || isNaN(value)) return '-';
    return value.toFixed(2);
  }

  /** MT5-style price: returns { main: '1.1875', last: '7' } */
  splitPrice(value: number | null | undefined, dp?: number): { main: string; last: string; lastTwo: string } {
    if (value === null || value === undefined || !Number.isFinite(value as number)) {
      return { main: '-', last: '', lastTwo: '' };
    }
    const decimals = dp ?? this.getPriceDecimals(value as number);
    const str = (value as number).toFixed(decimals);
    if (str.length < 2) return { main: str, last: '', lastTwo: '' };
    return { main: str.slice(0, -3), lastTwo: str.slice(-3, -1), last: str.slice(-1) };
  }

  private getPriceDecimals(v: number): number {
    if (v >= 10000) return 3;
    if (v >= 100) return 3;
    if (v >= 1) return 4;
    if (v >= 0.1) return 5;
    return 5;
  }

  /** Spread = (ask - bid) * 10^decimals, rounded */
  getSpread(market: any): string {
    if (!market.bid || !market.ask) return '—';
    const dp = this.getPriceDecimals(market.bid);
    const spread = Math.round(Math.abs(market.ask - market.bid) * Math.pow(10, dp));
    return String(spread);
  }

  formatPercentage(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  getMarketExchangeName(exchange: string): string {
    const exchangeNames: { [key: string]: string } = {
      'MT': 'Multi Terminal',
      'BINANCE': 'Binance',
      'FOREX': 'Forex'
    };
    return exchangeNames[exchange] || exchange;
  }

  private splitPath(rawPath: string): string[] {
    // IMPORTANT:
    // Many symbols contain "/" (e.g. "BANKNIFTY/03"), so we must NOT split on "/"
    // unless "/" is actually used as a path separator by the backend.
    const s = String(rawPath || '').trim();
    if (!s) return [];

    const parts = s.includes('\\')
      ? s.split(/\\+/g)          // Windows-style paths (common in our payloads)
      : s.split(/\/+/g);         // Fallback if backend uses "/" for folders

    return parts.map(p => p.trim()).filter(Boolean);
  }

  private normalizePath(rawPath: string): string {
    // Stable key format for grouping + expandedGroups keys
    return this.splitPath(rawPath).join('\\');
  }

  // ===== Path-based grouping =====
  private groupByPath(data: MarketData[]): MarketGroup[] {
    const hierarchy: MarketGroup[] = [];
    const pathMap = new Map<string, MarketGroup>();

    data.forEach(item => {
      // If path is missing / malformed, show symbol directly under its type/exchange.
      // Example: exchange=STOCK + market=ABB/02 => "STOCK\\ABB/02" so it appears under STOCK.
      const pathPartsFromItem = this.splitPath(item.path || '');
      const hasUsablePath = pathPartsFromItem.length >= 2;

      const rawPath = hasUsablePath
        ? this.normalizePath(item.path || '')
        : this.normalizePath(`${item.exchange ? item.exchange : 'Others'}\\${item.market}`);

      const pathParts = this.splitPath(rawPath);

      // Build path progressively up to the last folder (not the symbol name)
      // If there's only one part, it's the root folder
      const depth = pathParts.length > 1 ? pathParts.length - 1 : 1;

      for (let i = 0; i < depth; i++) {
        const partName = pathParts[i];
        const currentPath = pathParts.slice(0, i + 1).join('\\');

        if (!pathMap.has(currentPath)) {
          pathMap.set(currentPath, {
            name: partName,
            fullPath: currentPath,
            level: i,
            expanded: false,
            children: [],
            symbols: []
          });
        }
      }

      // Add symbol to its parent (the last folder)
      const parentPath = pathParts.length > 1
        ? pathParts.slice(0, -1).join('\\')
        : pathParts[0]; // If only one part, use it as root folder

      const parent = pathMap.get(parentPath);
      if (parent) {
        parent.symbols.push(item);
      }
    });

    // Build hierarchy from map
    const pathGroups = Array.from(pathMap.values());

    // Organize into tree structure
    pathGroups.forEach(group => {
      const parts = group.fullPath.split('\\');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('\\');
        if (pathMap.has(parentPath)) {
          const parent = pathMap.get(parentPath)!;
          // Avoid duplicate children
          if (!parent.children.find(c => c.fullPath === group.fullPath)) {
            parent.children.push(group);
          }
        }
      }
    });

    // Get top-level groups
    pathGroups.forEach(group => {
      if (!group.fullPath.includes('\\')) {
        hierarchy.push(group);
      }
    });

    // Stable ordering for predictable UI
    const sortTree = (groups: MarketGroup[]) => {
      groups.sort((a, b) => a.name.localeCompare(b.name));
      for (const g of groups) {
        if (Array.isArray(g.symbols)) {
          g.symbols.sort((x, y) => String(x.market).localeCompare(String(y.market)));
        }
        if (Array.isArray(g.children) && g.children.length) {
          sortTree(g.children);
        }
      }
    };
    sortTree(hierarchy);

    return hierarchy;
  }

  private filterHierarchy(groups: MarketGroup[], searchTerm: string): MarketGroup[] {
    if (!searchTerm) return groups;

    searchTerm = searchTerm.toLowerCase();

    const filtered: MarketGroup[] = [];

    groups.forEach(group => {
      const filteredGroup: MarketGroup = {
        ...group,
        children: [],
        symbols: []
      };

      if (group.symbols && group.symbols.length > 0) {
        filteredGroup.symbols = group.symbols.filter(symbol =>
          symbol.market.toLowerCase().includes(searchTerm)
        );
      }

      if (group.children && group.children.length > 0) {
        filteredGroup.children = this.filterHierarchy(group.children, searchTerm);
      }

      if (filteredGroup.symbols.length > 0 || filteredGroup.children.length > 0) {
        filtered.push(filteredGroup);
      }
    });

    return filtered;
  }

  toggleGroup(groupPath: string): void {
    if (this.expandedGroups.has(groupPath)) {
      this.expandedGroups.delete(groupPath);
      // Clear windowing state for collapsed group
      this.groupVisibleSymbols.delete(groupPath);
      this.groupTopSpacers.delete(groupPath);
      this.groupBottomSpacers.delete(groupPath);
      this.groupSymbolRenderCount.delete(groupPath);
    } else {
      this.expandedGroups.add(groupPath);
      if (!this.groupSymbolRenderCount.has(groupPath)) {
        this.groupSymbolRenderCount.set(groupPath, this.GROUP_SYMBOL_PAGE_SIZE);
      }
    }
    this.cdr.markForCheck();
  }

  getGroupVisibleSymbols(group: MarketGroup): MarketData[] {
    const count = this.groupSymbolRenderCount.get(group.fullPath) ?? this.GROUP_SYMBOL_PAGE_SIZE;
    return (group.symbols || []).slice(0, count);
  }

  canLoadMoreInGroup(group: MarketGroup): boolean {
    const count = this.groupSymbolRenderCount.get(group.fullPath) ?? this.GROUP_SYMBOL_PAGE_SIZE;
    return (group.symbols || []).length > count;
  }

  loadMoreInGroup(group: MarketGroup): void {
    const current = this.groupSymbolRenderCount.get(group.fullPath) ?? this.GROUP_SYMBOL_PAGE_SIZE;
    this.groupSymbolRenderCount.set(group.fullPath, current + this.GROUP_SYMBOL_PAGE_SIZE);
    this.cdr.markForCheck();
  }

  isGroupExpanded(groupPath: string): boolean {
    return this.expandedGroups.has(groupPath);
  }

  // Edit mode methods
  toggleEditMode(): void {
    this.isEditMode = !this.isEditMode;
    if (!this.isEditMode) {
      this.selectedItems.clear();
    }
  }

  toggleWatchlistView(): void {
    this.watchlistView = this.watchlistView === 'simple' ? 'advanced' : 'simple';
  }

  toggleSelection(symbol: string): void {
    if (this.selectedItems.has(symbol)) {
      this.selectedItems.delete(symbol);
    } else {
      this.selectedItems.add(symbol);
    }
  }

  isSelected(symbol: string): boolean {
    return this.selectedItems.has(symbol);
  }

  deleteSelected(): void {
    const symbolsToDelete = Array.from(this.selectedItems);
    for (const symbol of symbolsToDelete) {
      const market = this.watchlist.find(m => m.symbol === symbol);
      if (market) {
        // Find market ID from markets data
        const allMarkets = Object.values(this.markets).flat();
        const marketData = allMarkets.find(m => m.market === symbol);
        if (marketData) {
          this.watchlistSocketService.removeWatchlist(marketData.market_id);
        }
        // Optimistic local remove
        const idx = this.watchlist.findIndex(m => m.symbol === symbol);
        if (idx > -1) this.watchlist.splice(idx, 1);
      }
    }
    this.rebuildWatchlistIndex();
    this.recomputeHierarchyCounts();
    this.updateMiniTickerSubscriptions(); // unsubscribe removed symbols
    this.selectedItems.clear();
    this.isEditMode = false;
    this.cdr.markForCheck();
  }

  cancelEditMode(): void {
    this.selectedItems.clear();
    this.isEditMode = false;
  }

  // ===== Mini-ticker subscription =====
  private setupMiniTickerSubscription(): void {
    const allTypes = [
      MarketType.CRYPTO,
      MarketType.FOREX, MarketType.COMMODITY,
      MarketType.STOCK, MarketType.INDEX, MarketType.METAL, MarketType.ETFS, MarketType.FORWARDS, MarketType.MCX
    ];

    for (const mt of allTypes) {
      if (!this.miniTickerHandlers.has(mt)) {
        const handler = (data: any) => this.handleMiniTickerUpdate(data);
        this.miniTickerHandlers.set(mt, handler);
        // Register for both miniTicker and singleTicker events
        // HUB socket routes both to miniTicker handlers, but register both to be safe
        this.binanceSocketService.onMiniTicker(handler, mt);
        this.binanceSocketService.onSingleTicker(handler, mt);
      }
    }
  }

  private cleanupMiniTickerSubscription(): void {
    for (const [mt, handler] of this.miniTickerHandlers) {
      this.binanceSocketService.offMiniTicker(handler, mt);
      this.binanceSocketService.offSingleTicker(handler, mt);
    }
    this.miniTickerHandlers.clear();
    // Clear all watchlist subscriptions in one batched call
    this.binanceSocketService.updateMiniTickerSubscriptionsBatch(new Map(), 'watchlist');
  }

  private updateMiniTickerSubscriptions(): void {
    // Group watchlist symbols by their market type
    // Use allMarketsCache for accurate market type — server's market_type field can be unreliable
    const byType = new Map<MarketType, string[]>();

    for (const item of this.watchlist) {
      const mt = this.resolveMarketType(item);
      if (!byType.has(mt)) byType.set(mt, []);
      byType.get(mt)!.push(item.symbol);
    }

    // Single batched call — avoids 9 separate syncSocketSubscriptions calls
    // which could cause intermediate inconsistent states
    this.binanceSocketService.updateMiniTickerSubscriptionsBatch(byType, 'watchlist');
  }

  /**
   * Resolve market type for a watchlist item.
   * Priority: item.marketType (from server) > allMarketsCache lookup > symbol pattern > default FOREX (HUB)
   */
  private resolveMarketType(item: Market): MarketType {
    if (item.market_type_id === 1
      || Number(item.market_type_id) === 1
      || (item.exchange || '').toUpperCase() === 'BINANCE'
      || (item.path || '').toUpperCase().startsWith('CRYPTO')) {
      return MarketType.CRYPTO;
    }

    // 1. Trust server's market_type if it's a known non-empty value
    const serverType = item.marketType || item.market_type;
    if (serverType) {
      const upper = String(serverType).toUpperCase().trim();
      if (upper) {
        const mt = this.getMarketTypeFromString(upper);
        if (mt !== MarketType.CRYPTO || upper === 'CRYPTO' || upper === '1') {
          return mt;
        }
      }
    }

    // 2. allMarketsCache lookup — try both market_type and exchange fields
    const cacheList = this.allMarketsCache.length ? this.allMarketsCache : (this.sharedService.allMarketsCache || []);
    if (cacheList.length) {
      const normSym = this.normSymbol(item.symbol);
      const cached = cacheList.find(m => this.normSymbol(m.market) === normSym);
      if (cached) {
        if (cached.market_type_id === 1 || Number(cached.market_type_id) === 1 || (cached.exchange || '').toUpperCase() === 'BINANCE' || (cached.path || '').toUpperCase().startsWith('CRYPTO')) {
          item.marketType = 'CRYPTO';
          return MarketType.CRYPTO;
        }
        const typeStr = cached.market_type || cached.exchange || '';
        if (typeStr) {
          const mt = this.getMarketTypeFromString(typeStr);
          item.marketType = typeStr;
          return mt;
        }
      }
    }

    // 3. Symbol pattern fallback
    const sym = item.symbol.toUpperCase();
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(sym)) {
      return MarketType.CRYPTO;
    }
    if (/^[A-Z]{6}$/.test(sym)) return MarketType.FOREX;
    if (sym.startsWith('XAU') || sym.startsWith('XAG')) return MarketType.METAL;
    // Symbols with dots (AAXJ.US, BIRG.IE) or slashes (RELIANCE/04) → STOCK/ETFS → HUB
    if (sym.includes('.') || sym.includes('/')) return MarketType.STOCK;

    // 4. Default → COMMODITY (HUB socket) — never default to CRYPTO for unknown symbols
    return MarketType.COMMODITY;
  }

  private getMarketTypeFromString(marketTypeStr: string): MarketType {
    if (!marketTypeStr) return MarketType.COMMODITY; // default HUB, not CRYPTO
    // Handle numeric market type IDs
    const num = Number(marketTypeStr);
    if (Number.isFinite(num) && num >= 1 && num <= 9) return num as MarketType;
    const upperType = String(marketTypeStr).toUpperCase().trim();
    switch (upperType) {
      case 'CRYPTO': return MarketType.CRYPTO;
      case 'FOREX': return MarketType.FOREX;
      case 'COMMODITY': return MarketType.COMMODITY;
      case 'STOCK': return MarketType.STOCK;
      case 'INDEX': return MarketType.INDEX;
      case 'METAL': return MarketType.METAL;
      case 'ETFS': return MarketType.ETFS;
      case 'FORWARDS': return MarketType.FORWARDS;
      case 'MCX': return MarketType.MCX;
      // exchange aliases
      case 'BINANCE': return MarketType.CRYPTO;
      case 'MT': case 'MT5': return MarketType.COMMODITY; // MT5 broker → HUB
      default: return MarketType.COMMODITY; // unknown → HUB (safer than CRYPTO)
    }
  }

  private handleMiniTickerUpdate(data: any): void {
    // Try multiple symbol field names from different server formats
    const rawSym = data?.s || data?.symbol || data?.S || '';
    if (!rawSym) return;

    const normSocketSym = this.normSymbol(rawSym);
    let market = this.watchlistByNormSymbol.get(normSocketSym);

    // Fallback: try exact symbol match (for symbols with dots/slashes that normSymbol strips)
    if (!market && rawSym) {
      market = this.watchlist.find(m =>
        m.symbol.toUpperCase() === rawSym.toUpperCase() ||
        this.normSymbol(m.symbol) === normSocketSym
      ) || undefined;
    }

    if (!market) return;

    const bid = data.b != null ? parseFloat(data.b) : (data.bid != null ? parseFloat(data.bid) : null);
    const ask = data.a != null ? parseFloat(data.a) : (data.ask != null ? parseFloat(data.ask) : null);
    const ltp = data.c != null ? parseFloat(data.c) : (data.ltp != null ? parseFloat(data.ltp) : (data.lp != null ? parseFloat(data.lp) : null));

    // Track if this is the first price update for this symbol (bid/ask/ltp were all null)
    const wasEmpty = market.bid === null && market.ask === null && market.ltp === null;
    let changed = wasEmpty; // always trigger UI on first price arrival

    if (market.ltp !== null) market.previousLtp = market.ltp;
    if (bid !== null && Number.isFinite(bid) && market.bid !== bid) { market.bid = bid; changed = true; }
    if (ask !== null && Number.isFinite(ask) && market.ask !== ask) { market.ask = ask; changed = true; }
    if (ltp !== null && Number.isFinite(ltp) && market.ltp !== ltp) { market.ltp = ltp; changed = true; }

    // Never show blanks: if feed doesn't provide bid/ask for some symbols,
    // fall back to last price so UI always has a value.
    if ((market.bid === null || market.bid === undefined) && market.ltp !== null && market.ltp !== undefined) {
      market.bid = market.ltp;
      changed = true;
    }
    if ((market.ask === null || market.ask === undefined) && market.ltp !== null && market.ltp !== undefined) {
      market.ask = market.ltp;
      changed = true;
    }

    // Set values even on first arrival (wasEmpty case)
    if (wasEmpty) {
      if (bid !== null && Number.isFinite(bid)) market.bid = bid;
      if (ask !== null && Number.isFinite(ask)) market.ask = ask;
      if (ltp !== null && Number.isFinite(ltp)) market.ltp = ltp;
    }

    if (data.P !== undefined) {
      const pct = parseFloat(data.P);
      if (market.dailyChange !== pct) { market.dailyChange = pct; changed = true; }
    } else if (data.cp !== undefined) {
      const pct = parseFloat(data.cp);
      if (market.dailyChange !== pct) { market.dailyChange = pct; changed = true; }
    }

    // Update high/low/open from socket data
    if (data.h != null) { const h = parseFloat(data.h); if (Number.isFinite(h)) { market.high = h; changed = true; } }
    if (data.l != null) { const l = parseFloat(data.l); if (Number.isFinite(l)) { market.low = l; changed = true; } }
    if (data.o != null) { const o = parseFloat(data.o); if (Number.isFinite(o)) { market.open = o; changed = true; } }

    if (data.st !== undefined) {
      const stOpen = data.st === true || String(data.st).toLowerCase() === 'true';
      market.isMarketOpen = stOpen;
      this.marketStatusCache.set(market.symbol, stOpen);
    }

    // Flash direction
    const prevBid = market.previousLtp;
    if (bid !== null && prevBid !== null) {
      (market as any).flashDir = bid > (prevBid as number) ? 'up' : bid < (prevBid as number) ? 'down' : null;
      clearTimeout((market as any)._flashTimer);
      (market as any)._flashTimer = setTimeout(() => { (market as any).flashDir = null; }, 600);
    }

    // Push to shared price cache so other components can read live prices
    if (changed) {
      this.sharedService.updateLivePrice(market.symbol, {
        bid: market.bid,
        ask: market.ask,
        ltp: market.ltp,
        dailyChange: market.dailyChange,
        marketType: market.marketType
      });
      this.scheduleUiTick();
    }
  }

  private parsePercentage(value: string): number {
    if (!value) return 0;
    const parsed = parseFloat(value.replace('%', '').replace('+', ''));
    return isNaN(parsed) ? 0 : parsed;
  }

  // True jab watchlist hai aur kam se kam ek item load ho gaya ho
  get tickerReady(): boolean {
    if (this.watchlist.length === 0) return false;
    // Show live table as soon as any item has a price, otherwise show skeleton
    return this.watchlist.some(m => m.bid !== null || m.ask !== null || m.ltp !== null);
  }
}
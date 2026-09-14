import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WatchlistSocketService } from '../../../../services/watchlist-socket.service';
import { MarketDataService } from '../../../../services/market-data.service';

interface MarketType {
  type_id: number;
  type: string;
}

interface Market {
  market_id: number;
  market: string;
  exchange: string;
  bid: number | null;
  ask: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
}

@Component({
  selector: 'app-market-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './market-search.component.html',
  styleUrls: ['./market-search.component.scss']
})
export class MarketSearchComponent implements OnInit, OnDestroy {
  // View modes: 'market-types' | 'market-list' | 'search-results'
  viewMode: 'market-types' | 'market-list' | 'search-results' = 'market-types';

  marketTypes: MarketType[] = [];
  markets: { [key: string]: Market[] } = {};
  watchlist: string[] = [];

  selectedMarketType: string | null = null;
  searchText: string = '';
  filteredMarkets: Market[] = [];

  constructor(private watchlistSocketService: WatchlistSocketService, private marketDataService: MarketDataService) { }

  ngOnInit(): void {
    this.loadDataFromService();
    this.setupWatchlistSocket();
  }

  ngOnDestroy(): void {
    this.cleanupWatchlistSocket();
  }

  private setupWatchlistSocket(): void {
    // Subscribe to watchlist updates
    this.watchlistSocketService.watchlist$.subscribe((items: any[]) => {
      this.updateWatchlistFromItems(items);
    });
  }

  private cleanupWatchlistSocket(): void {
    // Cleanup handled by service
  }

  private updateWatchlistFromItems(items: any[]): void {
    const allMarkets = Object.values(this.markets).flat();
    this.watchlist = items.map(x => {
      const id = x?.id ?? x?.instrument_id ?? x?.market_id;
      const market = allMarkets.find(m => m.market_id === id);
      return market?.market || x?.symbol || '';
    }).filter(Boolean);
  }

  private loadDataFromService(): void {
    if (this.marketDataService.isLoaded) {
      this.markets = this.marketDataService.markets;
      this.marketTypes = this.marketDataService.market_types;
      return;
    }
    // Subscribe and apply when ready
    const sub = this.marketDataService.state$.subscribe(state => {
      if (state.loaded) {
        sub.unsubscribe();
        this.markets = state.markets;
        this.marketTypes = state.market_types;
      }
    });
  }

  getMarketCount(type: string): number {
    return this.markets[type]?.length || 0;
  }

  getWatchlistCount(type: string): number {
    const typeMarkets = this.markets[type] || [];
    return typeMarkets.filter(m => this.watchlist.includes(m.market)).length;
  }

  selectMarketType(type: string): void {
    this.selectedMarketType = type;
    this.viewMode = 'market-list';
    this.searchText = '';
    this.filteredMarkets = [];
  }

  goBack(): void {
    if (this.viewMode === 'market-list') {
      this.viewMode = 'market-types';
      this.selectedMarketType = null;
    } else if (this.viewMode === 'search-results') {
      this.viewMode = 'market-types';
      this.searchText = '';
      this.filteredMarkets = [];
    }
  }

  onSearchTextChange(): void {
    if (this.searchText.trim()) {
      this.viewMode = 'search-results';
      this.filterMarkets();
    } else {
      this.viewMode = 'market-types';
      this.filteredMarkets = [];
    }
  }

  private filterMarkets(): void {
    const query = this.searchText.toLowerCase().trim();
    if (!query) {
      this.filteredMarkets = [];
      return;
    }

    const allMarkets = Object.values(this.markets).flat();
    this.filteredMarkets = allMarkets.filter(market =>
      market.market.toLowerCase().includes(query) ||
      market.exchange.toLowerCase().includes(query)
    );
  }

  isMarketInWatchlist(market: string): boolean {
    return this.watchlist.includes(market);
  }

  toggleMarketInWatchlist(market: Market): void {
    const index = this.watchlist.indexOf(market.market);
    if (index > -1) {
      // Remove from watchlist
      this.watchlistSocketService.removeWatchlist(market.market_id);
    } else {
      // Add to watchlist
      this.watchlistSocketService.addWatchlist(market.market_id);
    }
  }

  closeSearch(): void {
    const event = new CustomEvent('closeMarketSearch', { bubbles: true });
    window.dispatchEvent(event);
  }

  getMarketExchangeName(exchange: string): string {
    const exchangeNames: { [key: string]: string } = {
      'MT': 'Multi Terminal',
      'BINANCE': 'Binance',
      'FOREX': 'Forex'
    };
    return exchangeNames[exchange] || exchange;
  }
}

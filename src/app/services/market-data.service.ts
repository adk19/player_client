import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, filter, take } from 'rxjs';
import { urlConstant } from '../shared/constant/urlConstant';
import { SharedService } from '../shared/services/shared.service';

export interface MarketDataState {
  markets: Record<string, any[]>;
  market_types: any[];
  loaded: boolean;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private _state = new BehaviorSubject<MarketDataState>({
    markets: {},
    market_types: [],
    loaded: false
  });

  /** Emits every time market data is updated */
  readonly state$ = this._state.asObservable();

  /** Emits once when data is first loaded (loaded === true) */
  readonly ready$ = this._state.pipe(filter(s => s.loaded), take(1));

  private _loading = false;

  constructor(private http: HttpClient, private sharedService: SharedService) { }

  // ── Getters ──────────────────────────────────────────────────

  get markets(): Record<string, any[]> {
    return this._state.value.markets;
  }

  get market_types(): any[] {
    return this._state.value.market_types;
  }

  get isLoaded(): boolean {
    return this._state.value.loaded;
  }

  /** Flat array of all markets across all types */
  get allMarkets(): any[] {
    return Object.values(this._state.value.markets).flat();
  }

  // ── Load ─────────────────────────────────────────────────────

  /**
   * Fetch market data from API.
   * Called on every login and every page reload (if user is logged in).
   * Never stores in sessionStorage / localStorage.
   */
  load(): Observable<void> {
    return new Observable(observer => {
      if (this._loading) {
        // Already in flight — wait for it
        this.ready$.subscribe(() => { observer.next(); observer.complete(); });
        return;
      }

      this._loading = true;

      this.http.get<any>(urlConstant.getPlayerMarkets).subscribe({
        next: (response) => {
          this._loading = false;
          if (response?.code === 0 && response?.data) {
            const data = response.data;
            const market_types: any[] = data?.market_types ?? [];
            let markets: Record<string, any[]> = {};

            if (data?.markets && typeof data.markets === 'object' && !Array.isArray(data.markets)) {
              markets = data.markets;
            } else if (Array.isArray(data)) {
              // flat list — group by type
              markets = (data as any[]).reduce((acc: Record<string, any[]>, item: any) => {
                const ty = item?.type || item?.market_type || 'UNKNOWN';
                acc[ty] = acc[ty] || [];
                acc[ty].push(item);
                return acc;
              }, {});
            }

            this.sharedService.allMarketsCache = Object.values(markets).flat();
            this._state.next({ markets, market_types, loaded: true });
          } else {
            // API returned unexpected shape — mark loaded so consumers don't hang
            this._state.next({ ...this._state.value, loaded: true });
          }
          observer.next();
          observer.complete();
        },
        error: (err) => {
          this._loading = false;
          console.error('[MarketDataService] Failed to load market data:', err);
          // Mark loaded so consumers don't hang forever
          this._state.next({ ...this._state.value, loaded: true });
          observer.error(err);
        }
      });
    });
  }

  /** Reset state (called on logout) */
  reset(): void {
    this._loading = false;
    this._state.next({ markets: {}, market_types: [], loaded: false });
  }
}

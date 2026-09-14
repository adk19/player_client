import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WatchlistSocketService } from '../../../services/watchlist-socket.service';
import { AuthService } from '../../../shared/services/auth.service';
import { CryptoComponent } from './crypto.component';
import { Subject, takeUntil, filter, take, timeout, catchError, of } from 'rxjs';

@Component({
  selector: 'app-crypto-redirect',
  standalone: true,
  imports: [CryptoComponent],
  template: '<app-crypto></app-crypto>'
})
export class CryptoRedirectComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private watchlistSocketService: WatchlistSocketService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      // console.log(params);
      const origMarket = params.get('market') || '';
      const origTf = params.get('timeframe') || '';
      const origChart = params.get('chart') || '';

      let market = origMarket;
      const timeframe = origTf || '15m';
      const chart = origChart || 'candles';

      // If no market in URL, try to use first watchlist item from socket; otherwise leave empty
      if (!market) {
        const user = this.authService.currentUser;
        const playerId = user?.playerId || user?.userId || user?.player_id || '';

        if (playerId) {
          const watchlist = this.watchlistSocketService.getCurrentWatchlist();
          // New format: watchlist contains objects with symbol property
          if (Array.isArray(watchlist) && watchlist.length > 0) {
            const firstItem = watchlist[0];
            const firstSymbol = firstItem?.symbol || firstItem?.market || '';
            if (firstSymbol) {
              this.router.navigate(['/trade'], {
                queryParams: {
                  market: firstSymbol,
                  timeframe: '15m',
                  chart: 'candles'
                },
                replaceUrl: true
              });
              return;
            }
          }

          // Watchlist arrives async via socket; wait for first non-empty emission.
          this.watchlistSocketService.watchlist$.pipe(takeUntil(this.destroy$),
            filter((wl: any) => Array.isArray(wl) && wl.length > 0),
            take(1),
            timeout({ first: 4000 }),
            catchError(() => of([]))
          ).subscribe((wl: any) => {
              const firstItem = Array.isArray(wl) && wl.length > 0 ? wl[0] : null;
              const firstSymbol = firstItem?.symbol || firstItem?.market || '';
              if (firstSymbol) {
                this.router.navigate(['/trade'], {
                  queryParams: {
                    market: firstSymbol,
                    timeframe: '15m',
                    chart: 'candles'
                  },
                  replaceUrl: true
                });
              }
            });
        }
      }
    });
    // If market is already present, just render CryptoComponent without redirect
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
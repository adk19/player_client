import { Component, HostListener, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { environment } from './shared/environment/environment';
import { urlConstant } from './shared/constant/urlConstant';
import { SharedService } from './shared/services/shared.service';
import { HttpClient } from '@angular/common/http';
import { PlayerService } from './services/player.service';
import { PlayerDetailsService } from './services/player-details.service';
import { AuthService } from './shared/services/auth.service';
import { filter } from 'rxjs';
import { BinanceSocketService } from './services/binance-socket.service';
import { SocketService } from './shared/services/socket.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'Binance';

  constructor(
    private sharedService: SharedService,
    private http: HttpClient,
    private playerService: PlayerService,
    private playerDetailsService: PlayerDetailsService,
    private authService: AuthService,
    private router: Router,
    private binanceSocketService: BinanceSocketService,
    private socketService: SocketService
  ) { }

  async ngOnInit() {
    this.sharedService.isWebView = this.sharedService.checkIsWebView();

    if (environment.BrandCode) {
      this.sharedService.brandCode = environment.BrandCode;
      this.loadBrandConfig(environment.BrandCode);
    }

    // Exchange rates only when logged in — subscribe to login state changes
    this.authService.isLoggedIn$.subscribe((loggedIn) => {
      if (loggedIn) {
        this.loadExchangeRates();
        this.playerDetailsService.refresh().subscribe({ error: () => { } });
      } else {
        this.playerDetailsService.clear();
      }
    });

    // On every route change, force re-subscribe all currently tracked symbols.
    // This prevents "blank until next tick" after navigation.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.binanceSocketService.forceResubscribeAllNow();
    });

    // If no brand config will load, connect review socket when already logged in.
    // Otherwise wait for loadBrandConfig so B2B brands can skip the socket.
    if (!environment.BrandCode && sessionStorage.getItem('auth_token')) {
      this.socketService.connect();
    }

    this.onResize(null);

    const theme = sessionStorage.getItem('Theme') || 'light';
    this.sharedService.isDarkMode = theme !== 'light';
    this.sharedService.switchMode(this.sharedService.isDarkMode ? 'dark' : 'light');
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.sharedService.deviceWidth = event ? event.target.innerWidth : window.innerWidth;
    this.sharedService.deviceHeight = event ? event.target.innerHeight : window.innerHeight;
  }

  private loadBrandConfig(brandCode: string): void {
    this.http.get<any>(urlConstant.configGet(brandCode)).subscribe({
      next: (res) => {
        if (res?.data?.length) this.sharedService.setBrandConfig(res.data[0]);
        this.maybeConnectReviewSocket();
      },
      error: (err) => {
        console.error('Failed to load brand config', err);
        this.maybeConnectReviewSocket();
      }
    });
  }

  /** Connect deposit/withdraw review socket after brand type is known (skipped for B2B). */
  private maybeConnectReviewSocket(): void {
    if (!sessionStorage.getItem('auth_token')) return;
    if (this.sharedService.isB2BBrand()) return;
    this.socketService.connect();
  }

  private loadExchangeRates(): void {
    this.playerService.getExchangeRates().subscribe({
      next: (res) => {
        if (res?.code === 0 && Array.isArray(res.data)) {
          this.sharedService.setExchangeRates(res.data);
        }
      },
      error: (err) => console.error('Failed to load exchange rates', err)
    });
  }
}
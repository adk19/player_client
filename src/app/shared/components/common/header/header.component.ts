import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { TradingSocketService } from '../../../../services/trading-socket.service';
import { environment } from '../../../environment/environment';
import { AuthService } from '../../../services/auth.service';
import { MARKET_SLUG, MarketType } from '../../../services/market.constants';
import { SharedService } from '../../../services/shared.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  env: any = environment;
  isBalanceOpen = false;
  noticeBarVisible = true;

  equity = 0;
  margin = 0;
  freeMargin = 0;
  marginLevel = 0;
  openPositions = 0;

  private subs = new Subscription();
  private _cachedPositions: any[] = [];

  markets = [
    { type: MarketType.CRYPTO, slug: MARKET_SLUG[MarketType.CRYPTO], label: 'Crypto' },
    { type: MarketType.FOREX, slug: MARKET_SLUG[MarketType.FOREX], label: 'Forex' },
    { type: MarketType.COMMODITY, slug: MARKET_SLUG[MarketType.COMMODITY], label: 'Commodity' },
    { type: MarketType.STOCK, slug: MARKET_SLUG[MarketType.STOCK], label: 'Stock' },
    { type: MarketType.INDEX, slug: MARKET_SLUG[MarketType.INDEX], label: 'Index' },
    { type: MarketType.METAL, slug: MARKET_SLUG[MarketType.METAL], label: 'Metal' },
    { type: MarketType.ETFS, slug: MARKET_SLUG[MarketType.ETFS], label: 'Etfs' },
    { type: MarketType.FORWARDS, slug: MARKET_SLUG[MarketType.FORWARDS], label: 'Forwards' },
    { type: MarketType.MCX, slug: MARKET_SLUG[MarketType.MCX], label: 'Mcx' },
  ];

  constructor(
    public sharedservice: SharedService,
    public authService: AuthService,
    private router: Router,
    private tradingSocket: TradingSocketService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) { }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.noticeBarVisible = sessionStorage.getItem('notice_bar_hidden') !== '1';
      this.applyNoticeBarState();
    }

    // Positions update → recalculate summary
    this.subs.add(
      this.tradingSocket.positions$.subscribe(positions => {
        this._cachedPositions = positions;
        this._recalculate();
      })
    );

    // Balance update → recalculate summary
    this.subs.add(
      this.authService.balance$.subscribe(() => {
        this._recalculate();
      })
    );
  }

  private _recalculate(): void {
    const balance = Number(this.authService.currentBalance) || 0;
    let unrealizedPnl = 0;
    let usedMargin = 0;

    for (const pos of this._cachedPositions) {
      // Use current_price for live P&L, fallback to unrealized_pl from server
      const currentPrice = pos.current_price || pos.entry_price || 0;
      const entryPrice = pos.entry_price || 0;
      const qty = pos.quantity || 0;
      const leverage = pos.leverage || 1;
      const isBuy = pos.type === 1;

      const priceDiff = isBuy
        ? (currentPrice - entryPrice)
        : (entryPrice - currentPrice);

      const livePnl = priceDiff * qty;
      unrealizedPnl += Number.isFinite(livePnl) ? livePnl : Number(pos.unrealized_pl || pos.profit_loss || 0);

      if (entryPrice && qty && leverage) {
        usedMargin += (entryPrice * qty) / leverage;
      }
    }

    this.openPositions = this._cachedPositions.length;
    this.equity = balance + unrealizedPnl;
    this.margin = usedMargin;
    this.freeMargin = this.equity - usedMargin;
    this.marginLevel = usedMargin > 0 ? (this.equity / usedMargin) * 100 : 0;
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  toggleBalance(event: MouseEvent): void {
    event.stopPropagation();
    this.isBalanceOpen = !this.isBalanceOpen;
  }

  toggleTheme(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const next = this.sharedservice.isDarkMode ? 'light' : 'dark';
    this.sharedservice.switchMode(next);
    this.cdr.markForCheck();
  }

  toggleNoticeBar(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.noticeBarVisible = false;
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem('notice_bar_hidden', '1');
      this.applyNoticeBarState();
    }
    this.cdr.markForCheck();
  }

  private applyNoticeBarState(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.documentElement.classList.toggle('notice-bar-hidden', !this.noticeBarVisible);
  }

  @HostListener('document:click')
  closeDropdown(): void {
    this.isBalanceOpen = false;
  }

  checkMenuActive(menuName: string): boolean {
    if (!menuName) return false;
    const url = (this.router.url || '').toLowerCase();
    return url.includes(menuName.toLowerCase());
  }
}
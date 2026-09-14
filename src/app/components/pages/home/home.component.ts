import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { BinanceSocketService } from '../../../services/binance-socket.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SharedService } from '../../../shared/services/shared.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {
  walletValue = 15280.00;
  changePct = 2.9;
  changeAbs = 830.00;

  coinsTop: Array<{ name: string; symbol: string; price: number; changePct: number }> = [
    { name: 'Bitcoin', symbol: 'BTC', price: 37250.12, changePct: 3.4 },
    { name: 'Ethereum', symbol: 'ETH', price: 2450.55, changePct: 2.1 },
    { name: 'Binance Coin', symbol: 'BNB', price: 312.45, changePct: -1.2 },
    { name: 'Solana', symbol: 'SOL', price: 185.32, changePct: 4.6 },
    { name: 'XRP', symbol: 'XRP', price: 0.62, changePct: -0.8 },
    { name: 'Cardano', symbol: 'ADA', price: 0.46, changePct: 1.9 },
    { name: 'Dogecoin', symbol: 'DOGE', price: 0.18, changePct: 2.3 },
    { name: 'Polygon', symbol: 'MATIC', price: 0.88, changePct: -0.6 },
  ];

  promo = {
    title: 'Trade Smarter, Not Harder',
    desc: 'Real-time market insights and seamless execution at your fingertips.',
    cta: 'Explore Markets'
  };

  slides: Array<{ title: string; desc: string; cta: string }> = [
    { title: 'Trade Smarter, Not Harder', desc: 'Real-time market insights & seamless transactions at your fingertips.', cta: 'Explore Markets' },
    { title: 'Earn Passive Income', desc: 'Stake assets and earn rewards with flexible terms.', cta: 'Start Earning' },
    { title: 'Set Price Alerts', desc: 'Never miss a move. Get notified instantly.', cta: 'Create Alert' },
    { title: 'Learn in Academy', desc: 'Bite-sized lessons to boost your trading skills.', cta: 'Start Learning' },
    { title: 'Refer & Earn', desc: 'Invite friends and earn bonuses together.', cta: 'Invite Now' },
  ];

  // Live coins state
  activeTab: string = 'all';
  tabs: string[] = ['all', 'defi', 'tvl', 'gainers', 'losers', 'largecap', 'traded', 'txns', 'hi-supply', 'lo-supply'];
  tabLabels: Record<string, string> = {
    'all': 'All coins',
    'defi': 'DeFi coins',
    'tvl': 'Most value locked',
    'gainers': 'Top gainers',
    'losers': 'Top losers',
    'largecap': 'Large-cap',
    'traded': 'Most traded',
    'txns': 'Most transactions',
    'hi-supply': 'Highest supply',
    'lo-supply': 'Lowest supply',
  };
  allSymbols: Array<{ symbol: string; base: string; quote: string }> = [];
  tickers: Record<string, { last: number; chgPct: number; qVol: number }> = {};
  lastPrice: Record<string, number> = {};
  private klinesCache: Record<string, number[]> = {};
  topSymbolsCount = 8;
  private tickerPollId?: any;
  private tickerSubscribed = false;
  private allTickerHandler?: (arr: any[]) => void;

  private getTabCount(): number {
    try {
      return (typeof window !== 'undefined' && window.matchMedia('(min-width: 992px)').matches) ? 4 : 6;
    } catch { return 6; }
  }

  // Quote asset helper for template
  quoteOf(sym: string): string {
    const f = this.allSymbols.find(s => s.symbol === sym);
    return f?.quote || '';
  }

  constructor(
    private http: HttpClient,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    public sharedservice: SharedService,
    public authService: AuthService,
    private binanceSocket: BinanceSocketService
  ) { }

  ngOnInit(): void {
    this.loadExchangeInfo();
    this.load24hTickers();
    // Backup polling to keep prices non-zero if WS is blocked
    // this.tickerPollId = setInterval(() => this.load24hTickers(true), 30000);
  }

  deposit() { }
  withdraw() { }

  showCashPayments(): boolean {
    return this.sharedservice.isCashPaymentsEnabled();
  }

  onCoin(symbol: string) {
    try {
      const market = encodeURIComponent(symbol || 'BTCUSDT');
      window.location.href = `/trade?market=${market}&timeframe=15m&chart=area`;
    } catch {
      // no-op
    }
  }

  setTab(key: string) { this.activeTab = key; }

  // Promos slider: drag + arrows
  @ViewChild('promoSlider') promoSlider?: ElementRef<HTMLDivElement>;
  canPromoLeft = false; canPromoRight = true;
  private promoDragActive = false;
  private promoStartX = 0; private promoScrollLeft = 0;

  ngAfterViewInit(): void {
    setTimeout(() => this.onPromoScroll(), 0);
  }

  scrollPromo(dir: number) {
    const el = this.promoSlider?.nativeElement; if (!el) return;
    const step = Math.max(1, Math.floor(el.clientWidth));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  onPromoPointerDown(ev: PointerEvent) {
    const el = this.promoSlider?.nativeElement; if (!el) return;
    this.promoDragActive = true;
    this.promoStartX = ev.clientX;
    this.promoScrollLeft = el.scrollLeft;
    try { el.setPointerCapture?.(ev.pointerId); } catch { }
  }

  onPromoPointerMove(ev: PointerEvent) {
    if (!this.promoDragActive) return;
    const el = this.promoSlider?.nativeElement; if (!el) return;
    ev.preventDefault();
    const dx = ev.clientX - this.promoStartX;
    el.scrollLeft = this.promoScrollLeft - dx;
    this.onPromoScroll();
  }

  onPromoPointerUp() {
    if (!this.promoDragActive) return;
    this.promoDragActive = false;
    this.onPromoScroll();
  }

  onPromoScroll() {
    const el = this.promoSlider?.nativeElement; if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    this.canPromoLeft = el.scrollLeft > 2;
    this.canPromoRight = el.scrollLeft < (maxScroll - 2);
    this.cdr.markForCheck();
  }

  // Top priced coins for marquee (20 items)
  get marqueeSymbols(): string[] {
    const pool = this.getSymbols()
      .filter(s => this.tickers[s])
      .filter(s => (this.lastOf(s) || 0) > 0)
      .sort((a, b) => (this.lastOf(b) || 0) - (this.lastOf(a) || 0));
    return this.uniqueByBase(pool).slice(0, 20);
  }

  private loadExchangeInfo() {
    const url = `https://api.binance.com/api/v3/exchangeInfo`;

    this.http.get<any>(url).subscribe({
      next: (info) => {
        const preferredQuotes = new Set(['USDT', 'BUSD', 'USDC']);
        const syms = (info?.symbols || []).filter((s: any) => s.status === 'TRADING');
        // Prioritize common quote assets for better live coverage
        const sorted = syms.sort((a: any, b: any) => Number(preferredQuotes.has(b.quoteAsset)) - Number(preferredQuotes.has(a.quoteAsset)));
        this.allSymbols = sorted.map((s: any) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
      },
      error: () => {
        // proceed; WS may still populate prices
        this.ensureMiniTicker();
      }
    });
  }

  private load24hTickers(isRefresh: boolean = false) {
    const url = `https://api.binance.com/api/v3/ticker/24hr`;

    this.http.get<any[]>(url).subscribe({
      next: (list) => {
        for (const r of list) {
          const sym = r.symbol as string;
          const chg = parseFloat(r.priceChangePercent);
          const lp = parseFloat(r.lastPrice);
          const qv = parseFloat(r.quoteVolume);
          if (!Number.isFinite(chg) || !Number.isFinite(lp)) continue;
          this.tickers[sym] = { last: lp, chgPct: chg, qVol: Number.isFinite(qv) ? qv : 0 };
          this.lastPrice[sym] = lp;
        }
        if (!isRefresh) this.ensureMiniTicker();
        this.cdr.markForCheck();
      },
      error: () => {
        // even if HTTP fails, ensure WS is running
        if (!isRefresh) this.ensureMiniTicker();
      }
    });
  }

  private ensureMiniTicker() {
    if (this.tickerSubscribed) return;
    this.tickerSubscribed = true;

    this.binanceSocket.emitSubscribeTicker();

    const handler = (arr: any) => {
      this.zone.run(() => {
        try {
          if (!Array.isArray(arr)) return;
          for (const t of arr) {
            const s = t.s as string;
            if (!s) continue;
            const c = parseFloat(t.c);
            const P = parseFloat(t.P); // priceChangePercent
            const q = parseFloat(t.q); // quoteVolume
            if (Number.isFinite(c)) {
              this.lastPrice[s] = c;
            }
            if (!this.tickers[s]) {
              this.tickers[s] = {
                last: Number.isFinite(c) ? c : 0,
                chgPct: Number.isFinite(P) ? P : (this.tickers[s]?.chgPct ?? 0),
                qVol: Number.isFinite(q) ? q : (this.tickers[s]?.qVol ?? 0)
              };
            } else {
              if (Number.isFinite(c)) this.tickers[s].last = c;
              if (Number.isFinite(P)) this.tickers[s].chgPct = P;
              if (Number.isFinite(q)) this.tickers[s].qVol = q;
            }
          }
          this.cdr.markForCheck();
        } catch { }
      });
    };

    this.allTickerHandler = handler;
    this.binanceSocket.onAllTicker(handler);
  }

  ngOnDestroy(): void {
    if (this.allTickerHandler) {
      this.binanceSocket.offAllTicker(this.allTickerHandler);
      this.allTickerHandler = undefined;
    }
    try { if (this.tickerPollId) clearInterval(this.tickerPollId); } catch { }
  }

  private getSymbols(): string[] { return this.allSymbols.map(s => s.symbol); }

  private basesOf(symbols: string[]): Set<string> {
    const set = new Set<string>();
    for (const s of symbols) {
      const b = this.baseOf(s);
      if (b) set.add(b);
    }
    return set;
  }

  private uniqueByBase(symbols: string[], excludeBases?: Set<string>): string[] {
    const seen = new Set<string>(excludeBases);
    const out: string[] = [];
    for (const s of symbols) {
      const b = this.baseOf(s);
      if (!b) continue;
      if (seen && seen.has(b)) continue;
      if (out.length && out[out.length - 1] === s) continue;
      seen?.add(b);
      out.push(s);
    }
    return out;
  }

  get topSymbols(): string[] {
    // Choose top by quote volume, de-duplicate by base to avoid BTCUSDT/BTCBUSD appearing together
    const ranked = this.getSymbols()
      .filter(s => this.tickers[s])
      .sort((a, b) => (this.tickers[b].qVol || 0) - (this.tickers[a].qVol || 0));
    const unique = this.uniqueByBase(ranked);
    return unique.slice(0, this.topSymbolsCount);
  }

  get list_all(): string[] {
    const exclude = this.basesOf(this.topSymbols);
    const arr = this.getSymbols()
      .filter(s => this.tickers[s])
      .filter(s => (this.lastOf(s) || 0) > 0);
    return this.uniqueByBase(arr, exclude).slice(0, this.getTabCount());
  }

  get list_gainers(): string[] {
    const exclude = this.basesOf(this.topSymbols);
    const arr = this.getSymbols()
      .filter(s => this.tickers[s])
      .filter(s => (this.lastOf(s) || 0) > 0)
      .sort((a, b) => this.tickers[b].chgPct - this.tickers[a].chgPct);
    return this.uniqueByBase(arr, exclude).slice(0, this.getTabCount());
  }

  get list_losers(): string[] {
    const exclude = this.basesOf(this.topSymbols);
    const arr = this.getSymbols()
      .filter(s => this.tickers[s])
      .filter(s => (this.lastOf(s) || 0) > 0)
      .sort((a, b) => this.tickers[a].chgPct - this.tickers[b].chgPct);
    return this.uniqueByBase(arr, exclude).slice(0, this.getTabCount());
  }

  get list_traded(): string[] {
    const exclude = this.basesOf(this.topSymbols);
    const arr = this.getSymbols()
      .filter(s => this.tickers[s])
      .filter(s => (this.lastOf(s) || 0) > 0)
      .sort((a, b) => (this.tickers[b].qVol || 0) - (this.tickers[a].qVol || 0));
    return this.uniqueByBase(arr, exclude).slice(0, this.getTabCount());
  }

  private listFor(tab: string, exclude: Set<string>): string[] {
    // Base ranking per category; unknown categories fall back to all
    let ranked: string[] = [];
    const pool = this.getSymbols().filter(s => this.tickers[s]).filter(s => (this.lastOf(s) || 0) > 0);
    switch (tab) {
      case 'gainers':
        ranked = [...pool].sort((a, b) => this.tickers[b].chgPct - this.tickers[a].chgPct);
        break;
      case 'losers':
        ranked = [...pool].sort((a, b) => this.tickers[a].chgPct - this.tickers[b].chgPct);
        break;
      case 'traded':
        ranked = [...pool].sort((a, b) => (this.tickers[b].qVol || 0) - (this.tickers[a].qVol || 0));
        break;
      default:
        ranked = pool;
        break;
    }
    return this.uniqueByBase(ranked, exclude).slice(0, this.getTabCount());
  }

  symbolsForTab(tab: string): string[] {
    const exclude = this.basesOf(this.topSymbols);
    for (const t of this.tabs) {
      const list = this.listFor(t, exclude);
      if (t === tab) return list;
      for (const s of list) exclude.add(this.baseOf(s));
    }
    return [];
  }

  sparkWidth = 90; sparkHeight = 32; sparkPadding = 2;
  sparkPath(vals: number[]): string {
    if (!vals || vals.length < 2) return '';
    const w = this.sparkWidth - this.sparkPadding * 2;
    const h = this.sparkHeight - this.sparkPadding * 2;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = Math.max(1e-6, max - min);
    const stepX = w / (vals.length - 1);
    const points = vals.map((v, i) => {
      const x = this.sparkPadding + i * stepX;
      const y = this.sparkPadding + (h - ((v - min) / range) * h);
      return `${x},${y}`;
    });
    return 'M ' + points[0] + ' L ' + points.slice(1).join(' ');
  }

  async sparkFor(sym: string): Promise<number[]> {
    const key = `${sym}:15m`;
    if (this.klinesCache[key]) return this.klinesCache[key];
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=40`;

      const data = await this.http.get<any[]>(url).toPromise();
      const vals = (data || []).map(r => parseFloat(r[4]));
      this.klinesCache[key] = vals;
      return vals;
    } catch { return []; }
  }
  getSpark(sym: string): number[] {
    const key = `${sym}:15m`;
    if (this.klinesCache[key]) return this.klinesCache[key];
    this.sparkFor(sym);
    return [];
  }

  baseOf(sym: string): string {
    const info = this.allSymbols.find(x => x.symbol === sym);
    return info?.base || sym;
  }

  chgOf(sym: string): number { return this.tickers[sym]?.chgPct ?? 0; }

  lastOf(sym: string): number { return (this.lastPrice[sym] ?? this.tickers[sym]?.last ?? NaN); }
}
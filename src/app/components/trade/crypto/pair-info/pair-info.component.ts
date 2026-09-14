import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { urlConstant } from '../../../../shared/constant/urlConstant';
import { BinanceSocketService } from '../../../../services/binance-socket.service';
import { MarketDataService } from '../../../../services/market-data.service';


@Component({
  selector: 'app-pair-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pair-info.component.html',
  styleUrls: ['pair-info.component.scss']
})

export class PairInfoComponent implements OnChanges, OnDestroy {

  @Input() symbol: string = '';
  @Input() priceNow: number | null = null;
  @Input() currentSlug: string;
  @Input() pairDetail: any;
  @Input() sessionChangePct: number | null = null;
  @Output() closed = new EventEmitter<void>();


  // small stats

  change5m: number | null = null;
  change60m: number | null = null;
  change1d: number | null = null;
  change1mo: number | null = null;
  change1y: number | null = null;
  changeYtd: number | null = null;

  schedule: Array<{ date: string; weekday: string; time: string }> = [];

  private alive = true;

  private miniTickerHandler?: (data: any) => void;

  private refreshTimer?: any;

  currentPrice: number | null = null;

  constructor(
    private http: HttpClient,
    private binanceSocket: BinanceSocketService,
    private marketDataService: MarketDataService) { }

  // simple sentiment mock based on sign of sessionChangePct

  get sentimentBuy(): number {

    const base = 50 + (this.sessionChangePct ?? 0) * 2; // bias by 24h change

    return Math.max(5, Math.min(95, Math.round(base)));

  }

  get sentimentSell(): number { return 100 - this.sentimentBuy; }

  get sentimentLabel(): 'Buy' | 'Sell' { return this.sentimentBuy >= this.sentimentSell ? 'Buy' : 'Sell'; }



  get headerProfitTag(): number {

    // derive a pseudo profitability tag from recent performance

    const v = 60 + (this.sessionChangePct ?? 0);
    return Math.max(40, Math.min(90, Math.round(v)));
  }

  get profit1m(): number {
    // map 5m change to a payout-like percentage for display
    const v = 65 + (this.change5m ?? 0) * 4;
    return Math.max(40, Math.min(95, Math.round(v)));
  }

  get profit5p(): number {
    const v = 70 + (this.change60m ?? 0) * 3;
    return Math.max(40, Math.min(95, Math.round(v)));

  }

  ngOnChanges(changes: SimpleChanges): void {

    if (changes['symbol'] && this.symbol) {

      // reset metrics to avoid showing stale values

      this.change5m = this.change60m = this.change1d = this.change1mo = this.change1y = this.changeYtd = null;
      this.fetchIntradayChanges();
      this.fetchDailyChanges();
      this.makeSchedule();
      this.openWs();
      this.setupRefresh();

    }

    if (changes['pairDetail'] && this.pairDetail) {

      // For MT markets, pairDetail arrives later - retry fetches if symbol is set

      const sym = this.symbol?.toUpperCase() || '';
      let isCrypto = false;
      const svcMkts1 = this.marketDataService.markets;
      if (Object.keys(svcMkts1).length > 0) {
        for (const marketType in svcMkts1) {
          const marketList = svcMkts1[marketType];
          if (Array.isArray(marketList)) {
            const found = marketList.find((m: any) => m.market === sym);
            if (found) { isCrypto = marketType.toLowerCase() === 'crypto'; break; }
          }
        }
      }

      if (this.symbol && !isCrypto) {
        this.fetchIntradayChanges();
        this.fetchDailyChanges();
      }

    }

    if (this.sessionChangePct != null) {
      this.change1d = this.sessionChangePct;
    }
  }

  ngOnDestroy(): void {
    this.alive = false;
    if (this.miniTickerHandler) {
      this.binanceSocket.offMiniTicker(this.miniTickerHandler);
      this.miniTickerHandler = undefined;
    }
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  close() {
    this.closed.emit();
  }

  formatSign(v: number | null): string {
    if (v == null || !isFinite(v)) return '-';
    const s = v > 0 ? '+' : '';
    return s + v.toFixed(2) + '%';
  }

  formatPrice(v: number | null): string {
    if (v == null || !isFinite(v)) return '-';
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }

  private fetchIntradayChanges() {

    const sym = this.symbol.toUpperCase();

    let dynamicUrl = '';

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
            break;
          }
        }
      }
    }
    if (this.pairDetail?.market_type) {
      marketName = String(this.pairDetail.market_type).toUpperCase();
    }

    if (isCrypto) {
      dynamicUrl = `klines?symbol=${sym}&market=${encodeURIComponent(marketName)}`;
    } else {
      if (!this.pairDetail || !this.pairDetail.aid) {
        return;
      }
      dynamicUrl = `mtKlines?symbol=${sym}`;
    }

    this.http.get<any[]>(`${urlConstant.CryptoApiBase}/${dynamicUrl}&interval=1d&limit=400`).subscribe({

      next: (rows) => {
        if (!Array.isArray(rows) || rows.length < 2) return;
        const closes = rows.map(r => parseFloat(r[4]));
        const opens = rows.map(r => parseFloat(r[1]));
        const times = rows.map(r => r[0] as number);
        const lastClose = closes[closes.length - 1];

        if (!isFinite(lastClose) || lastClose === 0) return;


        const pct = (from: number | null) => (isFinite(from as number) && (from as number) !== 0) ? ((lastClose - (from as number)) / (from as number)) * 100 : null;

        // 1 month ~ 30 days ago

        const idx1m = closes.length - 31; // 30 previous candles back from last
        this.change1mo = idx1m >= 0 ? pct(closes[idx1m]) : null;



        // 1 year ~ 365 days ago
        const idx1y = closes.length - 366;
        this.change1y = idx1y >= 0 ? pct(closes[idx1y]) : null;

        // YTD: find first candle on/after Jan 1 of current year

        const d0 = new Date();
        const jan1 = new Date(d0.getFullYear(), 0, 1).getTime();
        let ytdOpen: number | null = null;
        for (let i = 0; i < times.length; i++) {
          if (times[i] >= jan1) { ytdOpen = opens[i]; break; }
        }
        this.changeYtd = pct(ytdOpen);

        // 1 day change from daily klines (fallback if 24h ticker not provided)

        const prevClose = closes[closes.length - 2];
        const dayPct = (isFinite(prevClose) && prevClose !== 0) ? ((lastClose - prevClose) / prevClose) * 100 : null;
        if (this.change1d == null) this.change1d = dayPct;
      },

      error: () => {
        this.change1mo = null;
        this.change1y = null;
        this.changeYtd = null;
      }
    });
  }

  private fetchDailyChanges() {
    const sym = this.symbol.toUpperCase();

    // pull ~400 daily candles to compute 1m, 1y, YTD

    let dynamicUrl = '';

    // Check market type from MarketDataService
    let isCrypto = false;
    let marketName = 'CRYPTO';
    const svcMkts3 = this.marketDataService.markets;
    if (Object.keys(svcMkts3).length > 0) {
      for (const marketType in svcMkts3) {
        const marketList = svcMkts3[marketType];
        if (Array.isArray(marketList)) {
          const found = marketList.find((m: any) => m.market === sym);
          if (found) {
            isCrypto = marketType.toLowerCase() === 'crypto';
            marketName = (found.market_type || marketType || 'CRYPTO').toString().toUpperCase();
            break;
          }
        }
      }
    }
    if (this.pairDetail?.market_type) {
      marketName = String(this.pairDetail.market_type).toUpperCase();
    }

    if (isCrypto) {
      dynamicUrl = `klines?symbol=${sym}&market=${encodeURIComponent(marketName)}`;
    } else {
      if (!this.pairDetail || !this.pairDetail.aid) {
        return;
      }
      dynamicUrl = `mtKlines?symbol=${sym}`;
    }

    this.http.get<any[]>(`${urlConstant.CryptoApiBase}/${dynamicUrl}&interval=1d&limit=300`).subscribe({

      next: (rows) => {

        if (!Array.isArray(rows) || rows.length < 2) return;
        const closes = rows.map(r => parseFloat(r[4]));
        const opens = rows.map(r => parseFloat(r[1]));
        const times = rows.map(r => r[0] as number);
        const lastClose = closes[closes.length - 1];

        if (!isFinite(lastClose) || lastClose === 0) return;

        const pct = (from: number | null) => (isFinite(from as number) && (from as number) !== 0)
          ? ((lastClose - (from as number)) / (from as number)) * 100
          : null;

        // 1 month ~ 30 days ago

        const idx1m = closes.length - 31; // 30 previous candles back from last
        this.change1mo = idx1m >= 0 ? pct(closes[idx1m]) : null;

        // 1 year ~ 365 days ago

        const idx1y = closes.length - 366;
        this.change1y = idx1y >= 0 ? pct(closes[idx1y]) : null;



        // YTD: find first candle on/after Jan 1 of current year

        const d0 = new Date();
        const jan1 = new Date(d0.getFullYear(), 0, 1).getTime();
        let ytdOpen: number | null = null;

        for (let i = 0; i < times.length; i++) {
          if (times[i] >= jan1) { ytdOpen = opens[i]; break; }
        }

        this.changeYtd = pct(ytdOpen);

        // 1 day change from daily klines (fallback if 24h ticker not provided)

        const prevClose = closes[closes.length - 2];
        const dayPct = (isFinite(prevClose) && prevClose !== 0) ? ((lastClose - prevClose) / prevClose) * 100 : null;
        if (this.change1d == null) this.change1d = dayPct;

      },

      error: () => {
        this.change1mo = null;
        this.change1y = null;
        this.changeYtd = null;
      }
    });
  }

  private makeSchedule() {

    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const items: Array<{ date: string; weekday: string; time: string }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const dateStr = `${d.getDate()} ${d.toLocaleString(undefined, { month: 'long' })}`;
      const weekday = weekdays[d.getDay()];
      items.push({ date: dateStr, weekday, time: '05:30 - 05:29' });
    }

    this.schedule = items;
  }

  // Use streamed price if input missing

  get displayPrice(): number | null {
    return this.priceNow ?? this.currentPrice;
  }

  // Open a miniTicker WS for the active symbol

  private openWs() {
    const sym = (this.symbol || '').toLowerCase();
    if (!sym) return;

    // Unsubscribe previous handler if any

    if (this.miniTickerHandler) {
      this.binanceSocket.offMiniTicker(this.miniTickerHandler);
      this.miniTickerHandler = undefined;
    }

    this.binanceSocket.unsubscribeAll();
    this.binanceSocket.emitSubscribeMiniTicker(sym);

    const handler = (obj: any) => {
      try {
        const c = parseFloat(obj.c);
        if (Number.isFinite(c)) this.currentPrice = c;
      } catch { }

    };

    this.miniTickerHandler = handler;
    this.binanceSocket.onMiniTicker(handler);
  }



  // Periodically refresh intraday/daily changes

  private setupRefresh() {
    this.fetchIntradayChanges();
    this.fetchDailyChanges();

    // if (this.refreshTimer) clearInterval(this.refreshTimer);

    // this.refreshTimer = setInterval(() => {

    //   if (!this.alive) return;

    //   this.fetchIntradayChanges();

    //   this.fetchDailyChanges();

    // }, 60000);
  }

}
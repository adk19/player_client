import {
  Component, Input, OnChanges, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, SimpleChanges, NgZone, ChangeDetectionStrategy,
  ChangeDetectorRef, Output, EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedService } from '../../../../shared/services/shared.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tradingview-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tradingview-chart.component.html',
  styleUrls: ['./tradingview-chart.component.scss']
})
export class TradingviewChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() symbol: string = '';
  /** When set: crypto → `BINANCE:`, non-crypto → `PEPPERSTONE:`. When null, legacy heuristics apply. */
  @Input() isCryptoMarket: boolean | null = null;
  @Input() interval: string = '15m';
  @Input() theme: 'light' | 'dark' = 'dark';

  @Output() tvError = new EventEmitter<void>();

  @ViewChild('widgetContainer', { static: true }) container!: ElementRef<HTMLDivElement>;

  private viewReady = false;
  private debounceTimer: any = null;
  private themeObserver?: MutationObserver;
  private brandSub?: Subscription;
  private msgListener?: (e: MessageEvent) => void;
  private errorCheckTimer: any = null;

  // Track last rendered values to avoid unnecessary reloads
  private _lastSymbol   = '';
  private _lastInterval = '';
  private _lastTheme    = '';

  /** Match TradingView advanced embed defaults (dark) — close to official snippet */
  private readonly DARK_BG   = '#0F0F0F';
  private readonly DARK_GRID = 'rgba(242, 242, 242, 0.06)';
  private readonly LIGHT_BG  = '#ffffff';
  private readonly LIGHT_GRID = 'rgba(233, 233, 233, 0.5)';

  constructor(private zone: NgZone, public sharedService: SharedService, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.scheduleCreate();
    this.watchThemeChanges();

    this.brandSub = this.sharedService.brandConfig$.subscribe(() => {
      this.cdr.markForCheck();
    });

    this.msgListener = (e: MessageEvent) => this.handleTvMessage(e);
    window.addEventListener('message', this.msgListener);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewReady) return;

    const symbolChanged   = changes['symbol']   && changes['symbol'].currentValue   !== changes['symbol'].previousValue;
    const cryptoChanged   = changes['isCryptoMarket'] && changes['isCryptoMarket'].currentValue !== changes['isCryptoMarket'].previousValue;
    const intervalChanged = changes['interval'] && changes['interval'].currentValue !== changes['interval'].previousValue;
    // Theme input change — only reload if effective theme actually differs
    const themeChanged    = changes['theme']    && this.getEffectiveTheme() !== this._lastTheme;

    if (symbolChanged || intervalChanged || themeChanged || cryptoChanged) {
      this.scheduleCreate();
    }
  }

  ngOnDestroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.errorCheckTimer) clearTimeout(this.errorCheckTimer);
    if (this.msgListener) window.removeEventListener('message', this.msgListener);
    this.themeObserver?.disconnect();
    this.brandSub?.unsubscribe();
    this.clearContainer();
  }

  private scheduleCreate(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.viewReady || !this.symbol) return;

      const tvSym      = this.getTvSymbol();
      const tvInterval = this.getTvInterval();
      const tvTheme    = this.getEffectiveTheme();

      // Skip full reload if nothing meaningful changed
      if (tvSym === this._lastSymbol && tvInterval === this._lastInterval && tvTheme === this._lastTheme) {
        return;
      }

      this._lastSymbol   = tvSym;
      this._lastInterval = tvInterval;
      this._lastTheme    = tvTheme;

      this.createWidget();
    }, 150); // slightly longer debounce to batch rapid changes
  }

  private getTvSymbol(): string {
    const raw = (this.symbol || '').trim();
    if (!raw) return '';
    const sym = raw.toUpperCase().replace(/\//g, '').replaceAll('-', '');
    if (sym.includes(':')) return sym;

    if (this.isCryptoMarket === true) {
      return `BINANCE:${sym}`;
    }
    if (this.isCryptoMarket === false) {
      return `PEPPERSTONE:${sym}`;
    }

    // Legacy fallback (parent did not pass isCryptoMarket)
    if (/[A-Z0-9]+(USDT|USDC|USD1|BUSD|FDUSD|DAI|TUSD|USDE|PERP|BTC|ETH|BNB|SOL|XRP|DOGE|ADA)$/i.test(sym)) return `BINANCE:${sym}`;
    if (/^[A-Z]{6}$/.test(sym)) return `PEPPERSTONE:${sym}`;
    if (/^XAU|^XAG/.test(sym)) return `PEPPERSTONE:${sym}`;
    return sym;
  }

  private getTvInterval(): string {
    const map: Record<string, string> = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W', '1M': 'M' };
    return map[this.interval] || '15';
  }

  private getEffectiveTheme(): 'light' | 'dark' {
    if (this.theme !== 'dark' && this.theme !== 'light') {
      const html = document.documentElement;
      if (html.classList.contains('dark')) return 'dark';
      if (html.classList.contains('light')) return 'light';
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return this.theme;
  }

  createWidget(): void {
    if (this.errorCheckTimer) { clearTimeout(this.errorCheckTimer); this.errorCheckTimer = null; }

    this.zone.runOutsideAngular(() => {
      this.clearContainer();
      if (!this.symbol) return;

      const mode   = this._lastTheme as 'light' | 'dark';
      const isDark = mode === 'dark';
      const css = getComputedStyle(document.documentElement);
      const themedBg = css.getPropertyValue('--layout-bg')?.trim();
      const themedBorder = css.getPropertyValue('--border-light')?.trim();
      const bg = isDark ? this.DARK_BG : (themedBg || this.LIGHT_BG);
      const grid = isDark
        ? this.DARK_GRID
        : (themedBorder ? `rgba(${this.hexToRgb(themedBorder) || '233, 233, 233'}, 0.5)` : this.LIGHT_GRID);

      const tz =
        typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'
          : 'Etc/UTC';

      const config: Record<string, unknown> = {
        allow_symbol_change: false,
        calendar: false,
        details: false,
        hide_side_toolbar: false,
        hide_top_toolbar: false,
        hide_legend: true,
        hide_volume: true,
        hotlist: false,
        interval: this._lastInterval,
        locale: 'en',
        save_image: true,
        style: '1',
        symbol: this._lastSymbol,
        theme: mode,
        timezone: tz,
        backgroundColor: bg,
        gridColor: grid,
        watchlist: [],
        withdateranges: true,
        range: 'ALL',
        compareSymbols: [],
        show_popup_button: true,
        popup_height: '650',
        popup_width: '1000',
        studies: [],
        autosize: true,
      };

      const el = this.container.nativeElement;

      const wrapper = document.createElement('div');
      wrapper.className = 'tradingview-widget-container';
      wrapper.style.height = '100%';
      wrapper.style.width = '100%';
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';

      const inner = document.createElement('div');
      inner.className = 'tradingview-widget-container__widget';
      inner.style.height = '100%';
      inner.style.width = '100%';
      inner.style.minHeight = '0';
      inner.style.flex = '1 1 auto';

      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.async = true;
      script.innerHTML = JSON.stringify(config);

      script.onerror = () => {
        this.zone.run(() => this.tvError.emit());
      };

      wrapper.appendChild(inner);
      wrapper.appendChild(script);
      el.appendChild(wrapper);

      this.errorCheckTimer = setTimeout(() => this.checkForTvErrorDialog(), 4000);
    });
  }

  private hexToRgb(hex: string): string | null {
    const h = (hex || '').trim();
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const raw = m[1];
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `${r}, ${g}, ${b}`;
  }

  private checkForTvErrorDialog(): void {
    this.errorCheckTimer = null;
    try {
      const el = this.container?.nativeElement;
      if (!el) return;
      const inner = el.querySelector('.tradingview-widget-container__widget');
      if (inner && !inner.querySelector('iframe')) {
        this.zone.run(() => this.tvError.emit());
      }
    } catch {}
  }

  private handleTvMessage(e: MessageEvent): void {
    try {
      if (!e.data) return;
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const name = data?.name || data?.type || data?.event || '';
      const payload = JSON.stringify(data).toLowerCase();
      if (
        name === 'tv-widget-no-data' ||
        payload.includes('symbol not found') ||
        payload.includes('not available') ||
        payload.includes('no data') ||
        payload.includes('unavailable')
      ) {
        this.zone.run(() => this.tvError.emit());
      }
    } catch {}
  }

  private clearContainer(): void {
    try {
      if (this.container?.nativeElement) {
        this.container.nativeElement.innerHTML = '';
      }
    } catch {}
  }

  private watchThemeChanges(): void {
    let lastObservedTheme = this.getEffectiveTheme();
    this.themeObserver = new MutationObserver(() => {
      const newTheme = this.getEffectiveTheme();
      // Only reload if theme actually flipped — not on every class mutation
      if (newTheme !== lastObservedTheme) {
        lastObservedTheme = newTheme;
        this.scheduleCreate();
      }
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  navigateToBrand(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    // this.router.navigate(['/brand', this.sharedService.brandCode]);
  }
}

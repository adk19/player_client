import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { BehaviorSubject } from 'rxjs';

// Define interfaces for structured data
export interface BrandConfig {
    name: string;
    brand_code: string;
    brand_type?: string;
    logo: string;
    dark_logo: string;
    favicon: string;
    primary_color: string;
    status_id: number;
    base_currency_id: number;
    currency_symbol: string;
    currency_decimal_places: number;
    currency_code: string;
    currency_name: string;
}

export interface ExchangeRate {
    from_currency_id: number;
    from_currency_code: string;
    to_currency_id: number;
    to_currency_code: string;
    exchange_rate: string; // Keep as string for precision, convert to number when used
}

export interface LivePrice {
    symbol: string;
    bid: number | null;
    ask: number | null;
    ltp: number | null;
    dailyChange: number;
    marketType?: string;
}

@Injectable({ providedIn: 'root' })

export class SharedService {
    deviceWidth: number;
    deviceHeight: number;

    activeCurrency: any = { symbol: "₹", name: "INR" };

    isDarkMode: boolean = false;
    isFullscreen: boolean = false;
    isVolumeOn: boolean = false;
    isLoggedIn: boolean = false;
    isWebView: boolean = false;

    // Brand configuration
    brandCode: string | null = null;
    brandName: string | null = null;
    brandPrimaryColor: string | null = null;
    brandLogoUrl: string | null = null;
    brandDarkLogoUrl: string | null = null;
    brandFaviconUrl: string | null = null;

    public allMarketsCache: any[] = []; // Used by positions component

    // Live price cache — updated by watchlist/socket components, readable by any component
    private livePriceCache = new Map<string, LivePrice>();
    private livePriceCacheSubject = new BehaviorSubject<Map<string, LivePrice>>(new Map());
    livePrice$ = this.livePriceCacheSubject.asObservable();

    // Currency and Exchange Rate State
    private brandConfigSubject = new BehaviorSubject<BrandConfig | null>(null);
    brandConfig$ = this.brandConfigSubject.asObservable();

    private exchangeRatesSubject = new BehaviorSubject<ExchangeRate[]>([]);
    exchangeRates$ = this.exchangeRatesSubject.asObservable();

    constructor(private toastr: ToastrService) { }

    enterFullscreen() {
        const elem = document.documentElement; // full screen whole page
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if ((elem as any).webkitRequestFullscreen) { /* Safari */
            (elem as any).webkitRequestFullscreen();
        } else if ((elem as any).msRequestFullscreen) { /* IE11 */
            (elem as any).msRequestFullscreen();
        }
        this.isFullscreen = true;
    }


    showAlert(type: number, title: string, message?: string) {
        if (type == 1) {
            this.toastr.success(title, message ? message : '', {
                enableHtml: true,
                progressBar: true,
                positionClass: 'toast-top-right'
            });
        } else if (type == 2) {
            this.toastr.warning(title, message ? message : '', {
                enableHtml: true,
                progressBar: true,
                positionClass: 'toast-top-right'
            });
        } else if (type == 3) {
            this.toastr.error(title, message ? message : '', {
                enableHtml: true,
                progressBar: true,
                positionClass: 'toast-top-right'
            });
        } else if (type == 4) {
            this.toastr.info(title, message ? message : '', {
                enableHtml: true,
                progressBar: true,
                positionClass: 'toast-top-right'
            });
        }
    }

    copyText(val: string) {
        const selBox = document.createElement('textarea');
        selBox.style.position = 'fixed';
        selBox.style.left = '0';
        selBox.style.top = '0';
        selBox.style.opacity = '0';
        selBox.value = val;
        document.body.appendChild(selBox);
        selBox.focus();
        selBox.select();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(val);
            } else {
                document.execCommand('copy');
            }
        } catch { }
        document.body.removeChild(selBox);
        const el = document.getElementById('copy-data-text');
        if (el) el.innerHTML = 'Copied!';
    }

    openURL(url: string) {
        window.open(url, '_blank');
    }


    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) { /* Safari */
            (document as any).webkitExitFullscreen();
        }
        this.isFullscreen = false;
    }

    switchMode(mode: string) {
        let html = document.getElementsByTagName('html')[0];
        let body = document.body;
        if (mode == 'light') {
            body.classList.add('light');
            html.classList.add('light');
            body.classList.remove('dark');
            html.classList.remove('dark');
            this.isDarkMode = false;
            sessionStorage.setItem('Theme', 'light');
        } else {
            body.classList.add('dark');
            html.classList.add('dark');
            body.classList.remove('light');
            html.classList.remove('light');
            this.isDarkMode = true;
            sessionStorage.setItem('Theme', 'dark');
        }
    }

    checkIsWebView(): boolean {
        const ua = navigator.userAgent || navigator.vendor;

        // iOS WebView detect
        if (/iPhone|iPod|iPad/i.test(ua) && !/Safari/i.test(ua)) {
            return true;
        }

        // Android WebView detect
        if (/Android/i.test(ua) && /wv/.test(ua)) {
            return true;
        }

        return false;
    }

    applyBrandConfig(config: { name: string; primary_color: string; logo: string; dark_logo: string; favicon: string; }): void {
        if (!config) {
            return;
        }

        this.brandName = config.name || null;
        this.brandPrimaryColor = config.primary_color || null;
        this.brandLogoUrl = config.logo || null;
        this.brandDarkLogoUrl = config.dark_logo || null;
        this.brandFaviconUrl = config.favicon || null;

        const root = document.documentElement as HTMLElement;
        if (this.brandPrimaryColor) {
            root.style.setProperty('--primary', this.brandPrimaryColor);
            root.style.setProperty('--primary-btn', this.brandPrimaryColor);
            const primaryRgb = this.parseHexColorToRgb(this.brandPrimaryColor);
            if (primaryRgb) {
                root.style.setProperty('--primary-rgb', primaryRgb);
            }
        }

        const title = this.brandName || 'TRADING PLATFORM';
        document.title = title;

        let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        if (this.brandFaviconUrl) {
            link.type = 'image/png';
            link.href = this.brandFaviconUrl;
        }
    }

    getBrandCurrencyCode(): string | null {
        return this.brandConfigSubject.getValue()?.currency_code ?? null;
    }

    getBrandType(): string | null {
        return this.brandConfigSubject.getValue()?.brand_type ?? null;
    }

    /** True when the brand is B2B (no self-registration, no cash payments). */
    isB2BBrand(): boolean {
        const brandType = this.brandConfigSubject.getValue()?.brand_type?.trim().toUpperCase();
        return brandType === 'B2B';
    }

    /** True when the logged-in player's acquisition_channel is B2B (brand may still be B2C). */
    isB2BUser(): boolean {
        try {
            const rawUser = sessionStorage.getItem('auth_user');
            if (!rawUser) return false;
            const user = JSON.parse(rawUser);
            return user?.acquisition_channel?.trim().toUpperCase() === 'B2B';
        } catch (e) {
            console.error('[SharedService] Error parsing auth_user from sessionStorage', e);
            return false;
        }
    }

    /** Deposit/withdraw are hidden for B2B brands. */
    isCashPaymentsEnabled(): boolean {
        const brandType = this.brandConfigSubject.getValue()?.brand_type?.trim().toUpperCase();
        if (brandType === 'B2B') {
            return false;
        }

        // Also check if the logged-in player's acquisition_channel is B2B
        try {
            const rawUser = sessionStorage.getItem('auth_user');
            if (rawUser) {
                const user = JSON.parse(rawUser);
                const acquisitionChannel = user?.acquisition_channel?.trim().toUpperCase();
                if (acquisitionChannel === 'B2B') {
                    return false;
                }
            }
        } catch (e) {
            console.error('[SharedService] Error parsing auth_user from sessionStorage', e);
        }

        return true;
    }

    // ===== Live Price Cache Methods =====

    updateLivePrice(symbol: string, price: Partial<LivePrice>): void {
        const key = symbol.toUpperCase();
        const existing = this.livePriceCache.get(key) || { symbol: key, bid: null, ask: null, ltp: null, dailyChange: 0 };
        const updated = { ...existing, ...price, symbol: key };
        this.livePriceCache.set(key, updated);
        // Emit new map reference so subscribers detect change
        this.livePriceCacheSubject.next(new Map(this.livePriceCache));
    }

    getLivePrice(symbol: string): LivePrice | null {
        return this.livePriceCache.get(symbol.toUpperCase()) || null;
    }

    setBrandConfig(config: BrandConfig): void {
        this.brandConfigSubject.next(config);
        this.applyBrandConfig(config);
    }

    private parseHexColorToRgb(hexColor: string): string | null {
        const normalized = (hexColor || '').trim();
        const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized);
        if (!match) {
            return null;
        }

        const raw = match[1];
        const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
        const value = parseInt(full, 16);
        const red = (value >> 16) & 255;
        const green = (value >> 8) & 255;
        const blue = value & 255;
        return `${red}, ${green}, ${blue}`;
    }

    setExchangeRates(rates: ExchangeRate[]): void {
        this.exchangeRatesSubject.next(rates);
    }

    getExchangeRate(fromCurrencyCode: string, toCurrencyCode?: string): number | null {
        const rates = this.exchangeRatesSubject.getValue();
        const brandCurrency = this.brandConfigSubject.getValue()?.currency_code;
        const targetCurrency = toCurrencyCode || brandCurrency;

        if (!rates.length || !targetCurrency) {
            return null;
        }

        const rate = rates.find(r => r.from_currency_code === fromCurrencyCode && r.to_currency_code === targetCurrency);

        return rate ? parseFloat(rate.exchange_rate) : null;
    }

    /**
     * Converts a value from a quote currency to the brand's base currency.
     * @param value The value to convert (e.g., PnL in BTC).
     * @param quoteCurrency The currency of the value (e.g., 'BTC').
     * @returns The converted value in brand currency.
     */
    convertValueToBrandCurrency(value: number, quoteCurrency: string): number {
        if (!quoteCurrency || value === 0) return value;

        const config = this.brandConfigSubject.getValue();
        if (!config) return value;

        const brandCurrency = config.currency_code;
        if (quoteCurrency === brandCurrency) return value;

        const rate = this.getExchangeRate(quoteCurrency, brandCurrency);
        if (rate !== null) {
            return value * rate;
        }

        return value;
    }

    /**
     * Formats a numeric value into the brand's currency format.
     * @param value The number to format.
     * @returns A formatted currency string (e.g., "₹1,234.56").
     */
    formatToBrandCurrency(value: number): string {
        const config = this.brandConfigSubject.getValue();
        const num = Number(value);
        if (config === null || value === null || value === undefined || !Number.isFinite(num)) {
            return '-';
        }

        const symbol = config.currency_symbol || '';
        const decimals = config.currency_decimal_places ?? 2;
        return `${symbol} ${num.toFixed(decimals)}`;
    }
}
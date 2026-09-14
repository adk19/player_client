import { Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { urlConstant } from '../constant/urlConstant';
import { environment } from '../environment/environment';
import { MarketDataService } from '../../services/market-data.service';
import { BinanceSocketService } from '../../services/binance-socket.service';
import { TradingSocketService } from '../../services/trading-socket.service';
import { WatchlistSocketService } from '../../services/watchlist-socket.service';
import { SocketService } from './socket.service';

export interface AuthUser {
  userName: string;
  userId: number;
  balance: number;
  role: string;
  role_level_id: number;
  level: string;
  player_id?: number;
  playerId?: number;
  spreadId?: number;
  acquisition_channel?: string;
}

export interface AuthResponse {
  code: number;
  token: string;
  pages: any[];
  user: AuthUser;
  userConfig: any;
  market_types?: any[];
  markets?: any;
}

export interface PasswordResetResponse {
  code: number;
  message: string;
  playerId?: number;
  data?: {
    username?: string;
    playerId?: number;
    player_id?: number;
    id?: number;
    [key: string]: unknown;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'auth_user';

  private _isLoggedIn = new BehaviorSubject<boolean>(false);
  isLoggedIn$ = this._isLoggedIn.asObservable();

  private _user = new BehaviorSubject<AuthUser | null>(null);
  user$ = this._user.asObservable();

  private _balance = new BehaviorSubject<number>(0);
  balance$ = this._balance.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private marketData: MarketDataService,
    private injector: Injector
  ) {
    // Restore session on app start (page reload)
    // Market data is loaded by APP_INITIALIZER in app.config.ts
    try {
      const token = sessionStorage.getItem(this.TOKEN_KEY);
      const userRaw = sessionStorage.getItem(this.USER_KEY);
      if (token && userRaw) {
        const user: AuthUser = JSON.parse(userRaw);
        this._isLoggedIn.next(true);
        this._user.next(user);
        this._balance.next(user.balance ?? 0);
      }
    } catch {
      this._safeRemoveSession(this.TOKEN_KEY);
      this._safeRemoveSession(this.USER_KEY);
    }
  }

  login(payload: { username: string; password: string; brand_code: string; brand_type?: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(urlConstant.login, payload).pipe(
      tap((res) => {
        if (!res || !res.token || !res.user) {
          throw new Error('Invalid login response');
        }

        // Only store auth credentials — never market data (avoids QuotaExceededError on iOS)
        this._safeSetSession(this.TOKEN_KEY, res.token);
        this._safeSetSession(this.USER_KEY, JSON.stringify(res.user));

        this._isLoggedIn.next(true);
        this._user.next(res.user);
        this._balance.next(res.user.balance ?? 0);

        // Fetch market data fresh from dedicated API — stored in memory only
        this.marketData.load().subscribe({ error: () => { } });

        this._reconnectAllSockets();
      })
    );
  }

  forgotPassword(payload: {
    mobileNumber: string;
    dialingCode: string;
  }): Observable<PasswordResetResponse> {
    return this.http.post<PasswordResetResponse>(urlConstant.forgotPassword, {
      brand_code: environment.BrandCode || 'BRD0001',
      mobileNumber: payload.mobileNumber,
      dialingCode: payload.dialingCode
    });
  }

  resetPassword(payload: {
    mobileNumber: string;
    dialingCode: string;
    otp: string;
    newPassword: string;
  }): Observable<PasswordResetResponse> {
    return this.http.post<PasswordResetResponse>(urlConstant.resetPassword, {
      brand_code: environment.BrandCode || 'BRD0001',
      mobileNumber: payload.mobileNumber,
      dialingCode: payload.dialingCode,
      otp: payload.otp,
      newPassword: payload.newPassword
    });
  }

  logout(): void {
    this._disconnectAllSockets();
    this._safeRemoveSession(this.TOKEN_KEY);
    this._safeRemoveSession(this.USER_KEY);
    this._isLoggedIn.next(false);
    this._user.next(null);
    this._balance.next(0);
    this.marketData.reset();
    this.router.navigate(['/login']);
    // location.reload();
  }

  get isLoggedIn(): boolean {
    return this._isLoggedIn.value;
  }

  get currentUser(): AuthUser | null {
    return this._user.value;
  }

  get currentBalance(): number {
    return this._balance.value;
  }

  updateBalance(balance: number): void {
    this._balance.next(balance);
  }

  // ── Safe storage helpers ──────────────────────────────────────

  private _safeSetSession(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch (e: any) {
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        try {
          sessionStorage.setItem(key, value);
        } catch {
          console.warn(`[AuthService] sessionStorage unavailable for "${key}"`);
        }
      }
    }
  }

  private _safeRemoveSession(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch { }
  }

  /** Tear down all socket.io connections (avoids circular DI via Injector). */
  private _disconnectAllSockets(): void {
    try {
      this.injector.get(SocketService).disconnect();
    } catch (e) {
      console.warn('[AuthService] Socket disconnect failed', e);
    }
    try {
      this.injector.get(BinanceSocketService).disconnectForLogout();
    } catch (e) {
      console.warn('[AuthService] Binance socket disconnect failed', e);
    }
    try {
      this.injector.get(TradingSocketService).disconnectForLogout();
    } catch (e) {
      console.warn('[AuthService] Trading socket disconnect failed', e);
    }
    try {
      this.injector.get(WatchlistSocketService).disconnectForLogout();
    } catch (e) {
      console.warn('[AuthService] Watchlist socket disconnect failed', e);
    }
  }

  /** Re-open sockets after a successful login. */
  private _reconnectAllSockets(): void {
    try {
      this.injector.get(SocketService).connect();
    } catch (e) {
      console.warn('[AuthService] Socket reconnect failed', e);
    }
    try {
      this.injector.get(BinanceSocketService).reconnectAfterLogin();
    } catch (e) {
      console.warn('[AuthService] Binance socket reconnect failed', e);
    }
    try {
      this.injector.get(TradingSocketService).reconnectAfterLogin();
    } catch (e) {
      console.warn('[AuthService] Trading socket reconnect failed', e);
    }
    try {
      this.injector.get(WatchlistSocketService).reconnectAfterLogin();
    } catch (e) {
      console.warn('[AuthService] Watchlist socket reconnect failed', e);
    }
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { urlConstant } from '../shared/constant/urlConstant';
import type { PlayerDetailsApiResponse, PlayerDetailsPayload } from './player-details.models';
import {
  type LeverageResolveInput,
  type LeverageResolveResult,
  resolveTradeLeverage
} from './leverage-resolver';

/**
 * Full player trading profile from GET /player/details.
 * Stored only in memory (no localStorage / sessionStorage / cookies for this payload).
 */
@Injectable({ providedIn: 'root' })
export class PlayerDetailsService {
  private readonly _details$ = new BehaviorSubject<PlayerDetailsPayload | null>(null);

  /** Latest successful payload; subscribe for updates after refresh/login. */
  readonly details$ = this._details$.asObservable();

  /** Last API or network error message from refresh(). */
  lastError: string | null = null;

  constructor(private readonly http: HttpClient) { }

  /** Current snapshot (may be null before first successful refresh). */
  get details(): PlayerDetailsPayload | null {
    return this._details$.value;
  }

  clear(): void {
    this._details$.next(null);
    this.lastError = null;
  }

  /** Max allowed leverage for a symbol from cached GET /player/details (instrument → market type → plan). */
  resolveLeverage(input: LeverageResolveInput): LeverageResolveResult {
    return resolveTradeLeverage(this.details?.leverage_plan, input);
  }

  /**
   * Fetches player details. Call when user is logged in (auth token present).
   * Does not persist response to browser storage.
   */
  refresh(): Observable<PlayerDetailsPayload | null> {
    this.lastError = null;
    return this.http.get<PlayerDetailsApiResponse>(urlConstant.playerDetails).pipe(
      map((res) => {
        if (res?.code === 0 && res.data) {
          this._details$.next(res.data);
          return res.data;
        }
        this.lastError = res?.message || 'Failed to load player details';
        return null;
      }),
      catchError((err) => {
        this.lastError = err?.error?.message || err?.message || 'Network error';
        return of(null);
      })
    );
  }
}

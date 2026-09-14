import { Injectable } from '@angular/core';

// ── Types ─────────────────────────────────────────────────────

export interface TradingHoursDay {
  /** Full day name: "Monday", "Tuesday", ... "Sunday" */
  d: string;
  /** Array of [start, end] time pairs in market local time */
  s: string[][];
}

export interface MarketHoursInput {
  /** UTC offset string from API, e.g. "+3:00", "-5:00", "+5:30" */
  utcg: string;
  /** Array of day-wise trading hours in market local time */
  trading_hours: TradingHoursDay[];
}

export interface MarketStatusResult {
  isOpen: boolean;
  /** Next open time as UTC Date (null if no open found in next 7 days) */
  nextOpenUtc: Date | null;
  /** Next close time as UTC Date (null if market is closed now) */
  nextCloseUtc: Date | null;
  /** Human-readable reason */
  reason: string;
}

// ── Day name → JS getUTCDay() index (0=Sun … 6=Sat) ─────────
const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

@Injectable({ providedIn: 'root' })
export class MarketHoursService {

  /**
   * Parse UTC offset string like "+5:30", "-5:00", "+3:00"
   * Returns total offset in minutes.
   */
  /** True when API sent a parseable UTC offset (e.g. "+5:30", "-4:00"). */
  isValidUtcOffset(utcg: string | null | undefined): boolean {
    if (!utcg || typeof utcg !== 'string') return false;
    return /^[+-]\d{1,2}:\d{2}$/.test(utcg.trim());
  }

  parseUtcOffsetMinutes(utcg: string): number {
    if (!utcg) return 0;
    const match = utcg.trim().match(/^([+-])(\d{1,2}):(\d{2})$/);
    if (!match) return 0;
    const sign    = match[1] === '+' ? 1 : -1;
    const hours   = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    return sign * (hours * 60 + minutes);
  }

  /** Parse "HH:MM" → total minutes from midnight */
  private parseTimeMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Core logic:
   *
   * Step 1: Take player's current UTC time (new Date())
   * Step 2: Add utcg offset → get market local time
   * Step 3: Get day-of-week in market local time
   * Step 4: Get HH:MM in market local time
   * Step 5: Find today's entry in trading_hours
   * Step 6: Check if current market-local HH:MM is inside any session window
   */
  isMarketOpen(market: MarketHoursInput, nowUtc: Date = new Date()): MarketStatusResult {
    const { utcg, trading_hours } = market;

    if (!trading_hours?.length) {
      return { isOpen: false, nextOpenUtc: null, nextCloseUtc: null, reason: 'No trading hours defined' };
    }

    const offsetMin = this.parseUtcOffsetMinutes(utcg);

    // ── Step 2: UTC + offset = market local time ──────────────
    const marketLocalMs   = nowUtc.getTime() + offsetMin * 60_000;
    const marketLocalDate = new Date(marketLocalMs);

    // ── Step 3: Day of week in market local time ──────────────
    const marketLocalDay = marketLocalDate.getUTCDay(); // 0=Sun … 6=Sat

    // ── Step 4: Minutes since midnight in market local time ───
    const marketLocalMin = marketLocalDate.getUTCHours() * 60 + marketLocalDate.getUTCMinutes();

    // ── Step 5: Find today's entry ────────────────────────────
    const todayEntry = trading_hours.find(
      h => DAY_INDEX[h.d.toLowerCase()] === marketLocalDay
    );

    // ── Step 6: Check session windows ────────────────────────
    if (todayEntry && todayEntry.s.length > 0) {
      for (const [startStr, endStr] of todayEntry.s) {
        const startMin = this.parseTimeMinutes(startStr);
        const endMin   = this.parseTimeMinutes(endStr);

        // Overnight session: end < start (e.g. 22:00 → 02:00)
        const isOvernight = endMin < startMin;
        const inSession   = isOvernight
          ? (marketLocalMin >= startMin || marketLocalMin <= endMin)
          : (marketLocalMin >= startMin && marketLocalMin <= endMin);

        if (inSession) {
          // Market is open — compute close time in UTC
          const closeUtc = this.sessionMinToUtc(marketLocalDate, endMin, offsetMin, isOvernight && marketLocalMin < startMin);
          return {
            isOpen: true,
            nextOpenUtc: null,
            nextCloseUtc: closeUtc,
            reason: `Open until ${endStr} (market local)`,
          };
        }
      }
    }

    // Market is closed — find next open
    const nextOpen = this.findNextOpenUtc(nowUtc, trading_hours, offsetMin, marketLocalDate, marketLocalDay, marketLocalMin);

    return {
      isOpen: false,
      nextOpenUtc: nextOpen,
      nextCloseUtc: null,
      reason: todayEntry?.s.length === 0
        ? `Closed today (${todayEntry.d})`
        : 'Outside trading hours',
    };
  }

  /** Convert a session time (minutes from midnight, market local) to UTC Date */
  private sessionMinToUtc(
    marketLocalDate: Date,
    sessionMin: number,
    offsetMin: number,
    nextDay: boolean
  ): Date {
    // Midnight of today in market local time (expressed as UTC ms)
    const midnightMarketLocalMs = Date.UTC(
      marketLocalDate.getUTCFullYear(),
      marketLocalDate.getUTCMonth(),
      marketLocalDate.getUTCDate(),
      0, 0, 0, 0
    );
    // Convert market-local midnight back to UTC: subtract offset
    const midnightUtcMs = midnightMarketLocalMs - offsetMin * 60_000;
    const dayShift = nextDay ? 24 * 60 * 60_000 : 0;
    return new Date(midnightUtcMs + dayShift + sessionMin * 60_000);
  }

  /** Scan up to 7 days ahead to find next open time */
  private findNextOpenUtc(
    nowUtc: Date,
    tradingHours: TradingHoursDay[],
    offsetMin: number,
    marketLocalDate: Date,
    currentMarketDay: number,
    currentMarketMin: number
  ): Date | null {
    const midnightMarketLocalMs = Date.UTC(
      marketLocalDate.getUTCFullYear(),
      marketLocalDate.getUTCMonth(),
      marketLocalDate.getUTCDate(),
      0, 0, 0, 0
    );
    const midnightUtcMs = midnightMarketLocalMs - offsetMin * 60_000;

    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
      const checkDay = (currentMarketDay + dayOffset) % 7;
      const entry = tradingHours.find(h => DAY_INDEX[h.d.toLowerCase()] === checkDay);
      if (!entry || entry.s.length === 0) continue;

      for (const [startStr] of entry.s) {
        const startMin = this.parseTimeMinutes(startStr);
        // Today: only sessions that haven't started yet
        if (dayOffset === 0 && startMin <= currentMarketMin) continue;
        const nextOpenMs = midnightUtcMs + dayOffset * 24 * 60 * 60_000 + startMin * 60_000;
        return new Date(nextOpenMs);
      }
    }
    return null;
  }

  /** Quick boolean check */
  isOpen(market: MarketHoursInput, nowUtc?: Date): boolean {
    return this.isMarketOpen(market, nowUtc).isOpen;
  }

  /**
   * Get today's sessions for a market, converted to player's local time strings.
   *
   * "Today" = the day in market local time (UTC + utcg).
   * Each session start/end is converted: market-local time → UTC → player's browser local time.
   */
  getTodaySessions(market: MarketHoursInput, nowUtc: Date = new Date()): Array<{ start: string; end: string }> {
    const { utcg, trading_hours } = market;
    if (!trading_hours?.length) return [];

    const offsetMin = this.parseUtcOffsetMinutes(utcg);

    // Market local time
    const marketLocalMs   = nowUtc.getTime() + offsetMin * 60_000;
    const marketLocalDate = new Date(marketLocalMs);
    const marketLocalDay  = marketLocalDate.getUTCDay();

    const todayEntry = trading_hours.find(h => DAY_INDEX[h.d.toLowerCase()] === marketLocalDay);
    if (!todayEntry || !todayEntry.s.length) return [];

    // Midnight of today in market local time → UTC ms
    const midnightMarketLocalMs = Date.UTC(
      marketLocalDate.getUTCFullYear(),
      marketLocalDate.getUTCMonth(),
      marketLocalDate.getUTCDate(),
      0, 0, 0, 0
    );
    const midnightUtcMs = midnightMarketLocalMs - offsetMin * 60_000;

    return todayEntry.s.map(([startStr, endStr]) => {
      const startUtc = new Date(midnightUtcMs + this.parseTimeMinutes(startStr) * 60_000);
      const endUtc   = new Date(midnightUtcMs + this.parseTimeMinutes(endStr)   * 60_000);
      return {
        start: this.formatLocalTime(startUtc),
        end:   this.formatLocalTime(endUtc),
      };
    });
  }

  /** Format UTC Date → player's browser local time "HH:MM" */
  formatLocalTime(utcDate: Date | null): string {
    if (!utcDate) return '—';
    return utcDate.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  /** Format UTC Date → player's browser local "EEE HH:MM" */
  formatLocalDateTime(utcDate: Date | null): string {
    if (!utcDate) return '—';
    return utcDate.toLocaleString(undefined, {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  /**
   * Returns countdown string "HH:MM:SS" until the given UTC target time.
   * Returns '' if target is null or already passed.
   */
  getCountdown(targetUtc: Date | null, nowUtc: Date = new Date()): string {
    if (!targetUtc) return '';
    const diffMs = targetUtc.getTime() - nowUtc.getTime();
    if (diffMs <= 0) return '00:00:00';
    const totalSec = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
}

/*
──────────────────────────────────────────────────────────────
CORRECT ALGORITHM (verified with example):
──────────────────────────────────────────────────────────────

Market: RELIANCE/04
utcg  : +5:30
Session: Monday ["09:16", "15:30"]  ← in market local time (IST)

Player is anywhere in the world. We use UTC.

Step 1: Player's current UTC = 10:00 UTC (Monday)
Step 2: Market local = 10:00 UTC + 5:30 = 15:30 IST
Step 3: Day in market local = Monday
Step 4: Market local minutes = 15*60+30 = 930
Step 5: Today's session = ["09:16","15:30"] → start=556, end=930
Step 6: 930 >= 556 && 930 <= 930 → OPEN ✓

Player in India (IST = UTC+5:30):
  Current IST = 15:30 → UTC = 10:00 → same result ✓

Player in New York (EST = UTC-4):
  Current EST = 06:00 → UTC = 10:00 → same result ✓

──────────────────────────────────────────────────────────────
USAGE:
──────────────────────────────────────────────────────────────

const result = this.marketHours.isMarketOpen({
  utcg: market.utcg,
  trading_hours: market.trading_hours,
});
result.isOpen          // true / false
result.nextCloseUtc    // Date (UTC) → display in player's local TZ
result.nextOpenUtc     // Date (UTC) → display in player's local TZ

// Quick boolean:
const open = this.marketHours.isOpen({ utcg, trading_hours });

// Today's sessions in player's local time:
const sessions = this.marketHours.getTodaySessions({ utcg, trading_hours });
// → [{ start: "09:16", end: "15:30" }]  (already in player's local TZ)

──────────────────────────────────────────────────────────────
*/

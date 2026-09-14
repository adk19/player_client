import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  PlayerService,
  DashboardSummaryData,
  DashboardAnalyticsData,
  MarginCallRow,
  MarginCallsData
} from '../../../../services/player.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-manage',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage.component.html',
  styleUrls: ['./manage.component.scss']
})
export class ManageComponent implements OnInit {
  loading = true;
  refreshing = false;
  marginLoading = false;
  analyticsRefreshing = false;
  error: string | null = null;

  summary: DashboardSummaryData | null = null;
  analytics: DashboardAnalyticsData | null = null;
  marginCalls: MarginCallsData | null = null;

  analyticsStart = '';
  analyticsEnd = '';

  mcStart = '';
  mcEnd = '';
  mcPage = 1;
  mcLimit = 5;
  readonly mcLimitOptions = [5, 10, 20, 50];

  copyFeedback: string | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private router: Router,
    private playerService: PlayerService,
    private auth: AuthService,
    public sharedService: SharedService
  ) {
    const end = new Date();
    const start = new Date(end.getFullYear(), 0, 1);
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.analyticsEnd = this.mcEnd = ymd(end);
    this.analyticsStart = this.mcStart = ymd(start);
  }

  ngOnInit(): void {
    // Profile UI has been modernized into Account Settings.
    // Keep this route for backward compatibility and redirect.
    try {
      this.router.navigate(['/account/settings'], { queryParams: { tab: 'profile' }, replaceUrl: true });
      return;
    } catch { }
    this.loadAll(false);
  }

  loadAll(isRefresh: boolean): void {
    if (isRefresh) {
      this.refreshing = true;
    } else {
      this.loading = true;
    }
    this.error = null;

    forkJoin({
      summary: this.playerService.getDashboardSummary(),
      analytics: this.playerService.postDashboardAnalytics({
        start_date: this.analyticsStart,
        end_date: this.analyticsEnd
      }),
      margin: this.playerService.postMarginCalls({
        start_date: this.mcStart,
        end_date: this.mcEnd,
        page: this.mcPage,
        limit: this.mcLimit
      })
    }).subscribe({
      next: ({ summary, analytics, margin }) => {
        if (summary.code !== 0) {
          this.error = summary.message || 'Failed to load profile';
          this.loading = false;
          this.refreshing = false;
          return;
        }
        if (analytics.code !== 0) {
          this.error = analytics.message || 'Failed to load analytics';
          this.loading = false;
          this.refreshing = false;
          return;
        }
        if (margin.code !== 0) {
          this.error = margin.message || 'Failed to load margin alerts';
          this.loading = false;
          this.refreshing = false;
          return;
        }
        this.summary = summary.data;
        this.analytics = analytics.data;
        this.marginCalls = margin.data;
        this.loading = false;
        this.refreshing = false;
      },
      error: () => {
        this.error = 'Failed to load account';
        this.loading = false;
        this.refreshing = false;
      }
    });
  }

  loadMarginOnly(): void {
    this.marginLoading = true;
    this.playerService
      .postMarginCalls({
        start_date: this.mcStart,
        end_date: this.mcEnd,
        page: this.mcPage,
        limit: this.mcLimit
      })
      .subscribe({
        next: (res) => {
          this.marginLoading = false;
          if (res.code === 0) this.marginCalls = res.data;
        },
        error: () => {
          this.marginLoading = false;
        }
      });
  }

  reloadAnalytics(): void {
    this.analyticsRefreshing = true;
    this.playerService
      .postDashboardAnalytics({
        start_date: this.analyticsStart,
        end_date: this.analyticsEnd
      })
      .subscribe({
        next: (res) => {
          this.analyticsRefreshing = false;
          if (res.code === 0) this.analytics = res.data;
        },
        error: () => {
          this.analyticsRefreshing = false;
        }
      });
  }

  onMcDatesApply(): void {
    this.mcPage = 1;
    this.loadMarginOnly();
  }

  onMcLimitChange(): void {
    this.mcPage = 1;
    this.loadMarginOnly();
  }

  prevMcPage(): void {
    if (this.mcPage <= 1) return;
    this.mcPage--;
    this.loadMarginOnly();
  }

  nextMcPage(): void {
    const tp = this.marginCalls?.total_pages ?? 1;
    if (this.mcPage >= tp) return;
    this.mcPage++;
    this.loadMarginOnly();
  }

  refresh(): void {
    if (this.refreshing) return;
    this.loadAll(true);
  }

  get profile() {
    return this.summary?.player_profile ?? null;
  }
  get wallet() {
    return this.summary?.wallet_info ?? null;
  }
  get margin() {
    return this.summary?.margin_info ?? null;
  }
  get trading() {
    return this.analytics?.trading_summary ?? null;
  }
  get pnl() {
    return this.analytics?.pnl_summary ?? null;
  }

  get avgTradePl(): number | null {
    const t = this.trading?.total_trades;
    const p = this.pnl?.realized_total;
    if (t == null || t <= 0 || p == null || !Number.isFinite(p)) return null;
    return p / t;
  }

  get marginHealthLabel(): string {
    const c = this.marginHealthClass;
    if (c === 'safe') return 'Healthy margin';
    if (c === 'warn') return 'Elevated risk';
    return 'Critical margin';
  }

  get marginRows(): MarginCallRow[] {
    return this.marginCalls?.data ?? [];
  }

  get winLossBar(): { winPct: number; lossPct: number; wins: number; losses: number } {
    const t = this.trading;
    if (!t) return { winPct: 0, lossPct: 0, wins: 0, losses: 0 };
    const w = Math.max(0, Number(t.win_trades) || 0);
    const l = Math.max(0, Number(t.loss_trades) || 0);
    const sum = w + l;
    if (sum <= 0) return { winPct: 0, lossPct: 100, wins: 0, losses: 0 };
    const winPct = (w / sum) * 100;
    return { winPct, lossPct: 100 - winPct, wins: w, losses: l };
  }

  get reservedOfBalancePct(): number {
    const w = this.wallet;
    if (!w) return 0;
    const b = Number(w.balance);
    const r = Number(w.reserved);
    if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(r) || r <= 0) return 0;
    return Math.min(100, (r / b) * 100);
  }

  get marginHealthClass(): string {
    const u = this.margin?.used_margin ?? 0;
    const e = this.margin?.equity ?? 0;
    if (u <= 0) return 'safe';
    const ratio = e / u;
    if (ratio >= 2) return 'safe';
    if (ratio >= 1) return 'warn';
    return 'danger';
  }

  formatDate(d: string): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  formatDateTime(d: string): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  getStatusLabel(id: number): string {
    if (id === 1) return 'Active';
    if (id === 0) return '—';
    return 'Inactive';
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }

  exactNum(v: number | null | undefined, maxFrac = 6): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: maxFrac
    });
  }

  intFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return Math.round(v).toLocaleString(undefined);
  }

  pctFmt(v: number | null | undefined, digits = 1): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  plClass(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '';
    if (v > 0) return 'pos';
    if (v < 0) return 'neg';
    return 'neutral';
  }

  signedBrand(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const formatted = this.sharedService.formatToBrandCurrency(v);
    if (v > 0) return '+' + formatted;
    return formatted;
  }

  alertTypeLabel(t: string): string {
    return t.replace(/_/g, ' ');
  }

  async copyEmail(): Promise<void> {
    const e = this.profile?.email;
    if (!e) return;
    try {
      await navigator.clipboard.writeText(e);
      this.flashCopy('Email copied');
    } catch {
      this.flashCopy('Could not copy');
    }
  }

  private flashCopy(msg: string): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyFeedback = msg;
    this.copyTimer = setTimeout(() => {
      this.copyFeedback = null;
      this.copyTimer = null;
    }, 2000);
  }

  onLogout(): void {
    this.auth.logout();
  }
}

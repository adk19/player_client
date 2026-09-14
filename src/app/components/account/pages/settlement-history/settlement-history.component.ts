import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  PlayerService,
  SettlementHistoryFilter,
  SettlementHistoryRow,
  SettlementHistoryTotals
} from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-settlement-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settlement-history.component.html',
  styleUrls: ['./settlement-history.component.scss']
})
export class SettlementHistoryComponent implements OnInit {
  loading = true;
  error: string | null = null;
  rows: SettlementHistoryRow[] = [];
  totals: SettlementHistoryTotals | null = null;
  total = 0;
  totalPages = 1;
  currentPage = 1;

  filterDateFrom = '';
  filterDateTo = '';
  limit = 25;
  page = 1;

  constructor(
    private playerService: PlayerService,
    private route: ActivatedRoute,
    private router: Router,
    public sharedService: SharedService
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['dateFrom']) this.filterDateFrom = String(params['dateFrom']);
      if (params['dateTo']) this.filterDateTo = String(params['dateTo']);
      this.page = 1;
      this.load();
    });
  }

  load(): void {
    this.loading = true;
    this.error = null;

    const filter: SettlementHistoryFilter = { page: this.page, limit: this.limit };
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;

    this.playerService.getSettlementHistory(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.rows = res.rows;
          this.totals = res.totals;
          this.total = res.total_count;
          this.currentPage = res.page > 0 ? res.page : this.page;
          const pagesFromApi = res.total_pages;
          this.totalPages = pagesFromApi > 0
            ? pagesFromApi
            : Math.max(1, Math.ceil(this.total / this.limit));
        } else {
          this.error = res.message || 'Failed to load settlement history';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load settlement history';
        this.loading = false;
      }
    });
  }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  onLimitChange(): void {
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.page = 1;
    this.load();
  }

  refresh(): void {
    this.page = 1;
    this.load();
  }

  goBack(): void {
    this.router.navigate(['/account/settlement'], {
      queryParams: {
        dateFrom: this.filterDateFrom || null,
        dateTo: this.filterDateTo || null
      }
    });
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.page = Math.max(1, this.page - 1);
    this.load();
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.page += 1;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.page = page;
    this.load();
  }

  pageNumbersForView(): (number | 'ellipsis')[] {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 1) return [1];
    if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);

    const set = new Set<number>([1, total]);
    for (let i = current - 2; i <= current + 2; i++) {
      if (i >= 1 && i <= total) set.add(i);
    }

    const sorted = [...set].sort((a, b) => a - b);
    const out: (number | 'ellipsis')[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i]!;
      if (i > 0 && n - sorted[i - 1]! > 1) out.push('ellipsis');
      out.push(n);
    }
    return out;
  }

  get hasFilters(): boolean {
    return !!(this.filterDateFrom || this.filterDateTo);
  }

  get rangeStart(): number {
    if (this.total === 0) return 0;
    return (this.currentPage - 1) * this.limit + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage * this.limit, this.total);
  }

  settledTypeClass(type: string): string {
    const normalized = (type || '').toUpperCase();
    if (normalized === 'SETTLED') return 'settled';
    if (normalized === 'PARTIAL_SETTLED') return 'partial';
    if (normalized.includes('NET_PAIR')) return 'net-pair';
    return 'default';
  }

  hasNetPending(): boolean {
    return this.totals?.net_pending != null && Number.isFinite(this.totals.net_pending);
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }

  fmtDate(d: string | null | undefined): string {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  enumLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return value.split('_').filter(Boolean).map(part => {
      if (part.length <= 3) return part;
      return part.charAt(0) + part.slice(1).toLowerCase();
    }).join(' ');
  }

  trackByRow(_index: number, row: SettlementHistoryRow): number {
    return row.settlement_id;
  }
}

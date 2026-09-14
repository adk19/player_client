import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ExposureSummaryFilter,
  ExposureSummaryRow,
  ExposureSummaryTotals,
  PlayerService
} from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-exposure-summary',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './exposure-summary.component.html',
  styleUrls: ['./exposure-summary.component.scss']
})
export class ExposureSummaryComponent implements OnInit {
  loading = true;
  error: string | null = null;
  rows: ExposureSummaryRow[] = [];
  totals: ExposureSummaryTotals | null = null;
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
  ) {}

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

    const filter: ExposureSummaryFilter = { page: this.page, limit: this.limit };
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;

    this.playerService.getSettlementExposureSummary(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.rows = res.data?.rows ?? [];
          this.totals = res.data?.totals ?? null;
          this.total = res.data?.total_count ?? 0;
          this.currentPage = res.data?.page > 0 ? res.data.page : this.page;
          const pagesFromApi = res.data?.total_pages ?? 0;
          this.totalPages = pagesFromApi > 0
            ? pagesFromApi
            : Math.max(1, Math.ceil(this.total / this.limit));
        } else {
          this.error = res.message || 'Failed to load exposure summary';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load exposure summary';
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

  amountClass(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '';
    if (value > 0) return 'val-positive';
    if (value < 0) return 'val-negative';
    return 'val-neutral';
  }

  exposureClass(type: string): string {
    const t = (type || '').toUpperCase();
    if (t === 'RECEIVABLE') return 'receivable';
    if (t === 'PAYABLE') return 'payable';
    return '';
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }

  signedFmt(value: number): string {
    const prefix = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${prefix}${this.brandFmt(Math.abs(value))}`;
  }

  absBrandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(Math.abs(v));
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
    return value
      .split('_')
      .filter(Boolean)
      .map(part => {
        if (part.length <= 3) return part;
        return part.charAt(0) + part.slice(1).toLowerCase();
      })
      .join(' ');
  }

  trackByRow(_index: number, row: ExposureSummaryRow): string {
    return `${row.created_at}|${row.exposure_type}|${row.signed_amount}|${row.pending_amount}`;
  }
}

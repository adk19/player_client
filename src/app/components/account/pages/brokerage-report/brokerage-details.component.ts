import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BrokerageDetailsFilter,
  BrokerageDetailsRow,
  BrokerageReportTotals,
  PlayerService
} from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-brokerage-details',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './brokerage-details.component.html',
  styleUrls: ['./brokerage-details.component.scss']
})
export class BrokerageDetailsComponent implements OnInit {
  loading = true;
  error: string | null = null;
  rows: BrokerageDetailsRow[] = [];
  totals: BrokerageReportTotals | null = null;
  brokerName = '';
  brokerId = 0;
  total = 0;
  totalPages = 1;
  currentPage = 1;

  filterSymbol = '';
  filterDateFrom = '';
  filterDateTo = '';
  limit = 20;
  page = 1;

  private symbolTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private playerService: PlayerService,
    public sharedService: SharedService
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.brokerId = Number(params['brokerId']);
      this.brokerName = String(params['broker'] || '');
      this.filterDateFrom = String(params['dateFrom'] || '');
      this.filterDateTo = String(params['dateTo'] || '');

      if (!Number.isFinite(this.brokerId) || this.brokerId <= 0) {
        this.error = 'Invalid broker';
        this.loading = false;
        return;
      }

      this.page = 1;
      this.load();
    });
  }

  load(): void {
    this.loading = true;
    this.error = null;

    const filter: BrokerageDetailsFilter = {
      broker_id: this.brokerId,
      page: this.page,
      limit: this.limit
    };
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;
    if (this.filterSymbol.trim()) filter.symbol = this.filterSymbol.trim().toUpperCase();

    this.playerService.getBrokerageReportDetails(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.rows = res.data?.rows ?? [];
          this.totals = res.data?.totals ?? null;
          if (res.data?.broker?.broker_username) {
            this.brokerName = res.data.broker.broker_username;
          }
          this.total = res.data?.total_count ?? 0;
          this.currentPage = res.data?.page > 0 ? res.data.page : this.page;
          const pagesFromApi = res.data?.total_pages ?? 0;
          this.totalPages = pagesFromApi > 0 ? pagesFromApi : Math.max(1, Math.ceil(this.total / this.limit));
        } else {
          this.error = res.message || 'Failed to load brokerage details';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load brokerage details';
        this.loading = false;
      }
    });
  }

  onSymbolChange(): void {
    if (this.symbolTimer) clearTimeout(this.symbolTimer);
    this.symbolTimer = setTimeout(() => {
      this.page = 1;
      this.load();
    }, 400);
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
    this.filterSymbol = '';
    this.page = 1;
    this.load();
  }

  clearAllFilters(): void {
    this.filterSymbol = '';
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
    this.router.navigate(['/account/brokerage'], {
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
    return !!(this.filterSymbol || this.filterDateFrom || this.filterDateTo);
  }

  get rangeStart(): number {
    if (this.total === 0) return 0;
    return (this.currentPage - 1) * this.limit + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage * this.limit, this.total);
  }

  get pageAmountTotal(): number {
    return this.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
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
    return value.split('_').filter(Boolean)
      .map(part => part.length <= 3 ? part : part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
  }

  trackByRow(_index: number, row: BrokerageDetailsRow): string {
    return `${row.symbol}|${row.created_at}|${row.amount}|${row.deduction_timing}`;
  }
}

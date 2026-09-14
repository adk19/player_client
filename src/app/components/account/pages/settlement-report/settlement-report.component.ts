import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  PlayerService,
  SettlementReportFilter,
  SettlementReportRow,
  SettlementReportTotals
} from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-settlement-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settlement-report.component.html',
  styleUrls: ['./settlement-report.component.scss']
})
export class SettlementReportComponent implements OnInit {
  loading = true;
  error: string | null = null;
  row: SettlementReportRow | null = null;
  totals: SettlementReportTotals | null = null;

  filterDateFrom = '';
  filterDateTo = '';

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
      this.load();
    });
  }

  load(): void {
    this.loading = true;
    this.error = null;

    const filter: SettlementReportFilter = { page: 0, limit: 10 };
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;

    this.playerService.getSettlementReport(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          const rows = res.data?.net?.rows ?? [];
          this.row = rows.length ? rows[0]! : null;
          this.totals = res.data?.totals ?? null;
        } else {
          this.error = res.message || 'Failed to load settlement report';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load settlement report';
        this.loading = false;
      }
    });
  }

  onFilterChange(): void {
    this.load();
  }

  clearFilters(): void {
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.load();
  }

  refresh(): void {
    this.load();
  }

  get hasFilters(): boolean {
    return !!(this.filterDateFrom || this.filterDateTo);
  }

  private dateQueryParams(): Record<string, string | null> {
    return {
      dateFrom: this.filterDateFrom || null,
      dateTo: this.filterDateTo || null
    };
  }

  openExposureSummary(): void {
    this.router.navigate(['/account/exposure'], { queryParams: this.dateQueryParams() });
  }

  openTradeHistory(): void {
    this.router.navigate(['/account/trade-history'], { queryParams: this.dateQueryParams() });
  }

  openSettlementHistory(): void {
    this.router.navigate(['/account/settlement-history'], { queryParams: this.dateQueryParams() });
  }

  amountClass(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '';
    if (value > 0) return 'val-positive';
    if (value < 0) return 'val-negative';
    return 'val-neutral';
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }

  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
}

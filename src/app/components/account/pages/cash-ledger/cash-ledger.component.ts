import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CashLedgerEntry,
  CashLedgerFilter,
  CashLedgerSummary,
  PlayerService
} from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

type SelectOption = { value: string; label: string };

@Component({
  selector: 'app-cash-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cash-ledger.component.html',
  styleUrls: ['./cash-ledger.component.scss']
})
export class CashLedgerComponent implements OnInit {
  loading = true;
  error: string | null = null;
  entries: CashLedgerEntry[] = [];
  summary: CashLedgerSummary | null = null;
  isPageSummary = false;
  total = 0;
  totalPages = 1;
  currentPage = 1;

  filterReference = '';
  filterTransactionType: string | null = null;
  filterDirection: string | null = null;
  filterDateFrom = '';
  filterDateTo = '';
  filterMinAmount: number | null = null;
  filterMaxAmount: number | null = null;
  limit = 25;
  page = 1;

  private referenceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly DIRECTION_OPTIONS: SelectOption[] = [
    { value: 'CREDIT', label: 'Credit' },
    { value: 'DEBIT', label: 'Debit' }
  ];

  readonly TRANSACTION_TYPE_OPTIONS: SelectOption[] = [
    { value: 'DEPOSIT', label: 'Deposit' },
    { value: 'WITHDRAWAL', label: 'Withdrawal' },
    { value: 'TRADE_PNL', label: 'Trade P/L' },
    { value: 'INTRADAY_CHARGE', label: 'Intraday Charge' },
    { value: 'BROKERAGE', label: 'Brokerage' },
    { value: 'SETTLEMENT', label: 'Settlement' },
    { value: 'ADJUSTMENT', label: 'Adjustment' }
  ];

  constructor(
    private playerService: PlayerService,
    public sharedService: SharedService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    const filter: CashLedgerFilter = { page: this.page, limit: this.limit };
    if (this.filterReference.trim()) filter.reference = this.filterReference.trim();
    if (this.filterTransactionType) filter.transaction_type = this.filterTransactionType;
    if (this.filterDirection) filter.direction = this.filterDirection;
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;
    if (this.filterMinAmount != null && Number.isFinite(this.filterMinAmount)) {
      filter.min_amount = this.filterMinAmount;
    }
    if (this.filterMaxAmount != null && Number.isFinite(this.filterMaxAmount)) {
      filter.max_amount = this.filterMaxAmount;
    }

    this.playerService.getCashLedger(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.entries = res.entries;
          this.summary = res.summary;
          this.isPageSummary = res.isPageSummary;
          this.total = res.total_count;
          this.currentPage = res.current_page > 0 ? res.current_page : this.page;
          const pagesFromApi = res.total_pages;
          this.totalPages = pagesFromApi > 0
            ? pagesFromApi
            : Math.max(1, Math.ceil(this.total / this.limit));
        } else {
          this.error = res.message || 'Failed to load cash ledger';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load cash ledger';
        this.loading = false;
      }
    });
  }

  onReferenceChange(): void {
    if (this.referenceTimer) clearTimeout(this.referenceTimer);
    this.referenceTimer = setTimeout(() => {
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
    this.filterReference = '';
    this.filterTransactionType = null;
    this.filterDirection = null;
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterMinAmount = null;
    this.filterMaxAmount = null;
    this.page = 1;
    this.load();
  }

  refresh(): void {
    this.page = 1;
    this.load();
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
    return !!(
      this.filterReference ||
      this.filterTransactionType ||
      this.filterDirection ||
      this.filterDateFrom ||
      this.filterDateTo ||
      this.filterMinAmount != null ||
      this.filterMaxAmount != null
    );
  }

  get rangeStart(): number {
    if (this.total === 0) return 0;
    return (this.currentPage - 1) * this.limit + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage * this.limit, this.total);
  }

  directionClass(direction: string): string {
    const d = (direction || '').toLowerCase();
    return d === 'credit' ? 'credit' : d === 'debit' ? 'debit' : '';
  }

  amountClass(entry: CashLedgerEntry): string {
    return this.directionClass(entry.direction);
  }

  plClass(value: number | null | undefined): string {
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

  transactionTypeLabel(value: string | null | undefined): string {
    if (!value) return '—';
    const match = this.TRANSACTION_TYPE_OPTIONS.find(o => o.value === value);
    if (match) return match.label;
    return this.enumLabel(value);
  }

  referenceLabel(entry: CashLedgerEntry): string {
    if (!entry.reference_type && entry.reference_id == null) return '—';
    const typeLabel = entry.reference_type ? this.enumLabel(entry.reference_type) : 'Reference';
    if (entry.reference_id == null) return typeLabel;
    return `${typeLabel} #${entry.reference_id}`;
  }

  minVal(a: number, b: number): number {
    return Math.min(a, b);
  }
}

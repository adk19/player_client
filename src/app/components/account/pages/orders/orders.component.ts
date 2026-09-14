import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlayerService, PlayerOrder, OrdersFilter } from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss']
})
export class AccountOrdersComponent implements OnInit {
  loading = true;
  error: string | null = null;
  orders: PlayerOrder[] = [];
  total = 0;

  filterSymbol = '';
  filterDateFrom = '';
  filterDateTo = '';
  limit = 50;
  offset = 0;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly ORDER_TYPE_LABELS: Record<number, string> = {
    1: 'Market',
    2: 'Limit'
  };

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

    const filter: OrdersFilter = { limit: this.limit, offset: this.offset };
    if (this.filterSymbol.trim()) filter.symbol = this.filterSymbol.trim().toUpperCase();
    if (this.filterDateFrom) filter.date_from = this.filterDateFrom;
    if (this.filterDateTo) filter.date_to = this.filterDateTo;

    this.playerService.getOrders(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.orders = res.data ?? [];
          this.total = res.total ?? 0;
        } else {
          this.error = res.message || 'Failed to load orders';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load orders';
        this.loading = false;
      }
    });
  }

  onSymbolChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.offset = 0;
      this.load();
    }, 400);
  }

  onFilterChange(): void {
    this.offset = 0;
    this.load();
  }

  onLimitChange(): void {
    this.offset = 0;
    this.load();
  }

  clearFilters(): void {
    this.filterSymbol = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.offset = 0;
    this.load();
  }

  refresh(): void {
    this.offset = 0;
    this.load();
  }

  prevPage(): void {
    if (this.offset <= 0) return;
    this.offset = Math.max(0, this.offset - this.limit);
    this.load();
  }

  nextPage(): void {
    if (this.offset + this.limit >= this.total) return;
    this.offset += this.limit;
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.offset = (page - 1) * this.limit;
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

  get currentPage(): number {
    return Math.floor(this.offset / this.limit) + 1;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get hasFilters(): boolean {
    return !!(this.filterSymbol || this.filterDateFrom || this.filterDateTo);
  }

  orderTypeLabel(order: PlayerOrder): string {
    return this.ORDER_TYPE_LABELS[order.order_type_id] || `Type ${order.order_type_id}`;
  }

  statusLabel(order: PlayerOrder): string {
    return this.formatEnumLabel(order.order_status);
  }

  statusClass(order: PlayerOrder): string {
    const key = (order.order_status || '').toLowerCase().replace(/-/g, '_');
    const map: Record<string, string> = {
      pending: 'pending',
      filled: 'filled',
      partially_filled: 'partial',
      cancelled: 'cancelled',
      rejected: 'rejected',
      expired: 'expired'
    };
    return map[key] || 'pending';
  }

  sideLabel(order: PlayerOrder): string {
    return order.side || (order.side_id === 1 ? 'BUY' : order.side_id === 2 ? 'SELL' : '—');
  }

  sideClass(order: PlayerOrder): string {
    const side = this.sideLabel(order).toLowerCase();
    return side === 'buy' ? 'buy' : side === 'sell' ? 'sell' : '';
  }

  closeReasonLabel(reason: string | null | undefined): string {
    if (!reason) return '—';
    return this.enumLabel(reason);
  }

  enumLabel(value: string | null | undefined): string {
    if (!value) return '—';
    return this.formatEnumLabel(value);
  }

  plClass(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '';
    if (value > 0) return 'pl-positive';
    if (value < 0) return 'pl-negative';
    return 'pl-neutral';
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

  minVal(a: number, b: number): number {
    return Math.min(a, b);
  }

  private formatEnumLabel(value: string): string {
    return value
      .split('_')
      .filter(Boolean)
      .map(part => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }
}

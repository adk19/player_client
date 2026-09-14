import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssetPosition, AssetsData, AssetsFilter, PlayerService } from '../../../../services/player.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-assets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assets.component.html',
  styleUrls: ['./assets.component.scss']
})
export class AssetsComponent implements OnInit {
  loading = true;
  error: string | null = null;
  data: AssetsData | null = null;

  // Filters
  filterSymbol = '';
  filterType: number | null = null;
  limit = 50;
  offset = 0;

  // Search debounce
  private searchTimer: any;

  constructor(
    private playerService: PlayerService,
    public sharedService: SharedService
  ) { }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const filter: AssetsFilter = { limit: this.limit, offset: this.offset };
    if (this.filterSymbol.trim()) filter.symbol = this.filterSymbol.trim().toUpperCase();
    if (this.filterType !== null) filter.position_type_id = this.filterType;

    this.playerService.getAssets(filter).subscribe({
      next: (res) => {
        if (res.code === 0) {
          this.data = res.data;
        } else {
          this.error = res.message || 'Failed to load assets';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load assets';
        this.loading = false;
      }
    });
  }

  onSearchChange(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.offset = 0; this.load(); }, 400);
  }

  onTypeChange(val: number | null): void {
    this.filterType = val;
    this.offset = 0;
    this.load();
  }

  refresh(): void { this.offset = 0; this.load(); }

  get wallet() { return this.data?.wallet ?? null; }
  get margin() { return this.data?.margin ?? null; }
  get positions(): AssetPosition[] { return this.data?.open_positions ?? []; }

  get buyCount(): number { return this.positions.filter(p => p.position_type_id === 1).length; }
  get sellCount(): number { return this.positions.filter(p => p.position_type_id === 2).length; }
  get totalPnl(): number { return this.positions.reduce((s, p) => s + (p.unrealized_pl ?? 0), 0); }
  get totalMarginUsed(): number { return this.positions.reduce((s, p) => s + (p.margin_used ?? 0), 0); }

  get marginLevelClass(): string {
    const ml = this.margin?.margin_level ?? 0;
    if (ml >= 200) return 'safe';
    if (ml >= 100) return 'warn';
    return 'danger';
  }

  get walletUtilPct(): number {
    const w = this.wallet;
    if (!w || !w.balance) return 0;
    return Math.min(100, Math.round((w.reserved / w.balance) * 100));
  }

  get marginUsedPct(): number {
    const m = this.margin;
    if (!m || !m.total_balance) return 0;
    return Math.min(100, Math.round((m.used_margin / m.total_balance) * 100));
  }

  positionSide(p: AssetPosition): string {
    return p.position_type_id === 1 ? 'BUY' : 'SELL';
  }

  positionPnlClass(p: AssetPosition): string {
    return p.unrealized_pl >= 0 ? 'pos' : 'neg';
  }

  fmt(v: number | null | undefined, dec = 2): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  fmtDate(d: string): string {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
  }

  brandFmt(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    return this.sharedService.formatToBrandCurrency(v);
  }
}

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import type {
  PlayerDetailsLeverageInstrument,
  PlayerDetailsLeverageMarketType,
  PlayerDetailsPayload
} from '../../../../services/player-details.models';
import { PlayerDetailsService } from '../../../../services/player-details.service';
import { SharedService } from '../../../../shared/services/shared.service';
import {
  type DetailRow,
  buildBrokerageRows,
  buildChargesRows,
  buildMarginRows,
  buildPermissionRows,
  buildPlayerRows,
  buildRiskRows,
  buildWalletRows,
  enumLabel,
  hasLeverageInstruments,
  hasLeverageMarketTypes,
  marginUtilizationPercent,
  winRatePercent
} from './account-details.helpers';

@Component({
  selector: 'app-account-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-details.component.html',
  styleUrl: './account-details.component.scss'
})
export class AccountDetailsComponent implements OnInit, OnDestroy {
  data: PlayerDetailsPayload | null = null;
  loading = false;
  error: string | null = null;

  private sub?: Subscription;

  constructor(
    readonly playerDetails: PlayerDetailsService,
    readonly shared: SharedService
  ) { }

  ngOnInit(): void {
    this.sub = this.playerDetails.details$.subscribe((details) => {
      this.data = details;
      if (details) {
        this.error = null;
      }
    });
    if (!this.playerDetails.details) {
      this.reload();
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  reload(): void {
    this.loading = true;
    this.error = null;
    this.playerDetails.refresh().pipe(finalize(() => (this.loading = false)))
      .subscribe((details) => {
        if (!details) {
          this.error = this.playerDetails.lastError || 'Unable to load details.';
        }
      });
  }

  get showContent(): boolean {
    return !!this.data && !this.error;
  }

  get showInitialLoading(): boolean {
    return this.loading && !this.data;
  }

  winRate(): number | null {
    if (!this.data) return null;
    return winRatePercent(this.data.statistics.winning_trades, this.data.statistics.total_trades);
  }

  marginUtilization(): number | null {
    if (!this.data) return null;
    return marginUtilizationPercent(
      this.data.margin_summary.used_margin,
      this.data.margin_summary.total_balance
    );
  }

  playerRows(): DetailRow[] {
    return this.data ? buildPlayerRows(this.data.player_info) : [];
  }

  walletRows(): DetailRow[] {
    return this.data ? buildWalletRows(this.data.wallet, (value) => this.money(value)) : [];
  }

  marginRows(): DetailRow[] {
    return this.data
      ? buildMarginRows(this.data.margin_summary, (value) => this.money(value), (value) => this.plClass(value))
      : [];
  }

  chargesRows(): DetailRow[] {
    return this.data
      ? buildChargesRows(this.data.trading_charges, (value) => this.money(value))
      : [];
  }

  brokerageRows(): DetailRow[] {
    return this.data ? buildBrokerageRows(this.data.brokerage_config) : [];
  }

  riskRows(): DetailRow[] {
    return this.data
      ? buildRiskRows(this.data.player_risk_config, (value) => this.money(value))
      : [];
  }

  permissionRows(): DetailRow[] {
    return this.data ? buildPermissionRows(this.data.player_trading_permissions) : [];
  }

  hasInstruments(): boolean {
    return hasLeverageInstruments(this.data);
  }

  hasMarketTypes(): boolean {
    return hasLeverageMarketTypes(this.data);
  }

  statusClass(status: string | null | undefined): string {
    const normalized = (status || '').trim().toUpperCase();
    if (normalized === 'ACTIVE' || normalized === 'APPROVED' || normalized === 'ENABLED') {
      return 'det-status--active';
    }
    if (normalized === 'INACTIVE' || normalized === 'SUSPENDED' || normalized === 'BLOCKED') {
      return 'det-status--inactive';
    }
    return 'det-status--neutral';
  }

  booleanClass(value: string): string {
    if (value === 'Yes') return 'det-val--yes';
    if (value === 'No') return 'det-val--no';
    return '';
  }

  money(value: number | null | undefined): string {
    if (value == null || Number.isNaN(Number(value))) return '—';
    return this.shared.formatToBrandCurrency(Number(value));
  }

  plClass(value: number | null | undefined): string {
    if (value == null || Number.isNaN(Number(value))) return '';
    if (value > 0) return 'text-success';
    if (value < 0) return 'text-danger';
    return '';
  }

  fmtPercent(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  fmtDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  typeLabel(value: string | null | undefined): string {
    return enumLabel(value);
  }

  trackInst(_index: number, row: PlayerDetailsLeverageInstrument): string {
    return row.symbol;
  }

  trackMt(_index: number, row: PlayerDetailsLeverageMarketType): number {
    return row.market_type_id;
  }

  trackRow(_index: number, row: DetailRow): string {
    return row.label;
  }
}

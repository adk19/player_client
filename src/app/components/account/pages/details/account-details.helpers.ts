import type {
  PlayerDetailsBrokerageConfig,
  PlayerDetailsMarginSummary,
  PlayerDetailsPayload,
  PlayerDetailsPlayerInfo,
  PlayerDetailsRiskConfig,
  PlayerDetailsTradingCharges,
  PlayerDetailsTradingPermissions,
  PlayerDetailsWallet
} from '../../../../services/player-details.models';

export interface DetailRow {
  label: string;
  value: string;
  highlight?: boolean;
  valueClass?: string;
}

type ValueKind = 'money' | 'percent' | 'boolean' | 'number' | 'text';

interface FieldSpec<K extends string> {
  key: K;
  label: string;
  kind: ValueKind;
}

const RISK_FIELDS: FieldSpec<keyof PlayerDetailsRiskConfig>[] = [
  { key: 'max_open_positions', label: 'Max open positions', kind: 'number' },
  { key: 'total_exposure_limit', label: 'Total exposure limit', kind: 'money' },
  { key: 'max_script_exposure', label: 'Max script exposure', kind: 'money' },
  { key: 'order_limit_percent', label: 'Order limit', kind: 'percent' },
  { key: 'max_loss_cap', label: 'Max loss cap', kind: 'money' },
  { key: 'max_profit_cap', label: 'Max profit cap', kind: 'money' },
  { key: 'm2m_loss_limit', label: 'M2M loss limit', kind: 'money' },
  { key: 'm2m_profit_limit', label: 'M2M profit limit', kind: 'money' },
  { key: 'loss_streak_limit', label: 'Loss streak limit', kind: 'number' },
  { key: 'hedge_allowed', label: 'Hedging allowed', kind: 'boolean' },
  { key: 'm2m_linked_ledger', label: 'M2M linked to ledger', kind: 'boolean' }
];

const PERMISSION_FIELDS: FieldSpec<keyof PlayerDetailsTradingPermissions>[] = [
  { key: 'min_trade_size', label: 'Min trade size', kind: 'number' },
  { key: 'max_trade_size', label: 'Max trade size', kind: 'number' },
  { key: 'max_open_lots', label: 'Max open lots', kind: 'number' },
  { key: 'max_trades_per_day', label: 'Max trades per day', kind: 'number' },
  { key: 'stop_loss_allowed', label: 'Stop loss', kind: 'boolean' },
  { key: 'take_profit_allowed', label: 'Take profit', kind: 'boolean' },
  { key: 'rollover_enabled', label: 'Rollover', kind: 'boolean' }
];

export function enumLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.split('_').filter(Boolean).map((part) => (part.length <= 3 ? part : part.charAt(0) + part.slice(1).toLowerCase())).join(' ');
}

export function winRatePercent(winning: number, total: number): number | null {
  if (!Number.isFinite(winning) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return (winning / total) * 100;
}

export function marginUtilizationPercent(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (used / total) * 100));
}

export function buildPlayerRows(player: PlayerDetailsPlayerInfo): DetailRow[] {
  return [
    { label: 'Username', value: player.username || '—' },
    { label: 'Email', value: player.email || '—' },
    { label: 'Phone', value: player.phone?.trim() || '—' },
    { label: 'Status', value: enumLabel(player.status) },
    { label: 'Parent', value: player.parent_user?.trim() || '—' },
    { label: 'Member since', value: formatDateTime(player.created_at) },
    { label: 'Last login', value: formatDateTime(player.last_login) }
  ];
}

export function buildWalletRows(
  wallet: PlayerDetailsWallet,
  formatMoney: (value: number) => string
): DetailRow[] {
  return [
    { label: 'Balance', value: formatMoney(wallet.balance) },
    { label: 'Reserved', value: formatMoney(wallet.reserved) },
    { label: 'Available', value: formatMoney(wallet.available), highlight: true }
  ];
}

export function buildMarginRows(
  margin: PlayerDetailsMarginSummary,
  formatMoney: (value: number) => string,
  plClass: (value: number) => string
): DetailRow[] {
  return [
    { label: 'Used margin', value: formatMoney(margin.used_margin) },
    { label: 'Available margin', value: formatMoney(margin.available_margin) },
    { label: 'Total balance', value: formatMoney(margin.total_balance) },
    { label: 'Total exposure', value: formatMoney(margin.total_exposure) },
    {
      label: 'Unrealized P/L',
      value: formatMoney(margin.unrealized_pnl),
      valueClass: plClass(margin.unrealized_pnl)
    }
  ];
}

export function buildChargesRows(
  charges: PlayerDetailsTradingCharges,
  formatMoney: (value: number) => string
): DetailRow[] {
  const symbolCount = Array.isArray(charges.symbol_charges) ? charges.symbol_charges.length : 0;
  return [
    { label: 'Default charge mode', value: enumLabel(charges.default_charge_mode) },
    { label: 'Per lot rate', value: formatPercent(charges.default_per_lot_percent) },
    { label: 'Fixed charge', value: formatMoney(charges.default_fix_charge) },
    { label: 'Symbol overrides', value: symbolCount > 0 ? `${symbolCount} configured` : 'None' }
  ];
}

export function buildBrokerageRows(config: PlayerDetailsBrokerageConfig): DetailRow[] {
  const rows: DetailRow[] = [
    { label: 'Brokerage rate', value: formatNumber(config.value, 4) }
  ];

  if (config.brokerage_type?.trim()) {
    rows.push({ label: 'Brokerage type', value: enumLabel(config.brokerage_type) });
  }
  if (config.deduction_time?.trim()) {
    rows.push({ label: 'Deduction timing', value: enumLabel(config.deduction_time) });
  }

  return rows;
}

export function buildRiskRows(
  risk: PlayerDetailsRiskConfig,
  formatMoney: (value: number) => string
): DetailRow[] {
  const rows = RISK_FIELDS.map((field) => ({
    label: field.label,
    value: formatFieldValue(risk[field.key], field.kind, formatMoney)
  }));

  rows.push({
    label: 'M2M ban',
    value: formatBanLimit(risk.m2m_ban_value, risk.m2m_ban_unit)
  });
  rows.push({
    label: 'Max cap ban',
    value: formatBanLimit(risk.max_cap_ban_value, risk.max_cap_ban_unit)
  });

  return rows;
}

export function buildPermissionRows(permissions: PlayerDetailsTradingPermissions): DetailRow[] {
  return PERMISSION_FIELDS.map((field) => ({
    label: field.label,
    value: formatFieldValue(permissions[field.key], field.kind, () => '—')
  }));
}

export function hasLeverageInstruments(data: PlayerDetailsPayload | null): boolean {
  return (data?.leverage_plan.instruments?.length ?? 0) > 0;
}

export function hasLeverageMarketTypes(data: PlayerDetailsPayload | null): boolean {
  return (data?.leverage_plan.market_types?.length ?? 0) > 0;
}

function formatFieldValue(
  raw: unknown,
  kind: ValueKind,
  formatMoney: (value: number) => string
): string {
  if (raw === null || raw === undefined) return '—';

  if (kind === 'boolean') {
    return raw ? 'Yes' : 'No';
  }
  if (kind === 'money') {
    const amount = Number(raw);
    return Number.isFinite(amount) ? formatMoney(amount) : '—';
  }
  if (kind === 'percent') {
    return formatPercent(Number(raw));
  }
  if (kind === 'number') {
    const num = Number(raw);
    return Number.isFinite(num) ? num.toLocaleString() : '—';
  }

  const text = String(raw).trim();
  return text || '—';
}

function formatBanLimit(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  const unitLabel = unit?.trim() ? enumLabel(unit) : '';
  return unitLabel ? `${value.toLocaleString()} ${unitLabel}` : value.toLocaleString();
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

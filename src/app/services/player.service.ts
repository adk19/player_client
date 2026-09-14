import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { urlConstant } from '../shared/constant/urlConstant';
import { ExchangeRate } from '../shared/services/shared.service';

export interface PlayerProfile {
  id: number;
  username: string;
  email: string;
  phone: string;
  status_id: number;
  created_at: string;
  parent_user_id?: number;
}

export interface WalletInfo {
  balance: number;
  reserved: number;
  available: number;
  credit_limit: number;
  lifetime_deposits: number;
  lifetime_withdrawals: number;
}

export interface MarginInfo {
  equity: number;
  used_margin: number;
  margin_level: number | null;
  summary_raw: {
    player_id: number;
    used_margin: number;
    total_balance: number;
    total_exposure: number;
    unrealized_pnl: number;
    available_margin: number;
    last_calculated_at: string;
  };
}

export interface TradingSummary {
  win_rate: number;
  win_trades: number;
  loss_trades: number;
  total_trades: number;
  /** Present on full dashboard payloads */
  most_traded_symbols?: Array<{ symbol: string; trades: number }>;
  /** Present on GET /api/player/profile trading_summary */
  best_trade?: number;
  worst_trade?: number;
  avg_trade_pl?: number;
  total_realized_pl?: number;
}

export interface TradeHighlight {
  id: number;
  symbol: string;
  closed_at: string;
  realized_pl: number;
}

export interface PnlSummary {
  by_symbol: Array<{ symbol: string; realized_pnl: number }>;
  best_trade?: TradeHighlight | null;
  worst_trade?: TradeHighlight | null;
  realized_total: number;
}

/** GET /player/dashboard/summary */
export interface DashboardSummaryData {
  margin_info: MarginInfo;
  wallet_info: WalletInfo;
  player_profile: PlayerProfile;
}

export interface DashboardSummaryResponse {
  code: number;
  message: string;
  data: DashboardSummaryData;
}

export interface DashboardActivityOpenOrder {
  id: number;
  price: number;
  symbol: string;
  quantity: number;
  created_at: string;
  order_type_id: number;
  order_status_id: number;
}

export interface DashboardActivityTrade {
  id: number;
  symbol: string;
  quantity: number;
  closed_at: string;
  exit_price: number;
  entry_price: number;
  realized_pl: number;
  position_type_id: number;
}

export interface DashboardActivityPosition {
  id: number;
  symbol: string;
  quantity: number;
  opened_at: string;
  stop_loss: number | null;
  entry_price: number;
  margin_used: number;
  take_profit: number | null;
  current_price: number;
  leverage_used: number;
  unrealized_pl: number;
  position_type_id: number;
}

export interface DashboardActivityData {
  open_orders: DashboardActivityOpenOrder[];
  recent_trades: DashboardActivityTrade[];
  open_positions: DashboardActivityPosition[];
  recent_transactions: RecentTransaction[];
  open_orders_total: number;
  recent_trades_total: number;
  open_positions_total: number;
  recent_transactions_total: number;
}

export interface DashboardActivityResponse {
  code: number;
  message: string;
  data: DashboardActivityData;
}

export interface DashboardAnalyticsBody {
  start_date: string;
  end_date: string;
}

export interface DashboardAnalyticsData {
  pnl_summary: PnlSummary;
  trading_summary: TradingSummary;
  performance_chart: PerformancePoint[];
}

export interface DashboardAnalyticsResponse {
  code: number;
  message: string;
  data: DashboardAnalyticsData;
}

export interface MarginCallRow {
  id: number;
  alert_type: string;
  created_at: string;
  current_margin_percent: number;
}

export interface MarginCallsBody {
  start_date: string;
  end_date: string;
  page: number;
  limit: number;
}

export interface MarginCallsData {
  data: MarginCallRow[];
  total_count: number;
  total_pages: number;
}

export interface MarginCallsResponse {
  code: number;
  message: string;
  data: MarginCallsData;
}

export interface PerformancePoint {
  date: string;
  realized_pnl: number;
}

export interface RecentTransaction {
  id: number;
  amount: number;
  txn_type: string;
  direction: string;
  created_at: string;
}

/**
 * Payload for GET /api/player/profile (and optional superset for dashboard).
 * Dashboard-only fields are optional so a slim profile response still types.
 */
export interface ProfileApiData {
  success?: boolean;
  player_profile: PlayerProfile;
  wallet_info: WalletInfo;
  trading_summary: TradingSummary;
  date_range?: { start: string; end: string };
  margin_info?: MarginInfo;
  pnl_summary?: PnlSummary;
  open_positions?: any[];
  open_orders?: any[];
  recent_trades?: any[];
  recent_transactions?: RecentTransaction[];
  performance_chart?: PerformancePoint[];
  alerts?: { margin_calls: any[] };
}

/** @deprecated Prefer `ProfileApiData` — kept as alias for existing imports */
export type DashboardData = ProfileApiData;

export interface ProfileResponse {
  code: number;
  message: string;
  data: ProfileApiData;
}

// Legacy interfaces kept for positions component
export interface PositionHistory {
  position_id: number;
  player_id: number;
  market: string;
  position_type_id: number;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  leverage_used: number;
  margin_used: number;
  realized_pl: number;
  close_reason: string;
  opened_at: string;
  closed_at: string;
}

export interface PositionsHistoryResponse {
  code: number;
  message: string;
  totalProfit: number;
  data: PositionHistory[];
  walletData: any[];
}

export interface ExchangeRatesResponse {
  code: number;
  message: string;
  data: ExchangeRate[];
}

// Keep old types for backward compat
export type Profile = PlayerProfile;
export interface OpenPosition { position_id: number; market: string; position_type_id: number; quantity: number; entry_price: number; current_price: number; leverage_used: number; margin_required: number; margin_used: number; unrealized_pl: number; stop_loss: number | null; take_profit: number | null; position_value: number; current_value: number; status: number; squareoff_type_id: number; }
export interface Summary { orders: number; positions: number; trades: number; buy_percentage: number; sell_percentage: number; win_rate: number; }

// Assets interfaces
export interface AssetWallet {
  balance: number;
  reserved: number;
  available: number;
  credit_limit: number;
  lifetime_deposits: number;
  lifetime_withdrawals: number;
}

export interface AssetMargin {
  total_balance: number;
  used_margin: number;
  available_margin: number;
  total_exposure: number;
  unrealized_pnl: number;
  equity: number;
  margin_level: number;
}

export interface AssetPosition {
  id: number;
  symbol: string;
  position_type_id: number;
  quantity: number;
  entry_price: number;
  current_price: number;
  leverage_used: number;
  margin_used: number;
  unrealized_pl: number;
  stop_loss: number | null;
  take_profit: number | null;
  opened_at: string;
}

export interface AssetsData {
  wallet: AssetWallet;
  margin: AssetMargin;
  open_positions: AssetPosition[];
}

export interface AssetsResponse {
  code: number;
  message: string;
  data: AssetsData;
  filters_applied?: any;
}

export interface AssetsFilter {
  limit?: number;
  offset?: number;
  symbol?: string;
  position_type_id?: number;
}

// Orders interfaces
export interface PlayerOrder {
  side: string;
  symbol: string;
  net_pnl: number;
  side_id: number;
  quantity: number;
  turnover: number;
  closed_at: string | null;
  gross_pnl: number;
  opened_at: string;
  exit_price: number | null;
  entry_price: number;
  margin_used: number;
  record_type: string;
  close_reason: string | null;
  order_status: string;
  trading_type: string;
  order_type_id: number;
  brokerage_type: string;
  leverage_ratio: number;
  order_status_id: number;
  trading_charges: number;
  trading_type_id: number;
  brokerage_charged: number;
  brokerage_percent: number;
  brokerage_type_id: number;
  trading_charge_mode: string;
  trading_charges_percent: number;
}

export interface OrdersFilter {
  limit?: number;
  offset?: number;
  symbol?: string;
  status_id?: string;
  order_type_id?: string;
  order_side_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface OrdersResponse {
  code: number;
  message: string;
  total: number;
  limit: number;
  offset: number;
  data: PlayerOrder[];
  filters_applied?: any;
}

export interface CashLedgerEntry {
  amount: number;
  username: string;
  direction: string;
  ledger_id: number;
  player_id: number;
  user_type: string;
  created_at: string;
  description: string;
  reference_id: number;
  balance_after: number;
  balance_before: number;
  reference_type: string;
  transaction_type: string;
}

export interface CashLedgerSummary {
  net_change: number;
  debit_count: number;
  credit_count: number;
  total_debits: number;
  total_credits: number;
}

export interface CashLedgerFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
  min_amount?: number;
  max_amount?: number;
  reference?: string;
  transaction_type?: string;
  direction?: string;
}

export interface CashLedgerResponse {
  code: number;
  message: string;
  total_count: number;
  total_pages: number;
  current_page: number;
  data:
  | CashLedgerEntry[]
  | {
    entries?: CashLedgerEntry[];
    summary?: CashLedgerSummary | null;
  };
  player_id?: number;
  filters_applied?: Record<string, unknown>;
}

export interface CashLedgerResult {
  code: number;
  message: string;
  total_count: number;
  total_pages: number;
  current_page: number;
  entries: CashLedgerEntry[];
  summary: CashLedgerSummary | null;
  isPageSummary: boolean;
  player_id?: number;
  filters_applied?: Record<string, unknown>;
}

export interface SettlementReportRow {
  entries: number;
  gross_total: number;
  is_downline: boolean;
  net_pending: number;
  settled_total: number;
  counterparty_id: number;
  counterparty_name: string;
  counterparty_type: string;
  brokerage_amount: number;
  without_brokerage: number;
  with_brokerage: number;
  net_settlement: number;
  settlement_amount: number;
}

export interface SettlementReportTotals {
  net_pending: number;
  payable_pending: number;
  receivable_pending: number;
  settlement_amount: number;
  without_brokerage: number;
  brokerage_amount: number;
  with_brokerage: number;
  net_settlement: number;
}

export interface SettlementReportFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
}

export interface SettlementReportResponse {
  code: number;
  message: string;
  data: {
    net: { rows: SettlementReportRow[] };
    limit: number;
    offset: number;
    totals: SettlementReportTotals;
    total_count: number;
  };
}

export interface ExposureSummaryRow {
  created_at: string;
  exposure_type: string;
  obligation_id: number;
  signed_amount: number;
  pending_amount: number;
  settled_amount: number;
}

export interface ExposureSummaryTotals {
  net_payable: number;
  net_exposure: number;
  net_receivable: number;
}

export interface ExposureSummaryFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
}

export interface ExposureSummaryResponse {
  code: number;
  message: string;
  data: {
    page: number;
    rows: ExposureSummaryRow[];
    limit: number;
    totals: ExposureSummaryTotals;
    total_count: number;
    total_pages: number;
  };
}

export interface SettlementTradeHistoryRow {
  price: number;
  amount: number;
  symbol: string;
  net_pnl: number;
  quantity: number;
  trade_id: number;
  exit_date: string;
  gross_pnl: number;
  player_id: number;
  created_at: string;
  entry_date: string;
  exit_price: number;
  entry_price: number;
  profit_loss: number;
  owner_user_id: number;
  trade_type_id: number;
  owner_username: string;
  player_username: string;
  trading_type_id: number;
  brokerage_amount: number;
  owner_player_net: number;
  profit_loss_type: string;
  owner_player_amount: number;
}

export interface SettlementHistoryRow {
  settlement_id: number;
  player_id: number | null;
  user_id: number | null;
  created_at: string;
  approved_by: number | null;
  amount_settled: number;
  settlement_type: string;
}

export interface SettlementHistoryTotals {
  net_settled: number;
  net_pending?: number | null;
}

export interface SettlementHistoryFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
}

export interface SettlementHistoryResult {
  code: number;
  message: string;
  page: number;
  limit: number;
  rows: SettlementHistoryRow[];
  totals: SettlementHistoryTotals | null;
  total_count: number;
  total_pages: number;
}

export interface SettlementTradeHistoryFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
  symbol?: string;
  profit_loss_type?: string;
}

export interface SettlementTradeHistoryResponse {
  code: number;
  message: string;
  data: {
    page: number;
    rows: SettlementTradeHistoryRow[];
    limit: number;
    symbols: string[];
    total_count: number;
    total_pages: number;
    profit_loss_type: string | null;
  };
}

export interface BrokerageReportRow {
  entries: number;
  broker_id: number;
  broker_user_id: number;
  payable_amount: number;
  broker_username: string;
}

export interface BrokerageReportTotals {
  total_payable: number;
}

export interface BrokerageReportFilter {
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
}

export interface BrokerageReportResponse {
  code: number;
  message: string;
  data: {
    page: number;
    rows: BrokerageReportRow[];
    limit: number;
    totals: BrokerageReportTotals;
    total_count: number;
    total_pages: number;
    effective_player_id?: number;
  };
  filters_applied?: Record<string, unknown>;
}

export interface BrokerageDetailsRow {
  amount: number;
  symbol: string;
  trade_id: number;
  broker_id: number;
  player_id: number;
  created_at: string;
  position_id: number;
  deduction_timing: string;
}

export interface BrokerageDetailsBroker {
  broker_id: number;
  broker_user_id: number;
  broker_username: string;
}

export interface BrokerageDetailsFilter {
  broker_id: number;
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
  symbol?: string;
}

export interface BrokerageDetailsResponse {
  code: number;
  message: string;
  data: {
    page: number;
    rows: BrokerageDetailsRow[];
    limit: number;
    broker: BrokerageDetailsBroker;
    totals: BrokerageReportTotals;
    total_count: number;
    total_pages: number;
    effective_player_id?: number;
  };
  filters_applied?: Record<string, unknown>;
}

export interface PlayerUpdatePasswordBody {
  oldPw: string;
  newPw: string;
}

export interface PlayerUpdatePasswordResponse {
  code: number;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class PlayerService {
  constructor(private http: HttpClient) { }

  getPlayerProfile(): Observable<ProfileResponse> {
    return this.http.get<ProfileResponse>(urlConstant.playerProfile);
  }

  getPositionsHistory(): Observable<PositionsHistoryResponse> {
    return this.http.get<PositionsHistoryResponse>(urlConstant.playerPositionsHistory);
  }

  getExchangeRates(): Observable<ExchangeRatesResponse> {
    return this.http.get<ExchangeRatesResponse>(urlConstant.playerExchangeRates);
  }

  getAssets(filter?: AssetsFilter): Observable<AssetsResponse> {
    return this.http.post<AssetsResponse>(urlConstant.playerAssets, filter ?? { limit: 50, offset: 0 });
  }

  getOrders(filter?: OrdersFilter): Observable<OrdersResponse> {
    return this.http.post<OrdersResponse>(urlConstant.playerOrders, filter ?? { limit: 50, offset: 0 });
  }

  getCashLedger(filter?: CashLedgerFilter): Observable<CashLedgerResult> {
    return this.http.post<unknown>(  urlConstant.playerCashLedger,  filter ?? { page: 1, limit: 25 }
    ).pipe(map((body) => mapCashLedgerResponse(body)));
  }

  getSettlementReport(filter?: SettlementReportFilter): Observable<SettlementReportResponse> {
    return this.http.post<SettlementReportResponse>(
      urlConstant.playerSettlementReport,
      filter ?? { page: 0, limit: 25 }
    );
  }

  getSettlementExposureSummary(filter?: ExposureSummaryFilter): Observable<ExposureSummaryResponse> {
    return this.http.post<ExposureSummaryResponse>(
      urlConstant.playerSettlementExposureSummary,
      filter ?? { page: 1, limit: 25 }
    );
  }

  getSettlementTradeHistory(filter?: SettlementTradeHistoryFilter): Observable<SettlementTradeHistoryResponse> {
    return this.http.post<SettlementTradeHistoryResponse>(
      urlConstant.playerSettlementTradeHistory,
      filter ?? { page: 1, limit: 25 }
    );
  }

  getSettlementHistory(filter?: SettlementHistoryFilter): Observable<SettlementHistoryResult> {
    return this.http.post<unknown>(
      urlConstant.playerSettlementHistory,
      filter ?? { page: 1, limit: 25 }
    ).pipe(
      map((body) => mapSettlementHistoryResponse(body))
    );
  }

  getBrokerageReport(filter?: BrokerageReportFilter): Observable<BrokerageReportResponse> {
    return this.http.post<BrokerageReportResponse>(
      urlConstant.playerBrokerageReport,
      filter ?? { page: 1, limit: 25 }
    );
  }

  getBrokerageReportDetails(filter: BrokerageDetailsFilter): Observable<BrokerageDetailsResponse> {
    return this.http.post<BrokerageDetailsResponse>(
      urlConstant.playerBrokerageReportDetails,
      { page: 1, limit: 25, ...filter }
    );
  }

  getDashboardSummary(): Observable<DashboardSummaryResponse> {
    return this.http.get<DashboardSummaryResponse>(urlConstant.playerDashboardSummary);
  }

  postDashboardActivity(body: { page: number; limit: number }): Observable<DashboardActivityResponse> {
    return this.http.post<DashboardActivityResponse>(urlConstant.playerDashboardActivity, body);
  }

  postDashboardAnalytics(body: DashboardAnalyticsBody): Observable<DashboardAnalyticsResponse> {
    return this.http.post<DashboardAnalyticsResponse>(urlConstant.playerDashboardAnalytics, body);
  }

  postMarginCalls(body: MarginCallsBody): Observable<MarginCallsResponse> {
    return this.http.post<MarginCallsResponse>(urlConstant.playerMarginCalls, body);
  }

  postUpdatePassword(body: PlayerUpdatePasswordBody): Observable<PlayerUpdatePasswordResponse> {
    return this.http.post<PlayerUpdatePasswordResponse>(urlConstant.playerUpdatePassword, body);
  }
}

function mapCashLedgerResponse(body: unknown): CashLedgerResult {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const code = Number(record['code']);
  const message = String(record['message'] ?? '');
  const totalCount = Number(record['total_count'] ?? 0);
  const totalPages = Number(record['total_pages'] ?? 0);
  const currentPage = Number(record['current_page'] ?? 1);
  const entries = extractCashLedgerEntries(record['data']);
  const apiSummary = extractCashLedgerSummary(record['data']);
  const pageSummary = apiSummary ?? (entries.length ? buildCashLedgerPageSummary(entries) : null);

  return {
    code: Number.isFinite(code) ? code : -1,
    message,
    total_count: Number.isFinite(totalCount) ? totalCount : 0,
    total_pages: Number.isFinite(totalPages) ? totalPages : 0,
    current_page: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1,
    entries,
    summary: pageSummary,
    isPageSummary: !apiSummary && pageSummary != null,
    player_id: record['player_id'] != null ? Number(record['player_id']) : undefined,
    filters_applied: record['filters_applied'] && typeof record['filters_applied'] === 'object'
      ? (record['filters_applied'] as Record<string, unknown>)
      : undefined
  };
}

function extractCashLedgerEntries(data: unknown): CashLedgerEntry[] {
  if (Array.isArray(data)) {
    return data.filter(isCashLedgerEntry);
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = (data as Record<string, unknown>)['entries'];
    if (Array.isArray(entries)) {
      return entries.filter(isCashLedgerEntry);
    }
  }
  return [];
}

function extractCashLedgerSummary(data: unknown): CashLedgerSummary | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const summary = (data as Record<string, unknown>)['summary'];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return null;
  }
  const record = summary as Record<string, unknown>;
  return {
    net_change: Number(record['net_change'] ?? 0),
    debit_count: Number(record['debit_count'] ?? 0),
    credit_count: Number(record['credit_count'] ?? 0),
    total_debits: Number(record['total_debits'] ?? 0),
    total_credits: Number(record['total_credits'] ?? 0)
  };
}

function buildCashLedgerPageSummary(entries: CashLedgerEntry[]): CashLedgerSummary {
  let totalCredits = 0;
  let totalDebits = 0;
  let creditCount = 0;
  let debitCount = 0;

  for (const entry of entries) {
    const direction = entry.direction?.trim().toUpperCase();
    if (direction === 'CREDIT') {
      totalCredits += entry.amount;
      creditCount += 1;
    } else if (direction === 'DEBIT') {
      totalDebits += entry.amount;
      debitCount += 1;
    }
  }

  return {
    net_change: totalCredits - totalDebits,
    credit_count: creditCount,
    debit_count: debitCount,
    total_credits: totalCredits,
    total_debits: totalDebits
  };
}

function isCashLedgerEntry(value: unknown): value is CashLedgerEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as CashLedgerEntry).ledger_id === 'number';
}

function mapSettlementHistoryResponse(body: unknown): SettlementHistoryResult {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const data = record['data'] && typeof record['data'] === 'object' && !Array.isArray(record['data'])
    ? (record['data'] as Record<string, unknown>)
    : {};

  const code = Number(record['code']);
  const page = Number(data['page'] ?? 1);
  const limit = Number(data['limit'] ?? 25);
  const totalCount = Number(data['total_count'] ?? 0);
  const totalPages = Number(data['total_pages'] ?? 0);
  const rawRows = Array.isArray(data['rows']) ? data['rows'] : [];
  const rows = rawRows
    .map((row) => mapSettlementHistoryRow(row))
    .filter((row): row is SettlementHistoryRow => row != null);

  return {
    code: Number.isFinite(code) ? code : -1,
    message: String(record['message'] ?? ''),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
    rows,
    totals: extractSettlementHistoryTotals(data['totals']),
    total_count: Number.isFinite(totalCount) ? totalCount : 0,
    total_pages: Number.isFinite(totalPages) ? totalPages : 0
  };
}

function mapSettlementHistoryRow(raw: unknown): SettlementHistoryRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const settlementId = Number(record['settlement_id'] ?? record['settled_id']);
  if (!Number.isFinite(settlementId)) {
    return null;
  }

  const playerIdRaw = record['player_id'];
  const userIdRaw = record['user_id'];
  const approvedByRaw = record['approved_by'];

  return {
    settlement_id: settlementId,
    player_id: playerIdRaw == null ? null : Number(playerIdRaw),
    user_id: userIdRaw == null ? null : Number(userIdRaw),
    created_at: String(record['created_at'] ?? record['settled_at'] ?? ''),
    approved_by: approvedByRaw == null ? null : Number(approvedByRaw),
    amount_settled: Number(record['amount_settled'] ?? record['settled_amount'] ?? 0),
    settlement_type: String(record['settlement_type'] ?? record['settled_type'] ?? '')
  };
}

function extractSettlementHistoryTotals(raw: unknown): SettlementHistoryTotals | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const netSettled = Number(record['net_settled']);
  const netPendingRaw = record['net_pending'];

  if (!Number.isFinite(netSettled) && netPendingRaw == null) {
    return null;
  }

  return {
    net_settled: Number.isFinite(netSettled) ? netSettled : 0,
    net_pending: netPendingRaw == null ? null : Number(netPendingRaw)
  };
}

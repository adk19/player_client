/** GET /player/details — `data` payload (in-memory only via PlayerDetailsService). */

export interface PlayerDetailsWallet {
  balance: number;
  reserved: number;
  available: number;
}

export interface PlayerDetailsStatistics {
  total_pnl: number;
  total_trades: number;
  losing_trades: number;
  open_positions: number;
  total_turnover: number;
  winning_trades: number;
  total_brokerage: number;
}

export interface PlayerDetailsPlayerInfo {
  id: number;
  email: string;
  phone: string;
  status: string;
  username: string;
  created_at: string;
  last_login: string;
  parent_user?: string;
}

export interface PlayerDetailsLeverageInstrument {
  symbol: string;
  instrument_id: number;
  leverage_ratio: number;
}

export interface PlayerDetailsLeverageMarketType {
  name: string;
  leverage_ratio: number;
  market_type_id: number;
}

export interface PlayerDetailsLeveragePlan {
  plan_id: number;
  config_id: number;
  is_custom: boolean;
  plan_code: string;
  description: string;
  instruments: PlayerDetailsLeverageInstrument[];
  market_types: PlayerDetailsLeverageMarketType[];
  effective_from: string;
  leverage_ratio: number;
  stop_out_level: number;
  custom_leverage: unknown;
  margin_call_level: number;
}

export interface PlayerDetailsMarginSummary {
  used_margin: number;
  total_balance: number;
  total_exposure: number;
  unrealized_pnl: number;
  available_margin: number;
}

export interface PlayerDetailsTradingCharges {
  symbol_charges: unknown[];
  default_fix_charge: number;
  default_charge_mode: string;
  default_per_lot_percent: number;
}

export interface PlayerDetailsBrokerageConfig {
  value: number;
  brokerage_type?: string;
  deduction_time?: string;
  brokerage_type_id?: number;
  deduction_timing_id?: number;
}

export interface PlayerDetailsRiskConfig {
  m2m_ban_unit: string;
  max_loss_cap: number;
  hedge_allowed: boolean;
  m2m_ban_value: number;
  m2m_loss_limit: number;
  max_profit_cap: number;
  m2m_profit_limit: number;
  max_cap_ban_unit: string;
  loss_streak_limit: number;
  m2m_linked_ledger: boolean;
  max_cap_ban_value: number;
  max_open_positions: number | null;
  max_script_exposure: number;
  order_limit_percent: number;
  total_exposure_limit: number;
}

export interface PlayerDetailsTradingPermissions {
  max_open_lots: number;
  max_trade_size: number;
  min_trade_size: number;
  trading_type_id: number;
  rollover_enabled: boolean;
  stop_loss_allowed: boolean;
  max_trades_per_day: number;
  take_profit_allowed: boolean;
}

export interface PlayerDetailsPayload {
  wallet: PlayerDetailsWallet;
  statistics: PlayerDetailsStatistics;
  player_info: PlayerDetailsPlayerInfo;
  leverage_plan: PlayerDetailsLeveragePlan;
  margin_summary: PlayerDetailsMarginSummary;
  trading_charges: PlayerDetailsTradingCharges;
  brokerage_config: PlayerDetailsBrokerageConfig;
  player_risk_config: PlayerDetailsRiskConfig;
  player_trading_permissions: PlayerDetailsTradingPermissions;
}

export interface PlayerDetailsApiResponse {
  code: number;
  message: string;
  data: PlayerDetailsPayload;
}

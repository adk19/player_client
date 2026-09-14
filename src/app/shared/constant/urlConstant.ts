import { environment } from "../environment/environment";

export const urlConstant = {
  // Socket URLs
  get BinanceSocket() { return environment.CryptoWebSocketUrl; },
  get Mt5Socket() { return environment.Mt5SocketUrl; },
  get TradingSocketUrl() { return environment.TradingSocketUrl; },
  get WatchlistSocketUrl() { return environment.TradingSocketUrl; },

  // API Base URLs
  get APIBase() { return environment.APIUrl; },
  get CryptoApiBase() { return environment.CryptoApiUrl; },

  // Complete API URLs - Auth
  get login() { return `${environment.APIUrl}login`; },
  get forgotPassword() { return `${environment.APIUrl}forgot-password`; },
  get resetPassword() { return `${environment.APIUrl}reset-password`; },
  configGet: (brandCode: string) => `${environment.APIUrl}config/get/${brandCode}`,

  // Registration & plans
  get planList() { return `${environment.APIUrl}plan/list`; },
  get planDetails() { return `${environment.APIUrl}plan/details`; },
  get playerRegister() { return `${environment.APIUrl}player/register`; },
  get requestOtp() { return `${environment.APIUrl}request-otp`; },
  get verifyOtp() { return `${environment.APIUrl}verify-otp`; },

  // Player Market API - Get mapped markets for player
  get playerMarket() { return `${environment.APIUrl}player/market`; },
  get getPlayerMarkets() { return `${environment.APIUrl}player/getPlayerMarkets`; },

  // Complete API URLs - Crypto Market Data
  get exchangeInfo() { return `${environment.CryptoApiUrl}/exchangeInfo`; },
  mtExchangeInfo: (code: number) => `${environment.CryptoApiUrl}/mtExchangeInfo?code=${code}`,
  ticker24hr: (symbol?: string) => symbol ? `${environment.CryptoApiUrl}/ticker/24hr?symbol=${symbol}` : `${environment.CryptoApiUrl}/ticker/24hr`,
  symbolInfo: (symbol: string) => `${environment.CryptoApiUrl}/symbolInfo?symbol=${symbol}`,
  klines: (symbol: string, interval: string, limit: number, market?: string) =>
    `${environment.CryptoApiUrl}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&market=${encodeURIComponent(market || symbol)}`,
  klinesWithEndTime: (symbol: string, interval: string, endTime: number, limit: number, market?: string) =>
    `${environment.CryptoApiUrl}/klines?symbol=${symbol}&interval=${interval}&endTime=${endTime}&limit=${limit}&market=${encodeURIComponent(market || symbol)}`,
  mtKlines: (symbol: string, interval: string, limit: number, accountId?: number | null) =>
    accountId
      ? `${environment.CryptoApiUrl}/mtKlines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      : `${environment.CryptoApiUrl}/mtKlines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  mtKlinesWithEndTime: (symbol: string, interval: string, endTime: number, limit: number, accountId?: number | null) =>
    accountId
      ? `${environment.CryptoApiUrl}/mtKlines?symbol=${symbol}&interval=${interval}&endTime=${endTime}&limit=${limit}`
      : `${environment.CryptoApiUrl}/mtKlines?symbol=${symbol}&interval=${interval}&endTime=${endTime}&limit=${limit}`,
  depth: (symbol: string, limit: number = 1000) => `${environment.CryptoApiUrl}/depth?symbol=${symbol}&limit=${limit}`,

  // Trade API URLs
  get tradeTakeProfit() { return `${environment.APIUrl}trade/tp`; },
  get tradeStopLoss() { return `${environment.APIUrl}trade/sl`; },

  // Player API URLs
  get playerProfile() { return `${environment.APIUrl}player/profile` },
  /** Full trading profile: wallet, leverage, risk, permissions, etc. */
  get playerDetails() { return `${environment.APIUrl}player/details`; },
  /** POST body: `{ oldPw, newPw }` */
  get playerUpdatePassword() { return `${environment.APIUrl}player/up`; },
  get playerPositionsHistory() { return `${environment.APIUrl}player/positions` },
  get playerExchangeRates() { return `${environment.APIUrl}player/exchangeRates`; },
  get playerAssets() { return `${environment.APIUrl}player/assets`; },
  get playerOrders() { return `${environment.APIUrl}player/orders`; },
  get playerCashLedger() { return `${environment.APIUrl}player/cash/ledger`; },
  get playerSettlementReport() { return `${environment.APIUrl}player/settlement/report`; },
  get playerSettlementExposureSummary() { return `${environment.APIUrl}player/settlement/exposureSummary`; },
  get playerSettlementTradeHistory() { return `${environment.APIUrl}player/settlement/tradeHistory`; },
  get playerSettlementHistory() { return `${environment.APIUrl}player/settlement/history`; },
  get playerBrokerageReport() { return `${environment.APIUrl}player/brokerage/report`; },
  get playerBrokerageReportDetails() { return `${environment.APIUrl}player/brokerage/report/details`; },
  get playerDashboardSummary() { return `${environment.APIUrl}player/dashboard/summary`; },
  get playerDashboardActivity() { return `${environment.APIUrl}player/dashboard/activity`; },
  get playerDashboardAnalytics() { return `${environment.APIUrl}player/dashboard/analytics`; },
  get playerMarginCalls() { return `${environment.APIUrl}player/margin/calls`; },

  /** Payment */
  get paymentConfig() { return `${environment.APIUrl}payment/config`; },
  get paymentConvert() { return `${environment.APIUrl}payment/convert`; },
  get paymentDeposit() { return `${environment.APIUrl}payment/deposit`; },
  get paymentDepositList() { return `${environment.APIUrl}payment/deposit/list`; },
  get paymentDepositCancel() { return `${environment.APIUrl}payment/deposit/cancel`; },
  get paymentPayout() { return `${environment.APIUrl}payment/payout`; },
  get paymentPayoutSave() { return `${environment.APIUrl}payment/payout/save`; },
  get paymentPayoutUpdate() { return `${environment.APIUrl}payment/payout/update`; },
  paymentPayoutDelete: (payoutId: number) => `${environment.APIUrl}payment/payout/delete/${payoutId}`,
  get paymentWithdraw() { return `${environment.APIUrl}payment/withdraw`; },
  get paymentWithdrawList() { return `${environment.APIUrl}payment/withdraw/list`; },
  get paymentWithdrawCancel() { return `${environment.APIUrl}payment/withdraw/cancel`; },

  /** Player KYC */
  get kycPlatformAndLevel() { return `${environment.APIUrl}kyc/platformAndLevel`; },
  get kycCountries() { return `${environment.APIUrl}kyc/countries`; },
  get kycDocList() { return `${environment.APIUrl}kyc/doclist`; },
  get kycSendEmailOtp() { return `${environment.APIUrl}kyc/sendEmailOtp`; },
  get kycVerifyEmailOtp() { return `${environment.APIUrl}kyc/verifyEmailOtp`; },
  get kycCustomVerification() { return `${environment.APIUrl}kyc/customVerification`; },

  // API Key endpoint
  get apiKey() { return `${environment.APIUrl}key` }
};

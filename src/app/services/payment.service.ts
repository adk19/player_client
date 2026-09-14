import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  ConfirmWithdrawPayload
} from '../components/account/pages/payments/shared/payment.helpers';
import { buildPayoutApiBody } from '../components/account/pages/payments/shared/payment.helpers';
import { urlConstant } from '../shared/constant/urlConstant';

export interface PaymentCashConfig {
  id: number;
  status_id: number;
  enabled_payment_method_ids: number[];
  min_deposit: number | null;
  min_withdrawal: number | null;
  max_deposit: number | null;
  max_withdrawal: number | null;
  max_pending_deposits: number;
  max_pending_withdrawals: number;
  max_withdrawal_per_day: number | null;
  require_kyc_for_deposit: boolean;
  require_kyc_for_withdrawal: boolean;
}

export interface PaymentMethodApi {
  id: number;
  code: string;
  name: string;
  direction: 'DEPOSIT' | 'WITHDRAW' | 'BOTH' | string;
  description?: string;
}

export interface DepositWalletCredentials {
  upi_id?: string;
  display_name?: string;
  qr_url?: string | null;
  wallet_address?: string;
  address?: string;
  deposit_address?: string;
  bank_name?: string;
  account_holder?: string;
  account_holder_name?: string;
  account_name?: string;
  account_number?: string;
  ifsc?: string;
  ifsc_code?: string;
  branch?: string;
  branch_name?: string;
  account_type?: string;
  [key: string]: unknown;
}

export interface DepositWalletApi {
  payment_method_id: number;
  payment_method_code: string;
  brand_wallet_id: number;
  wallet_key: string;
  display_name: string;
  display_order: number;
  is_active: boolean;
  is_configured: boolean;
  is_default: boolean;
  credentials?: DepositWalletCredentials;
  credential_fields?: string[];
  crypto_code?: string | null;
  crypto_asset_id?: number | null;
  network?: string | null;
  catalog_id?: number;
}

export interface BrandCurrencyInfo {
  currency_id: number;
  currency_code: string;
  currency_name: string;
  currency_symbol: string;
  decimal_places: number;
}

export interface PaymentConfigData {
  config: PaymentCashConfig;
  deposit_wallets: DepositWalletApi[];
  payment_methods: PaymentMethodApi[];
  brand_currency?: BrandCurrencyInfo | null;
}

export interface CashConvertRequest {
  amount: number;
  flow: 'deposit' | 'withdraw';
  payment_method_id: number;
  coin?: string | null;
  network?: string | null;
}

export interface CashConversionData {
  flow: 'deposit' | 'withdraw';
  payment_method_id: number;
  coin?: string;
  wallet_amount: number;
  wallet_currency_code: string;
  wallet_currency_symbol?: string;
  payment_amount: number;
  payment_currency_code: string;
  payment_currency_symbol?: string;
  exchange_rate: number;
  exchange_rate_base_to_payment?: number;
  rate_label: string;
  conversion_required: boolean;
  summary?: string;
}

export interface CashConvertResponse {
  code: number;
  message: string;
  data: CashConversionData | null;
}

export interface PaymentConfigResponse {
  code: number;
  message: string;
  data: PaymentConfigData | null;
}

export interface DepositResponseData {
  status: string;
  request_id: number;
  screenshot_url: string | null;
  deposit_proof_url: string | null;
}

export interface DepositResponse {
  code: number;
  message: string;
  data: DepositResponseData | null;
}

export interface DepositListFilter {
  status_id: number | null;
  page: number;
  limit: number;
}

export interface DepositPaymentDetails {
  utr: string;
  screenshotUrl: string | null;
  depositProofUrl: string | null;
}

export interface DepositRequestItem {
  requestId: number;
  amount: number;
  currencyCode: string;
  statusId: number | null;
  statusName: string;
  paymentMethodId: number | null;
  paymentMethodCode: string;
  paymentMethodName: string;
  proofUrl: string | null;
  paymentDetails: DepositPaymentDetails | null;
  adminNote: string | null;
  playerNote: string | null;
  requestedAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
}

export interface DepositListResponse {
  code: number;
  message: string;
  items: DepositRequestItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CancelDepositResponse {
  code: number;
  message: string;
}

export interface PayoutPaymentDetails {
  account_holder?: string;
  account_number?: string;
  ifsc?: string;
  bank_name?: string;
  upi_id?: string;
  wallet_address?: string;
  [key: string]: string | undefined;
}

export interface SavedPayoutMethod {
  payoutId: number;
  paymentMethodId: number;
  paymentMethodCode: string;
  paymentMethodName: string;
  label: string;
  paymentDetails: PayoutPaymentDetails;
  isDefault: boolean;
  isVerified: boolean;
}

export interface PayoutChannelApi {
  payment_method_id: number;
  payment_method_code: string;
  display_name: string;
  wallet_key: string;
  credential_fields: string[];
  is_configured: boolean;
  display_order: number;
  crypto_code?: string | null;
  network?: string | null;
  catalog_id?: number;
}

export interface PayoutResponse {
  code: number;
  message: string;
  allowedChannels: PayoutChannelApi[];
  savedPayouts: SavedPayoutMethod[];
}

export interface SavePayoutPayload {
  paymentMethodId: number;
  label: string;
  isDefault?: boolean;
  /** Payout fields sent flat in the request body (upi_id, account_number, etc.) */
  paymentDetails: PayoutPaymentDetails;
}

export interface UpdatePayoutPayload extends SavePayoutPayload {
  payoutId: number;
}

export interface SavePayoutResponse {
  code: number;
  message: string;
  data: SavedPayoutMethod | null;
}

export interface DeletePayoutResponse {
  code: number;
  message: string;
}

export interface WithdrawListFilter {
  status_id: number | null;
  search: string | null;
  page: number;
  limit: number;
}

export interface WithdrawPaymentDetails {
  account_holder?: string;
  account_number?: string;
  ifsc?: string;
  bank_name?: string;
  upi_id?: string;
  coin?: string;
  network?: string;
  address?: string;
  wallet_address?: string;
  [key: string]: string | undefined;
}

export interface WithdrawRequestItem {
  requestId: number;
  amount: number;
  currencyCode: string;
  statusId: number | null;
  statusName: string;
  paymentMethodId: number | null;
  paymentMethodCode: string;
  paymentMethodName: string;
  paymentDetails: WithdrawPaymentDetails | null;
  adminNote: string | null;
  playerNote: string | null;
  requestedAt: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  proofUrl: string | null;
}

export interface WithdrawListResponse {
  code: number;
  message: string;
  items: WithdrawRequestItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface WithdrawResponseData {
  status: string;
  request_id: number;
}

export interface WithdrawResponse {
  code: number;
  message: string;
  data: WithdrawResponseData | null;
}

export interface CancelWithdrawResponse {
  code: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  constructor(private http: HttpClient) { }

  convertCashAmount(request: CashConvertRequest): Observable<CashConvertResponse> {
    const body: Record<string, string | number> = {
      amount: request.amount,
      flow: request.flow,
      payment_method_id: request.payment_method_id
    };

    const coin = request.coin?.trim();
    if (coin) {
      body['coin'] = coin;
    }

    const network = request.network?.trim();
    if (network) {
      body['network'] = network;
    }

    return this.http.post<unknown>(urlConstant.paymentConvert, body).pipe(map((responseBody: unknown) => mapCashConvertResponse(responseBody)));
  }

  getConfig(): Observable<PaymentConfigResponse> {
    return this.http.get<unknown>(urlConstant.paymentConfig).pipe(
      map((body: unknown) => {
        const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
        const rawCode = Number(record['code']);
        const data = record['data'];
        return {
          code: Number.isFinite(rawCode) ? rawCode : 0,
          message: String(record['message'] ?? ''),
          data: isPaymentConfigData(data) ? data : null
        };
      })
    );
  }

  submitDeposit(formData: FormData): Observable<DepositResponse> {
    return this.http.post<unknown>(urlConstant.paymentDeposit, formData).pipe(map((body: unknown) => mapDepositResponse(body)));
  }

  getDepositList(filter: DepositListFilter): Observable<DepositListResponse> {
    return this.http.post<unknown>(urlConstant.paymentDepositList, {
      status_id: filter.status_id,
      page: filter.page,
      limit: filter.limit
    }).pipe(map((body: unknown) => mapDepositListResponse(body, filter)));
  }

  cancelDeposit(requestId: number): Observable<CancelDepositResponse> {
    return this.http.post<unknown>(urlConstant.paymentDepositCancel, { request_id: requestId }).pipe(map((body: unknown) => mapCancelDepositResponse(body)));
  }

  getPayout(): Observable<PayoutResponse> {
    return this.http.get<unknown>(urlConstant.paymentPayout).pipe(map((body: unknown) => mapPayoutResponse(body)));
  }

  savePayout(payload: SavePayoutPayload): Observable<SavePayoutResponse> {
    return this.http.post<unknown>(urlConstant.paymentPayoutSave, buildPayoutRequestBody(payload)).pipe(
      map((body: unknown) => mapSavePayoutResponse(body))
    );
  }

  updatePayout(payload: UpdatePayoutPayload): Observable<SavePayoutResponse> {
    return this.http.post<unknown>(urlConstant.paymentPayoutUpdate, {
      id: payload.payoutId, ...buildPayoutRequestBody(payload)
    }).pipe(map((body: unknown) => mapSavePayoutResponse(body)));
  }

  deletePayout(payoutId: number): Observable<DeletePayoutResponse> {
    return this.http.delete<unknown>(urlConstant.paymentPayoutDelete(payoutId)).pipe(
      map((body: unknown) => mapDeletePayoutResponse(body))
    );
  }

  submitWithdraw(body: ConfirmWithdrawPayload): Observable<WithdrawResponse> {
    return this.http.post<unknown>(urlConstant.paymentWithdraw, body).pipe(
      map((responseBody: unknown) => mapWithdrawResponse(responseBody))
    );
  }

  getWithdrawList(filter: WithdrawListFilter): Observable<WithdrawListResponse> {
    return this.http.post<unknown>(urlConstant.paymentWithdrawList, {
      status_id: filter.status_id,
      search: filter.search,
      page: filter.page,
      limit: filter.limit
    }).pipe(map((responseBody: unknown) => mapWithdrawListResponse(responseBody, filter)));
  }

  cancelWithdraw(requestId: number): Observable<CancelWithdrawResponse> {
    return this.http.post<unknown>(urlConstant.paymentWithdrawCancel, {
      request_id: requestId
    }).pipe(map((responseBody: unknown) => mapCancelWithdrawResponse(responseBody)));
  }
}

function isPaymentConfigData(value: unknown): value is PaymentConfigData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (record['config'] != null && Array.isArray(record['deposit_wallets']) && Array.isArray(record['payment_methods']));
}

function mapCashConvertResponse(body: unknown): CashConvertResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  return {
    code: code === 5 ? 0 : code,
    message: String(record['message'] ?? ''),
    data: isCashConversionData(data) ? data : null
  };
}

function isCashConversionData(value: unknown): value is CashConversionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['wallet_currency_code'] === 'string' && typeof record['payment_currency_code'] === 'string' && Number.isFinite(Number(record['wallet_amount'])) && Number.isFinite(Number(record['payment_amount']));
}

function mapDepositResponse(body: unknown): DepositResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? ''),
    data: isDepositResponseData(data) ? data : null
  };
}

function normalizeDepositCode(code: number): number {
  if (code === 5) {
    return 0;
  }
  return code;
}

function isDepositResponseData(value: unknown): value is DepositResponseData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const requestId = Number(record['request_id']);
  return Number.isFinite(requestId) && typeof record['status'] === 'string';
}

const DEPOSIT_STATUS_BY_ID: Record<number, string> = {
  1: 'PENDING',
  2: 'APPROVED',
  3: 'REJECTED',
  4: 'CANCELLED'
};

function mapDepositListResponse(body: unknown, filter: DepositListFilter): DepositListResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  const dataRecord = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;

  const rawItems = extractDepositListItems(data);
  const items = rawItems.map((item) => mapDepositRequestItem(item)).filter((item): item is DepositRequestItem => item != null);

  const total = readNumber(dataRecord?.['total_count'] ?? dataRecord?.['total'] ?? record['total'], items.length);
  const page = readNumber(dataRecord?.['page'] ?? record['page'], filter.page);
  const limit = readNumber(dataRecord?.['limit'] ?? record['limit'], filter.limit);
  const totalPages = readNumber(
    dataRecord?.['total_pages'] ?? record['total_pages'],
    Math.max(1, Math.ceil(total / Math.max(limit, 1)))
  );

  return { code: normalizeDepositCode(code), message: String(record['message'] ?? ''), items, total, page, limit, totalPages };
}

function extractDepositListItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  for (const key of ['items', 'rows', 'requests', 'list', 'deposits']) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function mapDepositRequestItem(raw: unknown): DepositRequestItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const requestId = Number(record['request_id'] ?? record['id']);
  if (!Number.isFinite(requestId)) {
    return null;
  }

  const statusIdRaw = record['status_id'];
  const statusId = statusIdRaw == null ? null : Number(statusIdRaw);
  const statusFromId = statusId != null && Number.isFinite(statusId) ? DEPOSIT_STATUS_BY_ID[statusId] : undefined;

  const paymentDetailsRaw = record['payment_details'];
  const paymentDetailsRecord = paymentDetailsRaw && typeof paymentDetailsRaw === 'object' && !Array.isArray(paymentDetailsRaw) ? (paymentDetailsRaw as Record<string, unknown>) : null;
  const paymentDetails: DepositPaymentDetails | null = paymentDetailsRecord ? {
    utr: String(paymentDetailsRecord['utr'] ?? ''),
    screenshotUrl: paymentDetailsRecord['screenshot_url'] != null ? String(paymentDetailsRecord['screenshot_url']) : null,
    depositProofUrl: paymentDetailsRecord['deposit_proof_url'] != null ? String(paymentDetailsRecord['deposit_proof_url']) : null
  } : null;

  const proofUrl = record['proof_url'] != null ? String(record['proof_url']) : paymentDetails?.screenshotUrl ?? paymentDetails?.depositProofUrl ?? null;
  const paymentMethodIdRaw = record['payment_method_id'];
  const paymentMethodId = paymentMethodIdRaw == null ? null : Number(paymentMethodIdRaw);

  return {
    requestId,
    amount: Number(record['amount'] ?? 0),
    currencyCode: String(record['currency_code'] ?? record['currency'] ?? ''),
    statusId: statusId != null && Number.isFinite(statusId) ? statusId : null,
    statusName: String(record['status_name'] ?? record['status'] ?? statusFromId ?? 'PENDING'),
    paymentMethodId: paymentMethodId != null && Number.isFinite(paymentMethodId) ? paymentMethodId : null,
    paymentMethodCode: String(record['payment_method_code'] ?? ''),
    paymentMethodName: String(record['payment_method_name'] ?? record['payment_method'] ?? ''),
    proofUrl,
    paymentDetails,
    adminNote: record['admin_note'] != null ? String(record['admin_note']) : null,
    playerNote: record['player_note'] != null ? String(record['player_note']) : null,
    requestedAt: record['requested_at'] != null ? String(record['requested_at']) : record['created_at'] != null ? String(record['created_at']) : null,
    processedAt: record['processed_at'] != null ? String(record['processed_at']) : null,
    cancelledAt: record['cancelled_at'] != null ? String(record['cancelled_at']) : null
  };
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapCancelDepositResponse(body: unknown): CancelDepositResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? '')
  };
}

function mapPayoutResponse(body: unknown): PayoutResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];

  const allowedChannels = extractAllowedChannels(data).map((item) => mapPayoutChannel(item)).filter((item): item is PayoutChannelApi => item != null).sort((a, b) => a.display_order - b.display_order);
  const savedPayouts = extractSavedPayoutItems(data).map((item) => mapSavedPayoutMethod(item)).filter((item): item is SavedPayoutMethod => item != null);

  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? ''),
    allowedChannels,
    savedPayouts
  };
}

function extractAllowedChannels(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  for (const key of ['allowed_channels', 'allowedChannels', 'channels', 'payout_channels']) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function mapPayoutChannel(raw: unknown): PayoutChannelApi | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const paymentMethodId = Number(record['payment_method_id'] ?? record['paymentMethodId']);
  if (!Number.isFinite(paymentMethodId)) {
    return null;
  }

  const credentialFields = Array.isArray(record['credential_fields']) ? record['credential_fields'].map((field) => String(field)) : [];
  return {
    payment_method_id: paymentMethodId,
    payment_method_code: String(record['payment_method_code'] ?? ''),
    display_name: String(record['display_name'] ?? ''),
    wallet_key: String(record['wallet_key'] ?? ''),
    credential_fields: credentialFields,
    is_configured: Boolean(record['is_configured'] ?? true),
    display_order: Number(record['display_order'] ?? 0),
    crypto_code: record['crypto_code'] != null ? String(record['crypto_code']) : null,
    network: record['network'] != null ? String(record['network']) : null,
    catalog_id: record['catalog_id'] != null ? Number(record['catalog_id']) : undefined
  };
}

function extractSavedPayoutItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  for (const key of ['saved_wallets', 'saved_payouts', 'player_payouts', 'payout_accounts', 'items', 'rows', 'payouts', 'list', 'accounts']) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function mapSavedPayoutMethod(raw: unknown): SavedPayoutMethod | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const payoutId = Number(record['payout_id'] ?? record['id']);
  const paymentMethodId = Number(record['payment_method_id'] ?? record['paymentMethodId']);
  if (!Number.isFinite(payoutId) || !Number.isFinite(paymentMethodId)) {
    return null;
  }

  const paymentDetailsRaw = record['payment_details'];
  let paymentDetailsRecord: Record<string, unknown> = {};
  if (paymentDetailsRaw && typeof paymentDetailsRaw === 'object' && !Array.isArray(paymentDetailsRaw)) {
    paymentDetailsRecord = paymentDetailsRaw as Record<string, unknown>;
  } else if (typeof paymentDetailsRaw === 'string' && paymentDetailsRaw.trim()) {
    try {
      const parsed = JSON.parse(paymentDetailsRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        paymentDetailsRecord = parsed as Record<string, unknown>;
      }
    } catch {
      paymentDetailsRecord = {};
    }
  }

  const paymentDetails: PayoutPaymentDetails = {};
  for (const [key, value] of Object.entries(paymentDetailsRecord)) {
    if (value != null && value !== '') {
      paymentDetails[key] = String(value);
    }
  }

  const flatDetailKeys = ['upi_id', 'account_holder', 'account_number', 'ifsc', 'bank_name', 'branch', 'address', 'wallet_address', 'coin', 'network', 'memo'];
  for (const key of flatDetailKeys) {
    const value = record[key];
    if (value != null && value !== '' && !paymentDetails[key]) {
      paymentDetails[key] = String(value);
    }
  }

  const paymentMethodCode = String(record['payment_method_code'] ?? '');

  return {
    payoutId,
    paymentMethodId,
    paymentMethodCode,
    paymentMethodName: String(record['payment_method_name'] ?? record['display_name'] ?? paymentMethodCode),
    label: String(record['label'] ?? record['name'] ?? `Account #${payoutId}`),
    paymentDetails,
    isDefault: Boolean(record['is_default'] ?? record['isDefault']),
    isVerified: Boolean(record['is_verified'] ?? record['isVerified'])
  };
}

function buildPayoutRequestBody(payload: SavePayoutPayload): Record<string, string | number | boolean> {
  return buildPayoutApiBody({
    paymentMethodId: payload.paymentMethodId,
    label: payload.label,
    paymentDetails: Object.fromEntries(Object.entries(payload.paymentDetails).map(([key, value]) => [key, String(value ?? '')])),
    isDefault: payload.isDefault
  });
}

function mapDeletePayoutResponse(body: unknown): DeletePayoutResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? '')
  };
}

function mapSavePayoutResponse(body: unknown): SavePayoutResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  const mapped = data != null ? mapSavedPayoutMethod(data) : null;

  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? ''),
    data: mapped
  };
}

function mapWithdrawResponse(body: unknown): WithdrawResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  const dataRecord = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  const requestId = Number(dataRecord?.['request_id']);
  const status = dataRecord?.['status'];

  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? ''),
    data: Number.isFinite(requestId) && typeof status === 'string'
      ? { request_id: requestId, status }
      : null
  };
}

function mapWithdrawListResponse(body: unknown, filter: WithdrawListFilter): WithdrawListResponse {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const rawCode = Number(record['code']);
  const code = Number.isFinite(rawCode) ? rawCode : -1;
  const data = record['data'];
  const dataRecord = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const rawItems = extractWithdrawListItems(data);
  const items = rawItems.map((item) => mapWithdrawRequestItem(item)).filter((item): item is WithdrawRequestItem => item != null);

  const total = readNumber(dataRecord?.['total_count'] ?? dataRecord?.['total'] ?? record['total'], items.length);
  const page = readNumber(dataRecord?.['page'] ?? record['page'], filter.page);
  const limit = readNumber(dataRecord?.['limit'] ?? record['limit'], filter.limit);
  const totalPages = readNumber(
    dataRecord?.['total_pages'] ?? record['total_pages'],
    Math.max(1, Math.ceil(total / Math.max(limit, 1)))
  );

  return {
    code: normalizeDepositCode(code),
    message: String(record['message'] ?? ''),
    items,
    total,
    page,
    limit,
    totalPages
  };
}

function extractWithdrawListItems(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data || typeof data !== 'object') {
    return [];
  }
  const record = data as Record<string, unknown>;
  for (const key of ['items', 'rows', 'requests', 'list', 'withdrawals', 'withdraws']) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function mapWithdrawRequestItem(raw: unknown): WithdrawRequestItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const requestId = Number(record['request_id'] ?? record['id']);
  if (!Number.isFinite(requestId)) {
    return null;
  }

  const statusIdRaw = record['status_id'];
  const statusId = statusIdRaw == null ? null : Number(statusIdRaw);
  const statusFromId = statusId != null && Number.isFinite(statusId) ? DEPOSIT_STATUS_BY_ID[statusId] : undefined;
  const paymentDetailsRaw = record['payment_details'];
  const paymentDetailsRecord = paymentDetailsRaw && typeof paymentDetailsRaw === 'object' && !Array.isArray(paymentDetailsRaw) ? (paymentDetailsRaw as Record<string, unknown>) : null;

  const paymentDetails: WithdrawPaymentDetails | null = paymentDetailsRecord
    ? Object.fromEntries(Object.entries(paymentDetailsRecord).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)]))
    : null;

  const paymentMethodIdRaw = record['payment_method_id'];
  const paymentMethodId = paymentMethodIdRaw == null ? null : Number(paymentMethodIdRaw);

  return {
    requestId,
    amount: Number(record['amount'] ?? 0),
    currencyCode: String(record['currency_code'] ?? record['currency'] ?? ''),
    statusId: statusId != null && Number.isFinite(statusId) ? statusId : null,
    statusName: String(record['status_name'] ?? record['status'] ?? statusFromId ?? 'PENDING'),
    paymentMethodId: paymentMethodId != null && Number.isFinite(paymentMethodId) ? paymentMethodId : null,
    paymentMethodCode: String(record['payment_method_code'] ?? ''),
    paymentMethodName: String(record['payment_method_name'] ?? record['payment_method'] ?? ''),
    paymentDetails,
    proofUrl: record['approval_proof_url'] != null ? String(record['approval_proof_url']) : null,
    adminNote: record['admin_note'] != null ? String(record['admin_note']) : null,
    playerNote: record['player_note'] != null ? String(record['player_note']) : null,
    requestedAt: record['requested_at'] != null ? String(record['requested_at']) : record['created_at'] != null ? String(record['created_at']) : null,
    processedAt: record['processed_at'] != null ? String(record['processed_at']) : null,
    cancelledAt: record['cancelled_at'] != null ? String(record['cancelled_at']) : null
  };
}

function mapCancelWithdrawResponse(body: unknown): CancelWithdrawResponse {
  return mapCancelDepositResponse(body);
}

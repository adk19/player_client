import type { DepositWalletApi } from '../../../../../services/payment.service';

export interface PaymentDetailRow {
  label: string;
  value: string;
}

const PRESET_AMOUNTS = [100, 250, 500, 1000];

const BANK_FIELD_LABELS: Record<string, string> = {
  bank_name: 'Bank name',
  account_holder: 'Account holder',
  account_holder_name: 'Account holder',
  account_name: 'Account name',
  display_name: 'Account holder',
  account_number: 'Account number',
  ifsc: 'IFSC code',
  ifsc_code: 'IFSC code',
  branch: 'Branch',
  branch_name: 'Branch',
  account_type: 'Account type'
};

const CRYPTO_FIELD_LABELS: Record<string, string> = {
  wallet_address: 'Deposit address',
  deposit_address: 'Deposit address',
  address: 'Deposit address',
  memo: 'Memo',
  tag: 'Tag',
  destination_tag: 'Destination tag'
};

const PAYOUT_FIELD_LABELS: Record<string, string> = {
  upi_id: 'UPI ID',
  account_holder: 'Account holder',
  account_number: 'Account number',
  ifsc: 'IFSC code',
  bank_name: 'Bank name',
  branch: 'Branch',
  address: 'Wallet address',
  wallet_address: 'Wallet address',
  coin: 'Coin',
  network: 'Network',
  memo: 'Memo'
};

const BANK_SKIP = new Set(['qr_url', 'upi_id', 'wallet_address', 'address', 'deposit_address']);
const CRYPTO_SKIP = new Set(['qr_url', 'upi_id', 'display_name']);
const CRYPTO_ADDRESS_FIELDS = ['wallet_address', 'deposit_address', 'address'] as const;

export function quickAmountPresets(min: number, max: number | null, balanceCap?: number): number[] {
  const ceiling = balanceCap != null
    ? Math.min(max ?? Number.MAX_SAFE_INTEGER, balanceCap)
    : max ?? Number.MAX_SAFE_INTEGER;

  return PRESET_AMOUNTS
    .filter((value) => value >= min && value <= ceiling)
    .slice(0, 4);
}

export function amountRangeLabel(min: number, max: number | null, unit: string): string {
  if (max != null) {
    return `${min.toLocaleString()} - ${max.toLocaleString()} ${unit}`;
  }
  return `Min ${min} ${unit}`;
}

export function amountMaxLength(max: number | null): number {
  if (max == null) {
    return 12;
  }
  return String(Math.trunc(max)).length + 3;
}

export function effectiveAmountMax(max: number | null, balance?: number): number {
  if (balance != null && Number.isFinite(balance)) {
    return max != null ? Math.min(max, balance) : balance;
  }
  return max ?? Number.MAX_SAFE_INTEGER;
}

export function sanitizeDecimalInput(raw: string): string {
  let value = raw.replace(/[^\d.]/g, '');
  const dotIndex = value.indexOf('.');
  if (dotIndex !== -1) {
    value = `${value.slice(0, dotIndex + 1)}${value.slice(dotIndex + 1).replace(/\./g, '')}`;
  }
  return value;
}

export function shouldBlockAmountKey(event: KeyboardEvent, nextValue: string, max: number): boolean {
  const controlKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (controlKeys.includes(event.key) || event.ctrlKey || event.metaKey) {
    return false;
  }
  if (!/^\d*\.?\d*$/.test(nextValue)) {
    return true;
  }
  if (!nextValue || nextValue === '.') {
    return false;
  }
  const nextAmount = Number(nextValue);
  return Number.isFinite(nextAmount) && nextAmount > max;
}

export function amountValidationError(
  amount: string,
  min: number,
  max: number | null,
  unit: string,
  submitAttempted: boolean,
  balance?: number
): string | null {
  if (!submitAttempted) {
    return null;
  }

  const paymentAmount = Number(amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return 'Enter a valid amount';
  }
  if (paymentAmount < min) {
    return `Minimum ${min} ${unit}`;
  }
  if (max != null && paymentAmount > max) {
    return `Maximum ${max.toLocaleString()} ${unit}`;
  }
  if (balance != null && paymentAmount > balance) {
    return 'Amount exceeds available balance';
  }
  return null;
}

export function isAmountValid(
  amount: string,
  min: number,
  max: number | null,
  balance?: number
): boolean {
  const paymentAmount = Number(amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount < min) {
    return false;
  }
  if (max != null && paymentAmount > max) {
    return false;
  }
  if (balance != null && paymentAmount > balance) {
    return false;
  }
  return true;
}

export interface BrandCurrencyFormat {
  currency_symbol?: string | null;
  decimal_places?: number | null;
}

export function formatFieldLabel(field: string, labels: Record<string, string>): string {
  return labels[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Resolves spendable wallet balance (available, or balance − reserved). */
export function resolveWalletAvailable(wallet: {
  available?: number | null;
  balance?: number | null;
  reserved?: number | null;
} | null | undefined): number {
  if (!wallet) {
    return 0;
  }

  if (wallet.available != null && Number.isFinite(Number(wallet.available))) {
    return Math.max(0, Number(wallet.available));
  }

  const balance = Number(wallet.balance);
  const reserved = Number(wallet.reserved);
  if (Number.isFinite(balance)) {
    const held = Number.isFinite(reserved) ? reserved : 0;
    return Math.max(0, balance - held);
  }

  return 0;
}

export function formatBrandMoney(
  value: number,
  brand: BrandCurrencyFormat | null | undefined,
  fallbackSymbol = ''
): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  const symbol = brand?.currency_symbol?.trim() || fallbackSymbol;
  const decimals = brand?.decimal_places ?? 2;
  const formatted = amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return symbol ? `${symbol} ${formatted}` : formatted;
}

export function buildBankDepositRows(wallet: DepositWalletApi | null): PaymentDetailRow[] {
  const credentials = wallet?.credentials;
  if (!credentials) {
    return [];
  }

  const fields = wallet.credential_fields?.length
    ? wallet.credential_fields
    : Object.keys(credentials);

  return fields
    .filter((field) => !BANK_SKIP.has(field))
    .map((field) => {
      const raw = credentials[field];
      const value = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
      if (!value) {
        return null;
      }
      return {
        label: formatFieldLabel(field, BANK_FIELD_LABELS),
        value
      };
    })
    .filter((row): row is PaymentDetailRow => row != null);
}

export function buildCryptoDepositRows(wallet: DepositWalletApi | null): PaymentDetailRow[] {
  const credentials = wallet?.credentials;
  if (!wallet || !credentials) {
    return [];
  }

  const rows: PaymentDetailRow[] = [];

  if (wallet.crypto_code?.trim()) {
    rows.push({ label: 'Asset', value: wallet.crypto_code.trim() });
  }
  if (wallet.network?.trim()) {
    rows.push({ label: 'Network', value: wallet.network.trim() });
  }

  for (const field of CRYPTO_ADDRESS_FIELDS) {
    const raw = credentials[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) {
      rows.push({ label: 'Deposit address', value });
      break;
    }
  }

  const fields = wallet.credential_fields?.length
    ? wallet.credential_fields
    : Object.keys(credentials);

  const skip = new Set<string>([...CRYPTO_SKIP, ...CRYPTO_ADDRESS_FIELDS, 'network', 'crypto_code']);

  for (const field of fields) {
    if (skip.has(field)) {
      continue;
    }
    const raw = credentials[field];
    const value = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
    if (!value) {
      continue;
    }
    rows.push({
      label: formatFieldLabel(field, CRYPTO_FIELD_LABELS),
      value
    });
  }

  return rows;
}

export function buildPayoutDetailRows(details: Record<string, string>): PaymentDetailRow[] {
  return Object.entries(details)
    .filter(([, value]) => !!value?.trim())
    .map(([key, value]) => ({
      label: formatFieldLabel(key, PAYOUT_FIELD_LABELS),
      value: value.trim()
    }));
}

export function payoutFieldLabel(key: string): string {
  return formatFieldLabel(key, PAYOUT_FIELD_LABELS);
}

const CRYPTO_PAYOUT_FORM_SKIP = new Set(['qr_url', 'display_name', 'coin', 'network', 'crypto_code']);
const CRYPTO_PAYOUT_ADDRESS_KEYS = ['address', 'wallet_address'] as const;
const CRYPTO_ONLY_PAYOUT_FIELDS = new Set(['address', 'wallet_address', 'coin', 'network', 'memo', 'tx_hash', 'sender_wallet_address']);
const UPI_PAYOUT_FIELDS = new Set(['upi_id']);
const BANK_PAYOUT_FIELDS = new Set(['account_holder', 'account_number', 'ifsc', 'bank_name', 'branch', 'branch_name', 'account_type']);
const FIAT_CURRENCY_CODES = new Set(['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'BRL', 'TRY', 'AED', 'SGD', 'JPY', 'CNY']);

export function resolveCryptoPayoutAddress(payoutDetails: Record<string, string>): string {
  return (payoutDetails['address'] || payoutDetails['wallet_address'] || '').trim();
}

export function resolveCryptoPayoutCoin(
  payoutDetails: Record<string, string>,
  coinFallback?: string | null
): string {
  return (payoutDetails['coin'] || coinFallback || '').trim().toUpperCase();
}

export function resolveCryptoPayoutNetwork(
  payoutDetails: Record<string, string>,
  networkFallback?: string | null
): string {
  return (payoutDetails['network'] || networkFallback || '').trim();
}

export function payoutMatchesWithdrawMethod(
  payout: {
    paymentMethodId: number;
    paymentMethodCode?: string;
    paymentDetails: Record<string, string>;
  },
  method: {
    paymentMethodId?: number;
    paymentMethodCode?: string;
    cryptoCode?: string;
    network?: string;
    kind?: string;
    walletKey?: string;
  }
): boolean {
  const methodId = resolveWithdrawPaymentMethodId({
    paymentMethodId: method.paymentMethodId,
    paymentMethodCode: method.paymentMethodCode,
    kind: method.kind,
    cryptoCode: method.cryptoCode,
    walletKey: method.walletKey
  });
  const payoutId = resolveWithdrawPaymentMethodId({
    paymentMethodId: payout.paymentMethodId,
    paymentMethodCode: payout.paymentMethodCode,
    paymentDetails: payout.paymentDetails
  });

  if (methodId == null || payoutId == null || methodId !== payoutId) {
    return false;
  }

  if (methodId !== CRYPTO_WITHDRAW_METHOD_ID) {
    return true;
  }

  const expectedCoin = normalizeCryptoCoin(method.cryptoCode || '');
  if (expectedCoin) {
    const payoutCoin = normalizeCryptoCoin(resolveCryptoPayoutCoin(payout.paymentDetails));
    if (payoutCoin && payoutCoin !== expectedCoin) {
      return false;
    }
  }

  const expectedNetwork = normalizeCryptoNetwork(method.network || '');
  if (expectedNetwork) {
    const payoutNetwork = normalizeCryptoNetwork(resolveCryptoPayoutNetwork(payout.paymentDetails));
    if (payoutNetwork && payoutNetwork !== expectedNetwork) {
      return false;
    }
  }

  return true;
}

export function isCryptoAssetCode(code: string | null | undefined): boolean {
  const normalized = (code || '').trim().toUpperCase();
  if (!normalized || FIAT_CURRENCY_CODES.has(normalized)) {
    return false;
  }
  return CRYPTO_WITHDRAW_CODES.has(normalized);
}

export function fiatPayoutEditableFields(input: {
  paymentMethodId?: number | null;
  kind?: string | null;
  credentialFields?: string[];
}): { key: string; label: string }[] {
  const isUpi = isUpiWithdrawMethodId(input.paymentMethodId) || input.kind === 'fiat_in';
  const isBank = isBankWithdrawMethodId(input.paymentMethodId) || input.kind === 'bank';
  const allowedFields = isUpi ? UPI_PAYOUT_FIELDS : isBank ? BANK_PAYOUT_FIELDS : UPI_PAYOUT_FIELDS;
  const defaultKeys = isUpi ? ['upi_id'] : isBank
    ? ['account_holder', 'account_number', 'ifsc', 'bank_name']
    : ['upi_id'];

  const fields = input.credentialFields?.length ? input.credentialFields : defaultKeys;

  return fields
    .filter((key) => allowedFields.has(key) && !CRYPTO_ONLY_PAYOUT_FIELDS.has(key))
    .map((key) => ({ key, label: payoutFieldLabel(key) }));
}

export function fiatPayoutSaveFieldError(
  fieldKey: string,
  value: string,
  paymentMethodId: number | null | undefined,
  kind: string | null | undefined,
  saveAttempted: boolean
): string | null {
  if (!saveAttempted) {
    return null;
  }

  if (isUpiWithdrawMethodId(paymentMethodId) || kind === 'fiat_in') {
    if (fieldKey !== 'upi_id') {
      return null;
    }
    const upiId = value.trim();
    if (!upiId) {
      return 'Enter UPI ID';
    }
    if (upiId.length < 3) {
      return 'UPI ID must be at least 3 characters';
    }
    if (upiId.length > 100) {
      return 'UPI ID must be at most 100 characters';
    }
    return null;
  }

  if (isBankWithdrawMethodId(paymentMethodId) || kind === 'bank') {
    if (!value.trim()) {
      return `Enter ${payoutFieldLabel(fieldKey).toLowerCase()}`;
    }
    return null;
  }

  if (!value.trim()) {
    return `Enter ${payoutFieldLabel(fieldKey).toLowerCase()}`;
  }

  return null;
}

export function cryptoPayoutEditableFields(
  credentialFields?: string[]
): { key: string; label: string }[] {
  const fields = credentialFields?.length ? credentialFields : ['address'];
  const rows: { key: string; label: string }[] = [];
  const addressKey = fields.find((field) => CRYPTO_PAYOUT_ADDRESS_KEYS.includes(field as typeof CRYPTO_PAYOUT_ADDRESS_KEYS[number]))
    ?? 'address';

  rows.push({ key: addressKey, label: payoutFieldLabel(addressKey) });

  for (const field of fields) {
    if (CRYPTO_PAYOUT_FORM_SKIP.has(field) || CRYPTO_PAYOUT_ADDRESS_KEYS.includes(field as typeof CRYPTO_PAYOUT_ADDRESS_KEYS[number])) {
      continue;
    }
    rows.push({ key: field, label: payoutFieldLabel(field) });
  }

  return rows;
}

export function normalizeCryptoPayoutDetailsForSave(
  form: Record<string, string>,
  coinFallback?: string | null,
  networkFallback?: string | null
): Record<string, string> {
  const details: Record<string, string> = {};
  const walletAddress = resolveCryptoPayoutAddress(form);

  if (walletAddress) {
    details['address'] = walletAddress.slice(0, 200);
  }

  const coin = resolveCryptoPayoutCoin(form, coinFallback);
  if (coin) {
    details['coin'] = coin.slice(0, 20);
  }

  const network = resolveCryptoPayoutNetwork(form, networkFallback);
  if (network) {
    details['network'] = network.slice(0, 40);
  }

  for (const [key, value] of Object.entries(form)) {
    if (
      CRYPTO_PAYOUT_FORM_SKIP.has(key)
      || CRYPTO_PAYOUT_ADDRESS_KEYS.includes(key as typeof CRYPTO_PAYOUT_ADDRESS_KEYS[number])
    ) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      details[key] = trimmed;
    }
  }

  return details;
}

export function cryptoPayoutSaveFieldError(
  fieldKey: string,
  value: string,
  saveAttempted: boolean
): string | null {
  if (!saveAttempted) {
    return null;
  }

  if (CRYPTO_PAYOUT_ADDRESS_KEYS.includes(fieldKey as typeof CRYPTO_PAYOUT_ADDRESS_KEYS[number])) {
    const walletAddress = value.trim();
    if (!walletAddress) {
      return 'Enter wallet address';
    }
    if (walletAddress.length < 8) {
      return 'Wallet address must be at least 8 characters';
    }
    if (walletAddress.length > 200) {
      return 'Wallet address must be at most 200 characters';
    }
    return null;
  }

  if (!value.trim()) {
    return `Enter ${payoutFieldLabel(fieldKey).toLowerCase()}`;
  }

  return null;
}

/** Matches PlayerAPI `payoutWalletBodySchema` — unknown keys rejected server-side. */
const PAYOUT_API_DETAIL_KEYS = new Set([
  'coin',
  'network',
  'address',
  'upi_id',
  'account_holder',
  'account_number',
  'ifsc',
  'bank_name'
]);

export function payoutLabelSaveError(label: string, saveAttempted: boolean): string | null {
  if (!saveAttempted) {
    return null;
  }
  if (!label.trim()) {
    return 'Enter a label for this account';
  }
  if (label.trim().length > 80) {
    return 'Label must be at most 80 characters';
  }
  return null;
}

export function buildPayoutApiBody(input: {
  paymentMethodId: number;
  label: string;
  paymentDetails: Record<string, string>;
  isDefault?: boolean;
}): Record<string, string | number | boolean> {
  const body: Record<string, string | number | boolean> = {
    payment_method_id: input.paymentMethodId,
    label: input.label.trim().slice(0, 80) || 'Default'
  };

  const walletAddress = resolveCryptoPayoutAddress(input.paymentDetails);
  if (walletAddress) {
    body['address'] = walletAddress.slice(0, 200);
  }

  for (const [key, value] of Object.entries(input.paymentDetails)) {
    if (!PAYOUT_API_DETAIL_KEYS.has(key) || key === 'address' || key === 'wallet_address') {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      body[key] = trimmed;
    }
  }

  if (input.isDefault != null) {
    body['is_default'] = input.isDefault;
  }

  return body;
}

export function buildWithdrawPayload(input: ConfirmWithdrawInput): ConfirmWithdrawPayload | null {
  const paymentMethodId = Number(input.paymentMethodId);
  const paymentAmount = Number(input.amount);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return null;
  }

  if (!CONFIRM_WITHDRAW_METHOD_IDS.includes(paymentMethodId as 1 | 2 | 3)) {
    return null;
  }

  const payload: ConfirmWithdrawPayload = {
    amount: paymentAmount,
    payment_method_id: paymentMethodId
  };

  const playerNote = input.playerNote?.trim();
  if (playerNote) {
    payload.player_note = playerNote.slice(0, 500);
  }

  if (input.payoutMethodId != null && Number.isFinite(Number(input.payoutMethodId))) {
    payload.payout_method_id = Number(input.payoutMethodId);
  }

  const withdrawProofUrl = input.withdrawProofUrl?.trim();
  if (withdrawProofUrl) {
    payload.withdraw_proof_url = withdrawProofUrl.slice(0, 2000);
  }

  const payoutDetails = input.payoutDetails;

  if (paymentMethodId === UPI_WITHDRAW_METHOD_ID) {
    const upiId = payoutDetails['upi_id']?.trim();
    if (!upiId || upiId.length < 3) {
      return null;
    }
    payload.upi_id = upiId.slice(0, 100);
    return payload;
  }

  if (paymentMethodId === BANK_WITHDRAW_METHOD_ID) {
    const accountHolder = payoutDetails['account_holder']?.trim();
    const accountNumber = payoutDetails['account_number']?.trim();
    const ifscCode = payoutDetails['ifsc']?.trim();
    const bankName = payoutDetails['bank_name']?.trim();
    if (!accountHolder || !accountNumber || !ifscCode || !bankName) {
      return null;
    }
    payload.account_holder = accountHolder;
    payload.account_number = accountNumber;
    payload.ifsc = ifscCode;
    payload.bank_name = bankName;
    return payload;
  }

  if (paymentMethodId === CRYPTO_WITHDRAW_METHOD_ID) {
    const walletAddress = (payoutDetails['address'] || payoutDetails['wallet_address'])?.trim();
    const coin = (payoutDetails['coin'] || input.coinFallback)?.trim();
    if (!walletAddress || walletAddress.length < 8 || !coin) {
      return null;
    }
    payload.coin = coin.slice(0, 20);
    payload.address = walletAddress.slice(0, 200);
    const network = (payoutDetails['network'] || input.networkFallback)?.trim();
    if (network) {
      payload.network = network.slice(0, 40);
    }
    return payload;
  }

  return null;
}

export const UPI_WITHDRAW_METHOD_ID = 1;
export const BANK_WITHDRAW_METHOD_ID = 2;
export const CRYPTO_WITHDRAW_METHOD_ID = 3;
export const CONFIRM_WITHDRAW_METHOD_IDS = [1, 2, 3] as const;

/** Matches backend `confirmWithdrawFieldsSchema` (unknown keys rejected). */
export interface ConfirmWithdrawPayload {
  amount: number;
  payment_method_id: number;
  coin?: string | null;
  network?: string | null;
  address?: string | null;
  upi_id?: string | null;
  account_holder?: string | null;
  account_number?: string | null;
  ifsc?: string | null;
  bank_name?: string | null;
  payout_method_id?: number | null;
  withdraw_proof_url?: string | null;
  player_note?: string | null;
}

export interface ConfirmWithdrawInput {
  amount: number;
  paymentMethodId: number;
  payoutDetails: Record<string, string>;
  payoutMethodId?: number | null;
  playerNote?: string;
  withdrawProofUrl?: string | null;
  coinFallback?: string;
  networkFallback?: string;
}

export function isUpiWithdrawMethodId(paymentMethodId: number | null | undefined): boolean {
  return paymentMethodId === UPI_WITHDRAW_METHOD_ID;
}

export function isBankWithdrawMethodId(paymentMethodId: number | null | undefined): boolean {
  return paymentMethodId === BANK_WITHDRAW_METHOD_ID;
}

export function isCryptoWithdrawMethodId(paymentMethodId: number | null | undefined): boolean {
  return paymentMethodId === CRYPTO_WITHDRAW_METHOD_ID;
}

const BANK_WITHDRAW_CODES = new Set(['BANK', 'BANK_TRANSFER', 'IMPS', 'NEFT', 'RTGS', 'NETBANKING']);
const CRYPTO_WITHDRAW_CODES = new Set([
  'CRYPTO', 'CRYPTOCURRENCY', 'BTC', 'BITCOIN', 'ETH', 'ETHEREUM',
  'USDT', 'USDC', 'BNB', 'SOL', 'TRX', 'XRP', 'DOGE'
]);

const CRYPTO_COIN_ALIASES: Record<string, string> = {
  BITCOIN: 'BTC',
  ETHEREUM: 'ETH',
  TETHER: 'USDT'
};

const CRYPTO_NETWORK_ALIASES: Record<string, string> = {
  BITCOIN: 'BTC',
  BTC: 'BTC',
  ETHEREUM: 'ETH',
  ETH: 'ETH',
  ERC20: 'ERC20',
  TRC20: 'TRC20',
  BEP20: 'BEP20'
};

export function normalizeCryptoCoin(coin: string): string {
  const normalized = coin.trim().toUpperCase();
  return CRYPTO_COIN_ALIASES[normalized] || normalized;
}

export function normalizeCryptoNetwork(network: string): string {
  const normalized = network.trim().toUpperCase();
  return CRYPTO_NETWORK_ALIASES[normalized] || normalized;
}

export function isCryptoWithdrawContext(input: {
  paymentMethodId?: number | null;
  paymentMethodCode?: string | null;
  kind?: string | null;
  cryptoCode?: string | null;
  walletKey?: string | null;
  paymentDetails?: Record<string, string> | null;
}): boolean {
  if (input.kind === 'fiat_in' || input.kind === 'bank') {
    return false;
  }
  if (input.kind === 'crypto') {
    return true;
  }
  if (isCryptoAssetCode(input.cryptoCode)) {
    return true;
  }
  if (input.paymentMethodId === CRYPTO_WITHDRAW_METHOD_ID) {
    return true;
  }

  const code = (input.paymentMethodCode || '').trim().toUpperCase();
  const walletKey = (input.walletKey || '').trim().toUpperCase();
  if (CRYPTO_WITHDRAW_CODES.has(code) || code.includes('CRYPTO')) {
    return true;
  }
  if (CRYPTO_WITHDRAW_CODES.has(walletKey)) {
    return true;
  }

  const details = input.paymentDetails;
  if (
    details
    && (resolveCryptoPayoutAddress(details) || details['coin']?.trim())
    && input.paymentMethodId !== UPI_WITHDRAW_METHOD_ID
    && input.paymentMethodId !== BANK_WITHDRAW_METHOD_ID
  ) {
    return true;
  }

  return false;
}

export function resolveWithdrawPaymentMethodId(input: {
  paymentMethodId?: number | null;
  paymentMethodCode?: string | null;
  kind?: string | null;
  cryptoCode?: string | null;
  walletKey?: string | null;
  paymentDetails?: Record<string, string> | null;
}): number | null {
  const walletKey = (input.walletKey || '').trim().toUpperCase();
  const code = (input.paymentMethodCode || '').trim().toUpperCase();

  if (code === 'UPI' || walletKey === 'UPI') {
    return UPI_WITHDRAW_METHOD_ID;
  }
  if (BANK_WITHDRAW_CODES.has(code) || code.includes('BANK') || walletKey === 'BANK') {
    return BANK_WITHDRAW_METHOD_ID;
  }
  if (isCryptoWithdrawContext(input)) {
    return CRYPTO_WITHDRAW_METHOD_ID;
  }

  const paymentMethodId = Number(input.paymentMethodId);
  if (Number.isFinite(paymentMethodId) && CONFIRM_WITHDRAW_METHOD_IDS.includes(paymentMethodId as 1 | 2 | 3)) {
    return paymentMethodId;
  }

  return Number.isFinite(paymentMethodId) ? paymentMethodId : null;
}

export function confirmWithdrawValidationError(
  input: ConfirmWithdrawInput,
  min: number,
  max: number | null,
  unit: string,
  availableBalance: number,
  submitAttempted: boolean
): string | null {
  if (!submitAttempted) {
    return null;
  }

  const amountErrorMessage = amountValidationError(
    String(input.amount),
    min,
    max,
    unit,
    true,
    availableBalance
  );
  if (amountErrorMessage) {
    return amountErrorMessage;
  }

  if (!CONFIRM_WITHDRAW_METHOD_IDS.includes(input.paymentMethodId as 1 | 2 | 3)) {
    return 'Invalid payment method';
  }

  if (input.payoutMethodId == null) {
    return 'Select or add a payout account';
  }

  const payoutDetails = input.payoutDetails;

  if (isUpiWithdrawMethodId(input.paymentMethodId)) {
    const upiId = payoutDetails['upi_id']?.trim() ?? '';
    if (upiId.length < 3) {
      return 'UPI ID must be at least 3 characters';
    }
    if (upiId.length > 100) {
      return 'UPI ID must be at most 100 characters';
    }
  }

  if (isBankWithdrawMethodId(input.paymentMethodId)) {
    if (!payoutDetails['account_holder']?.trim()) {
      return 'Account holder name is required';
    }
    if (!payoutDetails['account_number']?.trim()) {
      return 'Account number is required';
    }
    if (!payoutDetails['ifsc']?.trim()) {
      return 'IFSC code is required';
    }
    if (!payoutDetails['bank_name']?.trim()) {
      return 'Bank name is required';
    }
  }

  if (isCryptoWithdrawMethodId(input.paymentMethodId)) {
    const coin = (payoutDetails['coin'] || input.coinFallback)?.trim() ?? '';
    const walletAddress = (payoutDetails['address'] || payoutDetails['wallet_address'])?.trim() ?? '';
    if (!coin) {
      return 'Coin is required';
    }
    if (coin.length > 20) {
      return 'Coin must be at most 20 characters';
    }
    if (!walletAddress || walletAddress.length < 8) {
      return 'Wallet address must be at least 8 characters';
    }
    if (walletAddress.length > 200) {
      return 'Wallet address must be at most 200 characters';
    }
    const network = (payoutDetails['network'] || input.networkFallback)?.trim();
    if (network && network.length > 40) {
      return 'Network must be at most 40 characters';
    }
  }

  if (input.playerNote && input.playerNote.trim().length > 500) {
    return 'Note must be at most 500 characters';
  }

  const withdrawProofUrl = input.withdrawProofUrl?.trim();
  if (withdrawProofUrl && withdrawProofUrl.length > 2000) {
    return 'Withdraw proof URL must be at most 2000 characters';
  }

  return null;
}

export const CONFIRM_DEPOSIT_METHOD_IDS = [1, 2, 3, 4] as const;
export const CRYPTO_DEPOSIT_METHOD_ID = 3;
export const UTR_DEPOSIT_METHOD_IDS = [1, 2] as const;

/** Matches backend `confirmDepositFieldsSchema` (unknown keys rejected). */
export interface ConfirmDepositPayload {
  amount: number;
  payment_method_id: number;
  coin?: string | null;
  network?: string | null;
  tx_hash?: string | null;
  sender_wallet_address?: string | null;
  utr?: string | null;
  player_note?: string | null;
  currency_code?: string | null;
}

export interface ConfirmDepositInput {
  amount: number;
  paymentMethodId: number;
  currencyCode?: string;
  utr?: string;
  coin?: string;
  network?: string;
  txHash?: string;
  senderWalletAddress?: string;
  playerNote?: string;
  screenshot?: File | null;
  depositProof?: File | null;
}

export const DEPOSIT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const DEPOSIT_PROOF_ACCEPT = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';

export function isDepositProofFileValid(file: File | null | undefined): boolean {
  if (!file) {
    return false;
  }
  if (file.size > DEPOSIT_PROOF_MAX_BYTES) {
    return false;
  }
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  return (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'application/pdf' ||
    /\.(jpe?g|png|pdf)$/.test(fileName)
  );
}

export function isUtrDepositMethodId(paymentMethodId: number | null | undefined): boolean {
  return paymentMethodId === 1 || paymentMethodId === 2;
}

export function isCryptoDepositMethodId(paymentMethodId: number | null | undefined): boolean {
  return paymentMethodId === CRYPTO_DEPOSIT_METHOD_ID;
}

export function buildConfirmDepositPayload(input: ConfirmDepositInput): ConfirmDepositPayload | null {
  const paymentAmount = Number(input.amount);
  const paymentMethodId = Number(input.paymentMethodId);

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return null;
  }

  if (!CONFIRM_DEPOSIT_METHOD_IDS.includes(paymentMethodId as 1 | 2 | 3 | 4)) {
    return null;
  }

  const payload: ConfirmDepositPayload = {
    amount: paymentAmount,
    payment_method_id: paymentMethodId
  };

  const playerNote = input.playerNote?.trim();
  if (playerNote) {
    payload.player_note = playerNote.slice(0, 500);
  }

  if (paymentMethodId === CRYPTO_DEPOSIT_METHOD_ID) {
    const coin = input.coin?.trim();
    const txHash = input.txHash?.trim();
    const senderWalletAddress = input.senderWalletAddress?.trim();
    if (!coin || !txHash || !senderWalletAddress) {
      return null;
    }
    if (txHash.length < 8 || senderWalletAddress.length < 8) {
      return null;
    }

    payload.coin = coin.slice(0, 20);
    payload.tx_hash = txHash.slice(0, 200);
    payload.sender_wallet_address = senderWalletAddress.slice(0, 200);

    const network = input.network?.trim();
    if (network) {
      payload.network = network.slice(0, 40);
    }

    return payload;
  }

  if (isUtrDepositMethodId(paymentMethodId)) {
    const utr = input.utr?.trim();
    if (!utr || utr.length < 4) {
      return null;
    }
    payload.utr = utr.slice(0, 120);
    return payload;
  }

  const utr = input.utr?.trim();
  if (utr) {
    payload.utr = utr.slice(0, 120);
  }

  const network = input.network?.trim();
  if (network) {
    payload.network = network.slice(0, 40);
  }

  return payload;
}

/** Builds multipart FormData for POST /api/payment/deposit (not JSON-encrypted). */
export function buildConfirmDepositFormData(input: ConfirmDepositInput): FormData | null {
  const fields = buildConfirmDepositPayload(input);
  if (!fields) {
    return null;
  }

  const formData = new FormData();
  formData.append('amount', String(fields.amount));
  formData.append('payment_method_id', String(fields.payment_method_id));
  formData.append('currency_code', fields.currency_code || 'USD');

  if (fields.player_note) {
    formData.append('player_note', fields.player_note);
  }
  if (fields.utr) {
    formData.append('utr', fields.utr);
  }
  if (fields.coin) {
    formData.append('coin', fields.coin);
  }
  if (fields.network) {
    formData.append('network', fields.network);
  }
  if (fields.tx_hash) {
    formData.append('tx_hash', fields.tx_hash);
  }
  if (fields.sender_wallet_address) {
    formData.append('sender_wallet_address', fields.sender_wallet_address);
  }

  const screenshot = input.screenshot ?? null;
  const depositProof = input.depositProof ?? null;

  if (isCryptoDepositMethodId(fields.payment_method_id)) {
    if (!depositProof && !screenshot) {
      return null;
    }
    if (depositProof) {
      formData.append('deposit_proof', depositProof, depositProof.name);
    } else if (screenshot) {
      formData.append('screenshot', screenshot, screenshot.name);
    }
  } else {
    if (screenshot) {
      formData.append('screenshot', screenshot, screenshot.name);
    }
    if (depositProof) {
      formData.append('deposit_proof', depositProof, depositProof.name);
    }
  }

  return formData;
}

export function confirmDepositValidationError(
  input: ConfirmDepositInput,
  submitAttempted: boolean
): string | null {
  if (!submitAttempted) {
    return null;
  }

  const paymentAmount = Number(input.amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return 'Amount must be greater than zero';
  }

  if (!CONFIRM_DEPOSIT_METHOD_IDS.includes(input.paymentMethodId as 1 | 2 | 3 | 4)) {
    return 'Invalid payment method';
  }

  if (isCryptoDepositMethodId(input.paymentMethodId)) {
    if (!input.coin?.trim()) {
      return 'Coin is required';
    }
    if (!input.txHash?.trim() || input.txHash.trim().length < 8) {
      return 'Transaction hash must be at least 8 characters';
    }
    if (!input.senderWalletAddress?.trim() || input.senderWalletAddress.trim().length < 8) {
      return 'Sender wallet address must be at least 8 characters';
    }
    if (input.network && input.network.trim().length > 40) {
      return 'Network must be at most 40 characters';
    }
    if (!input.screenshot && !input.depositProof) {
      return 'Deposit proof or screenshot is required for crypto deposits';
    }
  }

  const proofFile = input.depositProof ?? input.screenshot ?? null;
  if (proofFile && !isDepositProofFileValid(proofFile)) {
    return 'File must be JPG, PNG or PDF (max 10MB)';
  }

  if (isUtrDepositMethodId(input.paymentMethodId)) {
    if (!input.utr?.trim() || input.utr.trim().length < 4) {
      return 'UTR must be at least 4 characters';
    }
  }

  if (input.playerNote && input.playerNote.trim().length > 500) {
    return 'Note must be at most 500 characters';
  }

  return null;
}

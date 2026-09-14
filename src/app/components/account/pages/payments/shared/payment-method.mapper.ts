import type { DepositWalletApi, PaymentConfigData, PaymentMethodApi, PayoutChannelApi } from '../../../../../services/payment.service';
import { PAYMENT_METHOD_ICONS, paymentMethodIcon, type PaymentMethod } from './payment-method.data';
import { CRYPTO_WITHDRAW_METHOD_ID, resolveWithdrawPaymentMethodId } from './payment.helpers';

const UPI_ICON = paymentMethodIcon('upi-qr');
const BANK_ICON = paymentMethodIcon('netbanking');

const BANK_METHOD_CODES = new Set(['BANK', 'BANK_TRANSFER', 'IMPS', 'NEFT', 'RTGS', 'NETBANKING']);
const CRYPTO_METHOD_CODES = new Set(['CRYPTO', 'CRYPTOCURRENCY', 'BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'USDT', 'USDC', 'BNB', 'SOL', 'TRX', 'XRP', 'DOGE']);
const BANK_CREDENTIAL_KEYS = new Set([
  'bank_name', 'account_holder', 'account_holder_name', 'account_name',
  'account_number', 'ifsc', 'ifsc_code', 'branch', 'branch_name', 'account_type'
]);

export function mapDepositMethodsFromConfig(data: PaymentConfigData): PaymentMethod[] {
  const enabledIds = new Set(data.config.enabled_payment_method_ids ?? []);
  const methodById = new Map(
    data.payment_methods
      .filter((method) => enabledIds.has(method.id))
      .filter((method) => method.direction === 'BOTH' || method.direction === 'DEPOSIT')
      .map((method) => [method.id, method])
  );

  return data.deposit_wallets
    .filter((wallet) => wallet.is_active && wallet.is_configured)
    .filter((wallet) => methodById.has(wallet.payment_method_id))
    .sort((a, b) => a.display_order - b.display_order)
    .map((wallet) => toDepositMethod(methodById.get(wallet.payment_method_id)!, wallet));
}

export function mapWithdrawMethodsFromPayoutChannels(channels: PayoutChannelApi[]): PaymentMethod[] {
  return channels
    .filter((channel) => channel.is_configured)
    .sort((a, b) => a.display_order - b.display_order)
    .map((channel) => toWithdrawMethod(channel));
}

export function buildPayoutChannelsFromConfig(data: PaymentConfigData): PayoutChannelApi[] {
  const enabledIds = new Set(data.config.enabled_payment_method_ids ?? []);
  const withdrawMethodIds = new Set(
    data.payment_methods
      .filter((method) => enabledIds.has(method.id))
      .filter((method) => method.direction === 'BOTH' || method.direction === 'WITHDRAW')
      .map((method) => method.id)
  );

  return data.deposit_wallets
    .filter((wallet) => wallet.is_active !== false)
    .filter((wallet) => wallet.payment_method_code?.toUpperCase() !== 'CASH')
    .filter((wallet) => withdrawMethodIds.has(wallet.payment_method_id))
    .sort((a, b) => a.display_order - b.display_order)
    .map((wallet) => depositWalletToPayoutChannel(wallet));
}

export function resolveWithdrawPayoutChannels(
  apiChannels: PayoutChannelApi[],
  config: PaymentConfigData
): PayoutChannelApi[] {
  if (apiChannels.length > 0) {
    return apiChannels;
  }
  return buildPayoutChannelsFromConfig(config);
}

function depositWalletToPayoutChannel(wallet: DepositWalletApi): PayoutChannelApi {
  return {
    payment_method_id: wallet.payment_method_id,
    payment_method_code: wallet.payment_method_code,
    display_name: wallet.display_name,
    wallet_key: wallet.wallet_key,
    credential_fields: wallet.credential_fields ?? [],
    is_configured: true,
    display_order: wallet.display_order,
    crypto_code: wallet.crypto_code ?? null,
    network: wallet.network ?? null,
    catalog_id: wallet.catalog_id
  };
}

function toWithdrawMethod(channel: PayoutChannelApi): PaymentMethod {
  const code = channel.payment_method_code.toUpperCase();
  const walletKey = channel.wallet_key.toUpperCase();
  const cryptoCode = channel.crypto_code?.trim().toUpperCase()
    || (walletKey.match(/^(BTC|ETH|USDT|USDC|BNB|SOL|TRX|XRP|DOGE)$/) ? walletKey : '');
  const channelKey = [
    channel.payment_method_id,
    channel.wallet_key,
    channel.crypto_code,
    channel.network,
    channel.catalog_id,
    channel.display_order
  ]
    .filter((value) => value != null && value !== '')
    .join('-');
  const base = {
    id: `withdraw-${channelKey}`,
    paymentMethodId: channel.payment_method_id,
    label: channel.display_name,
    feeLabel: channel.display_name,
    processingTime: '1–3 business days',
    credentialFields: channel.credential_fields,
    cryptoCode: cryptoCode || undefined,
    network: channel.network ?? undefined
  };

  if (code === 'UPI' || walletKey === 'UPI') {
    return {
      ...base,
      paymentMethodId: resolveWithdrawPaymentMethodId({
        paymentMethodId: channel.payment_method_id,
        paymentMethodCode: channel.payment_method_code,
        walletKey: channel.wallet_key,
        kind: 'fiat_in'
      }) ?? channel.payment_method_id,
      iconUrl: UPI_ICON,
      kind: 'fiat_in',
      currency: 'INR',
      processingTime: 'Instant'
    };
  }

  if (BANK_METHOD_CODES.has(code) || code.includes('BANK') || walletKey === 'BANK') {
    return {
      ...base,
      paymentMethodId: resolveWithdrawPaymentMethodId({
        paymentMethodId: channel.payment_method_id,
        paymentMethodCode: channel.payment_method_code,
        walletKey: channel.wallet_key,
        kind: 'bank'
      }) ?? channel.payment_method_id,
      iconUrl: resolveBankIcon(code),
      kind: 'bank',
      currency: 'INR',
      processingTime: '1–2 business days'
    };
  }

  if (cryptoCode || CRYPTO_METHOD_CODES.has(code) || code.includes('CRYPTO')) {
    const asset = cryptoCode || resolveCryptoAssetCode(code);
    return {
      ...base,
      paymentMethodId: resolveWithdrawPaymentMethodId({
        paymentMethodId: channel.payment_method_id,
        paymentMethodCode: channel.payment_method_code,
        walletKey: channel.wallet_key,
        cryptoCode: asset,
        kind: 'crypto'
      }) ?? CRYPTO_WITHDRAW_METHOD_ID,
      iconUrl: resolveCryptoIcon(asset, channel.network ?? ''),
      kind: 'crypto',
      currency: asset,
      processingTime: '5–60 min'
    };
  }

  return {
    ...base,
    paymentMethodId: resolveWithdrawPaymentMethodId({
      paymentMethodId: channel.payment_method_id,
      paymentMethodCode: channel.payment_method_code,
      walletKey: channel.wallet_key,
      kind: 'fiat_in'
    }) ?? channel.payment_method_id,
    iconUrl: resolveMethodIconFromCode(code),
    kind: 'fiat_in',
    currency: 'INR',
    processingTime: 'Instant'
  };
}

function toDepositMethod(method: PaymentMethodApi, wallet: DepositWalletApi): PaymentMethod {
  const code = method.code.toUpperCase();
  const credentials = wallet.credentials ?? {};
  const base = {
    id: `wallet-${wallet.brand_wallet_id}`,
    brandWalletId: wallet.brand_wallet_id,
    paymentMethodId: method.id,
    label: wallet.display_name || method.name,
    feeLabel: method.description || method.name
  };

  if (code === 'UPI' || wallet.wallet_key?.toUpperCase() === 'UPI') {
    return { ...base, iconUrl: UPI_ICON, kind: 'upi_qr', currency: 'INR', processingTime: 'Instant', feeLabel: method.description || 'No platform fee' };
  }

  if (isBankMethod(code, wallet, credentials)) {
    return { ...base, iconUrl: resolveBankIcon(code), kind: 'bank', currency: 'INR', processingTime: '15–60 min', feeLabel: method.description || 'Bank transfer' };
  }

  if (isCryptoMethod(code, wallet)) {
    const cryptoCode = resolveWalletCryptoCode(wallet, code);
    return {
      ...base,
      label: resolveCryptoLabel(wallet, method, cryptoCode),
      iconUrl: resolveCryptoIcon(cryptoCode, wallet.network ?? ''),
      kind: 'crypto',
      currency: cryptoCode,
      network: wallet.network ?? undefined,
      processingTime: '5–60 min',
      feeLabel: method.description || `${cryptoCode} transfer`
    };
  }

  return { ...base, iconUrl: resolveMethodIcon(code, wallet), kind: 'fiat_in', currency: 'INR', processingTime: 'Instant' };
}

function isBankMethod(code: string, wallet: DepositWalletApi, credentials: DepositWalletApi['credentials']): boolean {
  if (wallet.wallet_key?.toUpperCase() === 'BANK' || BANK_METHOD_CODES.has(code)) {
    return true;
  }
  return Object.keys(credentials ?? {}).some((key) => BANK_CREDENTIAL_KEYS.has(key));
}

function isCryptoMethod(code: string, wallet: DepositWalletApi): boolean {
  if (wallet.crypto_code || wallet.wallet_key?.match(/^(BTC|ETH|USDT|USDC|BNB|SOL|TRX|XRP|DOGE)$/i)) {
    return true;
  }
  return CRYPTO_METHOD_CODES.has(code) || code.includes('CRYPTO');
}

function resolveWalletCryptoCode(wallet: DepositWalletApi, methodCode: string): string {
  if (wallet.crypto_code?.trim()) {
    return wallet.crypto_code.trim().toUpperCase();
  }
  if (wallet.wallet_key?.trim()) {
    return wallet.wallet_key.trim().toUpperCase();
  }
  return resolveCryptoAssetCode(methodCode);
}

function resolveCryptoLabel(wallet: DepositWalletApi, method: PaymentMethodApi, cryptoCode: string): string {
  if (wallet.display_name?.trim()) {
    return wallet.display_name.trim();
  }
  if (wallet.network?.trim()) {
    return `${cryptoCode} (${wallet.network.trim()})`;
  }
  return method.name || cryptoCode;
}

function resolveCryptoAssetCode(code: string): string {
  if (code === 'BITCOIN' || code === 'BTC') return 'BTC';
  if (code === 'ETHEREUM' || code === 'ETH') return 'ETH';
  if (code === 'CRYPTOCURRENCY' || code === 'CRYPTO') return 'BTC';
  return code;
}

function resolveMethodIcon(code: string, wallet: DepositWalletApi): string {
  const walletKey = wallet.wallet_key?.toLowerCase() ?? '';
  for (const matcher of [code.toLowerCase(), code.toLowerCase().replace(/_/g, '-'), walletKey, walletKey.replace(/_/g, '-')]) {
    if (PAYMENT_METHOD_ICONS[matcher]) {
      return PAYMENT_METHOD_ICONS[matcher];
    }
  }
  return UPI_ICON;
}

function resolveMethodIconFromCode(code: string): string {
  const matcher = code.toLowerCase().replace(/_/g, '-');
  return PAYMENT_METHOD_ICONS[matcher] ?? UPI_ICON;
}

function resolveBankIcon(code: string): string {
  if (code === 'IMPS') return paymentMethodIcon('imps');
  if (code === 'NETBANKING') return paymentMethodIcon('netbanking');
  return BANK_ICON;
}

function resolveCryptoIcon(cryptoCode: string, network: string): string {
  const asset = cryptoCode.toUpperCase();
  const net = network.toUpperCase();

  if (asset === 'BTC' || asset === 'BITCOIN') return paymentMethodIcon('bitcoin');
  if (asset === 'ETH' || asset === 'ETHEREUM') return paymentMethodIcon('ethereum');
  if (asset === 'USDT') {
    if (net.includes('TRC')) return paymentMethodIcon('usdt-trc20');
    if (net.includes('ERC')) return paymentMethodIcon('usdt-erc20');
    if (net.includes('BEP') || net.includes('BSC')) return paymentMethodIcon('usdt-bep20');
    if (net.includes('TON')) return paymentMethodIcon('usdt-ton');
    return paymentMethodIcon('usdt-trc20');
  }
  if (asset === 'USDC') {
    if (net.includes('POLYGON')) return paymentMethodIcon('usdc-polygon');
    if (net.includes('ERC')) return paymentMethodIcon('usdc-erc20');
    return paymentMethodIcon('usdc-bep20');
  }
  if (asset === 'BNB') return paymentMethodIcon('bnb-bep20');
  if (asset === 'SOL' || asset === 'SOLANA') return paymentMethodIcon('solana');
  if (asset === 'TRX') return paymentMethodIcon('trx');
  if (asset === 'XRP') return paymentMethodIcon('xrp');
  if (asset === 'DOGE') return paymentMethodIcon('doge-bep20');

  return paymentMethodIcon('bitcoin');
}

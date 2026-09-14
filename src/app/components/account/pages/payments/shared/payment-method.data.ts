export type PaymentMethodKind = 'crypto' | 'fiat_in' | 'upi_qr' | 'bank';

export interface PaymentMethod {
  id: string;
  label: string;
  iconUrl: string;
  kind: PaymentMethodKind;
  currency: string;
  network?: string;
  processingTime: string;
  feeLabel: string;
  paymentMethodId?: number;
  brandWalletId?: number;
  credentialFields?: string[];
  cryptoCode?: string;
}

const CDN = 'https://oncf.the-cdn.com/payment-methods/icons/v1';

/** Icon lookup for API-backed payment methods */
export const PAYMENT_METHOD_ICONS: Record<string, string> = {
  'upi-qr': `${CDN}/upi-mini.b135e95de7b96170bee9ca28c4ca02c2.svg`,
  upi: `${CDN}/upi-mini.b135e95de7b96170bee9ca28c4ca02c2.svg`,
  imps: `${CDN}/imps-mini.fac3e43a9fea8c46215b17f6501adecb.svg`,
  netbanking: `${CDN}/internet_bank_india-mini.a778217661e870e32974d3131dc019e0.svg`,
  bitcoin: `${CDN}/bitcoin-mini.c7c07a32a234ee841bbfd6cc325fd79f.svg`,
  ethereum: `${CDN}/ethereum-mini.23578765207774f2ebe0b43fbfe41f2c.svg`,
  'usdt-trc20': `${CDN}/tether_trc20-mini.449f37398945f3d6bce614b9fd3a90b2.svg`,
  'usdt-erc20': `${CDN}/tether_erc20-mini.c6be9259942011e5760d16ee23e2c7f3.svg`,
  'usdt-bep20': `${CDN}/tether_bep20-mini.8fa8451cfd1c2d57c10985e55d5def06.svg`,
  'usdt-ton': `${CDN}/usdt_ton-mini.84d1374085323ea61ff6cb6ba9b169e2.svg`,
  'usdc-bep20': `${CDN}/usdc_bep20-mini.ce65da231c8d4ab53452df3cbcd4ff22.svg`,
  'usdc-erc20': `${CDN}/usdc_erc20-mini.19c0c3968e55b5434088dc13e1cb6d03.svg`,
  'usdc-polygon': `${CDN}/usdc_polygon-mini.5093c1e60ba15c691072ee3581ef1655.svg`,
  'bnb-bep20': `${CDN}/bnb-mini.f0da56812759eb126996152b391aa575.svg`,
  solana: `${CDN}/solana-mini.2e0ff0845035ee4f7f7b789da02525ce.svg`,
  trx: `${CDN}/trx-mini.8d9ee7a01928e0a081fd299f25a4b2ff.svg`,
  xrp: `${CDN}/xrp-mini.9c1bea325d855814b4ea9c7490776ced.svg`,
  'doge-bep20': `${CDN}/doge_bep20-mini.fbd83145d839c2b61ef8027083951fe8.svg`
};

const DEFAULT_ICON = PAYMENT_METHOD_ICONS['upi-qr'];

export function paymentMethodIcon(id: string): string {
  return PAYMENT_METHOD_ICONS[id] ?? DEFAULT_ICON;
}

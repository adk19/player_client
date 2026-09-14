export enum MarketType {
  CRYPTO = 1,
  FOREX = 2,
  COMMODITY = 3,
  STOCK = 4,
  INDEX = 5,
  METAL = 6,
  ETFS = 7,
  FORWARDS = 8,
  MCX = 9,
}

export const MARKET_MT_TY: Partial<Record<MarketType, string>> = {
  [MarketType.CRYPTO]: 'CRYPTO',
  [MarketType.FOREX]: 'FOREX',
  [MarketType.COMMODITY]: 'COMMODITY',
  [MarketType.STOCK]: 'STOCK',
  [MarketType.INDEX]: 'INDEX',
  [MarketType.METAL]: 'METAL',
  [MarketType.ETFS]: 'ETFS',
  [MarketType.FORWARDS]: 'FORWARDS',
  [MarketType.MCX]: 'MCX',
};

export const MARKET_MT_TY_CODE: Partial<Record<MarketType, number>> = {
  [MarketType.CRYPTO]: 1,
  [MarketType.FOREX]: 2,
  [MarketType.COMMODITY]: 3,
  [MarketType.STOCK]: 4,
  [MarketType.INDEX]: 5,
  [MarketType.METAL]: 6,
  [MarketType.ETFS]: 7,
  [MarketType.FORWARDS]: 8,
  [MarketType.MCX]: 9,
};

export const MARKET_SLUG: Record<MarketType, string> = {
  [MarketType.CRYPTO]: 'crypto',
  [MarketType.FOREX]: 'forex',
  [MarketType.COMMODITY]: 'commodity',
  [MarketType.STOCK]: 'stock',
  [MarketType.INDEX]: 'index',
  [MarketType.METAL]: 'metal',
  [MarketType.ETFS]: 'etfs',
  [MarketType.FORWARDS]: 'forwards',
  [MarketType.MCX]: 'mcx',
};

export const SLUG_TO_MARKET: Record<string, MarketType> = {
  crypto: MarketType.CRYPTO,
  forex: MarketType.FOREX,
  commodity: MarketType.COMMODITY,
  stock: MarketType.STOCK,
  index: MarketType.INDEX,
  metal: MarketType.METAL,
  etfs: MarketType.ETFS,
  forwards: MarketType.FORWARDS,
  mcx: MarketType.MCX,
};
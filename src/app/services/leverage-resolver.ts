import type { PlayerDetailsLeveragePlan } from './player-details.models';

export interface LeverageResolveInput {
  symbol: string;
  /** From pair / market API when available */
  marketTypeId?: number | null;
  /** e.g. "Crypto", "Forex", "stock" — matched against plan.market_types.name */
  marketTypeName?: string | null;
}

export interface LeverageResolveResult {
  defaultLeverage: number;
  maxLeverage: number;
  minLeverage: number;
  /** Plan-wide default (leverage_ratio) before symbol/type overrides */
  planDefaultLeverage: number;
  source: 'instrument' | 'market_type' | 'plan' | 'fallback';
  /** Label for UI, e.g. "XAUUSD" or "Forex" */
  sourceLabel: string;
}

export function normalizeTradeSymbol(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function toPositiveInt(n: unknown, fallback = 0): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function normalizeMarketTypeName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

/**
 * Resolves market_type_id for leverage_plan.market_types lookup.
 * Prefers name match (markets API IDs can disagree with plan IDs), then plan ID.
 */
export function resolvePlanMarketTypeId(
  plan: PlayerDetailsLeveragePlan | null | undefined,
  input: Pick<LeverageResolveInput, 'marketTypeId' | 'marketTypeName'>
): number | null {
  const types = plan?.market_types ?? [];
  if (!types.length) {
    return input.marketTypeId ?? null;
  }

  const normName = normalizeMarketTypeName(input.marketTypeName);
  if (normName) {
    const byName = types.find((r) => normalizeMarketTypeName(r.name) === normName);
    if (byName) return byName.market_type_id;
  }

  if (input.marketTypeId != null) {
    const byId = types.find((r) => r.market_type_id === input.marketTypeId);
    if (byId) return byId.market_type_id;
  }

  return input.marketTypeId ?? null;
}

function findInstrumentLeverage(
  plan: PlayerDetailsLeveragePlan,
  symbol: string
): { ratio: number; symbol: string } | null {
  const norm = normalizeTradeSymbol(symbol);
  if (!norm) return null;

  for (const row of plan.instruments ?? []) {
    if (normalizeTradeSymbol(row.symbol) === norm) {
      const ratio = toPositiveInt(row.leverage_ratio, 0);
      if (ratio) return { ratio, symbol: row.symbol };
    }
  }
  return null;
}

function findMarketTypeLeverage(
  plan: PlayerDetailsLeveragePlan,
  marketTypeId: number | null
): { ratio: number; name: string } | null {
  if (marketTypeId == null) return null;
  const row = plan.market_types?.find((r) => r.market_type_id === marketTypeId);
  if (!row) return null;
  const ratio = toPositiveInt(row.leverage_ratio, 0);
  if (!ratio) return null;
  return { ratio, name: row.name };
}

type CustomLeverageMatch = {
  ratio: number;
  /** How specific the custom row was — global must not raise past instrument/market limits. */
  specificity: 'symbol' | 'market_type' | 'global';
};

function parseCustomLeverageMax(
  custom: unknown,
  input: LeverageResolveInput,
  planMarketTypeId: number | null
): CustomLeverageMatch | null {
  if (custom == null) return null;

  if (typeof custom === 'number') {
    const ratio = toPositiveInt(custom, 0);
    return ratio ? {
      ratio,
      specificity: 'global'
    } : null;
  }

  if (Array.isArray(custom)) {
    const norm = normalizeTradeSymbol(input.symbol);
    let symbolMatch: number | null = null;
    let typeMatch: number | null = null;
    let globalMatch: number | null = null;

    for (const raw of custom) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const ratio = toPositiveInt(row['leverage_ratio'] ?? row['leverage'] ?? row['max'], 0);
      if (!ratio) continue;

      const sym = row['symbol'] ?? row['market'];
      if (sym && normalizeTradeSymbol(String(sym)) === norm) {
        symbolMatch = ratio;
        continue;
      }
      const mtId = row['market_type_id'];
      if (planMarketTypeId != null && Number(mtId) === planMarketTypeId) {
        typeMatch = ratio;
        continue;
      }
      if (!sym && mtId == null && globalMatch == null) {
        globalMatch = ratio;
      }
    }

    if (symbolMatch != null) return { ratio: symbolMatch, specificity: 'symbol' };
    if (typeMatch != null) return { ratio: typeMatch, specificity: 'market_type' };
    if (globalMatch != null) return { ratio: globalMatch, specificity: 'global' };
    return null;
  }

  if (typeof custom === 'object') {
    const o = custom as Record<string, unknown>;
    const norm = normalizeTradeSymbol(input.symbol);

    if (Array.isArray(o['instruments'])) {
      const hit = (o['instruments'] as unknown[]).find((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        const row = raw as Record<string, unknown>;
        const sym = row['symbol'] ?? row['market'];
        return sym && normalizeTradeSymbol(String(sym)) === norm;
      }) as Record<string, unknown> | undefined;
      if (hit) {
        const ratio = toPositiveInt(hit['leverage_ratio'] ?? hit['leverage'], 0);
        if (ratio) return { ratio, specificity: 'symbol' };
      }
    }

    if (Array.isArray(o['market_types']) && planMarketTypeId != null) {
      const hit = (o['market_types'] as unknown[]).find((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        return Number((raw as Record<string, unknown>)['market_type_id']) === planMarketTypeId;
      }) as Record<string, unknown> | undefined;
      if (hit) {
        const ratio = toPositiveInt(hit['leverage_ratio'] ?? hit['leverage'], 0);
        if (ratio) return { ratio, specificity: 'market_type' };
      }
    }

    const ratio = toPositiveInt(o['leverage_ratio'] ?? o['leverage'] ?? o['max'], 0);
    return ratio ? { ratio, specificity: 'global' } : null;
  }

  return null;
}

/**
 * Resolves allowed leverage for a trade (priority):
 * 1) leverage_plan.instruments[] for symbol
 * 2) leverage_plan.market_types[] for market type (by id or name)
 * 3) leverage_plan.leverage_ratio (global default)
 * When is_custom + custom_leverage is set:
 * - symbol / market_type custom rows override the resolved max
 * - global custom only replaces the plan default (does not raise past instrument/market limits)
 */
export function resolveTradeLeverage(
  plan: PlayerDetailsLeveragePlan | null | undefined,
  input: LeverageResolveInput
): LeverageResolveResult {
  const minLeverage = 1;
  const fallback = 1;

  if (!plan) {
    return {
      defaultLeverage: fallback,
      maxLeverage: fallback,
      minLeverage,
      planDefaultLeverage: fallback,
      source: 'fallback',
      sourceLabel: 'Default'
    };
  }

  const planDefault = toPositiveInt(plan.leverage_ratio, fallback);
  let maxLeverage = planDefault;
  let source: LeverageResolveResult['source'] = 'plan';
  let sourceLabel = 'Plan default';

  const instrumentHit = findInstrumentLeverage(plan, input.symbol);
  if (instrumentHit) {
    maxLeverage = instrumentHit.ratio;
    source = 'instrument';
    sourceLabel = instrumentHit.symbol;
  } else {
    const planMarketTypeId = resolvePlanMarketTypeId(plan, input);
    const marketHit = findMarketTypeLeverage(plan, planMarketTypeId);
    if (marketHit) {
      maxLeverage = marketHit.ratio;
      source = 'market_type';
      sourceLabel = marketHit.name;
    }
  }

  if (plan.is_custom) {
    const planMarketTypeId = resolvePlanMarketTypeId(plan, input);
    const customMax = parseCustomLeverageMax(plan.custom_leverage, input, planMarketTypeId);
    if (customMax) {
      if (customMax.specificity === 'symbol') {
        maxLeverage = customMax.ratio;
        source = 'instrument';
        sourceLabel = input.symbol || sourceLabel;
      } else if (customMax.specificity === 'market_type') {
        maxLeverage = customMax.ratio;
        source = 'market_type';
      } else if (source === 'plan') {
        // Global custom is a plan-default override only — keep per-market caps (e.g. Crypto 10x).
        maxLeverage = customMax.ratio;
      }
    }
  }

  maxLeverage = Math.max(minLeverage, maxLeverage);

  return {
    defaultLeverage: maxLeverage,
    maxLeverage,
    minLeverage,
    planDefaultLeverage: planDefault,
    source,
    sourceLabel
  };
}

export function getLeverageSourceDescription(result: LeverageResolveResult): string {
  switch (result.source) {
    case 'instrument':
      return `Symbol limit (${result.sourceLabel})`;
    case 'market_type':
      return `Market limit (${result.sourceLabel})`;
    case 'plan':
      return `Plan default (${result.planDefaultLeverage}x)`;
    default:
      return 'Default';
  }
}

/** Slider / tick labels from 1..max (up to `tickCount` points). */
export function buildLeverageTicks(max: number, tickCount = 6): number[] {
  const cap = Math.max(1, Math.floor(max));
  if (cap <= tickCount) {
    return Array.from({ length: cap }, (_, i) => i + 1);
  }
  const ticks: number[] = [];
  for (let i = 0; i < tickCount; i++) {
    ticks.push(Math.round(1 + ((cap - 1) * i) / (tickCount - 1)));
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

export function clampLeverage(value: number, min: number, max: number): number {
  const v = Math.round(Number(value));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function isLeverageAllowed(
  leverage: number,
  plan: PlayerDetailsLeveragePlan | null | undefined,
  input: LeverageResolveInput
): boolean {
  const { minLeverage, maxLeverage } = resolveTradeLeverage(plan, input);
  const v = Math.round(Number(leverage));
  return Number.isFinite(v) && v >= minLeverage && v <= maxLeverage;
}

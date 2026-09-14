import { RegistrationPlanDetails, RegistrationPlanSummary } from '../services/registration.service';

export const DEMO_REGISTRATION_PLANS: RegistrationPlanSummary[] = [
  {
    id: 1,
    plan_code: 'STARTER',
    name: 'Starter',
    description: 'Essential markets and standard leverage for new traders.',
    is_active: true
  },
  {
    id: 2,
    plan_code: 'PRO',
    name: 'Professional',
    description: 'Expanded markets, higher leverage, and advanced risk controls.',
    is_active: true
  },
  {
    id: 3,
    plan_code: 'ELITE',
    name: 'Elite',
    description: 'Full market access, premium leverage, and priority support.',
    is_active: true
  }
];

export const DEMO_REGISTRATION_PLAN_DETAILS: Record<number, RegistrationPlanDetails> = {
  1: {
    plan_id: 1,
    plan_code: 'STARTER',
    name: 'Starter',
    description: 'Essential markets and standard leverage for new traders.',
    is_active: true,
    template: {
      brokerage: { equity: '0.03%', derivatives: '₹20 per lot' },
      leverage: { intraday: '5x', delivery: '1x' },
      markets: { enabled: [1, 2] },
      trading_permissions: { intraday: true, delivery: true, options: false },
      trading_charges: { platform_fee: 'Free', amc: '₹0' }
    }
  },
  2: {
    plan_id: 2,
    plan_code: 'PRO',
    name: 'Professional',
    description: 'Expanded markets, higher leverage, and advanced risk controls.',
    is_active: true,
    template: {
      brokerage: { equity: '0.02%', derivatives: '₹15 per lot' },
      leverage: { intraday: '10x', delivery: '2x' },
      markets: { enabled: [1, 2, 3, 4] },
      trading_permissions: { intraday: true, delivery: true, options: true },
      trading_charges: { platform_fee: 'Free', amc: '₹0' }
    }
  },
  3: {
    plan_id: 3,
    plan_code: 'ELITE',
    name: 'Elite',
    description: 'Full market access, premium leverage, and priority support.',
    is_active: true,
    template: {
      brokerage: { equity: '0.01%', derivatives: '₹10 per lot' },
      leverage: { intraday: '20x', delivery: '3x' },
      markets: { enabled: [1, 2, 3, 4, 5, 6] },
      trading_permissions: { intraday: true, delivery: true, options: true, commodities: true },
      trading_charges: { platform_fee: 'Free', amc: '₹0', priority_support: true }
    }
  }
};

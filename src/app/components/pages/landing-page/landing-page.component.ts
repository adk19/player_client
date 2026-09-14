import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TopLivePricesComponent } from './top-live-prices/top-live-prices.component';
import { AuthService } from '../../../shared/services/auth.service';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterModule, TopLivePricesComponent],
  templateUrl: './landing-page.component.html',
  styleUrls: ['./landing-page.component.scss']
})
export class LandingPageComponent implements OnInit {
  navLinks = [
    { label: 'Overview', target: 'hero' },
    { label: 'Markets', target: 'markets' },
    { label: 'Growth', target: 'growth' },
    { label: 'FAQ', target: 'faq' }
  ];

  mobileNavOpen = false;

  markets = [
    {
      label: 'CRYPTO',
      title: 'Spot + Futures Crypto',
      copy: 'Trade 350+ coin pairs, copy pro strategies, and hedge 24/7 with instant conversions and deep liquidity.',
      icon: 'fa-duotone fa-coins'
    },
    {
      label: 'FOREX',
      title: 'Global FX Desk',
      copy: 'Execute majors, minors, and exotics with raw spreads, smart routing, and millisecond settlements.',
      icon: 'fa-duotone fa-chart-line-up'
    },
    {
      label: 'COMMODITY',
      title: 'Energy & Agri Commodities',
      copy: 'Speculate on oil, gas, and agri indices with tight collateral requirements and rolling contracts.',
      icon: 'fa-duotone fa-oil-well'
    },
    {
      label: 'STOCK',
      title: 'Tokenized Equities',
      copy: 'Own fractional blue-chips, mirror dividends, and rebalance instantly from the same wallet.',
      icon: 'fa-duotone fa-building-columns'
    },
    {
      label: 'INDEX',
      title: 'Macro Index Suite',
      copy: 'Track broad market sentiment via synthetic S&P, NASDAQ, and DeFi baskets with auto-roll.',
      icon: 'fa-duotone fa-swatchbook'
    },
    {
      label: 'METAL',
      title: 'Precious Metals Vault',
      copy: 'Trade gold, silver, and platinum pairs backed by insured vault custody and 1-click settlement.',
      icon: 'fa-duotone fa-ring'
    }
  ];

  growthStats = [
    { label: 'Evolving', metric: 'Asia 2024', detail: 'Invest with the fastest growing broker', icon: 'fa-duotone fa-arrow-trend-up' },
    { label: 'Awards', metric: '40+', detail: 'Global recognitions for excellence', icon: 'fa-duotone fa-trophy-star' },
    { label: 'Countries', metric: '105+', detail: 'Clients trading worldwide', icon: 'fa-duotone fa-earth-asia' },
    { label: 'Instruments', metric: '300+', detail: 'Cross-asset instruments offered', icon: 'fa-duotone fa-coins' }
  ];

  benefits = [
    {
      title: 'Unified Portfolio Engine',
      copy: 'Sync spot, futures, options, and staking balances in one ledger with instant internal transfers.',
      icon: 'fa-duotone fa-circle-nodes'
    },
    {
      title: 'Latency Edge Routing',
      copy: 'Smart order router deploys micro-batching and co-location routes to slash execution delay < 18ms.',
      icon: 'fa-duotone fa-gauge-high'
    },
    {
      title: 'Adaptive Risk Controls',
      copy: 'AI-backed margin guardrails auto-tune leverage, liquidation, and price bands per trader profile.',
      icon: 'fa-duotone fa-shield-check'
    },
    {
      title: 'Signal-Aware Alerts',
      copy: 'Tap into on-chain flow, funding rate spikes, and whale alerts pushed straight to your workspace.',
      icon: 'fa-duotone fa-wave-pulse'
    }
  ];

  faqs = [
    {
      title: 'Why is BigTrade trusted by crypto traders?',
      answer: `BigTrade delivers deep liquidity, low fees, and a complete suite of Spot, Futures, Earn, and P2P markets. Users track live prices, explore new launches, and discover top movers directly inside the platform. With military-grade security, 24/7 support, and an easy interface, BigTrade stays the first choice for millions of traders.`
    },
    {
      title: 'What products does BigTrade provide?',
      answer: 'Trade spot & derivatives, automate strategies, stake tokens, or access simple savings. BigTrade also offers OTC blocks, copy-trading, and institutional APIs.'
    },
    {
      title: 'How can I track market prices on BigTrade?',
      answer: 'Use the live dashboards, customizable watchlists, and price alerts on web or mobile. You can favorite symbols for instant access.'
    },
    {
      title: 'How does BigTrade keep my assets safe?',
      answer: 'Assets are stored in multi-sig realtime monitoring, biometric account locks.'
    },
    {
      title: 'How do I earn rewards on BigTrade?',
      answer: 'Stake PoS assets, subscribe to flexible Earn vaults, or join liquidity farming events to compound returns.'
    }
  ];

  activeFaq = 0;
  isLoggedIn = false;

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.isLoggedIn = this.authService.isLoggedIn;
  }

  goToTrade() {
    this.router.navigate(['/trade']);
  }

  toggleMobileNav() {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  closeMobileNav() {
    this.mobileNavOpen = false;
  }

  goToSection(target: string) {
    const el = document.getElementById(target);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    this.closeMobileNav();
  }

  toggleFaq(index: number) {
    this.activeFaq = this.activeFaq === index ? -1 : index;
  }
}

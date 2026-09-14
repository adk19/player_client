import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SharedService } from '../../../../shared/services/shared.service';

interface SitemapItem {
  name: string;
  url: string;
  icon: string;
  description: string;
}

interface SitemapSection {
  title: string;
  icon: string;
  items: SitemapItem[];
}

@Component({
  selector: 'app-sitemap',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sitemap.component.html',
  styleUrls: ['./sitemap.component.scss']
})
export class SitemapComponent {
  sections: SitemapSection[] = [];

  constructor(private readonly sharedService: SharedService) {
    this.sections = [
      {
        title: 'Trading Terminal & Markets',
        icon: 'chart-line-up',
        items: [
          { name: 'Trade Terminal', url: '/trade', icon: 'chart-line', description: 'Execute trades, view interactive charts, and monitor open orders.' },
          { name: 'Watchlist', url: '/watchlist', icon: 'star', description: 'Monitor your favorite cryptocurrency and market pairs.' },
          { name: 'Orders / Positions', url: '/orders', icon: 'receipt', description: 'Track all active trading positions and pending limit/market orders.' }
        ]
      },
      {
        title: 'Account Settings & Security',
        icon: 'user-gear',
        items: [
          { name: 'Dashboard', url: '/account/dashboard', icon: 'house', description: 'View account balance, trading performance, statistics, and recent activity.' },
          { name: 'Account Details', url: '/account/details', icon: 'clipboard-list', description: 'Check personal information, email, phone number, and user profile.' },
          { name: 'Assets & Margin', url: '/account/assets', icon: 'wallet', description: 'Review asset allocations, margin requirements, used margin, and equity.' },
          { name: 'KYC Verification', url: '/account/kyc', icon: 'id-card', description: 'Upload documents, verify email, and check identity verification status.' },
          { name: 'Settings', url: '/account/settings', icon: 'gear', description: 'Configure layout theme, sound settings, security, and credentials.' }
        ]
      },
      {
        title: 'Financials & History',
        icon: 'file-invoice-dollar',
        items: [
          { name: 'Deposit Funds', url: '/account/deposit', icon: 'arrow-down-to-bracket', description: 'Add funds to your live wallet balance.' },
          { name: 'Withdraw Funds', url: '/account/withdraw', icon: 'arrow-up-from-bracket', description: 'Initiate a payout or withdrawal request to your account.' },
          { name: 'Cash Ledger', url: '/account/cash-ledger', icon: 'book', description: 'Audit all transaction history, deposits, withdrawals, and balance shifts.' },
          { name: 'Settlement Report', url: '/account/settlement', icon: 'handshake', description: 'Overview of realized trades and contract settlements.' }
        ]
      },
      {
        title: 'Reports & Benefits',
        icon: 'award',
        items: [
          { name: 'Brokerage Summary', url: '/account/brokerage', icon: 'percent', description: 'Analyze fee structures, brokerage logs, and detailed charges.' },
          { name: 'Rewards Program', url: '/account/rewards', icon: 'gift', description: 'Participate in platform reward initiatives and view earned credits.' },
          { name: 'Referral Center', url: '/account/referral', icon: 'users', description: 'Share your referral code and track registered invitees.' }
        ]
      },
      // {
      //   title: 'Authentication & Onboarding',
      //   icon: 'shield-halved',
      //   items: [
      //     { name: 'Login', url: '/login', icon: 'right-to-bracket', description: 'Access your account or sign in as a guest.' },
      //     { name: 'Register', url: '/register', icon: 'user-plus', description: 'Create a new account on our platform.' },
      //     { name: 'Register Plans', url: '/register/plans', icon: 'tags', description: 'View available membership and subscription plans during signup.' }
      //   ]
      // }
    ];

    if (this.sharedService.isB2BBrand()) {
      this.sections = this.sections.map(section => ({
        ...section,
        items: section.items.filter(item => item.url !== '/register' && item.url !== '/register/plans')
      }));
    }
  }
}

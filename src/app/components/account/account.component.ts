import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';
import { SharedService } from '../../shared/services/shared.service';

interface MenuItem {
  icon: string;
  name: string;
  url: string;
  queryParams?: Record<string, any>;
  badge?: string;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss'
})
export class AccountComponent implements OnInit, OnDestroy {

  private readonly shared = inject(SharedService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  isChildActive = false;
  activeTitle = '';
  userName = '';
  balance = 0;

  private readonly cashPaymentUrls = new Set(['/account/deposit', '/account/withdraw']);

  private readonly menuBlueprint: MenuGroup[] = [
    {
      label: 'Overview',
      items: [
        { icon: 'house', name: 'Dashboard', url: '/account/dashboard' },
        { icon: 'clipboard-list', name: 'Details', url: '/account/details' },
        { icon: 'wallet', name: 'Assets', url: '/account/assets' },
      ],
    },
    {
      label: 'Funds',
      items: [
        { icon: 'arrow-down-to-bracket', name: 'Deposit', url: '/account/deposit' },
        { icon: 'arrow-up-from-bracket', name: 'Withdraw', url: '/account/withdraw' },
        { icon: 'book', name: 'Cash Ledger', url: '/account/cash-ledger' },
      ],
    },
    {
      label: 'Trading',
      items: [
        { icon: 'files', name: 'Orders', url: '/account/orders' },
      ],
    },
    {
      label: 'Reports',
      items: [
        { icon: 'handshake', name: 'Settlement', url: '/account/settlement' },
        { icon: 'percent', name: 'Brokerage', url: '/account/brokerage' },
      ],
    },
    {
      label: 'Account',
      items: [
        { icon: 'id-card', name: 'KYC', url: '/account/kyc' },
        { icon: 'gear', name: 'Settings', url: '/account/settings' },
        { icon: 'sitemap', name: 'Sitemap', url: '/account/sitemap' },
      ],
    },
  ];

  menuGroups: MenuGroup[] = [];

  private readonly titleMap: Record<string, string> = {
    '/account/dashboard': 'Dashboard',
    '/account/details': 'Details',
    '/account/assets': 'Assets',
    '/account/deposit': 'Deposit',
    '/account/withdraw': 'Withdraw',
    '/account/orders': 'Orders',
    '/account/cash-ledger': 'Cash Ledger',
    '/account/settlement': 'Settlement',
    '/account/exposure': 'Exposure',
    '/account/trade-history': 'Trade History',
    '/account/settlement-history': 'Settlement History',
    '/account/brokerage': 'Brokerage',
    '/account/brokerage/details': 'Brokerage Details',
    '/account/kyc': 'KYC',
    '/account/manage': 'Profile',
    '/account/settings': 'Settings',
    '/account/rewards': 'Rewards',
    '/account/referral': 'Referral',
    '/account/sitemap': 'Sitemap',
  };

  private routerSub?: Subscription;
  private brandConfigSub?: Subscription;
  private balanceSub?: Subscription;

  ngOnInit(): void {
    try {
      const rawUser = JSON.parse(sessionStorage.getItem('auth_user') || 'null');
      this.userName = rawUser?.username || '';
    } catch {
      this.userName = '';
    }

    this.balance = this.authService.currentBalance;
    this.balanceSub = this.authService.balance$.subscribe((b) => {
      this.balance = b ?? 0;
    });

    this.rebuildMenu();
    this.brandConfigSub = this.shared.brandConfig$.subscribe(() => {
      this.rebuildMenu();
      this.redirectBlockedCashPaymentRoute();
    });

    this.routerSub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateChildState();
      this.redirectBlockedCashPaymentRoute();
    });

    this.updateChildState();
    this.redirectBlockedCashPaymentRoute();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.brandConfigSub?.unsubscribe();
    this.balanceSub?.unsubscribe();
  }

  formatBalance(value: number): string {
    return this.shared.formatToBrandCurrency(value);
  }

  private rebuildMenu(): void {
    this.menuGroups = this.menuBlueprint
      .map((group) => ({
        label: group.label,
        items: group.items.filter((item) => {
          if (this.cashPaymentUrls.has(item.url)) {
            return this.shared.isCashPaymentsEnabled();
          }
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }

  private redirectBlockedCashPaymentRoute(): void {
    if (this.shared.isCashPaymentsEnabled()) {
      return;
    }
    const url = this.router.url.split('?')[0];
    if (this.cashPaymentUrls.has(url)) {
      void this.router.navigate(['/account/dashboard']);
    }
  }

  private updateChildState(): void {
    const url = this.router.url.split('?')[0];
    const isRoot = url === '/account' || url === '/account/';
    const isDashboard = url === '/account/dashboard';

    if (window.innerWidth <= 768) {
      this.isChildActive = !isRoot && !isDashboard;
    } else {
      this.isChildActive = true;
    }

    this.activeTitle = this.titleMap[url] || 'Account';
  }

  onMenuClick(): void {
    if (window.innerWidth <= 768) {
      this.isChildActive = true;
    }
  }

  goBack(): void {
    this.isChildActive = false;
    this.router.navigate(['/account/dashboard']);
  }

  logout(): void {
    this.authService.logout();
  }

  openSupport(): void {
    window.open('mailto:support@platform.com', '_blank');
  }
}

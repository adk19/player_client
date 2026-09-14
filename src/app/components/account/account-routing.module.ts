import { Routes } from '@angular/router';
import { AccountDashboardComponent } from './account-dashboard/account-dashboard.component';
import { AssetsComponent } from './pages/assets/assets.component';
import { BrokerageDetailsComponent } from './pages/brokerage-report/brokerage-details.component';
import { BrokerageReportComponent } from './pages/brokerage-report/brokerage-report.component';
import { CashLedgerComponent } from './pages/cash-ledger/cash-ledger.component';
import { AccountDetailsComponent } from './pages/details/account-details.component';
import { ExposureSummaryComponent } from './pages/exposure-summary/exposure-summary.component';
import { KycComponent } from './pages/kyc/kyc.component';
import { ManageComponent } from './pages/manage/manage.component';
import { AccountOrdersComponent } from './pages/orders/orders.component';
import { DepositComponent } from './pages/payments/deposit/deposit.component';
import { WithdrawComponent } from './pages/payments/withdraw/withdraw.component';
import { ReferralComponent } from './pages/referral/referral.component';
import { RewardsComponent } from './pages/rewards/rewards.component';
import { AccountSettingsComponent } from './pages/settings/settings.component';
import { SettlementHistoryComponent } from './pages/settlement-history/settlement-history.component';
import { SettlementReportComponent } from './pages/settlement-report/settlement-report.component';
import { SettlementTradeHistoryComponent } from './pages/settlement-trade-history/settlement-trade-history.component';
import { SitemapComponent } from './pages/sitemap/sitemap.component';
import { SubAccountsComponent } from './pages/sub-accounts/sub-accounts.component';

export const AccountRoutes: Routes = [
  {
    path: '',
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: AccountDashboardComponent },
      { path: 'details', component: AccountDetailsComponent },
      { path: 'assets', component: AssetsComponent },
      { path: 'deposit', component: DepositComponent },
      { path: 'deposit-requests', redirectTo: 'deposit', pathMatch: 'full' },
      { path: 'withdraw', component: WithdrawComponent },
      { path: 'withdraw-requests', redirectTo: 'withdraw', pathMatch: 'full' },
      { path: 'orders', component: AccountOrdersComponent },
      { path: 'cash-ledger', component: CashLedgerComponent },
      { path: 'settlement', component: SettlementReportComponent },
      { path: 'exposure', component: ExposureSummaryComponent },
      { path: 'trade-history', component: SettlementTradeHistoryComponent },
      { path: 'settlement-history', component: SettlementHistoryComponent },
      { path: 'brokerage', component: BrokerageReportComponent },
      { path: 'brokerage/details', component: BrokerageDetailsComponent },
      { path: 'rewards', component: RewardsComponent },
      { path: 'referral', component: ReferralComponent },
      { path: 'manage', component: ManageComponent },
      { path: 'sub-accounts', component: SubAccountsComponent },
      { path: 'kyc', component: KycComponent },
      { path: 'settings', component: AccountSettingsComponent },
      { path: 'sitemap', component: SitemapComponent },
      { path: '**', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  }
];
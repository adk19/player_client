import { Routes } from '@angular/router';
import { CryptoComponent } from './crypto/crypto.component';
import { CryptoRedirectComponent } from './crypto/crypto-redirect.component';

export const TradeRoutes: Routes = [
  {
    path: '',
    component: CryptoRedirectComponent
  }
];
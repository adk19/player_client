import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { ToastrModule } from 'ngx-toastr';
import { routes } from './app.routes';
import { AuthInterceptor } from './interceptors/auth.interceptor';
import { MarketDataService } from './services/market-data.service';
import { initBrandConfig } from './shared/initializers/brand-config.initializer';
import { SharedService } from './shared/services/shared.service';

/** Load market data on every app start if user is already logged in (page reload) */
function initMarketData(marketDataService: MarketDataService): () => Promise<void> {
  return async () => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (token) {
        // User is logged in — fetch market data before app renders
        try {
          await marketDataService.load().toPromise();
        } catch { }
      }
    } catch { }
    return Promise.resolve();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(FormsModule, BrowserModule, CommonModule, ToastrModule.forRoot()),
    provideHttpClient(withInterceptorsFromDi()),
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      useFactory: initBrandConfig,
      deps: [HttpClient, SharedService],
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initMarketData,
      deps: [MarketDataService],
      multi: true
    }
  ]
};

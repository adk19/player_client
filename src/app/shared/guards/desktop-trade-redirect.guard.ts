import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class DesktopTradeRedirectGuard implements CanActivate {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  canActivate(): boolean | UrlTree {
    if (!isPlatformBrowser(this.platformId)) return true;

    const width = window?.innerWidth ?? 0;
    if (width > 992) {
      return this.router.parseUrl('/trade');
    }
    return true;
  }
}


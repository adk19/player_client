import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SharedService } from '../services/shared.service';

/** Blocks the register flow for B2B brands (accounts are provisioned by the platform). */
export const registrationGuard: CanActivateFn = () => {
  const shared = inject(SharedService);
  const router = inject(Router);
  if (shared.isB2BBrand()) {
    return router.parseUrl('/login');
  }
  return true;
};

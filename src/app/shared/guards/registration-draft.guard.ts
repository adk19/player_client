import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RegistrationService } from '../services/registration.service';

/** Allows plan selection only when registration form data was saved. */
export const registrationDraftGuard: CanActivateFn = () => {
  const router = inject(Router);
  const registration = inject(RegistrationService);
  const draft = registration.getDraft();
  if (draft?.otpVerified) {
    return true;
  }
  return router.parseUrl('/register');
};

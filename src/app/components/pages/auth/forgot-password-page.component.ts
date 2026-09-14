import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, PasswordResetResponse } from '../../../shared/services/auth.service';
import { RegistrationService } from '../../../shared/services/registration.service';
import { SharedService } from '../../../shared/services/shared.service';
import { environment } from '../../../shared/environment/environment';
import {
  COUNTRY_DIAL_OPTIONS,
  CountryDialOption,
  DEFAULT_DIAL_CODE
} from './login-country-codes';

@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password-page.component.html'
})
export class ForgotPasswordPageComponent implements OnDestroy {
  readonly countryOptions = COUNTRY_DIAL_OPTIONS;

  step: 'mobile' | 'reset' = 'mobile';
  selectedDialCode = DEFAULT_DIAL_CODE;
  countryDialOpen = false;
  countrySearch = '';
  mobile = '';

  otpCode = '';
  newPassword = '';
  confirmPassword = '';
  passVisible = false;
  confirmPassVisible = false;

  playerId: number | null = null;
  username: string | null = null;
  submitting = false;
  error: string | null = null;
  resendSeconds = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    public readonly sharedservice: SharedService
  ) { }

  ngOnDestroy(): void {
    this.clearResendTimer();
  }

  get dialingCode(): string {
    return `+${this.selectedDialCode}`;
  }

  get mobileNumber(): string {
    return String(this.mobile || '').replace(/\D/g, '');
  }

  get maskedMobile(): string {
    const n = this.mobileNumber;
    if (n.length < 4) return `${this.dialingCode} ${n}`;
    return `${this.dialingCode} ${n.slice(0, 2)}••••${n.slice(-2)}`;
  }

  get dialDisplay(): string {
    return `+${this.selectedDialCode}`;
  }

  get filteredCountries(): CountryDialOption[] {
    const q = this.countrySearch.trim().toLowerCase();
    if (!q) return this.countryOptions;
    return this.countryOptions.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        `+${c.dialCode}`.includes(q)
    );
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.countryDialOpen = false;
  }

  toggleCountryDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.countryDialOpen = !this.countryDialOpen;
    if (this.countryDialOpen) this.countrySearch = '';
  }

  selectCountry(option: CountryDialOption, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedDialCode = option.dialCode;
    this.countryDialOpen = false;
    this.countrySearch = '';
  }

  sendOtp(isResend = false): void {
    if (this.submitting) return;
    if (!/^\d{7,15}$/.test(this.mobileNumber)) {
      this.error = 'Enter a valid mobile number (7–15 digits).';
      return;
    }

    this.error = null;
    this.submitting = true;

    this.auth
      .forgotPassword({
        mobileNumber: this.mobileNumber,
        dialingCode: this.dialingCode
      })
      .subscribe({
        next: (res) => {
          this.submitting = false;
          if (!this.isSuccess(res)) {
            this.error = res.message || 'Could not send OTP. Please try again.';
            return;
          }
          const playerId = this.extractPlayerId(res);
          if (playerId == null) {
            this.error = 'Could not start password reset. Please try again.';
            return;
          }
          const username = this.extractUsername(res);
          if (!username) {
            this.error = 'Could not resolve account username. Please try again.';
            return;
          }
          this.playerId = playerId;
          this.username = username;
          this.step = 'reset';
          this.otpCode = '';
          this.startResendCooldown();
          this.sharedservice.showAlert(
            1,
            res.message || (isResend ? 'OTP resent.' : 'OTP sent to your mobile number.')
          );
        },
        error: (err) => {
          this.submitting = false;
          this.error = RegistrationService.apiErrorMessage(err, 'Could not send OTP. Please try again.');
        }
      });
  }

  submitReset(): void {
    if (this.submitting) return;
    const otp = this.otpCode.replace(/\D/g, '');
    if (!/^\d{4,8}$/.test(otp)) {
      this.error = 'Enter the OTP sent to your mobile.';
      return;
    }
    if (!this.newPassword || this.newPassword.length < 8) {
      this.error = 'New password must be at least 8 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }
    if (this.playerId == null) {
      this.error = 'Session expired. Request a new OTP.';
      this.backToMobile();
      return;
    }

    this.error = null;
    this.submitting = true;

    this.auth.resetPassword({
      mobileNumber: this.mobileNumber,
      dialingCode: this.dialingCode,
      otp,
      newPassword: this.newPassword
    })
      .subscribe({
        next: (res) => {
          if (!this.isSuccess(res)) {
            this.submitting = false;
            this.error = res.message || 'Could not reset password. Please try again.';
            return;
          }
          this.autoLoginAfterReset(res.message || 'Password reset successfully');
        },
        error: (err) => {
          this.submitting = false;
          this.error = RegistrationService.apiErrorMessage(err, 'Could not reset password. Please try again.');
        }
      });
  }

  resendOtp(): void {
    if (this.resendSeconds > 0 || this.submitting) return;
    this.sendOtp(true);
  }

  backToMobile(): void {
    this.step = 'mobile';
    this.otpCode = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.error = null;
    this.playerId = null;
    this.username = null;
    this.clearResendTimer();
    this.resendSeconds = 0;
  }

  onOtpInput(value: string): void {
    this.otpCode = value.replace(/\D/g, '').slice(0, 8);
  }

  private extractPlayerId(res: PasswordResetResponse): number | null {
    const raw =
      res?.playerId ??
      res?.data?.playerId ??
      res?.data?.player_id ??
      res?.data?.id;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private extractUsername(res: PasswordResetResponse): string | null {
    const raw = res?.data?.username;
    const username = String(raw || '').trim();
    return username || null;
  }

  private autoLoginAfterReset(resetMessage: string): void {
    const username = this.username?.trim();
    const password = this.newPassword;
    if (!username) {
      this.submitting = false;
      this.sharedservice.showAlert(1, resetMessage);
      this.sharedservice.showAlert(2, 'Please sign in with your new password.');
      void this.router.navigate(['/login']);
      return;
    }

    this.auth.login({
      username,
      password,
      brand_code: environment.BrandCode || 'BRD0001',
      brand_type: this.sharedservice.getBrandType() || ''
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.sharedservice.showAlert(1, `${resetMessage} Welcome back!`);
        void this.router.navigateByUrl('/watchlist');
      },
      error: (err) => {
        this.submitting = false;
        this.sharedservice.showAlert(1, resetMessage);
        const loginMsg = RegistrationService.apiErrorMessage(
          err,
          'Password updated. Please sign in with your new password.'
        );
        this.sharedservice.showAlert(2, loginMsg);
        void this.router.navigate(['/login']);
      }
    });
  }

  private isSuccess(res: { code?: number } | null): boolean {
    const code = Number(res?.code);
    return code === 0 || code === 5;
  }

  private startResendCooldown(seconds = 30): void {
    this.clearResendTimer();
    this.resendSeconds = seconds;
    this.resendTimer = setInterval(() => {
      this.resendSeconds -= 1;
      if (this.resendSeconds <= 0) this.clearResendTimer();
    }, 1000);
  }

  private clearResendTimer(): void {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }
}

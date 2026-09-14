import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SharedService } from '../../../shared/services/shared.service';
import { RegistrationService } from '../../../shared/services/registration.service';
import {
  COUNTRY_DIAL_OPTIONS,
  CountryDialOption,
  DEFAULT_DIAL_CODE
} from './login-country-codes';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.component.html'
})
export class RegisterPageComponent implements OnInit, OnDestroy {
  readonly countryOptions = COUNTRY_DIAL_OPTIONS;

  regPassVisible = false;
  regConfirmPassVisible = false;

  selectedDialCode = DEFAULT_DIAL_CODE;
  countryDialOpen = false;
  countrySearch = '';

  registerForm!: FormGroup;

  step: 'form' | 'otp' = 'form';
  otpCode = '';
  otpSending = false;
  otpVerifying = false;
  otpError: string | null = null;
  resendSeconds = 0;
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly registration: RegistrationService,
    public readonly sharedservice: SharedService
  ) { }

  ngOnInit(): void {
    this.registerForm = this.fb.group(
      {
        username: [
          '',
          [
            Validators.required,
            Validators.minLength(3),
            Validators.maxLength(30),
            Validators.pattern(/^[a-zA-Z0-9._-]+$/)
          ]
        ],
        email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
        mobile: ['', [Validators.required, Validators.pattern(/^\d{7,15}$/)]],
        password: [
          '',
          [
            Validators.required,
            Validators.minLength(8),
            Validators.maxLength(64),
            Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
          ]
        ],
        confirmPassword: ['', [Validators.required]]
      },
      { validators: (g) => this.passwordsMatchValidator(g) }
    );
    this.restoreDraftIntoForm();
  }

  ngOnDestroy(): void {
    this.clearResendTimer();
  }

  get dialingCode(): string {
    return `+${this.selectedDialCode}`;
  }

  get mobileNumber(): string {
    return String(this.registerForm?.get('mobile')?.value || '').replace(/\D/g, '');
  }

  get maskedMobile(): string {
    const n = this.mobileNumber;
    if (n.length < 4) return `${this.dialingCode} ${n}`;
    return `${this.dialingCode} ${n.slice(0, 2)}••••${n.slice(-2)}`;
  }

  private restoreDraftIntoForm(): void {
    const draft = this.registration.getDraft();
    if (!draft) return;

    const { dialCode, nationalNumber } = this.splitPhone(draft.phone);
    if (dialCode) {
      this.selectedDialCode = dialCode;
    }

    this.registerForm.patchValue({
      username: draft.username,
      email: draft.email,
      mobile: nationalNumber,
      password: draft.password,
      confirmPassword: draft.confirmPassword
    });
  }

  private splitPhone(phone: string): { dialCode: string; nationalNumber: string } {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) {
      return { dialCode: this.selectedDialCode, nationalNumber: '' };
    }

    const sorted = [...this.countryOptions].sort((a, b) => b.dialCode.length - a.dialCode.length);
    for (const c of sorted) {
      if (digits.startsWith(c.dialCode)) {
        return {
          dialCode: c.dialCode,
          nationalNumber: digits.slice(c.dialCode.length)
        };
      }
    }
    return { dialCode: this.selectedDialCode, nationalNumber: digits };
  }

  get dialDisplay(): string {
    return `+${this.selectedDialCode}`;
  }

  get filteredCountries(): CountryDialOption[] {
    const q = this.countrySearch.trim().toLowerCase();
    if (!q) {
      return this.countryOptions;
    }
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
    if (this.countryDialOpen) {
      this.countrySearch = '';
    }
  }

  selectCountry(option: CountryDialOption, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedDialCode = option.dialCode;
    this.countryDialOpen = false;
    this.countrySearch = '';
  }

  registerControl(path: string): AbstractControl | null {
    return this.registerForm.get(path);
  }

  registerInvalid(path: string): boolean {
    const c = this.registerControl(path);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  registerError(path: string): string | null {
    const c = this.registerControl(path);
    if (!c || !c.errors || (!c.dirty && !c.touched)) {
      return null;
    }
    if (c.errors['required']) {
      return 'This field is required.';
    }
    if (path === 'username') {
      if (c.errors['minlength']) return 'Username must be at least 3 characters.';
      if (c.errors['maxlength']) return 'Username is too long.';
      if (c.errors['pattern']) return 'Use letters, numbers, dot, underscore or hyphen only.';
    }
    if (path === 'email') {
      if (c.errors['email']) return 'Enter a valid email address.';
    }
    if (path === 'mobile') {
      if (c.errors['pattern']) return 'Enter 7–15 digits (no spaces).';
    }
    if (path === 'password') {
      if (c.errors['minlength']) return 'At least 8 characters required.';
      if (c.errors['pattern']) return 'Include uppercase, lowercase and a number.';
    }
    if (path === 'confirmPassword') {
      if (
        c.errors['mismatch'] ||
        (this.registerForm.errors?.['passwordMismatch'] && (c.dirty || c.touched))
      ) {
        return 'Passwords do not match.';
      }
    }
    return null;
  }

  createAccount(): void {
    this.registerForm.markAllAsTouched();
    if (this.registerForm.invalid || this.otpSending) {
      return;
    }
    this.requestOtp();
  }

  requestOtp(isResend = false): void {
    const v = this.registerForm.getRawValue();
    this.otpError = null;
    this.otpSending = true;

    this.registration.requestOtp({
      username: String(v.username || '').trim(),
      mobileNumber: this.mobileNumber,
      dialingCode: this.dialingCode
    }).subscribe({
      next: (res) => {
        this.otpSending = false;
        if (this.isOtpSuccess(res)) {
          this.step = 'otp';
          this.otpCode = '';
          this.startResendCooldown();
          this.sharedservice.showAlert(
            1,
            res.message || (isResend ? 'OTP resent.' : 'OTP sent to your mobile number.')
          );
          return;
        }
        this.otpError = res.message || 'Could not send OTP. Please try again.';
      },
      error: (err) => {
        this.otpSending = false;
        this.otpError = RegistrationService.apiErrorMessage(err, 'Could not send OTP. Please try again.');
      }
    });
  }

  verifyOtp(): void {
    const otp = this.otpCode.replace(/\D/g, '');
    if (!/^\d{4,8}$/.test(otp) || this.otpVerifying) {
      this.otpError = 'Enter the OTP sent to your mobile.';
      return;
    }

    this.otpError = null;
    this.otpVerifying = true;

    this.registration.verifyOtp({
      mobileNumber: this.mobileNumber,
      dialingCode: this.dialingCode,
      otp
    }).subscribe({
      next: (res) => {
        this.otpVerifying = false;
        if (this.isOtpSuccess(res)) {
          this.saveVerifiedDraft();
          this.sharedservice.showAlert(1, res.message || 'Mobile number verified.');
          void this.router.navigate(['/register/plans']);
          return;
        }
        this.otpError = res.message || 'Invalid OTP. Please try again.';
      },
      error: (err) => {
        this.otpVerifying = false;
        this.otpError = RegistrationService.apiErrorMessage(err, 'Invalid OTP. Please try again.');
      }
    });
  }

  resendOtp(): void {
    if (this.resendSeconds > 0 || this.otpSending) return;
    this.requestOtp(true);
  }

  backToForm(): void {
    this.step = 'form';
    this.otpCode = '';
    this.otpError = null;
    this.clearResendTimer();
    this.resendSeconds = 0;
  }

  onOtpInput(value: string): void {
    this.otpCode = value.replace(/\D/g, '').slice(0, 8);
  }

  private saveVerifiedDraft(): void {
    const v = this.registerForm.getRawValue();
    const phone = `${this.selectedDialCode}${this.mobileNumber}`;
    this.registration.saveDraft({
      username: String(v.username || '').trim(),
      email: String(v.email || '').trim(),
      phone,
      password: v.password,
      confirmPassword: v.confirmPassword,
      otpVerified: true
    });
  }

  private startResendCooldown(seconds = 30): void {
    this.clearResendTimer();
    this.resendSeconds = seconds;
    this.resendTimer = setInterval(() => {
      this.resendSeconds -= 1;
      if (this.resendSeconds <= 0) {
        this.clearResendTimer();
      }
    }, 1000);
  }

  private clearResendTimer(): void {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  private isOtpSuccess(res: { code?: number } | null): boolean {
    const code = Number(res?.code);
    return code === 0 || code === 5;
  }

  private passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
    const pwd = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    const confirmCtrl = group.get('confirmPassword');
    if (!confirmCtrl) {
      return null;
    }
    if (confirm && pwd !== confirm) {
      const errs = { ...(confirmCtrl.errors || {}), mismatch: true };
      confirmCtrl.setErrors(errs);
      return { passwordMismatch: true };
    }
    if (confirmCtrl.errors?.['mismatch']) {
      const { mismatch, ...rest } = confirmCtrl.errors;
      confirmCtrl.setErrors(Object.keys(rest).length ? rest : null);
    }
    return null;
  }
}

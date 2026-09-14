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
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';
import { SharedService } from '../../../shared/services/shared.service';
import { environment } from '../../../shared/environment/environment';
import {
  COUNTRY_DIAL_OPTIONS,
  CountryDialOption,
  DEFAULT_DIAL_CODE
} from './login-country-codes';

export type AuthPanelMode = 'login' | 'register';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  readonly countryOptions = COUNTRY_DIAL_OPTIONS;

  authMode: AuthPanelMode = 'login';
  mobileSheetOpen = false;
  loginModel = { username: '', password: '' };
  passVisible = false;
  regPassVisible = false;
  regConfirmPassVisible = false;
  rememberMe = false;
  isLoginClicked = false;
  error: string | null = null;

  selectedDialCode = DEFAULT_DIAL_CODE;
  countryDialOpen = false;
  countrySearch = '';

  registerForm!: FormGroup;

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    public readonly sharedservice: SharedService
  ) { }

  ngOnInit(): void {
    this.registerForm = this.fb.group(
      {
        name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80), Validators.pattern(/^[a-zA-Z][a-zA-Z\s.'-]*$/)]],
        email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
        mobile: ['', [Validators.required, Validators.pattern(/^\d{7,15}$/)]],
        password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(64), Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)]],
        confirmPassword: ['', [Validators.required]]
      },
      { validators: (g) => this.passwordsMatchValidator(g) }
    );

    if (this.auth.isLoggedIn) {
      this.router.navigate(['/trade']);
    }

  }

  ngOnDestroy(): void {
    document.body.classList.remove('trade-login-sheet-open');
  }

  get heroHeadline(): string {
    return this.authMode === 'login'
      ? 'Login to your trading account'
      : 'Create your trading account';
  }

  get heroLead(): string {
    return this.authMode === 'login'
      ? 'Access your dashboard to monitor markets, manage trades, and control your portfolio in real time.'
      : 'Join the platform to access live markets, portfolio tools, and secure trading in one workspace.';
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileSheetOpen) {
      this.closeMobileSheet();
    }
  }

  getEnterEvent(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.keyCode === 13) {
      this.login();
    }
  }

  toggleTheme(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const next = this.sharedservice.isDarkMode ? 'light' : 'dark';
    this.sharedservice.switchMode(next);
  }

  showLogin(): void {
    this.setAuthMode('login');
  }

  showRegister(): void {
    this.setAuthMode('register');
  }

  openMobileSheet(mode: AuthPanelMode): void {
    this.setAuthMode(mode);
    this.mobileSheetOpen = true;
    document.body.classList.add('trade-login-sheet-open');
  }

  closeMobileSheet(): void {
    this.mobileSheetOpen = false;
    this.countryDialOpen = false;
    document.body.classList.remove('trade-login-sheet-open');
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (typeof window !== 'undefined' && window.innerWidth > 960 && this.mobileSheetOpen) {
      this.closeMobileSheet();
    }
  }

  private setAuthMode(mode: AuthPanelMode): void {
    this.authMode = mode;
    this.error = null;
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
    if (path === 'name') {
      if (c.errors['minlength']) return 'Name must be at least 2 characters.';
      if (c.errors['maxlength']) return 'Name is too long.';
      if (c.errors['pattern']) return 'Use letters and spaces only.';
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
    if (this.registerForm.invalid) {
      return;
    }
    this.sharedservice.showAlert(2, 'This feature is coming soon.');
  }

  login(): void {
    let errTxt = '';
    if (!this.loginModel.username) {
      errTxt += 'Enter Username\n';
    }
    if (!this.loginModel.password) {
      errTxt += 'Please enter password\n';
    }

    if (errTxt) {
      this.error = errTxt.trim();
      return;
    }

    this.error = null;
    this.isLoginClicked = true;

    const payload = {
      username: this.loginModel.username,
      password: this.loginModel.password,
      brand_code: environment.BrandCode || 'BRD0001',
      brand_type: this.sharedservice.getBrandType() || ''
    };

    const returnUrl = '/watchlist';

    this.auth.login(payload).subscribe({
      next: () => {
        this.isLoginClicked = false;
        this.sharedservice.showAlert(1, 'Login Successful');
        this.router.navigateByUrl(returnUrl);
      },
      error: (err) => {
        this.isLoginClicked = false;
        const errorMsg =
          err?.error?.message || err?.message || 'Login failed. Please check your credentials.';
        this.sharedservice.showAlert(2, errorMsg);
        console.error('Login error', err);
      }
    });
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

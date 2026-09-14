import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { AuthService } from '../../../shared/services/auth.service';
import { SharedService } from '../../../shared/services/shared.service';

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './auth-shell.component.html',
  styleUrls: ['./auth-shell.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AuthShellComponent implements OnInit, OnDestroy {
  mobileSheetOpen = false;
  isRegister = false;
  isForgot = false;

  private routerSub?: Subscription;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    public readonly sharedservice: SharedService
  ) { }

  ngOnInit(): void {
    if (this.auth.isLoggedIn) {
      void this.router.navigate(['/trade']);
      return;
    }

    this.syncRouteMode();
    this.routerSub = this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.syncRouteMode();
      this.ensureMobileSheetForAuthRoute();
    });

    this.ensureMobileSheetForAuthRoute();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    document.body.classList.remove('trade-login-sheet-open');
  }

  get heroHeadline(): string {
    if (this.isForgot) return 'Reset your trading password';
    return this.isRegister ? 'Create your trading account' : 'Login to your trading account';
  }

  get heroLead(): string {
    if (this.isForgot) {
      return 'Verify your mobile number with an OTP, then set a new password to get back into your account.';
    }
    return this.isRegister
      ? 'Join the platform to access live markets, portfolio tools, and secure trading in one workspace.'
      : 'Access your dashboard to monitor markets, manage trades, and control your portfolio in real time.';
  }

  toggleTheme(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const next = this.sharedservice.isDarkMode ? 'light' : 'dark';
    this.sharedservice.switchMode(next);
  }

  openMobileSheet(): void {
    this.mobileSheetOpen = true;
    document.body.classList.add('trade-login-sheet-open');
  }

  closeMobileSheet(): void {
    this.mobileSheetOpen = false;
    document.body.classList.remove('trade-login-sheet-open');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileSheetOpen) {
      this.closeMobileSheet();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.isMobileViewport()) {
      this.mobileSheetOpen = false;
      document.body.classList.remove('trade-login-sheet-open');
    }
  }

  private syncRouteMode(): void {
    const url = this.router.url.split('?')[0];
    this.isRegister = url === '/register';
    this.isForgot = url === '/forgot-password';
  }

  /** Mobile: login/register/forgot open in bottom sheet. */
  private ensureMobileSheetForAuthRoute(): void {
    if (!this.isMobileViewport()) {
      this.mobileSheetOpen = false;
      document.body.classList.remove('trade-login-sheet-open');
      return;
    }
    const url = this.router.url.split('?')[0];
    if (url === '/login' || url === '/register' || url === '/forgot-password') {
      this.openMobileSheet();
    }
  }

  private isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 960;
  }
}

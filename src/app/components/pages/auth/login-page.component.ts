import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';
import { SharedService } from '../../../shared/services/shared.service';
import { environment } from '../../../shared/environment/environment';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login-page.component.html'
})
export class LoginPageComponent {
  loginModel = { username: '', password: '' };
  passVisible = false;
  rememberMe = false;
  isLoginClicked = false;
  error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    public readonly sharedservice: SharedService
  ) {}

  getEnterEvent(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.keyCode === 13) {
      this.login();
    }
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
        void this.router.navigateByUrl(returnUrl);
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
}

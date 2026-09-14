import { Routes } from '@angular/router';
import { routing } from './shared/routes/routes';
import { LayoutComponent } from './shared/components/common/layout/layout.component';
import { AuthShellComponent } from './components/pages/auth/auth-shell.component';
import { LoginPageComponent } from './components/pages/auth/login-page.component';
import { ForgotPasswordPageComponent } from './components/pages/auth/forgot-password-page.component';
import { RegisterPageComponent } from './components/pages/auth/register-page.component';
import { RegisterPlansPageComponent } from './components/pages/auth/register-plans-page.component';
import { AuthGuard } from './shared/guards/auth.guard';
import { guestGuard } from './shared/guards/guest.guard';
import { registrationDraftGuard } from './shared/guards/registration-draft.guard';
import { registrationGuard } from './shared/guards/registration.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login'
  },
  {
    path: 'login',
    component: AuthShellComponent,
    canActivate: [guestGuard],
    children: [{ path: '', component: LoginPageComponent }]
  },
  {
    path: 'forgot-password',
    component: AuthShellComponent,
    canActivate: [guestGuard],
    children: [{ path: '', component: ForgotPasswordPageComponent }]
  },
  {
    path: 'register',
    component: AuthShellComponent,
    canActivate: [guestGuard, registrationGuard],
    children: [{ path: '', component: RegisterPageComponent }]
  },
  {
    path: 'register/plans',
    component: RegisterPlansPageComponent,
    canActivate: [guestGuard, registrationGuard, registrationDraftGuard]
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [AuthGuard],
    children: routing
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];

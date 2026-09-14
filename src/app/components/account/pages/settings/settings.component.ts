import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { DashboardSummaryData, PlayerProfile, PlayerService } from '../../../../services/player.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { SharedService } from '../../../../shared/services/shared.service';

@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class AccountSettingsComponent implements OnInit, OnDestroy {

  isDark = false;
  notificationsEnabled = true;
  soundEnabled = false;
  compactMode = false;

  activeTab: 'security' | 'profile' | 'notifications' | 'data' = 'profile';

  loadingProfile = true;
  profileError: string | null = null;
  summary: DashboardSummaryData | null = null;

  twoFactorEnabled = false;

  /** Expandable password change → `POST player/up` { oldPw, newPw } */
  showPasswordForm = false;
  oldPw = '';
  newPw = '';
  confirmPw = '';
  passwordSaving = false;
  passwordFieldError: string | null = null;

  showOldPw = false;
  showNewPw = false;
  showConfirmPw = false;

  private sub?: Subscription;

  constructor(
    public shared: SharedService,
    private playerService: PlayerService,
    private route: ActivatedRoute,
    private auth: AuthService
  ) { }

  ngOnInit() {
    // Sync from sessionStorage / SharedService
    this.isDark = this.shared.isDarkMode;
    this.soundEnabled = this.shared.isVolumeOn || sessionStorage.getItem('SoundEnabled') === 'true';
    this.compactMode = sessionStorage.getItem('CompactMode') === 'true';
    this.notificationsEnabled = sessionStorage.getItem('Notifications') !== 'false';
    this.twoFactorEnabled = sessionStorage.getItem('TwoFactorEnabled') === 'true';

    // Apply compact if stored
    if (this.compactMode) document.body.classList.add('compact');
    else document.body.classList.remove('compact');

    this.loadProfile();

    // Deep-link: /account/settings?tab=profile|security|notifications|data
    try {
      const qp = this.route.snapshot?.queryParamMap;
      const tab = (qp?.get('tab') || '').toLowerCase();
      if (tab === 'profile' || tab === 'security' || tab === 'notifications' || tab === 'data') {
        this.activeTab = tab as 'profile' | 'security' | 'notifications' | 'data';
      }
    } catch { }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  setTab(tab: 'security' | 'profile' | 'notifications' | 'data') {
    this.activeTab = tab;
  }

  private loadProfile() {
    this.loadingProfile = true;
    this.profileError = null;
    this.sub?.unsubscribe();
    this.sub = this.playerService.getDashboardSummary().subscribe({
      next: (res) => {
        if (res.code !== 0) {
          this.profileError = res.message || 'Failed to load profile';
          this.summary = null;
          this.loadingProfile = false;
          return;
        }
        this.summary = res.data;
        this.loadingProfile = false;
      },
      error: () => {
        this.profileError = 'Failed to load profile';
        this.summary = null;
        this.loadingProfile = false;
      }
    });
  }

  get profile(): PlayerProfile | null {
    return this.summary?.player_profile ?? null;
  }

  toggleTheme() {
    this.isDark = !this.isDark;
    this.shared.switchMode(this.isDark ? 'dark' : 'light');
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    this.shared.isVolumeOn = this.soundEnabled;
    sessionStorage.setItem('SoundEnabled', String(this.soundEnabled));
  }

  toggleNotifications() {
    this.notificationsEnabled = !this.notificationsEnabled;
    sessionStorage.setItem('Notifications', String(this.notificationsEnabled));
  }

  toggleTwoFactor() {
    if (this.shared.isB2BUser()) return;
    this.twoFactorEnabled = !this.twoFactorEnabled;
    sessionStorage.setItem('TwoFactorEnabled', String(this.twoFactorEnabled));
  }

  toggleCompact() {
    this.compactMode = !this.compactMode;
    sessionStorage.setItem('CompactMode', String(this.compactMode));
    if (this.compactMode) document.body.classList.add('compact');
    else document.body.classList.remove('compact');
  }

  clearCache() {
    ['watchlist_markets'].forEach(k => sessionStorage.removeItem(k));
    this.shared.showAlert(1, 'Cache cleared. Reload to refresh market data.');
  }

  copy(text?: string | null) {
    const t = (text || '').trim();
    if (!t) return;
    try {
      navigator.clipboard?.writeText(t);
      this.shared.showAlert(1, 'Copied');
    } catch {
      this.shared.showAlert(3, 'Could not copy');
    }
  }

  togglePasswordForm(): void {
    if (this.shared.isB2BUser()) return;
    this.showPasswordForm = !this.showPasswordForm;
    this.passwordFieldError = null;
    if (!this.showPasswordForm) {
      this.resetPasswordFields();
    }
  }

  private resetPasswordFields(): void {
    this.oldPw = '';
    this.newPw = '';
    this.confirmPw = '';
    this.showOldPw = false;
    this.showNewPw = false;
    this.showConfirmPw = false;
  }

  submitPasswordUpdate(): void {
    if (this.shared.isB2BUser()) return;
    this.passwordFieldError = null;
    const oldTrim = this.oldPw.trim();
    const newTrim = this.newPw.trim();
    const confirmTrim = this.confirmPw.trim();

    if (!oldTrim) {
      this.passwordFieldError = 'Enter your current password.';
      return;
    }
    if (!newTrim) {
      this.passwordFieldError = 'Enter a new password.';
      return;
    }
    if (newTrim.length < 6) {
      this.passwordFieldError = 'New password must be at least 6 characters.';
      return;
    }
    if (newTrim !== confirmTrim) {
      this.passwordFieldError = 'New password and confirm password must match.';
      return;
    }
    if (oldTrim === newTrim) {
      this.passwordFieldError = 'New password must be different from the current password.';
      return;
    }

    this.passwordSaving = true;
    this.playerService.postUpdatePassword({ oldPw: oldTrim, newPw: newTrim }).subscribe({
      next: (res) => {
        this.passwordSaving = false;
        if (res.code === 6) {
          this.resetPasswordFields();
          this.showPasswordForm = false;
          this.shared.showAlert(1, 'Password updated', res.message || '');
          this.auth.logout();
        } else {
          this.shared.showAlert(3, res.message || 'Could not update password');
        }
      },
      error: (err: unknown) => {
        this.passwordSaving = false;
        const e = err as { error?: { message?: string }; message?: string };
        const msg = e?.error?.message || e?.message || 'Request failed. Try again.';
        this.shared.showAlert(3, 'Password update failed', msg);
      }
    });
  }
}

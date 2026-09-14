import { CommonModule, DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from '../../../shared/services/auth.service';
import {
  RegistrationPlanDetails,
  RegistrationPlanSummary,
  RegistrationService
} from '../../../shared/services/registration.service';
import { SharedService } from '../../../shared/services/shared.service';

export interface PlanDetailRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-register-plans-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './register-plans-page.component.html',
  styleUrls: ['./register-plans-page.component.scss']
})
export class RegisterPlansPageComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sliderViewport') sliderViewport?: ElementRef<HTMLElement>;
  @ViewChildren('slideEl') slideElements?: QueryList<ElementRef<HTMLElement>>;

  draft: ReturnType<RegistrationService['getDraft']> = null;

  plans: RegistrationPlanSummary[] = [];
  plansLoading = true;
  plansError: string | null = null;

  activeSlideIndex = 0;

  detailsModalPlan: RegistrationPlanSummary | null = null;
  planDetails: RegistrationPlanDetails | null = null;
  detailsLoading = false;
  detailsError: string | null = null;
  activeDrawerTab: 'all' | 'spread' | 'charges' | 'risk' | 'markets' = 'all';

  submittingPlanId: number | null = null;

  private readonly destroy$ = new Subject<void>();
  private scrollSyncRaf = 0;

  constructor(
    private readonly registration: RegistrationService,
    private readonly auth: AuthService,
    private readonly router: Router,
    @Inject(DOCUMENT) private readonly document: Document,
    public readonly sharedservice: SharedService
  ) { }

  ngOnInit(): void {
    if (this.auth.isLoggedIn) {
      void this.router.navigate(['/trade']);
      return;
    }

    this.draft = this.registration.getDraft();
    if (!this.draft) {
      void this.router.navigate(['/register']);
      return;
    }
    this.loadPlans();
  }

  ngAfterViewInit(): void {
    this.slideElements?.changes.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.scrollToSlide(this.activeSlideIndex, false);
    });
  }

  ngOnDestroy(): void {
    if (this.scrollSyncRaf) {
      cancelAnimationFrame(this.scrollSyncRaf);
    }
    this.unlockBodyScroll();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.detailsModalPlan) {
      this.closeDetailsModal();
      return;
    }
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeft(): void {
    if (!this.detailsModalPlan && this.plans.length > 1) {
      this.prevSlide();
    }
  }

  @HostListener('document:keydown.arrowright')
  onArrowRight(): void {
    if (!this.detailsModalPlan && this.plans.length > 1) {
      this.nextSlide();
    }
  }

  get draftPhoneDisplay(): string {
    if (!this.draft?.phone) return '—';
    return this.draft.phone.startsWith('+') ? this.draft.phone : `+${this.draft.phone}`;
  }

  get isSubmitting(): boolean {
    return this.submittingPlanId !== null;
  }

  get activePlan(): RegistrationPlanSummary | null {
    return this.plans[this.activeSlideIndex] ?? null;
  }

  get canGoPrev(): boolean {
    return this.activeSlideIndex > 0;
  }

  get canGoNext(): boolean {
    return this.activeSlideIndex < this.plans.length - 1;
  }

  toggleTheme(event: MouseEvent): void {
    event.preventDefault();
    const next = this.sharedservice.isDarkMode ? 'light' : 'dark';
    this.sharedservice.switchMode(next);
  }

  loadPlans(): void {
    this.plansLoading = true;
    this.plansError = null;
    this.registration.fetchPlans().pipe(takeUntil(this.destroy$)).subscribe({
      next: (list) => {
        this.plans = list;
        this.activeSlideIndex = 0;
        this.plansLoading = false;
        setTimeout(() => this.scrollToSlide(0, false), 0);
      },
      error: (err) => {
        this.plansLoading = false;
        this.plansError = err?.message || 'Could not load registration plans.';
      }
    });
  }

  onSliderScroll(): void {
    if (this.scrollSyncRaf) {
      cancelAnimationFrame(this.scrollSyncRaf);
    }
    this.scrollSyncRaf = requestAnimationFrame(() => this.syncIndexFromScroll());
  }

  goToSlide(index: number): void {
    if (index < 0 || index >= this.plans.length) return;
    this.activeSlideIndex = index;
    this.scrollToSlide(index, true);
  }

  prevSlide(): void {
    if (!this.canGoPrev) return;
    this.goToSlide(this.activeSlideIndex - 1);
  }

  nextSlide(): void {
    if (!this.canGoNext) return;
    this.goToSlide(this.activeSlideIndex + 1);
  }

  openDetailsModal(plan: RegistrationPlanSummary): void {
    this.detailsModalPlan = plan;
    this.planDetails = null;
    this.detailsLoading = true;
    this.detailsError = null;
    this.activeDrawerTab = 'all';
    this.lockBodyScroll();

    this.registration.fetchPlanDetails(plan.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (details) => {
        this.planDetails = details;
        this.detailsLoading = false;
      },
      error: (err) => {
        this.detailsLoading = false;
        this.detailsError = err?.message || 'Could not load plan details.';
      }
    });
  }

  closeDetailsModal(): void {
    this.detailsModalPlan = null;
    this.planDetails = null;
    this.detailsError = null;
    this.detailsLoading = false;
    this.unlockBodyScroll();
  }

  proceedWithPlan(plan: RegistrationPlanSummary): void {
    if (!this.draft || this.isSubmitting) return;

    this.submittingPlanId = plan.id;
    this.registration.register(this.draft, plan.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.submittingPlanId = null;
        if (res.code === 5) {
          this.sharedservice.showAlert(1, res.message || 'Registration successful! Please sign in.');
          this.closeDetailsModal();
          this.registration.clearDraft();
          void this.router.navigate(['/login']);
        } else {
          this.sharedservice.showAlert(2, res.message || 'Registration failed. Please try again.');
        }
      },
      error: (err) => {
        this.submittingPlanId = null;
        const msg = RegistrationService.apiErrorMessage(err, 'Registration failed. Please try again.');
        this.sharedservice.showAlert(2, msg);
      }
    });
  }

  editRegistration(): void {
    void this.router.navigate(['/register']);
  }

  templateSectionKeys(details: RegistrationPlanDetails | null): string[] {
    if (!details?.template) return [];
    return Object.keys(details.template);
  }

  detailRows(section: string): PlanDetailRow[] {
    if (!this.planDetails?.template) return [];
    const sectionData = (this.planDetails.template as Record<string, unknown>)[section];
    return this.flattenToRows(sectionData);
  }

  formatSectionTitle(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  planCardIcon(index: number): string {
    const icons = ['fa-chart-line', 'fa-bolt', 'fa-gem', 'fa-rocket', 'fa-crown'];
    return icons[index % icons.length];
  }

  setDrawerTab(tab: 'all' | 'spread' | 'charges' | 'risk' | 'markets'): void {
    this.activeDrawerTab = tab;
  }

  getPlanTierBadge(index: number, plan: RegistrationPlanSummary): { label: string; theme: string; badgeText: string } {
    const tiers = [
      { label: 'STARTER TIER', theme: 'teal', badgeText: 'Essential' },
      { label: 'PRO TRADER', theme: 'purple', badgeText: 'Most Popular' },
      { label: 'VIP INSTITUTIONAL', theme: 'gold', badgeText: 'Max Perks' },
      { label: 'ELITE ACCESS', theme: 'blue', badgeText: 'Advanced' }
    ];
    return tiers[index % tiers.length];
  }

  getPlanPerks(plan: RegistrationPlanSummary, index: number): string[] {
    const perksByTier = [
      ['Standard Brokerage Rate', 'Custom Leverage Limits', 'Standard Trade Settlement'],
      ['Reduced Brokerage Fees', 'Up to 100x Leverage', 'Instant Trade Settlement'],
      ['Lowest Fee Schedule', 'Max Leverage Multipliers', 'Priority VIP Support'],
      ['Custom Fee Structure', 'Flexible Margin Rules', 'Dedicated Account Support']
    ];
    return perksByTier[index % perksByTier.length];
  }

  resolveMarketName(keyOrId: unknown): string {
    const str = String(keyOrId).trim();
    const map: Record<string, string> = {
      '1': 'Crypto Spot',
      '2': 'Crypto Futures',
      '3': 'Options & FX',
      '4': 'Commodities',
      '5': 'Equities & Indices',
      '6': 'Metals & Energy',
      'crypto_spot': 'Crypto Spot',
      'crypto_futures': 'Crypto Futures',
      'spot': 'Crypto Spot',
      'futures': 'Crypto Futures'
    };
    if (map[str.toLowerCase()] || map[str]) {
      return map[str.toLowerCase()] || map[str];
    }
    return str.replace(/_/g, ' ').toUpperCase();
  }

  private formatValueItem(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      const label = obj['name'] || obj['market_type'] || obj['market_name'] || obj['symbol'] || obj['title'] || obj['label'] || obj['code'] || obj['id'];
      if (label !== undefined && label !== null) {
        return this.resolveMarketName(String(label));
      }
      const firstStr = Object.values(obj).find((x) => typeof x === 'string');
      if (firstStr) return String(firstStr);
      return 'Enabled';
    }
    return this.resolveMarketName(String(val));
  }

  getLeverageItems(details: RegistrationPlanDetails | null): { symbol: string; value: string }[] {
    if (!details?.template?.leverage) return [];
    const lev = details.template.leverage as Record<string, unknown>;
    return Object.entries(lev).map(([k, v]) => {
      let displayVal = '-';
      if (Array.isArray(v)) {
        displayVal = v.length
          ? v.map((x) => this.formatValueItem(x)).filter(Boolean).join(', ')
          : 'All';
      } else if (typeof v === 'object' && v !== null) {
        displayVal = this.formatValueItem(v);
      } else if (v !== null && v !== undefined) {
        const str = String(v).trim();
        const lowerKey = k.toLowerCase();
        if (str.endsWith('x') || str.endsWith('X') || str.endsWith('%')) {
          displayVal = str;
        } else if (lowerKey.includes('level') || lowerKey.includes('call') || lowerKey.includes('stop') || lowerKey.includes('percent')) {
          displayVal = `${str}%`;
        } else if (lowerKey.includes('ratio') || lowerKey.includes('leverage') || lowerKey.includes('multiplier') || (!isNaN(Number(str)) && !lowerKey.includes('instrument') && !lowerKey.includes('market'))) {
          displayVal = `${str}x`;
        } else {
          displayVal = str;
        }
      }
      return {
        symbol: k.replace(/_/g, ' ').toUpperCase(),
        value: displayVal
      };
    });
  }

  getMarketChips(details: RegistrationPlanDetails | null): { name: string; count: number }[] {
    if (!details?.template?.markets) return [];
    const mkts = details.template.markets;

    if (Array.isArray(mkts)) {
      return mkts.map((m) => {
        if (typeof m === 'object' && m !== null) {
          const obj = m as Record<string, unknown>;
          const nameVal = obj['name'] || obj['market_type'] || obj['title'] || obj['label'] || obj['id'] || 'Market';
          const countVal = Number(obj['count'] || obj['assets_count'] || obj['assets'] || 1);
          return {
            name: this.resolveMarketName(String(nameVal)),
            count: isNaN(countVal) ? 1 : countVal
          };
        }
        return {
          name: this.resolveMarketName(m),
          count: 1
        };
      });
    }

    if (typeof mkts === 'object' && mkts !== null) {
      const obj = mkts as Record<string, unknown>;
      if (Array.isArray(obj['enabled'])) {
        return obj['enabled'].map((m) => ({
          name: this.resolveMarketName(m),
          count: 1
        }));
      }

      return Object.entries(obj).map(([k, v]) => {
        let count = 1;
        let name = this.resolveMarketName(k);
        if (Array.isArray(v)) {
          count = v.length || 1;
        } else if (typeof v === 'object' && v !== null) {
          const vObj = v as Record<string, unknown>;
          if (vObj['name'] || vObj['market_type']) {
            name = this.resolveMarketName(String(vObj['name'] || vObj['market_type']));
          }
          if (vObj['count'] || vObj['assets_count']) {
            count = Number(vObj['count'] || vObj['assets_count']) || 1;
          }
        } else if (typeof v === 'number') {
          count = v;
        }
        return { name, count };
      });
    }

    return [];
  }

  getSectionRows(details: RegistrationPlanDetails | null, sectionKey: string): PlanDetailRow[] {
    if (!details?.template) return [];
    const sectionData = (details.template as Record<string, unknown>)[sectionKey];
    return this.flattenToRows(sectionData);
  }

  hasSectionData(details: RegistrationPlanDetails | null, sectionKey: string): boolean {
    if (!details?.template) return false;
    const data = (details.template as Record<string, unknown>)[sectionKey];
    return data !== null && data !== undefined && typeof data === 'object' && Object.keys(data).length > 0;
  }

  getSpreadRows(details: RegistrationPlanDetails | null): PlanDetailRow[] {
    if (!details?.template) {
      return this.getDefaultSpreadRows();
    }
    const t = details.template as Record<string, unknown>;
    const spreadData = t['spread'] || t['spreads'] || t['spread_schedule'] || t['spread_configuration'];
    if (spreadData && typeof spreadData === 'object' && Object.keys(spreadData).length > 0) {
      return this.flattenToRows(spreadData);
    }
    return this.getDefaultSpreadRows();
  }

  private getDefaultSpreadRows(): PlanDetailRow[] {
    return [
      { label: 'Crypto Majors (BTC, ETH, SOL)', value: 'Dynamic Raw Spread (From 0.2 Pips)' },
      { label: 'Altcoins & Top 50 Tokens', value: 'Variable Market Spread (From 0.8 Pips)' },
      { label: 'Tier Spread Markup', value: '0.00% (Direct Institutional Liquidity)' },
      { label: 'Execution Latency', value: '< 15 ms Institutional Matching Engine' },
      { label: 'Price Improvement', value: 'Enabled (Positive Slippage Credited)' },
      { label: 'Quote Settlement', value: 'Instant USDT / USDC Multi-Asset Settlement' }
    ];
  }

  private scrollToSlide(index: number, smooth: boolean): void {
    const slides = this.slideElements?.toArray();
    const el = slides?.[index]?.nativeElement;
    if (!el) return;
    el.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'center'
    });
  }

  private syncIndexFromScroll(): void {
    const viewport = this.sliderViewport?.nativeElement;
    const slides = this.slideElements?.toArray();
    if (!viewport || !slides?.length) return;

    const center = viewport.scrollLeft + viewport.clientWidth / 2;
    let closest = 0;
    let minDist = Number.POSITIVE_INFINITY;

    slides.forEach((slide, i) => {
      const el = slide.nativeElement;
      const slideCenter = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(center - slideCenter);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    });

    if (closest !== this.activeSlideIndex) {
      this.activeSlideIndex = closest;
    }
  }

  private lockBodyScroll(): void {
    this.document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    this.document.body.style.overflow = '';
  }

  private flattenToRows(value: unknown, prefix = ''): PlanDetailRow[] {
    if (value === null || value === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        return [];
      }
      return value.flatMap((item, i) => {
        const label = prefix ? `${prefix} #${i + 1}` : `Item ${i + 1}`;
        if (item && typeof item === 'object') {
          return this.flattenToRows(item, label);
        }
        return [{ label, value: this.formatScalar(item, label) }];
      });
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) {
        return [];
      }
      return entries.flatMap(([k, v]) => {
        if (v === null || v === undefined || v === '') {
          return [];
        }
        const label = prefix ? `${prefix} · ${this.formatSectionLabel(k)}` : this.formatSectionLabel(k);
        const formattedVal = this.formatScalar(v, k);
        if (formattedVal === '' || formattedVal === '—') {
          return [];
        }
        if (v !== null && typeof v === 'object') {
          return this.flattenToRows(v, label);
        }
        return [{ label, value: formattedVal }];
      });
    }
    return [{ label: prefix || 'Value', value: this.formatScalar(value, prefix) }];
  }

  private formatSectionLabel(key: string): string {
    const map: Record<string, string> = {
      value: 'Brokerage Fee Rate',
      brokerage_type_id: 'Fee Schedule Type',
      period_type: 'Settlement Schedule',
      equity: 'Equity Delivery & Intraday',
      derivatives: 'Futures & Derivatives',
      intraday: 'Intraday Margin Limit',
      delivery: 'Delivery Margin Limit',
      platform_fee: 'Platform Maintenance Fee',
      amc: 'Annual Maintenance Charge (AMC)',
      options: 'Options Trading Access',
      commodities: 'Commodities Trading Access'
    };
    const lowerKey = key.toLowerCase();
    return map[lowerKey] || this.formatSectionTitle(key);
  }

  private formatScalar(value: unknown, keyName = ''): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'Enabled (Active)' : 'Disabled';
    const str = String(value).trim();
    if (!str || str === 'null' || str === 'undefined' || str === '—') return '';
    const lowerKey = keyName.toLowerCase();
    if (lowerKey === 'brokerage_type_id') {
      if (str === '1') return 'Standard Institutional Rate';
      if (str === '2') return 'Fixed Execution Fee';
      if (str === '3') return 'Tiered Volume Schedule';
      return str;
    }
    if (lowerKey === 'value' && !isNaN(Number(str))) {
      return `${str}% per Order`;
    }
    return str;
  }
}

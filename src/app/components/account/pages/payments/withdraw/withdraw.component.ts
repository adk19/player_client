import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';
import { KycService } from '../../../../../services/kyc.service';
import {
  PaymentService,
  type CashConversionData,
  type PayoutPaymentDetails,
  type SavedPayoutMethod
} from '../../../../../services/payment.service';
import type { PlayerDetailsPayload } from '../../../../../services/player-details.models';
import { PlayerDetailsService } from '../../../../../services/player-details.service';
import { AuthService } from '../../../../../shared/services/auth.service';
import { SharedService } from '../../../../../shared/services/shared.service';
import { resolveKycApprovedFromPlatformResponse } from '../../kyc/kyc.helpers';
import { type PaymentMethod } from '../shared/payment-method.data';
import { mapWithdrawMethodsFromPayoutChannels, resolveWithdrawPayoutChannels } from '../shared/payment-method.mapper';
import {
  amountMaxLength,
  amountRangeLabel,
  amountValidationError,
  buildPayoutDetailRows,
  buildWithdrawPayload,
  confirmWithdrawValidationError,
  cryptoPayoutEditableFields,
  cryptoPayoutSaveFieldError,
  effectiveAmountMax,
  fiatPayoutEditableFields,
  fiatPayoutSaveFieldError,
  formatBrandMoney,
  isAmountValid,
  isCryptoWithdrawContext,
  normalizeCryptoPayoutDetailsForSave,
  payoutLabelSaveError,
  payoutMatchesWithdrawMethod,
  quickAmountPresets,
  resolveCryptoPayoutAddress,
  resolveWalletAvailable,
  resolveWithdrawPaymentMethodId,
  sanitizeDecimalInput,
  shouldBlockAmountKey,
  type ConfirmWithdrawInput
} from '../shared/payment.helpers';
import { WithdrawRequestsComponent } from '../withdraw-requests/withdraw-requests.component';

@Component({
  selector: 'app-withdraw',
  standalone: true,
  imports: [CommonModule, FormsModule, WithdrawRequestsComponent],
  templateUrl: './withdraw.component.html',
  styleUrls: ['./withdraw.component.scss']
})
export class WithdrawComponent implements OnInit, OnDestroy {
  private readonly paymentService = inject(PaymentService);
  private readonly playerDetails = inject(PlayerDetailsService);
  private readonly kycService = inject(KycService);
  private readonly authService = inject(AuthService);
  readonly shared = inject(SharedService);
  private loadSub?: Subscription;
  private saveSub?: Subscription;
  private deleteSub?: Subscription;
  private withdrawSub?: Subscription;
  private conversionSub?: Subscription;
  private readonly amountChange$ = new Subject<void>();

  withdrawTab: 'withdraw' | 'requests' = 'withdraw';
  withdrawStep: 'methods' | 'amount' = 'methods';

  paymentMethods: PaymentMethod[] = [];
  savedPayouts: SavedPayoutMethod[] = [];
  selectedMethodId = '';
  selectedPayoutId: number | null = null;

  configLoading = false;
  configError: string | null = null;
  minWithdrawal = 100;
  maxWithdrawal: number | null = null;
  requireKycForWithdrawal = false;
  isKycApproved = false;
  brandCurrencyCode = 'INR';
  brandCurrencySymbol = '₹';
  brandCurrencyDecimals = 2;
  walletLoading = false;
  conversionLoading = false;
  conversionError: string | null = null;
  cashConversion: CashConversionData | null = null;

  showAddPayoutForm = false;
  editingPayoutId: number | null = null;
  isDefaultPayout = false;
  isDeletingPayoutId: number | null = null;
  payoutLabel = '';
  payoutForm: Record<string, string> = {};
  saveAttempted = false;
  isSavingPayout = false;
  savePayoutError: string | null = null;

  amount = '';
  playerNote = '';
  submitAttempted = false;
  withdrawSubmitting = false;
  withdrawSubmitError: string | null = null;

  ngOnInit(): void {
    this.refreshWalletDetails();
    this.loadPageData();
    this.conversionSub = this.amountChange$.pipe(debounceTime(400)).subscribe(() => {
      this.refreshCashConversion();
    });
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.saveSub?.unsubscribe();
    this.deleteSub?.unsubscribe();
    this.withdrawSub?.unsubscribe();
    this.conversionSub?.unsubscribe();
    this.amountChange$.complete();
  }

  showWithdrawTab(tab: 'withdraw' | 'requests'): void {
    this.withdrawTab = tab;
    if (tab === 'withdraw') {
      this.withdrawStep = 'methods';
      this.refreshWalletDetails();
    }
  }

  selectedMethod(): PaymentMethod {
    return this.paymentMethods.find((method) => method.id === this.selectedMethodId) ?? this.paymentMethods[0];
  }

  methodFee(method: PaymentMethod): string {
    return /0\s*%|no fee/i.test(method.feeLabel) ? '0%' : method.feeLabel;
  }

  selectWithdrawMethod(method: PaymentMethod): void {
    this.selectedMethodId = method.id;
    this.amount = '';
    this.playerNote = '';
    this.submitAttempted = false;
    this.withdrawSubmitError = null;
    this.showAddPayoutForm = false;
    this.resetPayoutForm();
    this.syncSelectedPayout();
    this.cashConversion = null;
    this.conversionError = null;
    this.withdrawStep = 'amount';
    this.refreshWalletDetails();
    this.queueConversionRefresh();
  }

  backToMethods(): void {
    this.withdrawStep = 'methods';
    this.submitAttempted = false;
    this.withdrawSubmitError = null;
    this.showAddPayoutForm = false;
    this.resetPayoutForm();
    this.cashConversion = null;
    this.conversionError = null;
  }

  selectedPayout(): SavedPayoutMethod | null {
    if (this.selectedPayoutId == null) return null;
    return this.savedPayouts.find((payout) => payout.payoutId === this.selectedPayoutId) ?? null;
  }

  payoutsForSelectedMethod(): SavedPayoutMethod[] {
    const method = this.selectedMethod();
    if (!method?.paymentMethodId) {
      return [];
    }
    return this.savedPayouts.filter((payout) => payoutMatchesWithdrawMethod(payout, method));
  }

  selectSavedPayout(payoutId: number): void {
    this.selectedPayoutId = payoutId;
    this.showAddPayoutForm = false;
    this.editingPayoutId = null;
    this.resetPayoutForm();
    this.saveAttempted = false;
    this.savePayoutError = null;
    this.queueConversionRefresh();
  }

  openAddPayoutForm(): void {
    this.showAddPayoutForm = true;
    this.editingPayoutId = null;
    this.selectedPayoutId = null;
    this.isDefaultPayout = false;
    this.resetPayoutForm();
    this.saveAttempted = false;
    this.savePayoutError = null;
  }

  openEditPayoutForm(payout: SavedPayoutMethod, event: Event): void {
    event.stopPropagation();
    this.showAddPayoutForm = true;
    this.editingPayoutId = payout.payoutId;
    this.selectedPayoutId = payout.payoutId;
    this.payoutLabel = payout.label;
    this.isDefaultPayout = payout.isDefault;
    this.payoutForm = { ...payout.paymentDetails };
    if (this.isCryptoWithdraw()) {
      const addressKey = this.payoutFields().find((field) => field.key === 'address' || field.key === 'wallet_address')?.key
        ?? 'address';
      this.payoutForm[addressKey] = resolveCryptoPayoutAddress(payout.paymentDetails);
    }
    this.saveAttempted = false;
    this.savePayoutError = null;
  }

  deletePayoutMethod(payout: SavedPayoutMethod, event: Event): void {
    event.stopPropagation();
    if (this.isDeletingPayoutId != null) {
      return;
    }

    this.isDeletingPayoutId = payout.payoutId;
    this.deleteSub?.unsubscribe();
    this.deleteSub = this.paymentService.deletePayout(payout.payoutId).subscribe({
      next: (response) => {
        this.isDeletingPayoutId = null;
        if (response.code !== 0) {
          this.shared.showAlert(3, response.message || 'Could not delete payout account');
          return;
        }

        this.shared.showAlert(1, response.message || 'Payout account deleted');
        if (this.editingPayoutId === payout.payoutId) {
          this.showAddPayoutForm = false;
          this.editingPayoutId = null;
          this.resetPayoutForm();
        }
        this.reloadPayoutData(null);
      },
      error: () => {
        this.isDeletingPayoutId = null;
        this.shared.showAlert(3, 'Could not delete payout account');
      }
    });
  }

  cancelAddPayoutForm(): void {
    this.showAddPayoutForm = false;
    this.editingPayoutId = null;
    this.resetPayoutForm();
    this.saveAttempted = false;
    this.savePayoutError = null;
    this.syncSelectedPayout();
  }

  isEditingPayoutForm(): boolean {
    return this.editingPayoutId != null;
  }

  payoutFields(): { key: string; label: string }[] {
    const method = this.selectedMethod();
    if (!method) {
      return [];
    }

    if (isCryptoWithdrawContext({
      paymentMethodId: method.paymentMethodId,
      kind: method.kind,
      cryptoCode: method.cryptoCode
    })) {
      return cryptoPayoutEditableFields(method.credentialFields);
    }

    return fiatPayoutEditableFields({
      paymentMethodId: method.paymentMethodId,
      kind: method.kind,
      credentialFields: method.credentialFields
    });
  }

  payoutFieldError(fieldKey: string): string | null {
    if (!this.saveAttempted) {
      return null;
    }

    if (this.isCryptoWithdraw()) {
      return cryptoPayoutSaveFieldError(fieldKey, this.payoutForm[fieldKey] ?? '', true);
    }

    const method = this.selectedMethod();
    return fiatPayoutSaveFieldError(
      fieldKey,
      this.payoutForm[fieldKey] ?? '',
      method.paymentMethodId,
      method.kind,
      true
    );
  }

  payoutLabelError(): string | null {
    return payoutLabelSaveError(this.payoutLabel, this.saveAttempted);
  }

  isPayoutFormValid(): boolean {
    if (payoutLabelSaveError(this.payoutLabel, true)) {
      return false;
    }

    if (this.isCryptoWithdraw()) {
      return this.payoutFields().every(
        (field) => !cryptoPayoutSaveFieldError(field.key, this.payoutForm[field.key] ?? '', true)
      );
    }

    const method = this.selectedMethod();
    return this.payoutFields().every(
      (field) => !fiatPayoutSaveFieldError(
        field.key,
        this.payoutForm[field.key] ?? '',
        method.paymentMethodId,
        method.kind,
        true
      )
    );
  }

  withdrawCoin(): string {
    const method = this.selectedMethod();
    return method.cryptoCode?.trim().toUpperCase() || method.currency?.trim().toUpperCase() || '';
  }

  withdrawNetwork(): string {
    return this.selectedMethod().network?.trim() || '';
  }

  cryptoPayoutLabelPlaceholder(): string {
    const coin = this.withdrawCoin();
    return coin ? `e.g. My ${coin} wallet` : 'e.g. My crypto wallet';
  }

  savePayoutMethod(): void {
    this.saveAttempted = true;
    this.savePayoutError = null;

    const method = this.selectedMethod();
    if (!method?.paymentMethodId || !this.isPayoutFormValid()) return;

    const paymentDetails: PayoutPaymentDetails = this.isCryptoWithdraw()
      ? normalizeCryptoPayoutDetailsForSave(
        this.payoutForm,
        method.cryptoCode || method.currency,
        method.network
      )
      : this.buildFiatPayoutPaymentDetails();

    this.isSavingPayout = true;
    this.saveSub?.unsubscribe();

    const payoutPayload = {
      paymentMethodId: this.resolvedWithdrawPaymentMethodId(method),
      paymentDetails,
      label: this.payoutLabel.trim(),
      isDefault: this.isDefaultPayout
    };

    const saveRequest = this.editingPayoutId != null
      ? this.paymentService.updatePayout({ ...payoutPayload, payoutId: this.editingPayoutId })
      : this.paymentService.savePayout(payoutPayload);

    this.saveSub = saveRequest.pipe(
      finalize(() => {
        this.isSavingPayout = false;
      })
    ).subscribe({
      next: (response) => {
        if (response.code !== 0) {
          this.savePayoutError = response.message || 'Could not save payout method';
          this.shared.showAlert(3, this.savePayoutError);
          return;
        }

        this.shared.showAlert(1, response.message || (this.editingPayoutId != null ? 'Payout account updated' : 'Payout method saved'));
        this.showAddPayoutForm = false;
        this.editingPayoutId = null;
        this.resetPayoutForm();
        this.saveAttempted = false;
        this.reloadPayoutData(response.data?.payoutId ?? null);
      },
      error: (error: { error?: { message?: string } }) => {
        this.savePayoutError = error?.error?.message || 'Could not save payout method';
        this.shared.showAlert(3, this.savePayoutError);
      }
    });
  }

  payoutSummary(payout: SavedPayoutMethod): string {
    const details = payout.paymentDetails;
    if (details['account_number']) {
      const accountNumber = details['account_number'];
      const masked = accountNumber.length > 4 ? `****${accountNumber.slice(-4)}` : accountNumber;
      return `${details['bank_name'] || payout.paymentMethodName} · ${masked}`;
    }
    if (details['upi_id']) {
      return details['upi_id'];
    }
    const address = resolveCryptoPayoutAddress(details);
    if (address) {
      const coin = details['coin']?.trim().toUpperCase();
      const masked = address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
      return coin ? `${coin} · ${masked}` : masked;
    }
    return payout.paymentMethodName;
  }

  walletTotalBalanceAmount(): number {
    const balance = Number(this.playerDetails.details?.wallet?.balance);
    if (Number.isFinite(balance)) {
      return balance;
    }
    const cachedBalance = Number(this.authService.currentBalance);
    return Number.isFinite(cachedBalance) ? cachedBalance : 0;
  }

  availableBalance(): number {
    return resolveWalletAvailable(this.playerDetails.details?.wallet);
  }

  walletReservedAmount(): number {
    return Math.max(0, this.walletTotalBalanceAmount() - this.availableBalance());
  }

  showWithdrawableHint(): boolean {
    return this.walletReservedAmount() > 0.009;
  }

  walletTotalBalance(): string {
    return this.formatWalletMoney(this.walletTotalBalanceAmount());
  }

  withdrawableBalance(): string {
    return this.formatWalletMoney(this.availableBalance());
  }

  walletReservedBalance(): string {
    return this.formatWalletMoney(this.walletReservedAmount());
  }

  private formatWalletMoney(amount: number): string {
    const sharedFormatted = this.shared.formatToBrandCurrency(amount);
    if (sharedFormatted !== '-') {
      return sharedFormatted;
    }

    return formatBrandMoney(amount, {
      currency_symbol: this.brandCurrencySymbol,
      decimal_places: this.brandCurrencyDecimals
    }, this.brandCurrencySymbol);
  }

  currency(): string {
    return this.brandCurrencyCode;
  }

  showConversionPanel(): boolean {
    return this.isCryptoWithdraw() && !!this.amount && !!this.selectedPayout();
  }

  formatReceiveAmount(): string {
    if (!this.cashConversion) {
      return '—';
    }
    return `${this.cashConversion.payment_amount} ${this.cashConversion.payment_currency_code}`;
  }

  get showKycWithdrawalBanner(): boolean {
    return this.requireKycForWithdrawal && !this.isKycApproved;
  }

  quickAmounts(): number[] {
    return quickAmountPresets(this.minWithdrawal, this.maxWithdrawal, this.availableBalance());
  }

  withdrawAmountRangeLabel(): string {
    return amountRangeLabel(this.minWithdrawal, this.maxWithdrawal, this.currency());
  }

  withdrawAmountMaxLength(): number {
    return amountMaxLength(this.maxWithdrawal);
  }

  onWithdrawAmountKeyDown(event: KeyboardEvent): void {
    const max = effectiveAmountMax(this.maxWithdrawal, this.availableBalance());
    const input = event.target as HTMLInputElement;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const nextValue = `${input.value.slice(0, selectionStart)}${event.key}${input.value.slice(selectionEnd)}`;
    if (shouldBlockAmountKey(event, nextValue, max)) {
      event.preventDefault();
    }
  }

  onWithdrawAmountInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = sanitizeDecimalInput(input.value);

    if (!raw) {
      this.amount = '';
      input.value = '';
      return;
    }

    const max = effectiveAmountMax(this.maxWithdrawal, this.availableBalance());
    const paymentAmount = Number(raw);
    if (!Number.isFinite(paymentAmount)) {
      input.value = this.amount;
      return;
    }

    if (paymentAmount > max) {
      this.amount = String(max);
      input.value = this.amount;
      return;
    }

    this.amount = raw;
    if (input.value !== raw) {
      input.value = raw;
    }
    this.queueConversionRefresh();
  }

  setWithdrawAmount(value: string | number | null): void {
    const raw = String(value ?? '').trim();
    if (!raw) {
      this.amount = '';
      return;
    }

    const paymentAmount = Number(raw);
    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return;

    const max = effectiveAmountMax(this.maxWithdrawal, this.availableBalance());
    this.amount = paymentAmount > max ? String(max) : raw;
    this.queueConversionRefresh();
  }

  isWithdrawAmountValid(): boolean {
    return isAmountValid(this.amount, this.minWithdrawal, this.maxWithdrawal, this.availableBalance());
  }

  amountError(): string | null {
    return amountValidationError(
      this.amount,
      this.minWithdrawal,
      this.maxWithdrawal,
      this.currency(),
      this.submitAttempted,
      this.availableBalance()
    );
  }

  payoutSelectionError(): string | null {
    if (!this.submitAttempted || this.showAddPayoutForm || this.selectedPayoutId != null) {
      return null;
    }
    return 'Select or add a payout account';
  }

  playerNoteError(): string | null {
    if (!this.submitAttempted || this.playerNote.trim().length <= 500) {
      return null;
    }
    return 'Note must be at most 500 characters';
  }

  confirmWithdrawFormError(): string | null {
    return confirmWithdrawValidationError(
      this.withdrawInput(),
      this.minWithdrawal,
      this.maxWithdrawal,
      this.currency(),
      this.availableBalance(),
      this.submitAttempted
    );
  }

  isWithdrawFormValid(): boolean {
    return buildWithdrawPayload(this.withdrawInput()) != null
      && !this.confirmWithdrawValidationSnapshot();
  }

  private confirmWithdrawValidationSnapshot(): string | null {
    return confirmWithdrawValidationError(
      this.withdrawInput(),
      this.minWithdrawal,
      this.maxWithdrawal,
      this.currency(),
      this.availableBalance(),
      true
    );
  }

  isCryptoWithdraw(): boolean {
    const method = this.selectedMethod();
    return isCryptoWithdrawContext({
      paymentMethodId: method.paymentMethodId,
      kind: method.kind,
      cryptoCode: method.cryptoCode
    });
  }

  showPayoutSidePanel(): boolean {
    return !!this.selectedPayout() && !this.showAddPayoutForm;
  }

  payoutDetailRows() {
    const payout = this.selectedPayout();
    return payout ? buildPayoutDetailRows(payout.paymentDetails) : [];
  }

  submitWithdraw(): void {
    this.submitAttempted = true;
    this.withdrawSubmitError = null;

    if (this.showKycWithdrawalBanner) {
      this.withdrawSubmitError = 'KYC verification is required before withdrawal';
      return;
    }

    const formError = this.confirmWithdrawFormError();
    if (formError) {
      return;
    }

    const body = buildWithdrawPayload(this.withdrawInput());
    if (!body) {
      this.withdrawSubmitError = 'Missing payout details';
      return;
    }

    this.withdrawSubmitting = true;
    this.withdrawSub?.unsubscribe();
    this.withdrawSub = this.paymentService.submitWithdraw(body).pipe(
      finalize(() => {
        this.withdrawSubmitting = false;
      })
    ).subscribe({
      next: (response) => {
        if (response.code !== 0) {
          this.withdrawSubmitError = response.message || 'Could not submit withdrawal';
          this.shared.showAlert(3, this.withdrawSubmitError);
          return;
        }

        this.shared.showAlert(1, response.message || 'Withdrawal submitted successfully');
        this.refreshWalletDetails();
        this.showWithdrawTab('requests');
      },
      error: (error: { error?: { message?: string } }) => {
        this.withdrawSubmitError = error?.error?.message || 'Could not submit withdrawal';
        this.shared.showAlert(3, this.withdrawSubmitError);
      }
    });
  }

  copyText(value: string): void {
    void navigator.clipboard?.writeText(value);
  }

  private queueConversionRefresh(): void {
    this.amountChange$.next();
  }

  private refreshCashConversion(): void {
    const method = this.selectedMethod();
    const paymentMethodId = method.paymentMethodId;
    if (!paymentMethodId || !this.isCryptoWithdraw() || !this.selectedPayout()) {
      this.cashConversion = null;
      this.conversionError = null;
      this.conversionLoading = false;
      return;
    }

    if (!isAmountValid(this.amount, this.minWithdrawal, this.maxWithdrawal, this.availableBalance())) {
      this.cashConversion = null;
      this.conversionError = null;
      this.conversionLoading = false;
      return;
    }

    const payout = this.selectedPayout();
    const coin = payout?.paymentDetails['coin'] || method.cryptoCode || method.currency;

    this.conversionLoading = true;
    this.conversionError = null;

    this.paymentService.convertCashAmount({
      amount: Number(this.amount),
      flow: 'withdraw',
      payment_method_id: paymentMethodId,
      coin,
      network: payout?.paymentDetails['network'] || method.network || null
    }).pipe(
      finalize(() => {
        this.conversionLoading = false;
      })
    ).subscribe({
      next: (response) => {
        if (response.code !== 0 || !response.data) {
          this.cashConversion = null;
          this.conversionError = response.message || 'Could not calculate conversion';
          return;
        }
        this.cashConversion = response.data;
        this.conversionError = null;
      },
      error: (error: { error?: { message?: string } }) => {
        this.cashConversion = null;
        this.conversionError = error?.error?.message || 'Could not calculate conversion';
      }
    });
  }

  private buildFiatPayoutPaymentDetails(): PayoutPaymentDetails {
    const paymentDetails: PayoutPaymentDetails = {};
    for (const field of this.payoutFields()) {
      paymentDetails[field.key] = this.payoutForm[field.key].trim();
    }
    return paymentDetails;
  }

  private loadPageData(): void {
    this.configLoading = true;
    this.configError = null;
    this.loadSub?.unsubscribe();

    this.loadSub = forkJoin({
      config: this.paymentService.getConfig(),
      payout: this.paymentService.getPayout(),
      kyc: this.kycService.getPlatformAndLevel()
    }).pipe(
      finalize(() => {
        this.configLoading = false;
      })
    ).subscribe({
      next: ({ config, payout, kyc }) => {
        if (config.code !== 0 || !config.data) {
          this.configError = config.message || 'Could not load withdrawal config';
          return;
        }
        if (payout.code !== 0) {
          this.configError = payout.message || 'Could not load payout methods';
          return;
        }

        this.isKycApproved = resolveKycApprovedFromPlatformResponse(kyc);
        this.minWithdrawal = config.data.config.min_withdrawal ?? 100;
        const max = config.data.config.max_withdrawal;
        this.maxWithdrawal = max != null && Number.isFinite(max) && max > 0 ? max : null;
        if (config.data.brand_currency?.currency_code) {
          this.brandCurrencyCode = config.data.brand_currency.currency_code;
          this.brandCurrencySymbol = config.data.brand_currency.currency_symbol || this.brandCurrencyCode;
          this.brandCurrencyDecimals = config.data.brand_currency.decimal_places ?? 2;
        }
        this.requireKycForWithdrawal = Boolean(config.data.config.require_kyc_for_withdrawal);
        const withdrawChannels = resolveWithdrawPayoutChannels(payout.allowedChannels, config.data);
        this.paymentMethods = mapWithdrawMethodsFromPayoutChannels(withdrawChannels);
        this.savedPayouts = payout.savedPayouts;
        this.selectedMethodId = '';
        this.withdrawStep = 'methods';
        this.syncSelectedPayout();
      },
      error: () => {
        this.configError = 'Could not load withdrawal data';
      }
    });
  }

  private reloadPayoutData(selectPayoutId: number | null): void {
    this.paymentService.getPayout().subscribe({
      next: (response) => {
        if (response.code !== 0) {
          this.shared.showAlert(3, response.message || 'Could not refresh payout methods');
          return;
        }
        this.savedPayouts = response.savedPayouts;
        if (selectPayoutId != null) {
          this.selectedPayoutId = selectPayoutId;
        } else {
          this.syncSelectedPayout();
        }
        this.queueConversionRefresh();
      },
      error: () => {
        this.shared.showAlert(3, 'Could not refresh payout methods');
      }
    });
  }

  private syncSelectedPayout(): void {
    const payouts = this.payoutsForSelectedMethod();
    if (!payouts.length) {
      this.selectedPayoutId = null;
      return;
    }
    if (this.selectedPayoutId == null || !payouts.some((payout) => payout.payoutId === this.selectedPayoutId)) {
      const defaultPayout = payouts.find((payout) => payout.isDefault) ?? payouts[0];
      this.selectedPayoutId = defaultPayout.payoutId;
    }
    this.queueConversionRefresh();
  }

  private resetPayoutForm(): void {
    this.payoutLabel = '';
    this.isDefaultPayout = false;
    this.payoutForm = {};
    const method = this.selectedMethod();

    for (const field of this.payoutFields()) {
      if (this.isCryptoWithdraw() && (field.key === 'address' || field.key === 'wallet_address')) {
        this.payoutForm[field.key] = '';
        continue;
      }
      if (field.key === 'coin') {
        this.payoutForm[field.key] = method?.cryptoCode || method?.currency || '';
      } else if (field.key === 'network') {
        this.payoutForm[field.key] = method?.network || '';
      } else {
        this.payoutForm[field.key] = '';
      }
    }
  }

  private withdrawInput(): ConfirmWithdrawInput {
    const method = this.selectedMethod();
    const payout = this.selectedPayout();
    return {
      amount: Number(this.amount),
      paymentMethodId: this.resolvedWithdrawPaymentMethodId(method),
      payoutDetails: payout?.paymentDetails ?? {},
      payoutMethodId: payout?.payoutId ?? null,
      playerNote: this.playerNote,
      coinFallback: method.cryptoCode || method.currency,
      networkFallback: method.network
    };
  }

  private resolvedWithdrawPaymentMethodId(method: PaymentMethod): number {
    return resolveWithdrawPaymentMethodId({
      paymentMethodId: method.paymentMethodId,
      kind: method.kind,
      cryptoCode: method.cryptoCode
    }) ?? method.paymentMethodId ?? 0;
  }

  private refreshWalletDetails(): void {
    this.walletLoading = !this.playerDetails.details;
    this.playerDetails.refresh().pipe(
      finalize(() => {
        this.walletLoading = false;
      })
    ).subscribe((data) => {
      this.syncAuthBalance(data);
    });
  }

  private syncAuthBalance(data: PlayerDetailsPayload | null): void {
    const balance = data?.wallet?.balance;
    if (balance != null && Number.isFinite(Number(balance))) {
      this.authService.updateBalance(Number(balance));
    }
  }
}

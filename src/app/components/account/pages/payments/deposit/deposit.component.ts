import { CommonModule } from '@angular/common';
import { Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { QRCodeComponent } from 'angularx-qrcode';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';
import {
  PaymentService,
  type CashConversionData,
  type DepositWalletApi,
  type PaymentConfigData
} from '../../../../../services/payment.service';
import type { PlayerDetailsPayload } from '../../../../../services/player-details.models';
import { PlayerDetailsService } from '../../../../../services/player-details.service';
import { AuthService } from '../../../../../shared/services/auth.service';
import { SharedService } from '../../../../../shared/services/shared.service';
import { DepositRequestsComponent } from '../deposit-requests/deposit-requests.component';
import { type PaymentMethod } from '../shared/payment-method.data';
import { mapDepositMethodsFromConfig } from '../shared/payment-method.mapper';
import {
  amountMaxLength,
  amountRangeLabel,
  amountValidationError,
  buildBankDepositRows,
  buildConfirmDepositFormData,
  buildCryptoDepositRows,
  confirmDepositValidationError,
  DEPOSIT_PROOF_ACCEPT,
  effectiveAmountMax,
  formatBrandMoney,
  isAmountValid,
  isCryptoDepositMethodId,
  isDepositProofFileValid,
  isUtrDepositMethodId,
  quickAmountPresets,
  sanitizeDecimalInput,
  shouldBlockAmountKey,
  type ConfirmDepositInput
} from '../shared/payment.helpers';

@Component({
  selector: 'app-deposit',
  standalone: true,
  imports: [CommonModule, FormsModule, QRCodeComponent, DepositRequestsComponent],
  templateUrl: './deposit.component.html',
  styleUrls: ['./deposit.component.scss']
})
export class DepositComponent implements OnInit, OnDestroy {
  private readonly paymentService = inject(PaymentService);
  private readonly playerDetails = inject(PlayerDetailsService);
  private readonly authService = inject(AuthService);
  readonly shared = inject(SharedService);
  private configSub?: Subscription;
  private depositSub?: Subscription;
  private conversionSub?: Subscription;
  private readonly amountChange$ = new Subject<void>();

  depositTab: 'deposit' | 'requests' = 'deposit';
  depositStep: 'methods' | 'amount' = 'methods';

  paymentMethods: PaymentMethod[] = [];
  depositWallets: DepositWalletApi[] = [];
  minDeposit = 100;
  maxDeposit: number | null = null;
  brandCurrencyCode = 'INR';
  brandCurrencySymbol = '₹';
  brandCurrencyDecimals = 2;
  walletLoading = false;

  configLoading = false;
  configError: string | null = null;
  conversionLoading = false;
  conversionError: string | null = null;
  cashConversion: CashConversionData | null = null;
  submitAttempted = false;
  depositSubmitting = false;
  depositSubmitError: string | null = null;

  selectedMethodId = '';
  amount = '';
  depositUtr = '';
  depositTxHash = '';
  depositSenderWallet = '';
  depositPlayerNote = '';
  depositFile: File | null = null;
  depositFileName = '';
  depositFilePreviewUrl: string | null = null;
  isDepositFileDragging = false;
  isDepositProofViewerOpen = false;

  readonly depositProofAccept = DEPOSIT_PROOF_ACCEPT;

  ngOnInit(): void {
    this.refreshWalletDetails();
    this.loadPaymentConfig();
    this.conversionSub = this.amountChange$.pipe(debounceTime(400)).subscribe(() => {
      this.refreshCashConversion();
    });
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.depositSub?.unsubscribe();
    this.conversionSub?.unsubscribe();
    this.amountChange$.complete();
    this.closeDepositProofViewer();
    this.releaseDepositFilePreview();
  }

  @HostListener('document:keydown.escape')
  onDepositProofViewerEscape(): void {
    this.closeDepositProofViewer();
  }

  showDepositTab(tab: 'deposit' | 'requests'): void {
    this.depositTab = tab;
    if (tab === 'deposit') {
      this.depositStep = 'methods';
    }
  }

  selectDepositMethod(method: PaymentMethod): void {
    this.selectedMethodId = method.id;
    this.resetDepositFormFields();
    this.depositSubmitError = null;
    this.submitAttempted = false;
    this.cashConversion = null;
    this.conversionError = null;
    this.depositStep = 'amount';
    this.queueConversionRefresh();
  }

  backToMethods(): void {
    this.depositStep = 'methods';
    this.submitAttempted = false;
    this.depositSubmitError = null;
    this.resetDepositFormFields();
    this.cashConversion = null;
    this.conversionError = null;
  }

  submitDeposit(): void {
    this.submitAttempted = true;
    this.depositSubmitError = null;

    const formData = buildConfirmDepositFormData(this.depositInput());
    if (!formData || this.confirmDepositFormError()) {
      return;
    }

    this.depositSubmitting = true;
    this.depositSub?.unsubscribe();

    this.depositSub = this.paymentService.submitDeposit(formData).pipe(
      finalize(() => {
        this.depositSubmitting = false;
      })
    ).subscribe({
      next: (response) => {
        if (response.code !== 0) {
          this.depositSubmitError = response.message || 'Could not submit deposit';
          this.shared.showAlert(3, this.depositSubmitError);
          return;
        }

        this.shared.showAlert(1, response.message || 'Deposit submitted successfully');
        this.refreshWalletDetails();
        this.showDepositTab('requests');
      },
      error: (error: { error?: { message?: string } }) => {
        this.depositSubmitError = error?.error?.message || 'Could not submit deposit';
        this.shared.showAlert(3, this.depositSubmitError);
      }
    });
  }

  quickAmounts(): number[] {
    return quickAmountPresets(this.minDeposit, this.maxDeposit);
  }

  depositAmountRangeLabel(): string {
    return amountRangeLabel(this.minDeposit, this.maxDeposit, this.currency());
  }

  depositAmountMaxLength(): number {
    return amountMaxLength(this.maxDeposit);
  }

  onDepositAmountKeyDown(event: KeyboardEvent): void {
    if (this.maxDeposit == null) return;
    const input = event.target as HTMLInputElement;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const nextValue = `${input.value.slice(0, selectionStart)}${event.key}${input.value.slice(selectionEnd)}`;
    if (shouldBlockAmountKey(event, nextValue, this.maxDeposit)) {
      event.preventDefault();
    }
  }

  onDepositAmountInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = sanitizeDecimalInput(input.value);

    if (!raw) {
      this.amount = '';
      input.value = '';
      return;
    }

    const max = effectiveAmountMax(this.maxDeposit);
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

  setDepositAmount(value: string | number | null): void {
    const raw = String(value ?? '').trim();
    if (!raw) {
      this.amount = '';
      return;
    }

    const paymentAmount = Number(raw);
    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) return;

    const max = effectiveAmountMax(this.maxDeposit);
    this.amount = paymentAmount > max ? String(max) : raw;
    this.queueConversionRefresh();
  }

  walletBalanceAmount(): number {
    const balance = Number(this.playerDetails.details?.wallet?.balance);
    if (Number.isFinite(balance)) {
      return balance;
    }
    const cachedBalance = Number(this.authService.currentBalance);
    return Number.isFinite(cachedBalance) ? cachedBalance : 0;
  }

  walletBalance(): string {
    const balance = this.walletBalanceAmount();
    const sharedFormatted = this.shared.formatToBrandCurrency(balance);
    if (sharedFormatted !== '-') {
      return sharedFormatted;
    }

    return formatBrandMoney(balance, {
      currency_symbol: this.brandCurrencySymbol,
      decimal_places: this.brandCurrencyDecimals
    }, this.brandCurrencySymbol);
  }

  selectedMethod(): PaymentMethod {
    return this.paymentMethods.find((method) => method.id === this.selectedMethodId) ?? this.paymentMethods[0];
  }

  selectedWallet(): DepositWalletApi | null {
    const selected = this.selectedMethod();
    if (selected.brandWalletId != null) {
      return this.depositWallets.find((wallet) => wallet.brand_wallet_id === selected.brandWalletId) ?? null;
    }
    if (selected.paymentMethodId == null) return null;
    return this.depositWallets.find((wallet) => wallet.payment_method_id === selected.paymentMethodId) ?? null;
  }

  upiId(): string {
    const id = this.selectedWallet()?.credentials?.upi_id;
    return typeof id === 'string' ? id.trim() : '';
  }

  payeeName(): string {
    const name = this.selectedWallet()?.credentials?.display_name;
    return typeof name === 'string' ? name.trim() : this.selectedWallet()?.display_name ?? '';
  }

  qrImageUrl(): string | null {
    const url = this.selectedWallet()?.credentials?.qr_url;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  }

  isUpiDeposit(): boolean {
    return this.selectedMethod().kind === 'upi_qr' && !!this.upiId();
  }

  isBankDeposit(): boolean {
    return this.selectedMethod().kind === 'bank' && this.bankDepositDetails().length > 0;
  }

  isCryptoDeposit(): boolean {
    return isCryptoDepositMethodId(this.selectedMethod().paymentMethodId)
      || (this.selectedMethod().kind === 'crypto' && this.cryptoDepositDetails().length > 0);
  }

  requiresUtr(): boolean {
    return isUtrDepositMethodId(this.selectedMethod().paymentMethodId);
  }

  requiresCryptoProof(): boolean {
    return isCryptoDepositMethodId(this.selectedMethod().paymentMethodId);
  }

  showDepositSidePanel(): boolean {
    return this.isUpiDeposit() || this.isBankDeposit() || this.isCryptoDeposit();
  }

  cryptoDepositDetails() {
    return buildCryptoDepositRows(this.selectedWallet());
  }

  bankDepositDetails() {
    return buildBankDepositRows(this.selectedWallet());
  }

  depositCoin(): string {
    const wallet = this.selectedWallet();
    return wallet?.crypto_code?.trim().toUpperCase()
      || this.selectedMethod().currency?.trim().toUpperCase()
      || '';
  }

  depositNetwork(): string {
    return this.selectedWallet()?.network?.trim() || this.selectedMethod().network?.trim() || '';
  }

  upiPayUri(): string {
    const params = new URLSearchParams({
      pa: this.upiId(),
      pn: this.payeeName(),
      cu: 'INR',
      tn: 'Wallet deposit'
    });
    const paymentAmount = Number(this.amount);
    if (Number.isFinite(paymentAmount) && paymentAmount > 0) {
      params.set('am', paymentAmount.toFixed(2));
    }
    return `upi://pay?${params.toString()}`;
  }

  canPayUpi(): boolean {
    return isAmountValid(this.amount, this.minDeposit, this.maxDeposit);
  }

  isDepositFormValid(): boolean {
    return buildConfirmDepositFormData(this.depositInput()) != null
      && !this.confirmDepositValidationSnapshot();
  }

  private confirmDepositValidationSnapshot(): string | null {
    return confirmDepositValidationError(this.depositInput(), true);
  }

  amountError(): string | null {
    return amountValidationError(this.amount, this.minDeposit, this.maxDeposit, this.currency(), this.submitAttempted);
  }

  confirmDepositFormError(): string | null {
    return confirmDepositValidationError(this.depositInput(), this.submitAttempted);
  }

  depositUtrError(): string | null {
    if (!this.submitAttempted || !this.requiresUtr() || this.depositUtr.trim().length >= 4) {
      return null;
    }
    return 'UTR must be at least 4 characters';
  }

  depositTxHashError(): string | null {
    if (!this.submitAttempted || !this.requiresCryptoProof() || this.depositTxHash.trim().length >= 8) {
      return null;
    }
    return 'Transaction hash must be at least 8 characters';
  }

  depositSenderWalletError(): string | null {
    if (!this.submitAttempted || !this.requiresCryptoProof() || this.depositSenderWallet.trim().length >= 8) {
      return null;
    }
    return 'Sender wallet address must be at least 8 characters';
  }

  depositPlayerNoteError(): string | null {
    if (!this.submitAttempted || this.depositPlayerNote.trim().length <= 500) {
      return null;
    }
    return 'Note must be at most 500 characters';
  }

  depositFileLabel(): string {
    return this.requiresCryptoProof() ? 'Deposit proof' : 'Payment screenshot';
  }

  depositFileHint(): string {
    return this.requiresCryptoProof()
      ? 'Required — JPG, PNG or PDF (max 10MB)'
      : 'Recommended — JPG, PNG or PDF (max 10MB)';
  }

  depositFileError(): string | null {
    if (!this.submitAttempted) {
      return null;
    }
    if (this.requiresCryptoProof() && !this.depositFile) {
      return 'Deposit proof or screenshot is required for crypto deposits';
    }
    if (this.depositFile && !isDepositProofFileValid(this.depositFile)) {
      return 'File must be JPG, PNG or PDF (max 10MB)';
    }
    return null;
  }

  isDepositFileImage(): boolean {
    return !!this.depositFile?.type.startsWith('image/');
  }

  isDepositFilePdf(): boolean {
    const file = this.depositFile;
    if (!file) {
      return false;
    }
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  openDepositProofViewer(): void {
    if (!this.depositFile) {
      return;
    }

    if (this.isDepositFileImage() && this.depositFilePreviewUrl) {
      this.isDepositProofViewerOpen = true;
      document.body.style.overflow = 'hidden';
      return;
    }

    if (this.isDepositFilePdf()) {
      const pdfUrl = URL.createObjectURL(this.depositFile);
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    }
  }

  closeDepositProofViewer(): void {
    if (!this.isDepositProofViewerOpen) {
      return;
    }
    this.isDepositProofViewerOpen = false;
    document.body.style.overflow = '';
  }

  onDepositFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setDepositFile(input.files?.[0] ?? null);
  }

  onDepositFileDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDepositFileDragging = true;
  }

  onDepositFileDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDepositFileDragging = false;
  }

  onDepositFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDepositFileDragging = false;
    this.setDepositFile(event.dataTransfer?.files?.[0] ?? null);
  }

  clearDepositFile(input?: HTMLInputElement): void {
    this.closeDepositProofViewer();
    this.releaseDepositFilePreview();
    this.depositFile = null;
    this.depositFileName = '';
    if (input) {
      input.value = '';
    }
  }

  formatDepositFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  openUpiApp(): void {
    if (!this.canPayUpi()) {
      this.submitAttempted = true;
      return;
    }
    window.location.href = this.upiPayUri();
  }

  copyText(value: string): void {
    void navigator.clipboard?.writeText(value);
  }

  currency(): string {
    return this.brandCurrencyCode;
  }

  showConversionPanel(): boolean {
    return this.requiresCryptoProof() && !!this.amount;
  }

  formatPaymentAmount(): string {
    if (!this.cashConversion) {
      return '—';
    }
    const value = this.cashConversion.payment_amount;
    const code = this.cashConversion.payment_currency_code;
    if (this.cashConversion.conversion_required) {
      return `${value} ${code}`;
    }
    return `${value} ${code}`;
  }

  methodFee(method: PaymentMethod): string {
    return /0\s*%|no fee/i.test(method.feeLabel) ? '0%' : method.feeLabel;
  }

  private depositInput(): ConfirmDepositInput {
    const method = this.selectedMethod();
    const file = this.depositFile;
    return {
      amount: Number(this.amount),
      paymentMethodId: method.paymentMethodId ?? 0,
      currencyCode: this.currency(),
      utr: this.depositUtr,
      coin: this.depositCoin(),
      network: this.depositNetwork(),
      txHash: this.depositTxHash,
      senderWalletAddress: this.depositSenderWallet,
      playerNote: this.depositPlayerNote,
      screenshot: this.requiresCryptoProof() ? null : file,
      depositProof: this.requiresCryptoProof() ? file : null
    };
  }

  private setDepositFile(file: File | null): void {
    if (file && !isDepositProofFileValid(file)) {
      this.depositSubmitError = 'File must be JPG, PNG or PDF (max 10MB)';
      return;
    }
    this.depositSubmitError = null;
    this.releaseDepositFilePreview();
    this.depositFile = file;
    this.depositFileName = file?.name ?? '';
    if (file?.type.startsWith('image/')) {
      this.depositFilePreviewUrl = URL.createObjectURL(file);
    }
  }

  private releaseDepositFilePreview(): void {
    if (this.depositFilePreviewUrl) {
      URL.revokeObjectURL(this.depositFilePreviewUrl);
      this.depositFilePreviewUrl = null;
    }
  }

  private resetDepositFormFields(): void {
    this.amount = '';
    this.depositUtr = '';
    this.depositTxHash = '';
    this.depositSenderWallet = '';
    this.depositPlayerNote = '';
    this.cashConversion = null;
    this.conversionError = null;
    this.clearDepositFile();
  }

  private queueConversionRefresh(): void {
    this.amountChange$.next();
  }

  private refreshCashConversion(): void {
    const method = this.selectedMethod();
    const paymentMethodId = method.paymentMethodId;
    if (!paymentMethodId || !this.requiresCryptoProof()) {
      this.cashConversion = null;
      this.conversionError = null;
      this.conversionLoading = false;
      return;
    }

    if (!isAmountValid(this.amount, this.minDeposit, this.maxDeposit)) {
      this.cashConversion = null;
      this.conversionError = null;
      this.conversionLoading = false;
      return;
    }

    this.conversionLoading = true;
    this.conversionError = null;

    this.paymentService.convertCashAmount({
      amount: Number(this.amount),
      flow: 'deposit',
      payment_method_id: paymentMethodId,
      coin: this.depositCoin(),
      network: this.depositNetwork() || null
    }).pipe(finalize(() => this.conversionLoading = false)).subscribe({
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

  private loadPaymentConfig(): void {
    this.configLoading = true;
    this.configError = null;
    this.configSub?.unsubscribe();

    this.configSub = this.paymentService.getConfig().subscribe({
      next: (response) => {
        this.configLoading = false;
        if (response.code !== 0 || !response.data) {
          this.configError = response.message || 'Could not load payment config';
          return;
        }
        this.applyConfig(response.data);
      },
      error: () => {
        this.configLoading = false;
        this.configError = 'Could not load payment config';
      }
    });
  }

  private applyConfig(data: PaymentConfigData): void {
    this.minDeposit = data.config.min_deposit ?? 100;
    const max = data.config.max_deposit;
    this.maxDeposit = max != null && Number.isFinite(max) && max > 0 ? max : null;
    if (data.brand_currency?.currency_code) {
      this.brandCurrencyCode = data.brand_currency.currency_code;
      this.brandCurrencySymbol = data.brand_currency.currency_symbol || this.brandCurrencyCode;
      this.brandCurrencyDecimals = data.brand_currency.decimal_places ?? 2;
    }
    this.depositWallets = data.deposit_wallets.filter((wallet) => wallet.is_active && wallet.is_configured).sort((a, b) => a.display_order - b.display_order);
    this.paymentMethods = mapDepositMethodsFromConfig(data);
    this.depositStep = 'methods';
    this.selectedMethodId = '';
  }

  private refreshWalletDetails(): void {
    this.walletLoading = !this.playerDetails.details;
    this.playerDetails.refresh().pipe(finalize(() => this.walletLoading = false)).subscribe((data) => {
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

import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { KycService } from '../../../../services/kyc.service';
import { KycSelfieCaptureComponent } from './kyc-selfie-capture/kyc-selfie-capture.component';
import {
  Obj,
  KycLevelStep,
  KycCountryOption,
  KycDocOption,
  KYC_STATUS_VIEWS,
  KYC_MEDIA_ACCEPT,
  KYC_MEDIA_LABEL,
  mapKycStatusToUiCode,
  parseKycLevels,
  levelKind,
  stepIcon as kycStepIcon,
  formatLabel,
  formatFileSize,
  isAllowedMedia,
  isImageMedia,
  mediaFileError,
  httpErrorMessage,
  parseCountries,
  parseDocs,
  buildSubmitPayload
} from './kyc.helpers';

/** Used when API returns code 0 but no `data.kyclevels` yet — still start the wizard. */
const DEFAULT_KYC_STEPS: KycLevelStep[] = [
  { id: 1, level: 'id', action: 1 },
  { id: 2, level: 'selfie', action: 2 },
  { id: 3, level: 'email', action: 3 },
  { id: 4, level: 'location', action: 4 }
];

@Component({
  selector: 'app-kyc',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, KycSelfieCaptureComponent],
  templateUrl: './kyc.component.html',
  styleUrls: ['./kyc.component.scss']
})
export class KycComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly kycService = inject(KycService);
  private reqSub?: Subscription;

  readonly statusViews = KYC_STATUS_VIEWS;
  readonly kycMediaAccept = KYC_MEDIA_ACCEPT;
  readonly kycMediaFormatsLabel = KYC_MEDIA_LABEL;
  readonly levelKind = levelKind;
  readonly formatFieldLabel = formatLabel;
  readonly formatFileSize = formatFileSize;
  readonly isImageFile = isImageMedia;

  emailForm = this.fb.nonNullable.group({
    email: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.email, Validators.maxLength(254)],
      updateOn: 'blur'
    })
  });
  otpForm = this.fb.nonNullable.group({
    otp: ['', [Validators.required, Validators.pattern(/^\d{4,10}$/)]]
  });
  emailOtpSent = false;
  emailVerified = false;
  emailSendLoading = false;
  emailVerifyLoading = false;
  emailSendError: string | null = null;
  emailVerifyError: string | null = null;

  locationForm = this.fb.nonNullable.group({
    city: ['', [Validators.required, Validators.maxLength(120)]],
    state: ['', [Validators.required, Validators.maxLength(120)]],
    address: ['', [Validators.required, Validators.maxLength(500)]]
  });
  locationDoc: File | null = null;
  locationDocPreviewUrl: string | null = null;
  locationSubmitError: string | null = null;
  locationDocError: string | null = null;

  private readonly draft = {
    countryId: null as number | null,
    docType: null as string | null,
    idRequiredFields: [] as string[],
    frontSide: null as File | null,
    backSide: null as File | null,
    selfie: null as File | null,
    email: null as string | null,
    locationDoc: null as File | null,
    city: '',
    state: '',
    address: ''
  };

  loading = true;
  /** 'wizard' = start KYC | 'status' = already applied | 'error' = failed load */
  pageMode: 'wizard' | 'status' | 'error' = 'wizard';
  error: string | null = null;
  kycStatusCode: number | null = null;
  kycStatusMessage = '';

  root: Obj | null = null;
  kycLevelSteps: KycLevelStep[] = [];
  activeLevelIndex = 0;
  idSubstep: 'country' | 'doc' = 'country';

  countries: KycCountryOption[] = [];
  countriesLoading = false;
  customCountriesError: string | null = null;
  selectedCountryId: number | null = null;
  countrySearchQuery = '';

  docs: KycDocOption[] = [];
  docsLoading = false;
  customDocsError: string | null = null;
  selectedDocId: number | null = null;
  docTypeListExpanded = true;
  docFieldErrors: Record<string, string> = {};

  private readonly docFiles: Record<string, File> = {};
  private readonly objectUrlByKey: Record<string, string> = {};
  selfieBlob: Blob | null = null;
  selfiePreviewObjectUrl: string | null = null;

  customVerificationLoading = false;
  customVerificationError: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.reqSub?.unsubscribe();
    this.clearDocUploads();
    this.revokeAllUrls();
    this.clearSelfie();
    this.locationForm.reset();
    this.clearLocationDoc();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.kycStatusCode = null;
    this.pageMode = 'wizard';
    this.resetWizard();
    this.reqSub?.unsubscribe();

    this.reqSub = this.kycService.getPlatformAndLevel().subscribe({
      next: (res) => {
        this.loading = false;

        if (res.hasStatus) {
          this.pageMode = 'status';
          this.kycStatusCode = this.statusToUiCode(res.status);
          this.kycStatusMessage = res.message || '';
          return;
        }

        if (res.code !== 0) {
          this.pageMode = 'error';
          this.error = res.message || 'Could not load KYC requirements';
          return;
        }

        this.pageMode = 'wizard';
        this.kycStatusMessage = res.message || '';
        this.root =
          res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? (res.data as Obj) : null;
        this.kycLevelSteps = this.root ? parseKycLevels(this.root) : [];
        this.activeLevelIndex = 0;
        const first = this.kycLevelSteps[0];
        if (first && levelKind(first.level) === 'id') {
          this.fetchCountries();
        }
      },
      error: () => {
        this.pageMode = 'error';
        this.error = 'Could not load KYC requirements';
        this.loading = false;
      }
    });
  }

  /** Map API `status` (number or text) to UI code 1–5. */
  private statusToUiCode(status: unknown): number | null {
    return mapKycStatusToUiCode(status);
  }

  isCustomFlowComplete(): boolean {
    return this.kycLevelSteps.length > 0 && this.activeLevelIndex >= this.kycLevelSteps.length;
  }

  hasCustomSteps(): boolean {
    return this.kycLevelSteps.length > 0;
  }

  currentKycLevel(): KycLevelStep | null {
    return this.kycLevelSteps[this.activeLevelIndex] ?? null;
  }

  stepLabel(level: string): string {
    const s = (level || '').trim();
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : 'Step';
  }

  stepIcon(level: string): string {
    return kycStepIcon(level);
  }

  stepIsDone(index: number): boolean {
    return index < this.activeLevelIndex || this.isCustomFlowComplete();
  }

  stepIsActive(index: number): boolean {
    return index === this.activeLevelIndex && !this.isCustomFlowComplete();
  }

  stepperIndex(): number {
    return Math.min(this.activeLevelIndex + 1, this.kycLevelSteps.length);
  }

  /** True when user can go back to the previous sub-step or wizard step. */
  canGoBack(): boolean {
    if (this.customVerificationLoading || this.emailSendLoading || this.emailVerifyLoading) return false;
    const kl = this.currentKycLevel();
    if (kl && levelKind(kl.level) === 'id') {
      if (this.idSubstep === 'doc') return true;
      return this.activeLevelIndex > 0;
    }
    return this.activeLevelIndex > 0;
  }

  goBack(): void {
    if (!this.canGoBack()) return;
    this.customVerificationError = null;
    this.locationSubmitError = null;
    const kl = this.currentKycLevel();
    if (kl && levelKind(kl.level) === 'id' && this.idSubstep === 'doc') {
      this.backToCountryPicker();
      return;
    }
    this.previousLevel();
  }

  filteredCountries(): KycCountryOption[] {
    const query = this.countrySearchQuery.trim().toLowerCase();
    if (!query) return this.countries;
    return this.countries.filter(
      (country) =>
        country.name.toLowerCase().includes(query) ||
        (country.code?.toLowerCase().includes(query) ?? false)
    );
  }

  selectCountry(country: KycCountryOption): void {
    if (this.selectedCountryId === country.id && this.idSubstep === 'doc') return;
    this.selectedCountryId = country.id;
    this.draft.countryId = country.id;
    this.idSubstep = 'doc';
    this.customVerificationError = null;
    this.fetchDocs(country.id);
  }

  changeCountry(): void {
    this.backToCountryPicker();
  }

  private backToCountryPicker(): void {
    this.idSubstep = 'country';
    this.countrySearchQuery = '';
    this.clearDocUploads();
    this.selectedDocId = null;
    this.docTypeListExpanded = true;
    this.docs = [];
    this.customDocsError = null;
    this.docsLoading = false;
    if (!this.countries.length && !this.customCountriesError) this.fetchCountries();
  }

  trackCountryById(_index: number, country: KycCountryOption): number {
    return country.id;
  }

  continueStep(): void {
    const kl = this.currentKycLevel();
    if (!kl) return;
    if (levelKind(kl.level) === 'id' && !this.docUploadComplete()) return;
    this.advance();
  }

  isLastActiveStep(): boolean {
    return this.kycLevelSteps.length > 0 && this.activeLevelIndex === this.kycLevelSteps.length - 1;
  }

  continueButtonLabel(): string {
    if (this.customVerificationLoading) return 'Submitting…';
    return this.isLastActiveStep() ? 'Submit verification' : 'Continue';
  }

  private advance(): void {
    if (this.customVerificationLoading) return;
    const err = this.saveStep();
    if (err) {
      this.setStepError(err);
      return;
    }
    this.locationSubmitError = null;
    this.customVerificationError = null;
    if (this.isLastActiveStep()) this.submit();
    else this.nextStep();
  }

  private submit(): void {
    this.customVerificationLoading = true;
    this.reqSub?.unsubscribe();
    this.reqSub = this.kycService.submitCustomVerification(buildSubmitPayload(this.draft, this.kycLevelSteps)).subscribe({
      next: (res) => {
        this.customVerificationLoading = false;
        if (res.code !== 0) {
          this.setStepError(res.message || 'Could not submit verification');
          return;
        }
        this.activeLevelIndex = this.kycLevelSteps.length;
        this.clearDraft();
        this.resetStepUi();
      },
      error: (err) => {
        this.customVerificationLoading = false;
        this.setStepError(httpErrorMessage(err, 'Could not submit verification'));
      }
    });
  }

  private saveStep(): string | null {
    const kl = this.currentKycLevel();
    if (!kl) return 'No active step';
    switch (levelKind(kl.level)) {
      case 'id': {
        if (this.selectedCountryId == null) return 'Select your country';
        const doc = this.selectedDoc();
        if (!doc) return 'Select a document type';
        for (const field of this.docFields(doc)) {
          const file = this.getFile(doc.id, field);
          if (!file) return `Upload ${formatLabel(field)}`;
          if (!isAllowedMedia(file)) return mediaFileError();
        }
        this.draft.countryId = this.selectedCountryId;
        this.draft.docType = doc.name;
        this.draft.idRequiredFields = [...this.docFields(doc)];
        this.draft.frontSide = this.getFile(doc.id, 'front_side') ?? null;
        this.draft.backSide = this.getFile(doc.id, 'back_side') ?? null;
        return null;
      }
      case 'selfie':
        if (!this.selfieBlob) return 'Capture a selfie first';
        this.draft.selfie = new File([this.selfieBlob], 'selfie.jpg', { type: 'image/jpeg' });
        return null;
      case 'email':
        if (!this.emailVerified) return 'Verify your email first';
        this.draft.email = this.emailForm.controls.email.value.trim().toLowerCase();
        return null;
      case 'location': {
        const { city, state, address } = this.locationForm.controls;
        [city, state, address].forEach((c) => { c.markAsTouched(); c.updateValueAndValidity(); });
        if (this.locationForm.invalid) return 'Complete all address fields';
        if (!this.locationDoc) return 'Location document is required';
        if (!isAllowedMedia(this.locationDoc)) return mediaFileError();
        this.draft.locationDoc = this.locationDoc;
        this.draft.city = city.value.trim();
        this.draft.state = state.value.trim();
        this.draft.address = address.value.trim();
        return null;
      }
      default:
        return null;
    }
  }

  private setStepError(message: string): void {
    const kl = this.currentKycLevel();
    if (kl && levelKind(kl.level) === 'location') this.locationSubmitError = message;
    else this.customVerificationError = message;
  }

  private clearDraft(): void {
    Object.assign(this.draft, {
      countryId: null, docType: null, idRequiredFields: [],
      frontSide: null, backSide: null, selfie: null, email: null,
      locationDoc: null, city: '', state: '', address: ''
    });
  }

  onLocationDocInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.clearLocationPreview();
    this.locationDoc = null;
    this.locationDocError = null;
    if (!file) return;
    if (!isAllowedMedia(file)) {
      this.locationDocError = mediaFileError();
      input.value = '';
      return;
    }
    this.locationDoc = file;
    if (isImageMedia(file)) this.locationDocPreviewUrl = URL.createObjectURL(file);
  }

  clearLocationDoc(): void {
    this.clearLocationPreview();
    this.locationDoc = null;
    this.locationDocError = null;
    const el = document.getElementById('kyc-location-doc-input') as HTMLInputElement | null;
    if (el) el.value = '';
  }

  locationFieldError(name: 'city' | 'state' | 'address'): string | null {
    const c = this.locationForm.controls[name];
    if (!c.touched) return null;
    if (c.hasError('required')) return `${name === 'city' ? 'City' : name === 'state' ? 'State' : 'Address'} is required`;
    if (c.hasError('maxlength')) return 'Value is too long';
    return null;
  }

  submitEmailForOtp(): void {
    const emailCtrl = this.emailForm.controls.email;
    emailCtrl.markAsTouched();
    emailCtrl.updateValueAndValidity();
    if (this.emailForm.invalid || this.emailSendLoading) return;
    this.emailSendLoading = true;
    this.emailSendError = null;
    this.reqSub?.unsubscribe();
    this.reqSub = this.kycService.sendEmailOtp(emailCtrl.value.trim().toLowerCase()).subscribe({
      next: (res) => {
        this.emailSendLoading = false;
        this.emailSendError = res.code !== 0 ? (res.message || 'Could not send code') : null;
        if (res.code === 0) { this.emailOtpSent = true; this.otpForm.reset({ otp: '' }); }
      },
      error: (err) => {
        this.emailSendLoading = false;
        this.emailSendError = httpErrorMessage(err, 'Could not send code');
      }
    });
  }

  verifyEmailOtp(): void {
    const otpCtrl = this.otpForm.controls.otp;
    otpCtrl.markAsTouched();
    otpCtrl.updateValueAndValidity();
    if (this.otpForm.invalid || this.emailVerifyLoading) return;
    const otp = parseInt(otpCtrl.value.trim(), 10);
    if (!Number.isFinite(otp)) { this.emailVerifyError = 'Enter a valid numeric code'; return; }
    this.emailVerifyLoading = true;
    this.emailVerifyError = null;
    this.reqSub?.unsubscribe();
    this.reqSub = this.kycService.verifyEmailOtp(otp).subscribe({
      next: (res) => {
        this.emailVerifyLoading = false;
        if (res.code !== 0) { this.emailVerifyError = res.message || 'Invalid code'; return; }
        this.emailVerified = true;
      },
      error: (err) => {
        this.emailVerifyLoading = false;
        this.emailVerifyError = httpErrorMessage(err, 'Could not verify code');
      }
    });
  }

  changeEmailForOtp(): void {
    this.emailOtpSent = false;
    this.emailVerified = false;
    this.emailSendError = null;
    this.emailVerifyError = null;
    this.otpForm.reset({ otp: '' });
  }

  emailFieldError(): string | null {
    const c = this.emailForm.controls.email;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Email is required';
    if (c.hasError('email')) return 'Enter a valid email address';
    if (c.hasError('maxlength')) return 'Email is too long';
    return null;
  }

  otpFieldError(): string | null {
    const c = this.otpForm.controls.otp;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Code is required';
    if (c.hasError('pattern')) return 'Enter the numeric code (4–10 digits)';
    return null;
  }

  onSelfieCaptured(blob: Blob): void {
    this.clearSelfie();
    this.selfieBlob = blob;
    this.selfiePreviewObjectUrl = URL.createObjectURL(blob);
  }

  retakeSelfie(): void {
    this.clearSelfie();
  }

  fetchCountries(onLoaded?: () => void): void {
    this.countriesLoading = true;
    this.customCountriesError = null;
    this.reqSub?.unsubscribe();
    this.reqSub = this.kycService.getCountries().subscribe({
      next: (res) => {
        this.countriesLoading = false;
        if (res.code !== 0) {
          this.customCountriesError = res.message || 'Failed to load countries';
          this.countries = [];
          onLoaded?.();
          return;
        }
        this.countries = parseCountries(res.data);
        if (!this.countries.length) this.customCountriesError = 'No countries available';
        onLoaded?.();
      },
      error: () => {
        this.countriesLoading = false;
        this.customCountriesError = 'Failed to load countries';
        this.countries = [];
        onLoaded?.();
      }
    });
  }

  retryDocs(): void {
    if (this.selectedCountryId != null) this.fetchDocs(this.selectedCountryId);
  }

  fetchDocs(countryId: number, onLoaded?: () => void): void {
    this.docsLoading = true;
    this.customDocsError = null;
    if (!onLoaded) {
      this.clearDocUploads();
      this.selectedDocId = null;
      this.docTypeListExpanded = true;
    }
    this.reqSub?.unsubscribe();
    this.reqSub = this.kycService.getDocList(countryId).subscribe({
      next: (res) => {
        this.docsLoading = false;
        if (res.code !== 0) {
          this.customDocsError = res.message || 'Failed to load document types';
          this.docs = [];
          onLoaded?.();
          return;
        }
        this.docs = parseDocs(res.data);
        if (!this.docs.length) this.customDocsError = 'No documents available for this country';
        onLoaded?.();
      },
      error: () => {
        this.docsLoading = false;
        this.customDocsError = 'Failed to load document types';
        this.docs = [];
        onLoaded?.();
      }
    });
  }

  private previousLevel(): void {
    if (this.activeLevelIndex <= 0) return;
    this.activeLevelIndex--;
    this.resetStepUi();
    this.hydrateCurrentStepFromDraft();
  }

  private hydrateCurrentStepFromDraft(): void {
    const kl = this.currentKycLevel();
    if (!kl) return;
    switch (levelKind(kl.level)) {
      case 'id':
        this.hydrateIdFromDraft();
        break;
      case 'selfie':
        this.hydrateSelfieFromDraft();
        break;
      case 'email':
        this.hydrateEmailFromDraft();
        break;
      case 'location':
        this.hydrateLocationFromDraft();
        break;
    }
  }

  private hydrateIdFromDraft(): void {
    if (this.draft.countryId == null) {
      this.fetchCountries();
      return;
    }
    this.selectedCountryId = this.draft.countryId;
    const restoreDoc = !!this.draft.docType;
    this.fetchCountries(() => {
      if (this.customCountriesError) return;
      this.idSubstep = 'doc';
      this.fetchDocs(this.draft.countryId!, () => {
        if (restoreDoc) this.applyDraftIdFiles();
      });
    });
  }

  private applyDraftIdFiles(): void {
    if (!this.draft.docType) return;
    const doc =
      this.docs.find((d) => d.name === this.draft.docType) ??
      this.docs.find((d) => this.draft.idRequiredFields.length && this.docFields(d).join() === this.draft.idRequiredFields.join());
    if (!doc) return;
    this.selectedDocId = doc.id;
    this.docTypeListExpanded = false;
    for (const field of this.docFields(doc)) {
      const file =
        field === 'front_side'
          ? this.draft.frontSide
          : field === 'back_side'
            ? this.draft.backSide
            : null;
      if (!file) continue;
      const key = this.fileKey(doc.id, field);
      this.docFiles[key] = file;
      if (isImageMedia(file)) this.objectUrlByKey[key] = URL.createObjectURL(file);
    }
  }

  private hydrateSelfieFromDraft(): void {
    if (!this.draft.selfie) return;
    this.selfieBlob = this.draft.selfie;
    this.selfiePreviewObjectUrl = URL.createObjectURL(this.draft.selfie);
  }

  private hydrateEmailFromDraft(): void {
    if (!this.draft.email) return;
    this.emailForm.patchValue({ email: this.draft.email });
    this.emailVerified = true;
  }

  private hydrateLocationFromDraft(): void {
    if (this.draft.city || this.draft.state || this.draft.address) {
      this.locationForm.patchValue({
        city: this.draft.city,
        state: this.draft.state,
        address: this.draft.address
      });
    }
    if (!this.draft.locationDoc) return;
    this.locationDoc = this.draft.locationDoc;
    if (isImageMedia(this.draft.locationDoc)) {
      this.locationDocPreviewUrl = URL.createObjectURL(this.draft.locationDoc);
    }
  }

  private nextStep(): void {
    this.activeLevelIndex++;
    this.resetStepUi();
    const next = this.currentKycLevel();
    if (next && levelKind(next.level) === 'id') this.fetchCountries();
  }

  private resetStepUi(): void {
    this.idSubstep = 'country';
    this.selectedCountryId = null;
    this.countrySearchQuery = '';
    this.selectedDocId = null;
    this.docTypeListExpanded = true;
    this.clearDocUploads();
    this.countries = [];
    this.docs = [];
    this.customCountriesError = null;
    this.customDocsError = null;
    this.countriesLoading = false;
    this.docsLoading = false;
    this.clearSelfie();
    this.emailForm.reset({ email: '' });
    this.otpForm.reset({ otp: '' });
    this.emailOtpSent = false;
    this.emailVerified = false;
    this.emailSendLoading = false;
    this.emailVerifyLoading = false;
    this.emailSendError = null;
    this.emailVerifyError = null;
    this.locationForm.reset();
    this.clearLocationDoc();
    this.locationSubmitError = null;
  }

  private resetWizard(): void {
    this.kycLevelSteps = [];
    this.activeLevelIndex = 0;
    this.clearDraft();
    this.resetStepUi();
    this.customVerificationLoading = false;
    this.customVerificationError = null;
  }

  headlineLevel(): string {
    const v = this.root?.['level'] ?? this.root?.['kyc_level'];
    return v != null && String(v).length ? String(v) : '—';
  }

  selectedCountryLabel(): string {
    const country = this.countries.find((item) => item.id === this.selectedCountryId);
    if (!country) return '';
    return country.code ? `${country.name} (${country.code})` : country.name;
  }

  selectedDoc(): KycDocOption | undefined {
    return this.selectedDocId == null ? undefined : this.docs.find((x) => x.id === this.selectedDocId);
  }

  docFields(doc: KycDocOption): string[] {
    return doc.fields?.length ? doc.fields : ['front_side'];
  }

  fieldLabelsDisplay(doc: KycDocOption): string {
    return this.docFields(doc).map(formatLabel).join(', ');
  }

  selectDocument(doc: KycDocOption): void {
    if (this.selectedDocId != null && this.selectedDocId !== doc.id) this.clearFilesForDoc(this.selectedDocId);
    this.selectedDocId = doc.id;
    this.docTypeListExpanded = false;
  }

  changeDocType(): void {
    this.docTypeListExpanded = true;
  }

  trackDocById(_i: number, doc: KycDocOption): number {
    return doc.id;
  }

  onDocFileInput(docId: number, field: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    const key = this.fileKey(docId, field);
    this.revokeUrl(key);
    delete this.docFieldErrors[key];
    if (!file) { delete this.docFiles[key]; return; }
    if (!isAllowedMedia(file)) {
      delete this.docFiles[key];
      this.docFieldErrors[key] = mediaFileError();
      input.value = '';
      return;
    }
    this.docFiles[key] = file;
    if (isImageMedia(file)) this.objectUrlByKey[key] = URL.createObjectURL(file);
  }

  clearDocField(docId: number, field: string): void {
    const key = this.fileKey(docId, field);
    this.revokeUrl(key);
    delete this.docFiles[key];
    delete this.docFieldErrors[key];
    const el = document.getElementById(this.fileInputId(docId, field)) as HTMLInputElement | null;
    if (el) el.value = '';
  }

  getDocFieldError(docId: number, field: string): string | null {
    return this.docFieldErrors[this.fileKey(docId, field)] ?? null;
  }

  fileInputId(docId: number, field: string): string {
    return `kyc-file-${docId}-${field.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  getFileForSlot(docId: number, field: string): File | undefined {
    return this.getFile(docId, field);
  }

  getPreviewUrlFor(docId: number, field: string): string | null {
    return this.objectUrlByKey[this.fileKey(docId, field)] ?? null;
  }

  docUploadCompleteForSelected(): boolean {
    return this.docUploadComplete();
  }

  private docUploadComplete(): boolean {
    const doc = this.selectedDoc();
    return doc ? this.docFields(doc).every((f) => !!this.docFiles[this.fileKey(doc.id, f)]) : false;
  }

  private getFile(docId: number, field: string): File | undefined {
    return this.docFiles[this.fileKey(docId, field)];
  }

  private fileKey(docId: number, field: string): string {
    return `${docId}::${field}`;
  }

  private clearFilesForDoc(docId: number): void {
    const d = this.docs.find((x) => x.id === docId);
    if (!d) return;
    for (const f of this.docFields(d)) {
      const key = this.fileKey(docId, f);
      this.revokeUrl(key);
      delete this.docFiles[key];
    }
  }

  private clearDocUploads(): void {
    for (const k of Object.keys(this.docFiles)) {
      this.revokeUrl(k);
      delete this.docFiles[k];
    }
    this.docFieldErrors = {};
  }

  private revokeUrl(key: string): void {
    const u = this.objectUrlByKey[key];
    if (u) { URL.revokeObjectURL(u); delete this.objectUrlByKey[key]; }
  }

  private revokeAllUrls(): void {
    for (const k of Object.keys(this.objectUrlByKey)) this.revokeUrl(k);
  }

  private clearSelfie(): void {
    if (this.selfiePreviewObjectUrl) URL.revokeObjectURL(this.selfiePreviewObjectUrl);
    this.selfiePreviewObjectUrl = null;
    this.selfieBlob = null;
  }

  private clearLocationPreview(): void {
    if (this.locationDocPreviewUrl) URL.revokeObjectURL(this.locationDocPreviewUrl);
    this.locationDocPreviewUrl = null;
  }
}

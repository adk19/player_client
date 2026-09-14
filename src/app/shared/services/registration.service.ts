import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { urlConstant } from '../constant/urlConstant';
import { environment } from '../environment/environment';

export interface RegistrationDraft {
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  brandCode: string;
  otpVerified?: boolean;
}

export interface RegistrationOtpResponse {
  code: number;
  message: string;
  data?: any;
}

export interface RegistrationPlanSummary {
  id: number;
  plan_code: string;
  name: string;
  description: string;
  is_active: boolean;
}

export interface RegistrationPlanDetails {
  plan_id: number;
  plan_code: string;
  name: string;
  description: string;
  is_active: boolean;
  status_id?: number;
  created_by?: number;
  created_at?: string;
  updated_at?: string;
  template?: {
    brokerage?: Record<string, unknown>;
    leverage?: Record<string, unknown>;
    markets?: Record<string, number[]>;
    risk_configuration?: Record<string, unknown>;
    trading_permissions?: Record<string, unknown>;
    trading_charges?: Record<string, unknown>;
  };
}

export interface RegistrationResponse {
  code: number;
  message: string;
  data?: any;
}

const DRAFT_KEY = 'registration_draft_v1';

@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private draft: RegistrationDraft | null = null;

  constructor(private readonly http: HttpClient) {
    this.restoreDraft();
  }

  static apiErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string } | string | null;
      if (body && typeof body === 'object' && body.message) {
        return body.message;
      }
      if (typeof body === 'string' && body.trim()) {
        return body;
      }
      return err.message || fallback;
    }
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return fallback;
  }

  get brandCode(): string {
    return environment.BrandCode || 'BRD0001';
  }

  hasDraft(): boolean {
    return !!this.draft;
  }

  getDraft(): RegistrationDraft | null {
    return this.draft;
  }

  saveDraft(draft: Omit<RegistrationDraft, 'brandCode'>): void {
    this.draft = { ...draft, brandCode: this.brandCode };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(this.draft));
    } catch {
      /* ignore quota */
    }
  }

  clearDraft(): void {
    this.draft = null;
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Fetch active plans from API. */
  fetchPlans(): Observable<RegistrationPlanSummary[]> {
    return this.http.post<{ code: number; data: RegistrationPlanSummary[] }>(urlConstant.planList, { brandCode: this.brandCode }).pipe(
      map(res => res.data || [])
    );
  }

  /** Fetch plan details from API. */
  fetchPlanDetails(planId: number): Observable<RegistrationPlanDetails> {
    return this.http.post<{ code: number; data: RegistrationPlanDetails }>(urlConstant.planDetails, {
      plan_id: planId,
      brandCode: this.brandCode
    }).pipe(map(res => res.data));
  }

  requestOtp(payload: {
    username: string;
    mobileNumber: string;
    dialingCode: string;
  }): Observable<RegistrationOtpResponse> {
    return this.http.post<RegistrationOtpResponse>(urlConstant.requestOtp, {
      brand_code: this.brandCode,
      mobileNumber: payload.mobileNumber,
      dialingCode: payload.dialingCode
    });
  }

  verifyOtp(payload: {
    mobileNumber: string;
    dialingCode: string;
    otp: string;
  }): Observable<RegistrationOtpResponse> {
    return this.http.post<RegistrationOtpResponse>(urlConstant.verifyOtp, {
      brand_code: this.brandCode,
      mobileNumber: payload.mobileNumber,
      dialingCode: payload.dialingCode,
      otp: payload.otp
    });
  }

  /** Register player with selected plan. */
  register(draft: RegistrationDraft, planId: number): Observable<RegistrationResponse> {
    const payload = {
      username: draft.username,
      email: draft.email,
      phone: draft.phone,
      password: draft.password,
      confirm_password: draft.confirmPassword,
      brand_code: draft.brandCode,
      plan_id: planId
    };
    return this.http.post<RegistrationResponse>(urlConstant.playerRegister, payload);
  }

  private restoreDraft(): void {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RegistrationDraft;
      if (parsed?.username && parsed?.email && parsed?.password) {
        this.draft = parsed;
      }
    } catch {
      this.clearDraft();
    }
  }
}


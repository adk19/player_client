import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { urlConstant } from '../shared/constant/urlConstant';

/**
 * Response for GET kyc/platformAndLevel — shape of `data` depends on backend.
 * Use narrow fields where known; callers may read `data` as a record.
 */
export interface KycPlatformAndLevelResponse {
  code: number;
  message: string;
  data: unknown;
  /** True only when the JSON body has a `status` property (returning applicant). */
  hasStatus: boolean;
  status?: unknown;
}

export interface KycCountriesResponse {
  code: number;
  message: string;
  data: unknown;
}

export interface KycDocListResponse {
  code: number;
  message: string;
  data: unknown;
}

/** Typical `{ code, message, data? }` KYC POST response */
export interface KycMutationResponse {
  code: number;
  message: string;
  data?: unknown;
}

/** Body for POST kyc/customVerification (multipart) — only enabled sections are sent. */
export interface KycCustomVerificationPayload {
  levelSum: number;
  includeId: boolean;
  includeSelfie: boolean;
  includeEmail: boolean;
  includeLocation: boolean;
  frontSide?: File;
  backSide?: File;
  docType?: string;
  selfie?: File;
  countryId?: number;
  email?: string;
  locationDoc?: File;
  city?: string;
  state?: string;
  address?: string;
}

@Injectable({ providedIn: 'root' })
export class KycService {
  constructor(private http: HttpClient) { }

  /**
   * Normalizes either `{ code, message, data }` or a raw payload (treated as `data` with `code: 0`).
   */
  getPlatformAndLevel(): Observable<KycPlatformAndLevelResponse> {
    return this.http.get<unknown>(urlConstant.kycPlatformAndLevel).pipe(
      map((body: any) => {
        const hasStatus = body != null && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'status');
        return {
          code: Number(body?.code) || 0,
          message: String(body?.message ?? ''),
          data: body?.data,
          hasStatus,
          status: hasStatus ? body.status : undefined
        };
      })
    );
  }

  getCountries(): Observable<KycCountriesResponse> {
    return this.http.get<KycCountriesResponse>(urlConstant.kycCountries);
  }

  getDocList(countryId: number): Observable<KycDocListResponse> {
    return this.http.get<KycDocListResponse>(`${urlConstant.kycDocList}?country_id=${countryId}`);
  }

  private mapMutationBody(body: unknown): KycMutationResponse {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as Record<string, unknown>;
      let code: number;
      if (b['success'] === true) {
        code = 0;
      } else {
        const raw = Number(b['code']);
        code = Number.isFinite(raw) ? raw : 0;
      }
      if (code === 200 || code === 201) {
        code = 0;
      }
      return {
        code,
        message: String(b['message'] ?? ''),
        data: b['data']
      };
    }
    return { code: 0, message: '', data: body };
  }

  private normalizeSuccessCode(r: KycMutationResponse): KycMutationResponse {
    if (r.code === 1) {
      return { ...r, code: 0 };
    }
    return r;
  }

  sendEmailOtp(email: string): Observable<KycMutationResponse> {
    return this.http
      .post<unknown>(urlConstant.kycSendEmailOtp, { email })
      .pipe(map((b) => this.mapMutationBody(b)));
  }

  verifyEmailOtp(otp: number): Observable<KycMutationResponse> {
    return this.http.post<unknown>(urlConstant.kycVerifyEmailOtp, { otp })
      .pipe(map((b) => this.normalizeSuccessCode(this.mapMutationBody(b))));
  }

  /** Final custom KYC submit — only fields for steps in the flow are included. */
  submitCustomVerification(payload: KycCustomVerificationPayload): Observable<KycMutationResponse> {
    const fd = new FormData();

    if (payload.includeId) {
      if (payload.frontSide) {
        fd.append('front_side', payload.frontSide);
      }
      if (payload.backSide) {
        fd.append('back_side', payload.backSide);
      }
      if (payload.docType) {
        fd.append('doc_type', payload.docType);
      }
      if (payload.countryId != null) {
        fd.append('country_id', String(payload.countryId));
      }
    }

    if (payload.includeSelfie && payload.selfie) {
      fd.append('selfie', payload.selfie);
    }

    if (payload.includeEmail && payload.email) {
      fd.append('email', payload.email);
    }

    if (payload.includeLocation) {
      if (payload.locationDoc) {
        fd.append('location_doc', payload.locationDoc);
      }
      if (payload.city) {
        fd.append('city', payload.city);
      }
      if (payload.state) {
        fd.append('state', payload.state);
      }
      if (payload.address) {
        fd.append('address', payload.address);
      }
    }

    fd.append('level_sum', String(payload.levelSum));

    return this.http.post<unknown>(urlConstant.kycCustomVerification, fd).pipe(
      map((b) => this.normalizeSuccessCode(this.mapMutationBody(b)))
    );
  }
}

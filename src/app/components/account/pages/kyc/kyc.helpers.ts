import { KycCustomVerificationPayload } from '../../../../services/kyc.service';

export type Obj = Record<string, unknown>;

export interface KycLevelStep {
  id: number;
  level: string;
  action: number;
}

export type KycLevelKind = 'id' | 'selfie' | 'email' | 'location' | 'other';

export interface KycCountryOption {
  id: number;
  name: string;
  code?: string;
}

export interface KycDocOption {
  id: number;
  name: string;
  description?: string;
  fields: string[];
}

export type KycApplicationStatus = 1 | 2 | 3 | 4 | 5;

export interface KycStatusView {
  badge: string;
  title: string;
  icon: string;
  hint: string;
  tone: string;
  showPulse: boolean;
}

/** Map API `status` (number or text) to UI code 1–5. */
export function mapKycStatusToUiCode(status: unknown): KycApplicationStatus | null {
  const statusNumber = Number(status);
  if (statusNumber >= 1 && statusNumber <= 5) {
    return statusNumber as KycApplicationStatus;
  }

  const statusText = String(status).toLowerCase();
  if (statusText.includes('pending')) {
    return 1;
  }
  if (statusText.includes('hold')) {
    return 2;
  }
  if (statusText.includes('review')) {
    return 3;
  }
  if (statusText.includes('approv')) {
    return 4;
  }
  if (statusText.includes('reject')) {
    return 5;
  }

  return null;
}

export function isKycApproved(status: unknown): boolean {
  return mapKycStatusToUiCode(status) === 4;
}

export function resolveKycApprovedFromPlatformResponse(response: {
  hasStatus: boolean;
  status?: unknown;
  data?: unknown;
}): boolean {
  if (response.hasStatus && isKycApproved(response.status)) {
    return true;
  }

  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    return false;
  }

  const data = response.data as Obj;
  const nestedStatus =
    data['status'] ?? data['kyc_status'] ?? data['kycStatus'] ?? data['application_status'];
  return isKycApproved(nestedStatus);
}

export const KYC_STATUS_VIEWS: Record<KycApplicationStatus, KycStatusView> = {
  1: {
    badge: 'Pending', title: 'Verification pending', icon: 'fa-clock', tone: 'pending', showPulse: true,
    hint: 'Your application is queued. You do not need to submit again until we ask for more information.'
  },
  2: {
    badge: 'On hold', title: 'Verification on hold', icon: 'fa-pause', tone: 'hold', showPulse: true,
    hint: 'Your application is paused. We will notify you when it moves forward.'
  },
  3: {
    badge: 'Under review', title: 'Verification in progress', icon: 'fa-hourglass-half', tone: 'review', showPulse: true,
    hint: 'You do not need to submit again. We will notify you when your application has been processed.'
  },
  4: {
    badge: 'Approved', title: 'Verification approved', icon: 'fa-circle-check', tone: 'approved', showPulse: false,
    hint: 'Your identity has been verified. No further action is required.'
  },
  5: {
    badge: 'Rejected', title: 'Verification rejected', icon: 'fa-circle-xmark', tone: 'rejected', showPulse: false,
    hint: 'Contact support if you believe this is incorrect or when you are ready to re-apply.'
  }
};

const MEDIA_EXT = new Set(['png', 'jpg', 'jpeg', 'pdf']);

export const KYC_MEDIA_ACCEPT = '.png,.jpg,.jpeg,.pdf';
export const KYC_MEDIA_LABEL = 'PNG, JPG, JPEG, or PDF';

export function parseKycLevels(o: Obj): KycLevelStep[] {
  const raw = o['kyclevels'] ?? o['kyc_levels'];
  if (!Array.isArray(raw)) return [];
  const items: KycLevelStep[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const r = x as Obj;
    const id = Number(r['id']);
    const level = String(r['level'] ?? '').trim();
    if (!Number.isFinite(id) || id <= 0 || !level) continue;
    const action = Number(r['action']);
    items.push({ id, level, action: Number.isFinite(action) ? action : items.length + 1 });
  }
  return items.sort((a, b) => a.action - b.action);
}

export function levelKind(level: string): KycLevelKind {
  const s = (level || '').toLowerCase();
  if (s.includes('selfie')) return 'selfie';
  if (s.includes('email')) return 'email';
  if (s.includes('location') || s.includes('address')) return 'location';
  if (s.includes('id') || s.includes('identity')) return 'id';
  return 'other';
}

export function stepIcon(level: string): string {
  const icons: Record<KycLevelKind, string> = {
    id: 'fa-id-card', selfie: 'fa-camera', email: 'fa-envelope', location: 'fa-location-dot', other: 'fa-shield-check'
  };
  return icons[levelKind(level)];
}

export function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAllowedMedia(file: File): boolean {
  const i = file.name.lastIndexOf('.');
  return i >= 0 && MEDIA_EXT.has(file.name.slice(i + 1).toLowerCase());
}

export function isImageMedia(file: File): boolean {
  const i = file.name.lastIndexOf('.');
  const ext = i >= 0 ? file.name.slice(i + 1).toLowerCase() : '';
  return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
}

export function mediaFileError(): string {
  return `Only ${KYC_MEDIA_LABEL} files are allowed.`;
}

export function httpErrorMessage(err: unknown, fallback: string): string {
  const e = err && typeof err === 'object' && 'error' in err ? (err as { error?: unknown }).error : null;
  if (e && typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

export function parseCountries(data: unknown): KycCountryOption[] {
  return asArray(data)
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const o = row as Obj;
      const id = Number(o['id'] ?? o['country_id']);
      if (!Number.isFinite(id) || id <= 0) return null;
      const name = String(o['name'] ?? o['country_name'] ?? `Country ${id}`);
      const codeRaw = o['code'] ?? o['country_code'];
      const code = codeRaw != null && String(codeRaw).length ? String(codeRaw) : undefined;
      return { id, name, code };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

export function parseDocs(data: unknown): KycDocOption[] {
  return asArray(data)
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const o = row as Obj;
      const id = Number(o['id'] ?? o['document_id'] ?? o['doc_id']);
      if (!Number.isFinite(id) || id <= 0) return null;
      const name = String(o['name'] ?? o['document_name'] ?? `Document ${id}`);
      const desc = o['description'];
      const description = desc != null && String(desc).length ? String(desc) : undefined;
      let fields: string[] = Array.isArray(o['fields'])
        ? (o['fields'] as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim())
        : [];
      if (!fields.length) fields = ['front_side'];
      return { id, name, description, fields };
    }).filter((x): x is NonNullable<typeof x> => x != null);
}

export function buildSubmitPayload(
  draft: {
    countryId: number | null;
    docType: string | null;
    idRequiredFields: string[];
    frontSide: File | null;
    backSide: File | null;
    selfie: File | null;
    email: string | null;
    locationDoc: File | null;
    city: string;
    state: string;
    address: string;
  },
  steps: KycLevelStep[]
): KycCustomVerificationPayload {
  const has = (k: KycLevelKind) => steps.some((s) => levelKind(s.level) === k);
  const levelSum = steps.reduce((n, s) => n + s.action, 0);
  const includeId = has('id');
  const includeSelfie = has('selfie');
  const includeEmail = has('email');
  const includeLocation = has('location');
  return {
    levelSum,
    includeId,
    includeSelfie,
    includeEmail,
    includeLocation,
    frontSide: includeId ? draft.frontSide ?? undefined : undefined,
    backSide: includeId ? draft.backSide ?? undefined : undefined,
    docType: includeId ? draft.docType ?? undefined : undefined,
    countryId: includeId ? draft.countryId ?? undefined : undefined,
    selfie: includeSelfie ? draft.selfie ?? undefined : undefined,
    email: includeEmail ? draft.email ?? undefined : undefined,
    locationDoc: includeLocation ? draft.locationDoc ?? undefined : undefined,
    city: includeLocation ? draft.city : undefined,
    state: includeLocation ? draft.state : undefined,
    address: includeLocation ? draft.address : undefined
  };
}

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as Obj;
    for (const k of ['data', 'items', 'countries', 'documents', 'list']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}


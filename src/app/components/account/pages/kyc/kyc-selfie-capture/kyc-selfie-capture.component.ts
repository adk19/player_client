import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import type { FaceDetectorInstance } from '../../../../../services/mediapipe-face-global.service';
import {
  FaceDetectorResult,
  MediapipeFaceGlobalService
} from '../../../../../services/mediapipe-face-global.service';

type BbNorm = {
  x0: number;
  y0: number;
  bw: number;
  bh: number;
  cxN: number;
  cyN: number;
  relArea: number;
  score: number;
};

/**
 * Oval frame in normalized coordinates — must match `.selfie-oval-ring` + `.selfie-vignette` in SCSS
 * (center ~50% / 42%, ~74% × 58% ellipse).
 */
const OVAL_CX = 0.5;
const OVAL_CY = 0.42;
const OVAL_RX = 0.36;
const OVAL_RY = 0.28;

@Component({
  selector: 'app-kyc-selfie-capture',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kyc-selfie-capture.component.html',
  styleUrls: ['./kyc-selfie-capture.component.scss']
})
export class KycSelfieCaptureComponent implements OnDestroy {
  @Output() captured = new EventEmitter<Blob>();

  @ViewChild('videoEl') videoRef?: ElementRef<HTMLVideoElement>;

  status: 'idle' | 'loading' | 'live' | 'error' = 'idle';
  statusMessage = '';
  cameraError: string | null = null;
  modelError: string | null = null;

  /** Face meets model + oval (Sumsub-style frame). */
  faceOk = false;
  goodFrameStreak = 0;

  rotationSatisfied = false;

  autoCaptureProgress = 0;

  primedForCapture = false;

  /** Smoothed “aligned” state for the static oval UI (no canvas flicker). */
  frameAligned = false;

  pendingReview = false;
  captureWarning: string | null = null;
  pendingPreviewUrl: string | null = null;

  private stream: MediaStream | null = null;
  private detector: FaceDetectorInstance | null = null;
  private rafId = 0;
  private destroyed = false;

  private readonly cxHistory: number[] = [];
  private readonly cxHistMax = 100;
  private noFaceStreak = 0;
  private rotationLocked = false;

  private stableGreenSince: number | null = null;
  private readonly stableGreenMs = 1700;
  private readonly cameraSettleMs = 2600;
  private readonly minGoodFrameStreak = 24;
  private readonly preSnapshotSettleMs = 220;

  private liveStartedAt = 0;
  autoCaptureFired = false;

  private lastMetrics: BbNorm | null = null;

  /** Preview is mirrored (CSS); map detector X to screen space for the oval. */
  private screenCxN(cxN: number): number {
    return 1 - cxN;
  }

  private ovalOkBlend = 0;

  constructor(private faceGlobal: MediapipeFaceGlobalService) { }

  async startCamera(): Promise<void> {
    this.cameraError = null;
    this.modelError = null;
    this.pendingReview = false;
    this.captureWarning = null;
    this.revokePendingPreview();
    this.autoCaptureFired = false;
    this.rotationLocked = false;
    this.rotationSatisfied = false;
    this.cxHistory.length = 0;
    this.stableGreenSince = null;
    this.autoCaptureProgress = 0;
    this.primedForCapture = false;
    this.liveStartedAt = 0;
    this.frameAligned = false;
    this.ovalOkBlend = 0;
    this.status = 'loading';
    this.statusMessage = 'Starting camera…';

    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false
      });
    } catch {
      this.status = 'error';
      this.cameraError = 'Camera permission denied or not available.';
      this.statusMessage = '';
      return;
    }

    const video = this.videoRef?.nativeElement;
    if (!video) {
      this.stopCamera();
      this.status = 'error';
      this.cameraError = 'Video element not ready.';
      return;
    }
    video.srcObject = this.stream;
    await video.play();

    this.statusMessage = 'Loading face detection…';
    try {
      this.detector = await this.faceGlobal.getFaceDetector();
    } catch (e: unknown) {
      this.modelError = e instanceof Error ? e.message : 'Face model failed to load';
      this.status = 'error';
      this.statusMessage = '';
      this.stopCamera();
      return;
    }

    this.status = 'live';
    this.statusMessage = 'Slowly turn your head to the left, then to the right';
    this.startLoop();
  }

  stopCamera(): void {
    this.stopLoop();
    const video = this.videoRef?.nativeElement;
    if (video) {
      video.srcObject = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.status === 'live' || this.status === 'loading') {
      this.status = 'idle';
      this.statusMessage = '';
    }
    this.faceOk = false;
    this.goodFrameStreak = 0;
    this.rotationSatisfied = false;
    this.rotationLocked = false;
    this.cxHistory.length = 0;
    this.stableGreenSince = null;
    this.autoCaptureProgress = 0;
    this.autoCaptureFired = false;
    this.primedForCapture = false;
    this.liveStartedAt = 0;
    this.frameAligned = false;
    this.ovalOkBlend = 0;
  }

  private stopCameraTracksOnly(): void {
    const video = this.videoRef?.nativeElement;
    if (video) {
      video.srcObject = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.status === 'live' || this.status === 'loading') {
      this.status = 'idle';
    }
  }

  capturePhoto(): void {
    if (!this.faceOk || this.status !== 'live' || this.pendingReview || this.autoCaptureFired) return;
    if (!this.rotationSatisfied || !this.primedForCapture) return;
    void this.runCaptureFlow('manual');
  }

  acceptPendingCapture(): void {
    if (!this.pendingReview || !this.pendingBlob) return;
    const b = this.pendingBlob;
    this.pendingBlob = null;
    this.pendingReview = false;
    this.captureWarning = null;
    this.revokePendingPreview();
    this.captured.emit(b);
    this.cleanupAfterEmit();
  }

  retakeFromReview(): void {
    this.revokePendingPreview();
    this.pendingReview = false;
    this.captureWarning = null;
    this.pendingBlob = null;
    this.autoCaptureFired = false;
    this.stableGreenSince = null;
    this.primedForCapture = false;
    void this.startCamera();
  }

  private pendingBlob: Blob | null = null;

  private startLoop(): void {
    this.stopLoop();
    this.liveStartedAt = performance.now();
    const tick = () => {
      if (this.destroyed) return;
      this.rafId = requestAnimationFrame(tick);
      void this.onFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private revokePendingPreview(): void {
    if (this.pendingPreviewUrl) {
      URL.revokeObjectURL(this.pendingPreviewUrl);
      this.pendingPreviewUrl = null;
    }
  }

  private normalizeBBox(
    bb: NonNullable<FaceDetectorResult['detections'][0]['boundingBox']>,
    w: number,
    h: number,
    score: number
  ): BbNorm | null {
    const norm = bb.width <= 1.01 && bb.height <= 1.01 && bb.originX <= 1.01 && bb.originY <= 1.01;
    let relArea: number;
    let cx: number;
    let cy: number;
    let x0: number;
    let y0: number;
    let bw: number;
    let bh: number;
    if (norm) {
      relArea = bb.width * bb.height;
      cx = bb.originX + bb.width / 2;
      cy = bb.originY + bb.height / 2;
      x0 = bb.originX * w;
      y0 = bb.originY * h;
      bw = bb.width * w;
      bh = bb.height * h;
    } else {
      relArea = (bb.width / w) * (bb.height / h);
      cx = bb.originX + bb.width / 2;
      cy = bb.originY + bb.height / 2;
      x0 = bb.originX;
      y0 = bb.originY;
      bw = bb.width;
      bh = bb.height;
    }
    const cxN = norm ? cx : cx / w;
    const cyN = norm ? cy : cy / h;
    return { x0, y0, bw, bh, cxN, cyN, relArea, score };
  }

  private pickBest(
    dets: FaceDetectorResult['detections'] | undefined,
    scoreFloor: number,
    w: number,
    h: number
  ): FaceDetectorResult['detections'][0] | null {
    let best: FaceDetectorResult['detections'][0] | null = null;
    let bestRel = 0;
    for (const d of dets ?? []) {
      const bb = d.boundingBox;
      const sc = d.categories?.[0]?.score ?? 0;
      if (!bb || sc < scoreFloor) continue;
      const norm = bb.width <= 1.01 && bb.height <= 1.01 && bb.originX <= 1.01 && bb.originY <= 1.01;
      const relArea = norm ? bb.width * bb.height : (bb.width * bb.height) / (w * h);
      if (relArea > bestRel) {
        bestRel = relArea;
        best = d;
      }
    }
    return best;
  }

  /** Face center inside the on-screen oval (mirrored preview coordinates). */
  private faceInOval(cxN: number, cyN: number): boolean {
    const dx = (cxN - OVAL_CX) / OVAL_RX;
    const dy = (cyN - OVAL_CY) / OVAL_RY;
    return dx * dx + dy * dy <= 1.04;
  }

  private updateRotationHistory(cxN: number | null): void {
    if (this.rotationLocked) return;
    if (cxN == null) {
      this.noFaceStreak++;
      if (this.noFaceStreak > 40) {
        this.cxHistory.length = 0;
        this.noFaceStreak = 0;
      }
      return;
    }
    this.noFaceStreak = 0;
    this.cxHistory.push(cxN);
    if (this.cxHistory.length > this.cxHistMax) this.cxHistory.shift();
    if (this.cxHistory.length < 28) return;
    const lo = Math.min(...this.cxHistory);
    const hi = Math.max(...this.cxHistory);
    if (hi - lo >= 0.1) {
      this.rotationSatisfied = true;
      this.rotationLocked = true;
    }
  }

  private qualityAssessment(m: BbNorm): { tier: 'good' | 'warn'; messages: string[] } {
    const messages: string[] = [];
    let warn = false;
    if (m.score < 0.82) {
      warn = true;
      messages.push('Face confidence is a bit low.');
    }
    if (m.relArea < 0.05) {
      warn = true;
      messages.push('Face looks small — move a little closer next time.');
    }
    if (m.relArea > 0.5) {
      warn = true;
      messages.push('Face is very large in frame — move slightly back.');
    }
    const cxS = this.screenCxN(m.cxN);
    if (!this.faceInOval(cxS, m.cyN)) {
      warn = true;
      messages.push('Face was not aligned inside the frame.');
    }
    return { tier: warn ? 'warn' : 'good', messages };
  }

  private async runCaptureFlow(source: 'auto' | 'manual'): Promise<void> {
    if (this.pendingReview) return;
    if (this.autoCaptureFired) return;
    this.autoCaptureFired = true;

    const video = this.videoRef?.nativeElement;
    if (!video || video.videoWidth < 2) {
      this.autoCaptureFired = false;
      return;
    }
    await new Promise<void>((r) => setTimeout(r, this.preSnapshotSettleMs));
    const blob = await this.snapshotBlob(video);
    if (!blob) {
      this.autoCaptureFired = false;
      return;
    }

    const m = this.lastMetrics;
    if (!m) {
      this.autoCaptureFired = false;
      return;
    }

    const q = this.qualityAssessment(m);
    if (q.tier === 'good') {
      this.captured.emit(blob);
      this.cleanupAfterEmit();
      return;
    }

    this.pendingBlob = blob;
    this.captureWarning = q.messages.join(' ');
    this.revokePendingPreview();
    this.pendingPreviewUrl = URL.createObjectURL(blob);
    this.pendingReview = true;
    this.stopLoop();
    this.stopCameraTracksOnly();
    this.statusMessage =
      source === 'auto'
        ? 'Check the photo below. You can retake or continue.'
        : 'This shot may not be ideal. Retake or continue.';
  }

  private cleanupAfterEmit(): void {
    this.stopLoop();
    this.autoCaptureProgress = 0;
    this.stableGreenSince = null;
    this.primedForCapture = false;
    this.stopCamera();
  }

  private snapshotBlob(video: HTMLVideoElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
    });
  }

  private async onFrame(): Promise<void> {
    const video = this.videoRef?.nativeElement;
    const det = this.detector;
    if (!video || !det || video.readyState < 2 || this.pendingReview || this.autoCaptureFired) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w < 2 || h < 2) return;

    const now = performance.now();

    let result: FaceDetectorResult;
    try {
      result = det.detectForVideo(video, performance.now());
    } catch {
      this.faceOk = false;
      this.goodFrameStreak = 0;
      this.lastMetrics = null;
      this.primedForCapture = false;
      this.updateOvalBlend(false);
      this.updateRotationHistory(null);
      return;
    }

    const dets = result.detections ?? [];
    const bestLoose = this.pickBest(dets, 0.52, w, h);
    let looseNorm: BbNorm | null = null;
    if (bestLoose?.boundingBox) {
      looseNorm = this.normalizeBBox(bestLoose.boundingBox, w, h, bestLoose.categories?.[0]?.score ?? 0);
      this.updateRotationHistory(looseNorm.cxN);
    } else {
      this.updateRotationHistory(null);
    }

    const best = this.pickBest(dets, 0.55, w, h);
    let ok = false;
    let faceNorm: BbNorm | null = null;

    const minRelArea = 0.042;
    const maxRelArea = 0.52;
    const scoreMin = 0.72;

    if (best?.boundingBox) {
      const sc = best.categories?.[0]?.score ?? 0;
      const n = this.normalizeBBox(best.boundingBox, w, h, sc);
      if (n) {
        faceNorm = n;
        this.lastMetrics = n;
        const cxS = this.screenCxN(n.cxN);
        const inOval = this.faceInOval(cxS, n.cyN);
        ok = n.score >= scoreMin && n.relArea >= minRelArea && n.relArea <= maxRelArea && inOval;
      }
    } else {
      this.lastMetrics = looseNorm;
    }

    this.updateOvalBlend(ok);

    this.faceOk = ok;
    if (ok) {
      this.goodFrameStreak = Math.min(this.goodFrameStreak + 1, 120);
    } else {
      this.goodFrameStreak = 0;
      this.primedForCapture = false;
    }

    if (!this.rotationSatisfied) {
      this.stableGreenSince = null;
      this.autoCaptureProgress = 0;
      this.primedForCapture = false;
      this.statusMessage = 'Slowly turn your head to the left, then to the right';
    } else if (!ok) {
      this.stableGreenSince = null;
      this.autoCaptureProgress = 0;
      this.primedForCapture = false;
      const n = this.lastMetrics;
      if (n) {
        const cxS = this.screenCxN(n.cxN);
        if (!this.faceInOval(cxS, n.cyN)) {
          this.statusMessage = 'Position your face inside the oval and look straight ahead';
        } else if (n.relArea < minRelArea) {
          this.statusMessage = 'Move a bit closer so your face fills the frame';
        } else if (n.relArea > maxRelArea) {
          this.statusMessage = 'Move slightly back — your face is too large in the frame';
        } else {
          this.statusMessage = 'Hold steady and improve lighting if the outline stays orange';
        }
      } else {
        this.statusMessage = 'Position your face inside the oval';
      }
    } else {
      const sinceLive = now - this.liveStartedAt;
      const settleDone = sinceLive >= this.cameraSettleMs;
      const streakDone = this.goodFrameStreak >= this.minGoodFrameStreak;

      if (!settleDone) {
        this.stableGreenSince = null;
        this.autoCaptureProgress = Math.min(0.42, (sinceLive / this.cameraSettleMs) * 0.42);
        this.primedForCapture = false;
        const sec = Math.max(1, Math.ceil((this.cameraSettleMs - sinceLive) / 1000));
        this.statusMessage = `Preparing camera… ${sec}s`;
      } else if (!streakDone) {
        this.stableGreenSince = null;
        this.autoCaptureProgress =
          0.42 + Math.min(0.28, (this.goodFrameStreak / this.minGoodFrameStreak) * 0.28);
        this.primedForCapture = false;
        this.statusMessage = 'Hold still — optimizing image…';
      } else {
        this.primedForCapture = true;
        if (this.stableGreenSince == null) this.stableGreenSince = now;
        const held = now - this.stableGreenSince;
        this.autoCaptureProgress = Math.min(1, 0.7 + (held / this.stableGreenMs) * 0.3);
        this.statusMessage =
          held < this.stableGreenMs * 0.28
            ? 'Perfect. Hold very still.'
            : 'Capturing…';
        if (held >= this.stableGreenMs) {
          void this.runCaptureFlow('auto');
        }
      }
    }
  }

  private updateOvalBlend(ok: boolean): void {
    const target = ok ? 1 : 0;
    this.ovalOkBlend += (target - this.ovalOkBlend) * 0.2;
    this.frameAligned = this.ovalOkBlend >= 0.52;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopLoop();
    this.stopCamera();
    this.revokePendingPreview();
    this.pendingBlob = null;
    this.detector = null;
    this.faceGlobal.releaseDetector();
  }
}

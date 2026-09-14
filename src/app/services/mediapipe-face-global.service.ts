import { Injectable } from '@angular/core';

/** Globals set by `vision_bundle.js` (see index.html). */
type FaceDetectorCtor = {
  createFromOptions: (
    fileset: unknown,
    options: {
      baseOptions: { modelAssetPath: string; delegate?: string };
      runningMode: string;
      minDetectionConfidence?: number;
    }
  ) => Promise<FaceDetectorInstance>;
};

export type FaceDetectorInstance = {
  detectForVideo(video: HTMLVideoElement, timestamp: number): FaceDetectorResult;
  close?: () => void;
};

export interface FaceDetectorResult {
  detections: Array<{
    categories?: Array<{ score?: number; categoryName?: string }>;
    boundingBox?: { originX: number; originY: number; width: number; height: number };
    /** Present for BlazeFace-style models (pixel or normalized per task). */
    keypoints?: Array<{ x?: number; y?: number; label?: string; name?: string }>;
  }>;
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.10/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

@Injectable({ providedIn: 'root' })
export class MediapipeFaceGlobalService {
  private detector: FaceDetectorInstance | null = null;
  private loadPromise: Promise<FaceDetectorInstance> | null = null;

  /** Wait for CDN scripts: MediaPipe `FilesetResolver` / `FaceDetector`. */
  waitForGlobals(timeoutMs = 20000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const w = globalThis as unknown as Record<string, unknown>;
        if (w['FilesetResolver'] && w['FaceDetector']) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error('MediaPipe Tasks Vision not found (FilesetResolver / FaceDetector). Check index.html includes vision_bundle.js.'));
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    });
  }

  /** Uses global `tf` from CDN when present (WebGL backend). */
  async ensureTfReady(): Promise<void> {
    const tf = (globalThis as unknown as { tf?: { ready?: () => Promise<void>; setBackend?: (b: string) => Promise<boolean> } }).tf;
    if (!tf?.ready) return;
    await tf.ready();
    try {
      if (tf.setBackend) await tf.setBackend('webgl');
    } catch {
      /* CPU fallback is fine */
    }
  }

  async getFaceDetector(): Promise<FaceDetectorInstance> {
    if (this.detector) return this.detector;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      await this.waitForGlobals();
      await this.ensureTfReady();

      const w = globalThis as unknown as {
        FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
        FaceDetector: FaceDetectorCtor;
      };

      const fileset = await w.FilesetResolver.forVisionTasks(WASM_ROOT);

      const tryCreate = (delegate: string) => w.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.55 });

      try {
        this.detector = await tryCreate('GPU');
      } catch {
        this.detector = await tryCreate('CPU');
      }
      this.loadPromise = null;
      return this.detector;
    })();

    return this.loadPromise;
  }

  /** Close WASM / GPU resources when leaving the selfie step. */
  releaseDetector(): void {
    this.detector?.close?.();
    this.detector = null;
    this.loadPromise = null;
  }
}

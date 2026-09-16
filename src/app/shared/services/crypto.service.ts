import { Injectable } from '@angular/core';
import { environment } from '../environment/environment';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private keyPromise: Promise<CryptoKey> | null = null;

  private async deriveKey(): Promise<CryptoKey> {
    if (!window.isSecureContext) {
      throw new Error('Web Crypto API requires a secure context (HTTPS)');
    }
    const secret = (environment as any).REQUEST_RESPONSE_SECRET || '';
    if (!secret) throw new Error('Encryption key not configured');
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  private getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = this.deriveKey();
    }
    return this.keyPromise;
  }

  /** Encrypt JSON payload → iv(12) + authTag(16) + ciphertext */
  async encrypt(data: unknown): Promise<ArrayBuffer> {
    const key = await this.getKey();

    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const browserOutput = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext);

    const browserBytes = new Uint8Array(browserOutput);
    const encryptedData = browserBytes.slice(0, browserBytes.length - 16);
    const authTag = browserBytes.slice(browserBytes.length - 16);

    const wire = new Uint8Array(12 + 16 + encryptedData.length);
    wire.set(iv, 0);
    wire.set(authTag, 12);
    wire.set(encryptedData, 28);

    return wire.buffer;
  }

  /** Decrypt iv(12) + authTag(16) + ciphertext from backend */
  async decrypt(buffer: ArrayBuffer): Promise<unknown> {
    const key = await this.getKey();
    const bytes = new Uint8Array(buffer);

    if (bytes.length < 28) {
      throw new Error(`Encrypted payload too short: ${bytes.length} bytes`);
    }

    const iv = bytes.slice(0, 12);
    const authTag = bytes.slice(12, 28);
    const encryptedData = bytes.slice(28);

    const forWebCrypto = new Uint8Array(encryptedData.length + 16);
    forWebCrypto.set(encryptedData, 0);
    forWebCrypto.set(authTag, encryptedData.length);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, forWebCrypto);

    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  /**
   * Normalises HTTP bodies into raw encrypted bytes.
   *
   * Backend may send:
   * - `res.send(buffer)`           → ArrayBuffer (application/octet-stream)
   * - `res.json(buffer)` (legacy)  → { type: "Buffer", data: number[] }
   * - base64 string                → decoded bytes
   */
  toWireBuffer(body: unknown): ArrayBuffer | null {
    if (body == null) {
      return null;
    }

    if (body instanceof ArrayBuffer) {
      return body.byteLength > 0 ? body : null;
    }

    if (ArrayBuffer.isView(body)) {
      const view = body as ArrayBufferView;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    }

    if (typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (record['type'] === 'Buffer' && Array.isArray(record['data'])) {
        return new Uint8Array(record['data'] as number[]).buffer;
      }
    }

    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed['type'] === 'Buffer' && Array.isArray(parsed['data'])) {
          return new Uint8Array(parsed['data'] as number[]).buffer;
        }
      } catch { }

      try {
        return this.base64ToArrayBuffer(trimmed);
      } catch {
        return null;
      }
    }

    return null;
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }
}

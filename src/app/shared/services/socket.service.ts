import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../environment/environment';
import { SharedService } from './shared.service';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;
  private readonly shared = inject(SharedService);

  private depositReviewSubject = new Subject<any>();
  private withdrawReviewSubject = new Subject<any>();

  depositReview$ = this.depositReviewSubject.asObservable();
  withdrawReview$ = this.withdrawReviewSubject.asObservable();

  connect(): void {
    // Deposit/withdraw review socket is not used for B2B brands.
    if (this.shared.isB2BBrand()) {
      return;
    }

    if (this.socket?.connected) {
      return;
    }

    const token = this.readToken();
    const brandCode = environment.BrandCode || 'BRD0001';
    const socketUrl = this.resolveSocketUrl();

    if (!socketUrl) {
      console.warn('[SocketService] No SocketUrl configured — skipping connection');
      return;
    }

    this.socket = io(socketUrl, {
      auth: { token, brandcode: brandCode },
      query: { token, brandcode: brandCode },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      // console.log('[SocketService] Connected', this.socket?.id);
    });

    this.socket.on('disconnect', (reason) => {
      // console.log('[SocketService] Disconnected', reason);
    });

    this.socket.on('connect_error', (err) => {
      // console.error('[SocketService] Connection error', err.message);
    });

    this.socket.on('deposit_review', (data: any) => {
      // console.log('[SocketService] deposit_review', data);
      if (data && data != null) {
        this.depositReviewSubject.next(data);
      }
    });

    this.socket.on('withdraw_review', (data: any) => {
      // console.log('[SocketService] withdraw_review', data);
      if (data && data != null) {
        this.withdrawReviewSubject.next(data);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      // console.log('[SocketService] Disconnected and cleaned up');
    }
    // Do not complete Subjects — this service is a root singleton.
    // Logout must only close the socket; re-login calls connect() again
    // and existing depositReview$ / withdrawReview$ subscribers keep working.
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  private readToken(): string {
    const raw = sessionStorage.getItem('auth_token')?.trim() || '';
    try {
      return raw;
    } catch {
      return raw;
    }
  }

  private resolveSocketUrl(): string {
    if (environment.SocketUrl) {
      return environment.SocketUrl;
    }
    if (environment.APIUrl) {
      try {
        return new URL(environment.APIUrl).origin;
      } catch {
        return environment.APIUrl;
      }
    }
    return '';
  }
}

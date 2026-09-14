import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { from, Observable, throwError } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { environment } from '../shared/environment/environment';
import { AuthService } from '../shared/services/auth.service';
import { CryptoService } from '../shared/services/crypto.service';
import { SocketService } from '../shared/services/socket.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private readonly crypto: CryptoService,
    private readonly router: Router,
    private readonly authService: AuthService,
    private readonly socketService: SocketService
  ) { }

  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    const url = request.url;

    if (this.shouldSkipInterceptor(url)) {
      return next.handle(request);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const token = sessionStorage.getItem('auth_token')?.trim();
    if (token) {
      headers['Authorization'] = token.startsWith('Bearer ')
        ? token
        : `Bearer ${token}`;
    }
    // Commented out encryption to send data in plain JSON format
    /*
    if (request.body !== null && request.body !== undefined && !(request.body instanceof FormData)) {
      return from(this.crypto.encrypt(request.body)).pipe(
        switchMap((encryptedBody: ArrayBuffer) => {
          const encryptedRequest = request.clone({
            body: new Uint8Array(encryptedBody),
            setHeaders: {
              ...headers,
              'Content-Type': 'application/octet-stream',
            },
            responseType: 'arraybuffer',
          });
          return this.handleResponse(next, encryptedRequest);
        })
      );
    }

    const requestWithAuth = request.clone({
      setHeaders: headers,
      responseType: 'arraybuffer',
    });
    return this.handleResponse(next, requestWithAuth);
  }
*/
    const requestWithAuth = request.clone({
      setHeaders: headers,
    });
    return this.handleResponse(next, requestWithAuth);
  }

  private shouldSkipInterceptor(url: string): boolean {
    if (url.startsWith('assets/') || url.includes('/assets/')) {
      return true;
    }

    const apiBase = environment.APIUrl?.trim();
    if (!apiBase) {
      return true;
    }

    return !url.startsWith(apiBase);
  }

  private handleResponse(
    next: HttpHandler,
    request: HttpRequest<unknown>
  ): Observable<HttpEvent<unknown>> {
    return next.handle(request).pipe(
      /*
      switchMap((event: HttpEvent<unknown>) => {
        if (event instanceof HttpResponse) {
          return from(
            this.resolveResponseBody(event.body).then((body) => event.clone({ body }) as HttpEvent<unknown>)
          );
        }
        return from(Promise.resolve(event));
      }),
      catchError((error: HttpErrorResponse) => {
        const wireBuffer = this.crypto.toWireBuffer(error.error);
        if (wireBuffer) {
          return from(this.resolveEncryptedBody(wireBuffer)).pipe(
            switchMap((decrypted) => {
              return throwError(() =>
                new HttpErrorResponse({
                  error: decrypted,
                  headers: error.headers,
                  status: error.status,
                  statusText: error.statusText,
                  url: error.url ?? undefined,
                })
              )
            })
          );
        }

        return throwError(() => error);
      }),
      */
      tap({
        error: (error: HttpErrorResponse) => {
          if (error.status === 401) {
            this.socketService.disconnect();
            this.authService.logout();
            // sessionStorage.clear();
            // this.router.navigate(['/login']);
          }
        },
      })
    );
  }

  private async resolveResponseBody(body: unknown): Promise<unknown> {
    const wireBuffer = this.crypto.toWireBuffer(body);
    if (wireBuffer) {
      return this.resolveEncryptedBody(wireBuffer);
    }

    if (this.isApiJson(body)) {
      return body;
    }

    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }

    return body;
  }

  private async resolveEncryptedBody(wireBuffer: ArrayBuffer): Promise<unknown> {
    try {
      return await this.crypto.decrypt(wireBuffer);
    } catch (error) {
      console.error('[AuthInterceptor] Failed to decrypt API response', error);
      throw error;
    }
  }

  private isApiJson(body: unknown): body is Record<string, unknown> {
    return (
      body !== null &&
      typeof body === 'object' &&
      !ArrayBuffer.isView(body) &&
      !(body instanceof ArrayBuffer) &&
      ('code' in (body as object) || 'message' in (body as object))
    );
  }
}

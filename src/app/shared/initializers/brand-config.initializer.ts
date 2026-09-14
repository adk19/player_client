import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { urlConstant } from '../constant/urlConstant';
import { environment } from '../environment/environment';
import { BrandConfig, SharedService } from '../services/shared.service';

/** Load /config/get/{brandCode} before first route. */
export function initBrandConfig(http: HttpClient, shared: SharedService): () => Promise<void> {
  return async () => {
    const brandCode = environment.BrandCode;
    if (!brandCode) {
      return Promise.resolve();
    }

    shared.brandCode = brandCode;

    await firstValueFrom(
      http.get<{ data?: unknown[]; }>(urlConstant.configGet(brandCode)).pipe(
        tap((res) => {
          const row = res?.data?.[0];
          if (row && typeof row === 'object') {
            shared.setBrandConfig(row as BrandConfig);
          }
        }),
        catchError((err) => {
          console.error('Failed to load brand config', err);
          return of(null);
        })
      )
    );
    return undefined;
  };
}

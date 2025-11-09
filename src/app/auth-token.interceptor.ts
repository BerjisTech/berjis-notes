import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CoreAuthService } from '@berjis/angular-auth';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../environments/environment';

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CoreAuthService);
  const serviceBase = normalizeBase(environment.notesApiBase);
  let attemptedRefresh = false;

  return next(req).pipe(
    catchError((err: any) => {
      const httpError = err as HttpErrorResponse;
      if (!attemptedRefresh && serviceBase && req.url.startsWith(serviceBase) && httpError.status === 401) {
        attemptedRefresh = true;
        return from(
          auth.refresh()
            .then(() => auth.ensureAuth({ force: true, maxAgeMs: 0 }))
        ).pipe(
          switchMap(() => next(req)),
          catchError(() => throwError(() => err))
        );
      }
      return throwError(() => err);
    })
  );
};

function normalizeBase(base: string | undefined): string {
  if (!base) return '';
  return base.replace(/\/+$/, '');
}

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, map, catchError, of } from 'rxjs';
import { ApiService } from './api.service';

export const authGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  return from(api.ensureAuth()).pipe(
    map(res => { const valid = !!res?.data?.valid; if (!valid) router.navigateByUrl('/'); return valid; }),
    catchError(() => { router.navigateByUrl('/'); return of(false); })
  );
};


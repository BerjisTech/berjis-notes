import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  try {
    const w: any = (typeof window !== 'undefined') ? (window as any) : {};
    const svcBase: string = (w.__NOTES_API__ && String(w.__NOTES_API__).trim()) || 'https://notes-api.berjis.tech';
    const token = localStorage.getItem('accessToken');
    if (req.url.startsWith(svcBase) && token && !req.headers.has('Authorization')) {
      req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
    }
  } catch {}

  return next(req).pipe(
    catchError((err: any) => {
      const e = err as HttpErrorResponse;
      try {
        const w: any = (typeof window !== 'undefined') ? (window as any) : {};
        const svcBase: string = (w.__NOTES_API__ && String(w.__NOTES_API__).trim()) || 'https://notes-api.berjis.tech';
        const coreBase: string = (w.__BERJIS_API__ && String(w.__BERJIS_API__).trim()) || 'https://api.berjis.tech';
        const http = inject(HttpClient);
        if (req.url.startsWith(svcBase) && e.status === 401) {
          return from(firstValueFrom(http.post<any>(`${coreBase}/v1/auth/refresh`, {}, { withCredentials: true }))).pipe(
            switchMap((res) => {
              try {
                const token = res?.data?.access || res?.access;
                if (typeof token === 'string' && token.length) localStorage.setItem('accessToken', token);
              } catch {}
              const token = localStorage.getItem('accessToken');
              let retried = req;
              if (token) retried = retried.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
              return next(retried);
            }),
            catchError(() => throwError(() => err))
          );
        }
      } catch {}
      return throwError(() => err);
    })
  );
};


import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

const apiBase = 'https://api.berjis.tech';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}
  verify() { return this.http.post<any>(`${apiBase}/v1/auth/verify`, {}, { withCredentials: true }); }
  refresh() { return this.http.post<any>(`${apiBase}/v1/auth/refresh`, {}, { withCredentials: true }).pipe(tap((res: any) => {
    try {
      const token = res?.data?.access || res?.access;
      if (typeof token === 'string' && token.length) localStorage.setItem('accessToken', token);
    } catch {}
  })); }
  async ensureAuth(): Promise<any> {
    try { const v = await firstValueFrom(this.verify()); if (v?.data?.valid) return v; await firstValueFrom(this.refresh()); return await firstValueFrom(this.verify()); }
    catch { try { await firstValueFrom(this.refresh()); return await firstValueFrom(this.verify()); } catch { return { success: true, data: { valid: false } }; } }
  }
}

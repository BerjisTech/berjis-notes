import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private static readonly STORAGE_KEY = 'notes-theme';
  private mode: ThemeMode;

  constructor(@Inject(DOCUMENT) private readonly document: Document, @Inject(PLATFORM_ID) private readonly platformId: Object) {
    this.mode = this.resolveInitialTheme();
    this.applyTheme(this.mode);
  }

  get current(): ThemeMode {
    return this.mode;
  }

  get isDark(): boolean {
    return this.mode === 'dark';
  }

  toggle(): void {
    this.setTheme(this.isDark ? 'light' : 'dark');
  }

  setTheme(mode: ThemeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.persist(mode);
    this.applyTheme(mode);
  }

  private resolveInitialTheme(): ThemeMode {
    if (!this.isBrowser) return 'light';

    const stored = localStorage.getItem(ThemeService.STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    const legacy = localStorage.getItem('notes-dark-mode');
    if (legacy === '1' || legacy === '0') {
      const legacyMode: ThemeMode = legacy === '1' ? 'dark' : 'light';
      localStorage.removeItem('notes-dark-mode');
      this.persist(legacyMode);
      return legacyMode;
    }

    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
    return prefersDark ? 'dark' : 'light';
  }

  private applyTheme(mode: ThemeMode): void {
    if (!this.isBrowser) return;
    const root = this.document.documentElement;
    const body = this.document.body;
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
    body?.classList.toggle('dark', mode === 'dark');
    body?.classList.toggle('light', mode === 'light');
  }

  private persist(mode: ThemeMode): void {
    if (!this.isBrowser) return;
    localStorage.setItem(ThemeService.STORAGE_KEY, mode);
  }

  private get isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}

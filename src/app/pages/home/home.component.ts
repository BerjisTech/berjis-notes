import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CoreAuthService } from '@berjis/angular-auth';
import { NotesService, Note } from '../../notes.service';
import { ThemeService } from '../../theme.service';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
})
export class HomePageComponent {
  authed: boolean | null = null;
  recents: Note[] = [];
  loading = false;
  error: string | null = null;

  constructor(private auth: CoreAuthService, private router: Router, private notes: NotesService, public theme: ThemeService) {
    void this.init();
  }

  async init() {
    this.loading = true;
    this.error = null;
    try {
      const session = await this.auth.ensureAuth({ maxAgeMs: 1500 });
      this.authed = !!session?.valid;
      if (this.authed) {
        this.recents = await this.notes.list(['active']);
      } else {
        this.recents = [];
      }
    } catch (err: any) {
      this.authed = false;
      this.error = err?.message || 'Unable to load account details.';
    } finally {
      this.loading = false;
    }
  }

  createNote() {
    this.router.navigate(['/note', 'new']);
  }

  select(note: Note) {
    this.router.navigate(['/note', note.id]);
  }

  toggleTheme() {
    this.theme.toggle();
  }

  get themeModeLabel() {
    return this.theme.isDark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  get themeIcon() {
    return this.theme.isDark ? 'light_mode' : 'dark_mode';
  }

  get themeButtonText() {
    return this.theme.isDark ? 'Light' : 'Dark';
  }
}


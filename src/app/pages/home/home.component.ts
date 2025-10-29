import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
import { NotesService, Note } from '../../notes.service';

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

  constructor(private api: ApiService, private router: Router, private notes: NotesService) {
    void this.init();
  }

  async init() {
    this.loading = true;
    this.error = null;
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
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
}


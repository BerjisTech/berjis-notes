import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';
import { NotesService, Note } from '../../notes.service';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html'
})
export class HomePageComponent {
  authed: boolean | null = null;
  recents: Note[] = [];
  activeNote: Note | null = null;

  constructor(private api: ApiService, private router: Router, private notes: NotesService) {
    this.init();
  }

  async init() {
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
      if (this.authed) {
        this.recents = this.notes.list(['active']);
      } else {
        this.recents = [];
        this.activeNote = null;
      }
    } catch {
      this.authed = false;
    }
  }

  select(n: Note) { this.activeNote = n; }
}

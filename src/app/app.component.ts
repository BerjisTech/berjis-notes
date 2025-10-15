import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';
import { NotesService, Note } from './notes.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './app.component.html'
})
export class AppComponent {
  authed: boolean | null = null;
  recents: Array<Note> = [];
  activeNote: Note | null = null;

  constructor(private router: Router, private api: ApiService, private notes: NotesService) { }

  async ngOnInit(): Promise<void> {
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

  createNote() {
    // Navigate to editor; in a real flow we'd create on the API first and use returned id
    this.router.navigate(['/note', 'new']);
  }


  select(n: Note) { this.activeNote = n; }
}

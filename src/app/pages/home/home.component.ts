import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../api.service';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html'
})
export class HomePageComponent {
  authed: boolean | null = null;
  recents: Array<{ id: string; title: string; updatedAt: string }>= [];
  activeNote: { id: string; title: string; updatedAt: string } | null = null;

  constructor(private api: ApiService, private router: Router) {
    this.init();
  }

  async init() {
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
      if (this.authed) {
        // Placeholder recent notes; wire to API when available
        this.recents = [
          { id: 'welcome', title: 'Welcome to Berjis Notes', updatedAt: new Date().toISOString() },
          { id: 'demo', title: 'Project kickoff notes', updatedAt: new Date(Date.now() - 86400000).toISOString() },
          { id: 'ideas', title: 'Ideas scratchpad', updatedAt: new Date(Date.now() - 3*86400000).toISOString() }
        ];
      } else {
        this.recents = [];
        this.activeNote = null;
      }
    } catch {
      this.authed = false;
    }
  }

  select(n: { id: string; title: string; updatedAt: string }) { this.activeNote = n; }
  createNote() {
    // Navigate to editor; in a real flow we'd create on the API first and use returned id
    this.router.navigate(['/note', 'new']);
  }
}


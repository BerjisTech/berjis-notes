import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ApiService } from './api.service';
import { Note, NoteSearchResult, NoteStatus, NotesService } from './notes.service';

type NoteBuckets = Record<NoteStatus, Note[]>;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  authed: boolean | null = null;
  filter: NoteStatus = 'active';
  notesByFilter: NoteBuckets = {
    active: [],
    archived: [],
    deleted: [],
  };
  loadingNotes = false;

  searchTerm = '';
  searching = false;
  searchResults: NoteSearchResult[] = [];
  searchError: string | null = null;
  private searchDebounce?: number;

  activeNote: Note | null = null;
  private routerSub?: Subscription;

  @ViewChildren('searchBox') searchBoxes?: QueryList<ElementRef<HTMLInputElement>>;

  constructor(private router: Router, private api: ApiService, public notes: NotesService) {}

  async ngOnInit(): Promise<void> {
    await this.ensureSession();
    this.routerSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.resolveActiveNote());
    this.resolveActiveNote();
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
  }

  private async ensureSession() {
    try {
      const res = await this.api.ensureAuth();
      this.authed = !!res?.data?.valid;
      if (this.authed) {
        await this.refreshNotes('active', true);
      } else {
        this.resetState();
      }
    } catch {
      this.authed = false;
      this.resetState();
    }
  }

  private resetState() {
    this.notesByFilter = { active: [], archived: [], deleted: [] };
    this.searchResults = [];
    this.searchError = null;
    this.activeNote = null;
  }

  get visibleNotes(): Note[] {
    return this.notesByFilter[this.filter] || [];
  }

  async refreshNotes(filter: NoteStatus, force = false) {
    if (!this.authed) return;
    if (!force && this.notesByFilter[filter]?.length) return;
    this.loadingNotes = true;
    try {
      const notes = await this.notes.list([filter]);
      this.notesByFilter[filter] = this.sortByUpdated(notes);
    } finally {
      this.loadingNotes = false;
    }
    if (filter === this.filter) {
      this.resolveActiveNote();
    }
  }

  async setFilter(filter: NoteStatus) {
    if (this.filter === filter) return;
    this.filter = filter;
    await this.refreshNotes(filter);
  }

  async createNote() {
    if (!this.authed) return;
    const note = await this.notes.create();
    this.insertOrUpdate(note);
    this.filter = 'active';
    await this.refreshNotes('active', true);
    await this.router.navigate(['/note', note.id]);
  }

  select(note: Note) {
    this.router.navigate(['/note', note.id]);
  }

  async onSearchInput(value: string) {
    if (!this.authed) {
      this.clearSearch();
      return;
    }
    this.searchTerm = value;
    if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
    if (!value.trim()) {
      this.searchResults = [];
      this.searchError = null;
      return;
    }
    this.searchDebounce = window.setTimeout(() => {
      void this.executeSearch();
    }, 220);
  }

  async executeSearch() {
    if (!this.authed) {
      this.clearSearch();
      return;
    }
    const query = this.searchTerm.trim();
    if (!query) {
      this.searchResults = [];
      this.searchError = null;
      return;
    }
    this.searching = true;
    try {
      this.searchResults = await this.notes.search(query);
      this.searchError = null;
    } catch (err: any) {
      this.searchResults = [];
      this.searchError = err?.message || 'Search unavailable';
    } finally {
      this.searching = false;
    }
  }

  openResult(result: NoteSearchResult) {
    this.router.navigate(['/note', result.id]);
    this.searchResults = [];
  }

  clearSearch() {
    if (this.searchDebounce) window.clearTimeout(this.searchDebounce);
    this.searchTerm = '';
    this.searchResults = [];
    this.searchError = null;
    this.searching = false;
  }

  @HostListener('window:keydown', ['$event'])
  handleHotkeys(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.focusSearch();
    } else if (event.key === 'Escape' && (this.searchTerm || this.searchResults.length)) {
      this.clearSearch();
    }
  }

  focusSearch() {
    if (!this.authed) return;
    queueMicrotask(() => {
      const target = this.searchBoxes?.first;
      target?.nativeElement?.focus();
    });
  }

  get syncLabel(): string {
    if (this.notes.isSaving) return 'Saving...';
    if (this.notes.lastSavedAt) {
      return `Saved ${new Date(this.notes.lastSavedAt).toLocaleTimeString()}`;
    }
    return this.notes.syncMode === 'local' ? 'Offline mode' : 'All changes saved';
  }

  private resolveActiveNote() {
    const match = this.router.url.match(/\/note\/([^\/\?]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const cached = this.notes.get(id);
      if (cached) {
        this.activeNote = cached;
        this.insertOrUpdate(cached);
      } else {
        void this.notes.fetch(id).then((note) => {
          if (note) {
            this.insertOrUpdate(note);
            this.activeNote = note;
          }
        });
      }
    } else {
      this.activeNote = null;
    }
  }

  private insertOrUpdate(note: Note) {
    const next: NoteBuckets = {
      active: this.removeNote(this.notesByFilter.active, note.id),
      archived: this.removeNote(this.notesByFilter.archived, note.id),
      deleted: this.removeNote(this.notesByFilter.deleted, note.id),
    };
    next[note.status] = this.sortByUpdated([note, ...next[note.status]]);
    this.notesByFilter = next;
  }

  private removeNote(list: Note[], id: string): Note[] {
    return list.filter((item) => item.id !== id);
  }

  private sortByUpdated(list: Note[]): Note[] {
    return [...list].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  // Sync status bindings
  get syncMode() {
    return this.notes.syncMode;
  }
  get isSaving() {
    return this.notes.isSaving;
  }
  get lastSavedAt() {
    return this.notes.lastSavedAt;
  }
  get lastError() {
    return this.notes.lastError;
  }
}

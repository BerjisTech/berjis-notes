import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type NoteStatus = 'active' | 'archived' | 'deleted';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Note {
  id: string;
  title?: string;
  content?: string; // Markdown (legacy HTML still supported)
  todos?: TodoItem[];
  status: NoteStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

const STORAGE_KEY = 'berjis-notes';
const API_BASE = 'https://notes-api.berjis.tech';

@Injectable({ providedIn: 'root' })
export class NotesService {
  private cache: Record<string, Note> = {};
  private preferRemote = true;
  // Sync status
  syncMode: 'remote' | 'local' = 'remote';
  isSaving = false;
  lastSavedAt: string | null = null;
  lastError: string | null = null;

  constructor(private http: HttpClient) {
    this.load();
    // Fire-and-forget migration from local storage to server, once.
    this.maybeMigrateToServer();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.cache = raw ? (JSON.parse(raw) as Record<string, Note>) : {};
    } catch {
      this.cache = {};
    }
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
  }

  private now() { return new Date().toISOString(); }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      // @ts-ignore
      return crypto.randomUUID();
    }
    return 'n_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  async list(status: NoteStatus[] = ['active']): Promise<Note[]> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/notes`, {
          params: { status: status.join(',') }, withCredentials: true
        }));
        this.preferRemote = true; this.syncMode = 'remote'; this.lastError = null;
        const rows: Note[] = res?.data || [];
        // Refresh cache with remote results
        for (const n of rows) this.cache[n.id] = n;
        this.persist();
        return rows;
      } catch (e) { this.switchToLocal(e); }
    }
    return Object.values(this.cache)
      .filter(n => status.includes(n.status))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  get(id: string): Note | undefined { return this.cache[id]; }

  async fetch(id: string): Promise<Note | undefined> {
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/notes/${id}`, { withCredentials: true }));
        const n: Note = res?.data;
        if (n) { this.cache[n.id] = n; this.persist(); }
        this.preferRemote = true; this.syncMode = 'remote'; this.lastError = null;
        return n;
      } catch (e) { this.switchToLocal(e); }
    }
    return this.cache[id];
  }

  async create(initial?: Partial<Note>): Promise<Note> {
    const id = initial?.id || this.uuid();
    const now = this.now();
    const note: Note = {
      id,
      title: initial?.title?.trim() || '',
      content: initial?.content || '',
      todos: initial?.todos || [],
      status: initial?.status || 'active',
      createdAt: now,
      updatedAt: now,
    };
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/notes`, {
          title: note.title || undefined,
          content: note.content || undefined,
          todos: note.todos && note.todos.length ? note.todos : undefined,
        }, { withCredentials: true }));
        const saved: Note = res.data;
        this.preferRemote = true; this.syncMode = 'remote'; this.lastError = null;
        this.cache[saved.id] = saved;
        this.persist();
        this.endSave();
        return saved;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    this.cache[id] = note; this.persist(); return note;
  }

  /** Save a note if it has any content (title, content HTML, or todos). */
  async save(note: Note): Promise<Note | undefined> {
    const hasTitle = !!note.title && note.title.trim().length > 0;
    const hasContent = !!note.content && this.stripFormatting(note.content).trim().length > 0; // strip MD/HTML
    const hasTodos = !!note.todos && note.todos.some(t => t.text.trim().length > 0);
    if (!hasTitle && !hasContent && !hasTodos) {
      // If empty and exists, do not create/save; if it existed, leave untouched.
      return undefined;
    }
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.put<any>(`${API_BASE}/v1/notes/${note.id}`, {
          title: note.title || undefined,
          content: note.content || undefined,
          todos: note.todos && note.todos.length ? note.todos : undefined,
        }, { withCredentials: true }));
        const saved: Note = res.data;
        this.preferRemote = true; this.syncMode = 'remote'; this.lastError = null;
        this.cache[saved.id] = saved; this.persist(); this.endSave();
        return saved;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    note.updatedAt = this.now(); this.cache[note.id] = { ...note }; this.persist(); return note;
  }

  async archive(id: string) {
    if (this.preferRemote) {
      try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/notes/${id}/archive`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    const n = this.cache[id]; if (n) { n.status = 'archived'; n.updatedAt = this.now(); this.persist(); }
  }
  async restore(id: string) {
    if (this.preferRemote) {
      try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/notes/${id}/restore`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    const n = this.cache[id]; if (n) { n.status = 'active'; n.updatedAt = this.now(); this.persist(); }
  }
  async softDelete(id: string) {
    if (this.preferRemote) {
      try { this.beginSave(); await firstValueFrom(this.http.delete(`${API_BASE}/v1/notes/${id}`, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    const n = this.cache[id]; if (n) { n.status = 'deleted'; n.updatedAt = this.now(); this.persist(); }
  }

  private MIGRATION_FLAG = 'berjis-notes-migrated-v1';
  private async maybeMigrateToServer() {
    try {
      if (!this.preferRemote) return;
      if (localStorage.getItem(this.MIGRATION_FLAG) === 'true') return;
      const localNotes = Object.values(this.cache || {});
      if (!localNotes.length) { localStorage.setItem(this.MIGRATION_FLAG, 'true'); return; }
      for (const n of localNotes) {
        const hasTitle = !!n.title && n.title.trim().length > 0;
        const hasContent = !!n.content && this.stripFormatting(n.content).trim().length > 0;
        const hasTodos = !!n.todos && n.todos.some(t => t.text.trim().length > 0);
        if (!hasTitle && !hasContent && !hasTodos) continue;
        let created: Note | null = null;
        try {
          this.beginSave();
          const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/notes`, {
            title: n.title || undefined,
            content: n.content || undefined,
            todos: n.todos && n.todos.length ? n.todos : undefined,
          }, { withCredentials: true }));
          created = res?.data as Note;
          this.endSave();
        } catch { /* if any fail, keep local and continue */ }
        if (created) {
          // Apply status
          if (n.status === 'archived') {
            try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/notes/${created.id}/archive`, {}, { withCredentials: true })); this.endSave(); } catch {}
          } else if (n.status === 'deleted') {
            try { this.beginSave(); await firstValueFrom(this.http.delete(`${API_BASE}/v1/notes/${created.id}`, { withCredentials: true })); this.endSave(); } catch {}
          }
        }
      }
      // Clear local storage cache after migration, refresh local cache with remote list
      this.cache = {};
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(this.MIGRATION_FLAG, 'true');
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/notes`, { params: { status: 'active,archived,deleted' }, withCredentials: true }));
        const all: Note[] = res?.data || [];
        for (const n of all) this.cache[n.id] = n;
        this.persist();
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  private beginSave() { this.isSaving = true; this.lastError = null; }
  private endSave(err?: any) {
    this.isSaving = false;
    if (err) { this.lastError = (err?.message || 'sync error'); }
    else { this.lastSavedAt = this.now(); }
  }
  private switchToLocal(e?: any) {
    this.preferRemote = false; this.syncMode = 'local'; this.lastError = (e?.message || 'offline, saving locally');
  }
  purge(id: string) { delete this.cache[id]; this.persist(); }

  // Strip HTML and Markdown syntax to detect real text content
  private stripFormatting(s: string): string {
    try {
      let t = s || '';
      t = t.replace(/```[\s\S]*?```/g, ' '); // fenced code
      t = t.replace(/`[^`]*`/g, ' '); // inline code
      t = t.replace(/<[^>]*>/g, ' '); // html tags
      t = t.replace(/!\[[^\]]*\]\([^\)]*\)/g, ' '); // images
      t = t.replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1'); // links -> text
      t = t.replace(/[\*_]{1,3}([^\*_]+)[\*_]{1,3}/g, '$1'); // emphasis
      t = t.replace(/^>\s?/gm, ''); // blockquote
      t = t.replace(/^\s{0,3}(\*|-|\+)\s+/gm, ''); // ul
      t = t.replace(/^\s{0,3}\d+\.\s+/gm, ''); // ol
      t = t.replace(/\[([ xX])]\s+/g, ''); // tasks
      t = t.replace(/^#{1,6}\s+/gm, ''); // headings
      t = t.replace(/\s+/g, ' ');
      return t.trim();
    } catch { return (s || '').trim(); }
  }
}

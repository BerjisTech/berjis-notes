import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { environment } from '../environments/environment';
import { BookmarkPreview, NoteDatabase, NoteDatabaseColumn, NoteDatabaseRow } from './editor/editor.types';

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

export interface NoteSearchResult {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

const STORAGE_KEY = 'berjis-notes';
const API_BASE = normalizeBase(environment.notesApiBase || 'https://notes-api.berjis.tech');

@Injectable({ providedIn: 'root' })
export class NotesService {
  private cache: Record<string, Note> = {};
  private databaseCache = new Map<string, NoteDatabase>();
  private preferRemote = true;
  private noteUpdates = new Subject<Note>();
  // Sync status
  syncMode: 'remote' | 'local' = 'remote';
  isSaving = false;
  lastSavedAt: string | null = null;
  lastError: string | null = null;

  noteChanges$ = this.noteUpdates.asObservable();

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
    const incomingTodos = initial?.todos;
    const todos = Array.isArray(incomingTodos) ? [...incomingTodos] : [];
    const content = initial?.content ?? '';
    const trimmedTitle = (initial?.title ?? '').trim();
    const hasTitle = trimmedTitle.length > 0;
    const hasContent = !!content && this.stripFormatting(content).trim().length > 0;
    const hasTodos = todos.some((todo) => typeof todo?.text === 'string' && todo.text.trim().length > 0);
    const seededTitle = hasTitle ? trimmedTitle : (!hasContent && !hasTodos ? 'Untitled note' : '');
    const note: Note = {
      id,
      title: seededTitle,
      content,
      todos,
      status: initial?.status || 'active',
      createdAt: now,
      updatedAt: now,
    };
    if (this.preferRemote) {
      try {
        this.beginSave();
        const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/notes`, {
          title: note.title?.trim() || undefined,
          content: note.content || undefined,
          todos: note.todos && note.todos.length ? note.todos : undefined,
        }, { withCredentials: true }));
        const saved: Note = res.data;
        this.preferRemote = true; this.syncMode = 'remote'; this.lastError = null;
        this.cache[saved.id] = saved;
        this.persist();
        this.endSave();
        this.emitNoteChange(saved);
        return saved;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    this.cache[id] = note; this.persist(); this.emitNoteChange(note); return note;
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
        this.cache[saved.id] = saved; this.persist(); this.endSave(); this.emitNoteChange(saved);
        return saved;
      } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    note.updatedAt = this.now(); this.cache[note.id] = { ...note }; this.persist(); this.emitNoteChange(this.cache[note.id]); return note;
  }

  async archive(id: string) {
    if (this.preferRemote) {
      try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/notes/${id}/archive`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    const n = this.cache[id]; if (n) { n.status = 'archived'; n.updatedAt = this.now(); this.persist(); this.emitNoteChange({ ...n }); }
  }
  async restore(id: string) {
    if (this.preferRemote) {
      try { this.beginSave(); await firstValueFrom(this.http.post(`${API_BASE}/v1/notes/${id}/restore`, {}, { withCredentials: true })); this.endSave(); } catch (e) { this.endSave(e); this.switchToLocal(e); }
    }
    const n = this.cache[id]; if (n) { n.status = 'active'; n.updatedAt = this.now(); this.persist(); this.emitNoteChange({ ...n }); }
  }
  async softDelete(id: string) {
    if (this.preferRemote) {
      try {
        this.beginSave();
        await firstValueFrom(this.http.delete(`${API_BASE}/v1/notes/${id}`, { withCredentials: true }));
        this.endSave();
      } catch (e) {
        this.endSave(e);
        this.switchToLocal(e);
      }
    }
    const n = this.cache[id];
    if (n) {
      n.status = 'deleted';
      n.updatedAt = this.now();
      this.persist();
    }
    this.evictDatabasesForNote(id);
    if (n) this.emitNoteChange({ ...n });
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
  purge(id: string) {
    delete this.cache[id];
    this.evictDatabasesForNote(id);
    this.persist();
  }

  async uploadImage(noteId: string, blockId: string, file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    if (noteId) form.append('noteId', noteId);
    if (blockId) form.append('blockId', blockId);
    const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/assets/images`, form, { withCredentials: true }));
    return res?.data as { id: string; url: string; fileName: string; mimeType: string; size: number };
  }

  async previewBookmark(url: string): Promise<BookmarkPreview> {
    const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/bookmarks/preview`, { url }, { withCredentials: true }));
    return res?.data as BookmarkPreview;
  }

  async createDatabase(noteId: string, options?: { title?: string; view?: 'table' | 'list'; filters?: any; sorts?: any }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/databases`, {
      noteId,
      title: options?.title,
      view: options?.view,
      filters: options?.filters,
      sorts: options?.sorts,
    }, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async getDatabase(id: string, force = false): Promise<NoteDatabase | undefined> {
    if (!force && this.databaseCache.has(id)) return this.databaseCache.get(id);
    try {
      const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/databases/${id}`, { withCredentials: true }));
      if (!res?.data) {
        this.databaseCache.delete(id);
        return undefined;
      }
      return this.adaptDatabase(res.data);
    } catch (err) {
      this.databaseCache.delete(id);
      throw err;
    }
  }

  async updateDatabase(id: string, patch: { title?: string; view?: 'table' | 'list'; filters?: any; sorts?: any }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.patch<any>(`${API_BASE}/v1/databases/${id}`, patch, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async createDatabaseColumn(databaseId: string, input: { name: string; type: string; position?: number; config?: any }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/databases/${databaseId}/columns`, input, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async updateDatabaseColumn(databaseId: string, columnId: string, patch: { name?: string; type?: string; position?: number; config?: any }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.patch<any>(`${API_BASE}/v1/databases/${databaseId}/columns/${columnId}`, patch, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async deleteDatabaseColumn(databaseId: string, columnId: string): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.delete<any>(`${API_BASE}/v1/databases/${databaseId}/columns/${columnId}`, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async createDatabaseRow(databaseId: string, input: { position?: number; values?: Record<string, any> }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.post<any>(`${API_BASE}/v1/databases/${databaseId}/rows`, input, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async updateDatabaseRow(databaseId: string, rowId: string, input: { position?: number; values?: Record<string, any> }): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.patch<any>(`${API_BASE}/v1/databases/${databaseId}/rows/${rowId}`, input, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async deleteDatabaseRow(databaseId: string, rowId: string): Promise<NoteDatabase> {
    const res = await firstValueFrom(this.http.delete<any>(`${API_BASE}/v1/databases/${databaseId}/rows/${rowId}`, { withCredentials: true }));
    return this.adaptDatabase(res?.data);
  }

  async search(query: string): Promise<NoteSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    if (this.preferRemote) {
      try {
        const res = await firstValueFrom(this.http.get<any>(`${API_BASE}/v1/search`, { params: { q: trimmed }, withCredentials: true }));
        if (Array.isArray(res?.data)) {
          return res.data.map((r: any) => ({
            id: r.id,
            title: r.title || '',
            snippet: r.snippet || '',
            updatedAt: r.updatedAt,
          }) as NoteSearchResult);
        }
      } catch (e) {
        this.switchToLocal(e);
      }
    }
    const fallback = Object.values(this.cache)
      .filter(n => {
        const haystack = `${n.title || ''} ${n.content || ''}`.toLowerCase();
        return haystack.includes(trimmed.toLowerCase());
      })
      .slice(0, 20)
      .map(n => ({
        id: n.id,
        title: n.title || 'Untitled',
        snippet: this.previewContent(n.content, 160) || (n.title || 'Untitled'),
        updatedAt: n.updatedAt,
      }));
    return fallback;
  }

  async export(noteId: string): Promise<Blob> {
    const res = await firstValueFrom(this.http.get(`${API_BASE}/v1/notes/${noteId}/export`, {
      withCredentials: true,
      responseType: 'blob' as const,
    }));
    return res;
  }

  private evictDatabasesForNote(noteId: string) {
    for (const [databaseId, database] of this.databaseCache.entries()) {
      if (database.noteId === noteId) {
        this.databaseCache.delete(databaseId);
      }
    }
  }

  private adaptDatabase(payload: any): NoteDatabase {
    if (!payload) {
      throw new Error('Invalid database payload');
    }
    const view = payload.view === 'list' ? 'list' : 'table';
    const columns: NoteDatabaseColumn[] = Array.isArray(payload.columns)
      ? payload.columns.map((c: any) => ({
          id: c.id,
          databaseId: c.databaseId,
          name: c.name,
          type: c.type,
          position: c.position ?? 0,
          config: this.parseJSONOrUndefined(c.config),
        }))
      : [];
    const rows: NoteDatabaseRow[] = Array.isArray(payload.rows)
      ? payload.rows.map((r: any) => ({
          id: r.id,
          databaseId: r.databaseId,
          position: r.position ?? 0,
          values: r.values || {},
        }))
      : [];
    const db: NoteDatabase = {
      id: payload.id,
      noteId: payload.noteId,
      title: payload.title ?? null,
      view,
      filters: this.parseJSONOrUndefined(payload.filters),
      sorts: this.parseJSONOrUndefined(payload.sorts),
      columns,
      rows,
    };
    this.databaseCache.set(db.id, db);
    return db;
  }

  private parseJSONOrUndefined(value: any) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === 'null') return undefined;
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return value;
  }

  // Strip block document / HTML / Markdown formatting so we can detect meaningful text content.
  private stripFormatting(raw: string): string {
    if (!raw) return '';
    const json = this.tryParseEditorDocument(raw);
    if (json) {
      const text = json.blocks
        .map((block: any) => {
          if (block.type === 'code') return block.code || '';
          if (block.type === 'todo') return `${block.checked ? '[x]' : '[ ]'} ${this.stripHtml(block.html || '')}`;
          if (block.type === 'divider') return '';
          if (block.type === 'image') return block.caption || '';
          if (block.type === 'bookmark') {
            if (block.bookmark?.title) return block.bookmark.title;
            return block.caption || block.url || '';
          }
          if (block.type === 'database') return '[database]';
          return this.stripHtml(block.html || '');
        })
        .join(' ');
      return text.trim();
    }
    try {
      let t = raw || '';
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
    } catch {
      return (raw || '').trim();
    }
  }

  private tryParseEditorDocument(raw: string): { blocks: any[] } | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.blocks)) return parsed as { blocks: any[] };
    } catch {
      return null;
    }
    return null;
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  previewContent(raw?: string, limit = 120): string {
    if (!raw) return '';
    const text = this.stripFormatting(raw);
    if (!text) return '';
    const trimmed = text.slice(0, limit).trim();
    return text.length > limit ? `${trimmed}…` : trimmed;
  }

  private emitNoteChange(note: Note) {
    this.noteUpdates.next({ ...note });
  }
}

function normalizeBase(base: string): string {
  if (!base) return '';
  return base.replace(/\/+$/, '');
}

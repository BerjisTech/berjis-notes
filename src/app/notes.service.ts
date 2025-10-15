import { Injectable } from '@angular/core';

export type NoteStatus = 'active' | 'archived' | 'deleted';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Note {
  id: string;
  title?: string;
  content?: string; // HTML stored from contenteditable
  todos?: TodoItem[];
  status: NoteStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

const STORAGE_KEY = 'berjis-notes';

@Injectable({ providedIn: 'root' })
export class NotesService {
  private cache: Record<string, Note> = {};

  constructor() {
    this.load();
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

  list(status: NoteStatus[] = ['active']): Note[] {
    return Object.values(this.cache)
      .filter(n => status.includes(n.status))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  get(id: string): Note | undefined { return this.cache[id]; }

  create(initial?: Partial<Note>): Note {
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
    this.cache[id] = note;
    this.persist();
    return note;
  }

  /** Save a note if it has any content (title, content HTML, or todos). */
  save(note: Note): Note | undefined {
    const hasTitle = !!note.title && note.title.trim().length > 0;
    const hasContent = !!note.content && note.content.replace(/<[^>]*>/g, '').trim().length > 0; // strip HTML
    const hasTodos = !!note.todos && note.todos.some(t => t.text.trim().length > 0);
    if (!hasTitle && !hasContent && !hasTodos) {
      // If empty and exists, do not create/save; if it existed, leave untouched.
      return undefined;
    }
    note.updatedAt = this.now();
    this.cache[note.id] = { ...note };
    this.persist();
    return note;
  }

  archive(id: string) { const n = this.cache[id]; if (n) { n.status = 'archived'; n.updatedAt = this.now(); this.persist(); } }
  restore(id: string) { const n = this.cache[id]; if (n) { n.status = 'active'; n.updatedAt = this.now(); this.persist(); } }
  softDelete(id: string) { const n = this.cache[id]; if (n) { n.status = 'deleted'; n.updatedAt = this.now(); this.persist(); } }
  purge(id: string) { delete this.cache[id]; this.persist(); }
}


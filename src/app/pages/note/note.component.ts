import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockEditorComponent } from '../../components/block-editor/block-editor.component';
import { EditorDocument } from '../../editor/editor.types';
import { deserializeDocument, serializeDocument, createBlock } from '../../editor/editor.utils';
import { Note, NotesService } from '../../notes.service';

interface PageProperty {
  id: string;
  name: string;
  type: 'text' | 'date' | 'select' | 'multi-select' | 'number' | 'checkbox';
  value: any;
}

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `prop_${Math.random().toString(36).slice(2, 10)}`;

@Component({
  standalone: true,
  selector: 'app-note',
  imports: [CommonModule, FormsModule, BlockEditorComponent],
  templateUrl: './note.component.html',
  styleUrls: ['./note.component.css'],
})
export class NotePageComponent implements OnInit, OnDestroy {
  note: Note | null = null;
  document: EditorDocument = { version: 1, blocks: [createBlock('paragraph')] };
  properties: PageProperty[] = [];
  isLoading = false;
  pendingSave?: number;
  routeSub?: Subscription;

  coverImage: string | null = null;
  pageIcon: string = '📝';
  darkMode = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public notes: NotesService,
  ) {}

  ngOnInit(): void {
    this.darkMode = localStorage.getItem('notes-dark-mode') === '1';
    this.routeSub = this.route.paramMap.subscribe(async (pm) => {
      const id = pm.get('id') || 'new';
      await this.loadNote(id);
    });
  }

  ngOnDestroy(): void {
    if (this.pendingSave) window.clearTimeout(this.pendingSave);
    this.routeSub?.unsubscribe();
  }

  async loadNote(id: string) {
    this.isLoading = true;
    try {
      let note: Note | undefined;
      if (id === 'new') {
        note = await this.notes.create();
        if (note.id) {
          await this.router.navigate(['/note', note.id]);
          return;
        }
      } else {
        note = await this.notes.fetch(id);
        if (!note) {
          note = await this.notes.create({ id });
        }
      }
      if (!note) return;
      this.note = note;
      const doc = deserializeDocument(note.content);
      this.document = {
        version: doc.version || 1,
        blocks: doc.blocks.length ? doc.blocks : [createBlock('paragraph')],
        meta: doc.meta,
      };
      this.coverImage = doc.meta?.coverImage ?? null;
      this.pageIcon = doc.meta?.icon ?? '📝';
      this.properties = this.buildPropertiesFromMeta(doc.meta);
    } finally {
      this.isLoading = false;
    }
  }

  onTitleChange() {
    this.queueSave();
  }

  onDocumentChange(doc: EditorDocument) {
    this.document = {
      ...doc,
      meta: {
        ...(doc.meta ?? {}),
        icon: this.pageIcon,
        coverImage: this.coverImage ?? undefined,
        properties: this.toMetaProperties(),
      },
    };
    this.queueSave();
  }

  onPropertyChange(property: PageProperty) {
    property.value = this.normalisePropertyValue(property);
    this.syncDocumentMeta();
    this.queueSave();
  }

  addProperty() {
    const name = prompt('Property name');
    if (!name) return;
    this.properties.push({
      id: createId(),
      name,
      type: 'text',
      value: '',
    });
    this.syncDocumentMeta();
    this.queueSave();
  }

  removeProperty(property: PageProperty) {
    this.properties = this.properties.filter((p) => p.id !== property.id);
    this.syncDocumentMeta();
    this.queueSave();
  }

  changePropertyType(property: PageProperty, type: PageProperty['type']) {
    property.type = type;
    property.value = this.normalisePropertyValue(property);
    this.syncDocumentMeta();
    this.queueSave();
  }

  changeIcon() {
    const next = prompt('Paste an emoji or short icon', this.pageIcon);
    if (!next) return;
    this.pageIcon = next.trim().slice(0, 4) || this.pageIcon;
    this.syncDocumentMeta();
    this.queueSave();
  }

  setCover() {
    const url = prompt('Cover image URL', this.coverImage ?? '');
    if (url === null) return;
    this.coverImage = url.trim() ? url.trim() : null;
    this.syncDocumentMeta();
    this.queueSave();
  }

  removeCover() {
    this.coverImage = null;
    this.syncDocumentMeta();
    this.queueSave();
  }

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem('notes-dark-mode', this.darkMode ? '1' : '0');
  }

  archive() {
    if (this.note) this.notes.archive(this.note.id);
  }

  restore() {
    if (this.note) this.notes.restore(this.note.id);
  }

  softDelete() {
    if (this.note) this.notes.softDelete(this.note.id);
  }
  async exportMarkdown() {
    if (!this.note) return;
    try {
      const blob = await this.notes.export(this.note.id);
      const fileName = (this.note.title?.trim() || 'note') + '.md';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('export failed', err);
    }
  }

  get lastSavedLabel(): string {
    if (this.notes.isSaving) return 'Saving...';
    if (this.notes.lastSavedAt) return `Saved ${new Date(this.notes.lastSavedAt).toLocaleTimeString()}`;
    return this.notes.syncMode === 'local' ? 'Offline mode' : 'All changes saved';
  }

  private queueSave() {
    if (!this.note) return;
    if (this.pendingSave) window.clearTimeout(this.pendingSave);
    this.pendingSave = window.setTimeout(() => this.persist(), 400);
  }

  private async persist() {
    if (!this.note) return;
    const meta = {
      ...(this.document.meta ?? {}),
      icon: this.pageIcon,
      coverImage: this.coverImage ?? undefined,
      properties: this.toMetaProperties(),
    };
    const doc: EditorDocument = {
      version: this.document.version ?? 1,
      blocks: this.document.blocks,
      meta,
    };
    this.note.content = serializeDocument(doc);
    const saved = await this.notes.save(this.note);
    if (saved) this.note = saved;
  }

  private buildPropertiesFromMeta(meta: EditorDocument['meta']): PageProperty[] {
    if (!meta?.properties) {
      return [
        {
          id: 'Created',
          name: 'Created',
          type: 'date',
          value: this.note?.createdAt ?? new Date().toISOString(),
        },
        {
          id: 'Last Edited',
          name: 'Last Edited',
          type: 'date',
          value: this.note?.updatedAt ?? new Date().toISOString(),
        },
      ];
    }
    return Object.entries(meta.properties).map(([key, prop]) => ({
      id: key,
      name: key,
      type: prop.type,
      value: prop.value,
    }));
  }

  private toMetaProperties(): Record<string, { type: PageProperty['type']; value: any }> {
    const entries: Record<string, { type: PageProperty['type']; value: any }> = {};
    for (const property of this.properties) {
      const key = property.name || property.id;
      entries[key] = {
        type: property.type,
        value: property.value,
      };
    }
    return entries;
  }

  private normalisePropertyValue(property: PageProperty) {
    if (property.type === 'checkbox') return Boolean(property.value);
    if (property.type === 'number') {
      const parsed = Number(property.value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return property.value;
  }

  private syncDocumentMeta() {
    this.document = {
      ...this.document,
      meta: {
        ...(this.document.meta ?? {}),
        icon: this.pageIcon,
        coverImage: this.coverImage ?? undefined,
        properties: this.toMetaProperties(),
      },
    };
  }
}


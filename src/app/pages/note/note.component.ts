import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BlockEditorComponent } from '../../components/block-editor/block-editor.component';
import { EditorDocument, EditorDocumentMeta } from '../../editor/editor.types';
import { deserializeDocument, serializeDocument, createBlock } from '../../editor/editor.utils';
import { Note, NotesService } from '../../notes.service';

interface PageProperty {
  id: string;
  name: string;
  type: 'text' | 'date' | 'select' | 'multi-select' | 'number' | 'checkbox';
  value: any;
}

interface PropertyTemplate {
  label: string;
  type: PageProperty['type'];
  description: string;
  initialValue?: any;
}

interface CoverLibraryItem {
  label: string;
  url: string;
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
  noteSub?: Subscription;

  coverImage: string | null = null;
  pageIcon: string = '📝';
  darkMode = false;
  propertyMenuOpen = false;
  coverMenuOpen = false;
  coverUploading = false;
  coverUploadError: string | null = null;
  // Share modal
  shareOpen = false;
  shareRows: { userId: string; role: 'viewer'|'commenter'|'editor' }[] = [];
  shareUserId = '';
  shareRole: 'viewer'|'commenter'|'editor' = 'viewer';

  readonly propertyTemplates: PropertyTemplate[] = [
    { label: 'Text', type: 'text', description: 'Plain text value' },
    { label: 'Date', type: 'date', description: 'Calendar date' },
    { label: 'Number', type: 'number', description: 'Numeric field' },
    { label: 'Checkbox', type: 'checkbox', description: 'True or false' },
    { label: 'Select', type: 'select', description: 'Single choice list' },
    { label: 'Multi-select', type: 'multi-select', description: 'Tag multiple options' },
  ];

  readonly coverLibrary: CoverLibraryItem[] = [
    {
      label: 'Aurora',
      url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80',
    },
    {
      label: 'Ocean',
      url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80',
    },
    {
      label: 'Desert',
      url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80',
    },
    {
      label: 'Forest',
      url: 'https://images.unsplash.com/photo-1482192597420-4817fdd7e8b0?auto=format&fit=crop&w=1600&q=80',
    },
  ];

  @ViewChild('propertyMenu') propertyMenu?: ElementRef<HTMLDivElement>;
  @ViewChild('propertyTrigger') propertyTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('coverMenu') coverMenu?: ElementRef<HTMLDivElement>;
  @ViewChild('coverTrigger') coverTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('coverUploadInput') coverUploadInput?: ElementRef<HTMLInputElement>;

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
    this.noteSub = this.notes.noteChanges$.subscribe((updated) => {
      if (!this.note || updated.id !== this.note.id) return;
      this.note = { ...this.note, ...updated };
      this.refreshSystemProperties();
    });
  }

  ngOnDestroy(): void {
    if (this.pendingSave) window.clearTimeout(this.pendingSave);
    this.routeSub?.unsubscribe();
    this.noteSub?.unsubscribe();
  }

  // Share helpers
  openShare(){ this.shareOpen = true; this.loadCollaborators(); }
  private get id(): string | null { return this.note?.id ?? null; }
  async loadCollaborators(){ const id=this.id; if(!id){ this.shareRows=[]; return; } try { const res=await fetch(`/v1/notes/${encodeURIComponent(id)}/collaborators`, { credentials:'include' }); const j=await res.json(); const rows=(j?.data||[]) as any[]; this.shareRows = rows.map(r => ({ userId: r.userId||r.user_id, role: (r.role||'viewer') })); } catch { this.shareRows=[]; } }
  async addCollaborator(){ const id=this.id; if(!id) return; const userId=this.shareUserId.trim(); if(!userId) return; const role=this.shareRole; await fetch(`/v1/notes/${encodeURIComponent(id)}/collaborators`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, role }) }); this.shareUserId=''; await this.loadCollaborators(); }
  async removeCollaborator(uid: string){ const id=this.id; if(!id) return; await fetch(`/v1/notes/${encodeURIComponent(id)}/collaborators?user_id=${encodeURIComponent(uid)}`, { method:'DELETE', credentials:'include' }); await this.loadCollaborators(); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.propertyMenuOpen && !this.isInsideInteractiveArea(target, this.propertyMenu, this.propertyTrigger)) {
      this.propertyMenuOpen = false;
    }
    if (this.coverMenuOpen && !this.isInsideInteractiveArea(target, this.coverMenu, this.coverTrigger)) {
      this.coverMenuOpen = false;
    }
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
      this.refreshSystemProperties();
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
    this.propertyMenuOpen = !this.propertyMenuOpen;
    if (this.propertyMenuOpen) this.coverMenuOpen = false;
  }

  addPropertyFromTemplate(template: PropertyTemplate) {
    const property = this.createPropertyFromTemplate(template);
    this.properties = [...this.properties, property];
    this.propertyMenuOpen = false;
    this.syncDocumentMeta();
    this.queueSave();
  }

  removeProperty(property: PageProperty) {
    if (this.isSystemDateProperty(property)) return;
    this.properties = this.properties.filter((p) => p.id !== property.id);
    this.syncDocumentMeta();
    this.queueSave();
  }

  changePropertyType(property: PageProperty, type: PageProperty['type']) {
    if (this.isSystemDateProperty(property)) return;
    property.type = type;
    property.value = this.defaultValueForType(type);
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
    this.coverMenuOpen = !this.coverMenuOpen;
    if (this.coverMenuOpen) {
      this.propertyMenuOpen = false;
      this.coverUploadError = null;
    }
  }

  removeCover() {
    this.coverImage = null;
    this.coverMenuOpen = false;
    this.syncDocumentMeta();
    this.queueSave();
  }

  triggerCoverUpload() {
    if (this.coverUploading) return;
    this.coverMenuOpen = false;
    this.coverUploadError = null;
    this.coverUploadInput?.nativeElement?.click();
  }

  async onCoverFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || !this.note) {
      if (input) input.value = '';
      return;
    }
    if (input) input.value = '';
    this.coverUploading = true;
    this.coverUploadError = null;
    try {
      const uploaded = await this.notes.uploadImage(this.note.id, 'cover', file);
      if (uploaded?.url) {
        this.coverImage = uploaded.url;
        this.syncDocumentMeta();
        this.queueSave();
      }
    } catch (err: any) {
      console.error('cover upload failed', err);
      this.coverUploadError = err?.message || 'Failed to upload cover image';
    } finally {
      this.coverUploading = false;
    }
  }

  setCoverFromLibrary(url: string) {
    this.coverImage = url;
    this.coverMenuOpen = false;
    this.coverUploadError = null;
    this.syncDocumentMeta();
    this.queueSave();
  }

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem('notes-dark-mode', this.darkMode ? '1' : '0');
  }

  async archive() {
    if (!this.note) return;
    await this.notes.archive(this.note.id);
    const latest = this.notes.get(this.note.id);
    if (latest) this.note = { ...this.note, ...latest };
    else this.note = { ...this.note, status: 'archived', updatedAt: new Date().toISOString() };
    this.refreshSystemProperties();
  }

  async restore() {
    if (!this.note) return;
    await this.notes.restore(this.note.id);
    const latest = this.notes.get(this.note.id);
    if (latest) this.note = { ...this.note, ...latest };
    else this.note = { ...this.note, status: 'active', updatedAt: new Date().toISOString() };
    this.refreshSystemProperties();
  }

  async softDelete() {
    if (!this.note) return;
    await this.notes.softDelete(this.note.id);
    const latest = this.notes.get(this.note.id);
    if (latest) this.note = { ...this.note, ...latest };
    else this.note = { ...this.note, status: 'deleted', updatedAt: new Date().toISOString() };
    this.refreshSystemProperties();
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
    this.refreshSystemProperties();
  }

  private buildPropertiesFromMeta(meta: EditorDocument['meta']): PageProperty[] {
    let props: PageProperty[] = [];
    if (meta?.properties) {
      props = Object.entries(meta.properties).map(([key, prop]) => ({
        id: key,
        name: key,
        type: prop.type,
        value: prop.value,
      }));
    }
    props = this.mergeSystemProperty(props, 'Last Edited', this.note?.updatedAt ?? new Date().toISOString());
    props = this.mergeSystemProperty(props, 'Created', this.note?.createdAt ?? new Date().toISOString());
    return props;
  }

  isSystemDateProperty(property: PageProperty): boolean {
    const key = this.normalisePropertyKey(property.name || property.id);
    return key === 'created' || key === 'last edited';
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

  private mergeSystemProperty(props: PageProperty[], label: string, value: string): PageProperty[] {
    const key = this.normalisePropertyKey(label);
    const idx = props.findIndex((prop) => this.normalisePropertyKey(prop.name || prop.id) === key);
    const normalisedValue = value || new Date().toISOString();
    if (idx >= 0) {
      const next = [...props];
      next[idx] = {
        ...next[idx],
        id: label,
        name: label,
        type: 'date',
        value: normalisedValue,
      };
      return next;
    }
    return [
      {
        id: label,
        name: label,
        type: 'date',
        value: normalisedValue,
      },
      ...props,
    ];
  }

  private createPropertyFromTemplate(template: PropertyTemplate): PageProperty {
    return {
      id: createId(),
      name: this.generatePropertyName(template.label),
      type: template.type,
      value: template.initialValue ?? this.defaultValueForType(template.type),
    };
  }

  private generatePropertyName(base: string): string {
    const existing = new Set(this.properties.map((prop) => this.normalisePropertyKey(prop.name || prop.id)));
    let candidate = base;
    let suffix = 2;
    while (existing.has(this.normalisePropertyKey(candidate))) {
      candidate = `${base} ${suffix++}`;
    }
    return candidate;
  }

  private defaultValueForType(type: PageProperty['type']) {
    switch (type) {
      case 'checkbox':
        return false;
      case 'number':
        return null;
      default:
        return '';
    }
  }

  private refreshSystemProperties() {
    this.properties = this.mergeSystemProperty(
      this.mergeSystemProperty(this.properties, 'Last Edited', this.note?.updatedAt ?? new Date().toISOString()),
      'Created',
      this.note?.createdAt ?? new Date().toISOString(),
    );
    this.syncDocumentMeta();
  }

  private normalisePropertyKey(value?: string): string {
    return (value || '').trim().toLowerCase();
  }

  private isInsideInteractiveArea(
    target: HTMLElement,
    menu?: ElementRef<HTMLElement>,
    trigger?: ElementRef<HTMLElement>,
  ): boolean {
    if (menu?.nativeElement && menu.nativeElement.contains(target)) return true;
    if (trigger?.nativeElement && trigger.nativeElement.contains(target)) return true;
    return false;
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
    const nextMeta: EditorDocumentMeta = {
      ...(this.document.meta ?? {}),
      icon: this.pageIcon,
      properties: this.toMetaProperties(),
    };
    if (this.coverImage) {
      nextMeta.coverImage = this.coverImage;
    } else {
      delete nextMeta.coverImage;
    }
    this.document.meta = nextMeta;
  }
}

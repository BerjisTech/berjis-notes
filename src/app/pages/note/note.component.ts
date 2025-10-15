import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Note, NotesService, TodoItem } from '../../notes.service';

@Component({
  standalone: true,
  selector: 'app-note',
  imports: [CommonModule, FormsModule],
  templateUrl: './note.component.html'
})
export class NotePageComponent implements OnInit, OnDestroy {
  @ViewChild('editor', { static: true }) editorRef!: ElementRef<HTMLDivElement>;

  note: Note | null = null;
  pendingSave?: any;
  colorPickerOpen = false;
  emojiPickerOpen = false;

  foreColor = '#000000';
  backColor = '#ffff00';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private notes: NotesService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || 'new';
    if (id !== 'new') {
      const existing = this.notes.get(id);
      this.note = existing || this.notes.create({ id });
    } else {
      // Lazy-create when user types a title/content/todo
      this.note = {
        id: 'new',
        title: '',
        content: '',
        todos: [],
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    // Initialize editor HTML
    setTimeout(() => {
      if (this.editorRef && this.note) this.editorRef.nativeElement.innerHTML = this.note.content || '';
    });
  }

  ngOnDestroy(): void {
    if (this.pendingSave) clearTimeout(this.pendingSave);
  }

  onTitleChange() { this.queueSave(); }

  onEditorInput() {
    if (!this.note) return;
    this.note.content = this.editorRef.nativeElement.innerHTML;
    this.queueSave();
  }

  addTodo() {
    if (!this.note) return;
    const item: TodoItem = { id: this.uuid(), text: '', done: false };
    this.note.todos = this.note.todos || [];
    this.note.todos.push(item);
    this.queueSave();
  }

  removeTodo(id: string) {
    if (!this.note?.todos) return;
    this.note.todos = this.note.todos.filter(t => t.id !== id);
    this.queueSave();
  }

  toggleTodo(t: TodoItem) { t.done = !t.done; this.queueSave(); }
  onTodoTextChange() { this.queueSave(); }

  private queueSave() {
    if (!this.note) return;
    if (this.pendingSave) clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => this.save(), 400);
  }

  private ensureCreatedId() {
    if (this.note && this.note.id === 'new') {
      const hasTitle = !!this.note.title && this.note.title.trim().length > 0;
      const hasContent = !!this.note.content && this.note.content.replace(/<[^>]*>/g, '').trim().length > 0;
      const hasTodos = !!this.note.todos && this.note.todos.some(t => t.text.trim().length > 0);
      if (hasTitle || hasContent || hasTodos) {
        const created = this.notes.create({
          title: this.note.title,
          content: this.note.content,
          todos: this.note.todos,
        });
        this.note = created;
        // Navigate to actual id route silently
        this.router.navigate(['/note', created.id], { replaceUrl: true });
      }
    }
  }

  private save() {
    if (!this.note) return;
    this.ensureCreatedId();
    if (!this.note) return;
    this.notes.save(this.note);
  }

  exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    this.onEditorInput();
  }

  applyBlock(tag: string) {
    document.execCommand('formatBlock', false, tag);
    this.onEditorInput();
  }

  insertLink() {
    const url = prompt('Enter URL');
    if (url) this.exec('createLink', url);
  }

  unlink() { this.exec('unlink'); }

  insertImage(files?: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        document.execCommand('insertImage', false, dataUrl);
        this.onEditorInput();
      };
      reader.readAsDataURL(f);
    } else {
      const name = f.name;
      document.execCommand('insertText', false, `Attachment: ${name} `);
      this.onEditorInput();
    }
  }

  insertEmoji(e: string) {
    document.execCommand('insertText', false, e);
    this.emojiPickerOpen = false;
    this.onEditorInput();
  }

  resetFormatting() { this.exec('removeFormat'); }

  softDelete() {
    if (!this.note) return;
    if (confirm('Move note to Trash?')) {
      this.notes.softDelete(this.note.id);
      this.router.navigate(['/']);
    }
  }

  archive() {
    if (!this.note) return;
    this.notes.archive(this.note.id);
    this.router.navigate(['/']);
  }

  keydown(e: KeyboardEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); this.exec('bold'); }
    if (key === 'i') { e.preventDefault(); this.exec('italic'); }
    if (key === 'u') { e.preventDefault(); this.exec('underline'); }
    if (key === 'z') { e.preventDefault(); this.exec('undo'); }
    if (key === 'y') { e.preventDefault(); this.exec('redo'); }
  }

  private uuid(): string { return 't_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

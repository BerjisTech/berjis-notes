import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BlockType, EditorBlock, EditorDocument, BookmarkPreview } from '../../editor/editor.types';
import { DatabaseBlockComponent } from '../database-block/database-block.component';
import { cloneBlocks, createBlock } from '../../editor/editor.utils';
import { NotesService } from '../../notes.service';

interface SlashCommand {
  label: string;
  description: string;
  type: BlockType;
  icon: string;
}

@Component({
  standalone: true,
  selector: 'app-block-editor',
  imports: [CommonModule, FormsModule, DatabaseBlockComponent],
  templateUrl: './block-editor.component.html',
  styleUrls: ['./block-editor.component.css'],
})
export class BlockEditorComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChildren('blockContent') blockContentEls!: QueryList<ElementRef<HTMLElement>>;

  private _document: EditorDocument | null = null;

  @Input() noteId: string | null = null;

  @Input()
  set document(doc: EditorDocument | null) {
    this._document = doc;
    this.blocks = doc ? cloneBlocks(doc.blocks) : [createBlock('paragraph')];
    queueMicrotask(() => this.ensureAtLeastOneBlock());
    this.blocks.forEach((block) => {
      if (block.type === 'database') {
        const view = (block.view as any) || (block.props?.['view'] as any);
        block.view = view === 'list' ? 'list' : 'table';
        block.props = { ...(block.props || {}), view: block.view };
        if (!block.databaseId) {
          void this.ensureDatabase(block);
        }
      }
      if (block.type === 'bookmark' && block.bookmark && typeof block.bookmark !== 'object') {
        block.bookmark = undefined;
      }
    });
  }

  get document(): EditorDocument | null { return this._document; }

  @Output() documentChange = new EventEmitter<EditorDocument>();

  blocks: EditorBlock[] = [createBlock('paragraph')];
  activeBlockId: string | null = null;
  dragBlockId: string | null = null;
  slashOpen = false;
  slashBlockId: string | null = null;
  slashCommands: SlashCommand[] = [
    { label: 'Text', description: 'Paragraph text', type: 'paragraph', icon: 'T' },
    { label: 'Heading 1', description: 'Large section title', type: 'heading-1', icon: 'H1' },
    { label: 'Heading 2', description: 'Medium section title', type: 'heading-2', icon: 'H2' },
    { label: 'Heading 3', description: 'Small section title', type: 'heading-3', icon: 'H3' },
    { label: 'Bulleted list', description: 'Create a simple list', type: 'bulleted-list', icon: '•' },
    { label: 'Numbered list', description: 'Create an ordered list', type: 'numbered-list', icon: '1.' },
    { label: 'To-do', description: 'Track tasks with checkboxes', type: 'todo', icon: '☑︎' },
    { label: 'Quote', description: 'Capture a quote', type: 'quote', icon: '❝' },
    { label: 'Callout', description: 'Highlight information', type: 'callout-info', icon: '★' },
    { label: 'Warning', description: 'Important warning callout', type: 'callout-warning', icon: '⚠︎' },
    { label: 'Success', description: 'Success callout', type: 'callout-success', icon: '✓' },
    { label: 'Code', description: 'Capture code snippet', type: 'code', icon: '</>' },
    { label: 'Divider', description: 'Visual divider', type: 'divider', icon: '—' },
    { label: 'Image', description: 'Upload or paste images', type: 'image', icon: '🖼️' },
    { label: 'Bookmark', description: 'Save a link preview', type: 'bookmark', icon: '🔗' },
    { label: 'Database', description: 'Structured table with rows and columns', type: 'database', icon: '▦' },
  ];

  slashX = 0;
  slashY = 0;
  slashQuery = '';
  typeOptions: { label: string; value: BlockType }[] = [
    { label: 'Paragraph', value: 'paragraph' },
    { label: 'Heading 1', value: 'heading-1' },
    { label: 'Heading 2', value: 'heading-2' },
    { label: 'Heading 3', value: 'heading-3' },
    { label: 'Bulleted list', value: 'bulleted-list' },
    { label: 'Numbered list', value: 'numbered-list' },
    { label: 'To-do', value: 'todo' },
    { label: 'Quote', value: 'quote' },
    { label: 'Callout (info)', value: 'callout-info' },
    { label: 'Callout (warning)', value: 'callout-warning' },
    { label: 'Callout (success)', value: 'callout-success' },
    { label: 'Code', value: 'code' },
    { label: 'Divider', value: 'divider' },
  { label: 'Image', value: 'image' },
  { label: 'Bookmark', value: 'bookmark' },
  { label: 'Database', value: 'database' },
];

  uploadingBlocks = new Set<string>();
  bookmarkLoadingBlocks = new Set<string>();
  bookmarkErrors: Record<string, string> = {};

  constructor(private notes: NotesService) {}

  private emitTimer?: number;

  ngAfterViewInit(): void {
    this.ensureAtLeastOneBlock();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['noteId'] && this.noteId) {
      for (const block of this.blocks) {
        if (block.type === 'database' && !block.databaseId) {
          void this.ensureDatabase(block);
        }
      }
    }
  }

  getNumberIndex(block: EditorBlock): number {
    let count = 1;
    for (const b of this.blocks) {
      if (b.id === block.id) return count;
      if (b.type === 'numbered-list') {
        count += 1;
      } else {
        count = 1;
      }
    }
    return count;
  }

  calloutTone(block: EditorBlock): { icon: string; className: string } {
    switch (block.type) {
      case 'callout-warning':
        return { icon: '⚠️', className: 'bg-amber-50 border border-amber-200 text-amber-900' };
      case 'callout-success':
        return { icon: '✅', className: 'bg-emerald-50 border border-emerald-200 text-emerald-900' };
      default:
        return { icon: '💡', className: 'bg-sky-50 border border-sky-200 text-sky-900' };
    }
  }

  ngOnDestroy(): void {
    if (this.emitTimer) window.clearTimeout(this.emitTimer);
  }

  trackBlock = (_: number, block: EditorBlock) => block.id;

  handleBlockFocus(block: EditorBlock) {
    this.activeBlockId = block.id;
  }

  handleInput(event: Event, block: EditorBlock) {
    if (block.type === 'code') {
      const target = event.target as HTMLTextAreaElement;
      block.code = target.value;
    } else if (block.type === 'image') {
      const target = event.target as HTMLInputElement;
      block.url = target.value;
    } else if (block.type === 'bookmark') {
      const target = event.target as HTMLInputElement;
      block.url = target.value;
    } else {
      const el = event.target as HTMLElement;
      block.html = el.innerHTML;
    }
    this.scheduleEmit();
    this.updateSlashState(block);
  }

  handleCheckboxChange(block: EditorBlock, checked: boolean) {
    block.checked = checked;
    this.scheduleEmit();
  }

  handleCaptionInput(event: Event, block: EditorBlock) {
    const target = event.target as HTMLElement | HTMLInputElement;
    block.caption = 'value' in target ? target.value : target.innerHTML;
    this.scheduleEmit();
  }

  async onImageFileSelected(event: Event, block: EditorBlock) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file || !this.noteId) {
      input.value = '';
      return;
    }
    this.uploadingBlocks.add(block.id);
    try {
      const uploaded = await this.notes.uploadImage(this.noteId, block.id, file);
      block.url = uploaded.url;
      if (!block.caption) block.caption = uploaded.fileName;
      this.scheduleEmit();
    } catch (err) {
      console.error('image upload failed', err);
    } finally {
      this.uploadingBlocks.delete(block.id);
      input.value = '';
    }
  }

  async fetchBookmarkPreview(block: EditorBlock) {
    if (!block.url || !block.url.trim()) return;
    this.bookmarkErrors[block.id] = '';
    this.bookmarkLoadingBlocks.add(block.id);
    try {
      const preview = await this.notes.previewBookmark(block.url.trim());
      block.bookmark = preview as BookmarkPreview;
      this.scheduleEmit();
    } catch (err: any) {
      this.bookmarkErrors[block.id] = err?.message || 'Unable to fetch preview';
    } finally {
      this.bookmarkLoadingBlocks.delete(block.id);
    }
  }

  resetBookmark(block: EditorBlock) {
    block.bookmark = undefined;
    this.scheduleEmit();
  }

  private async ensureDatabase(block: EditorBlock) {
    if (block.type !== 'database' || block.databaseId || !this.noteId) return;
    try {
      const database = await this.notes.createDatabase(this.noteId, { view: block.view === 'list' ? 'list' : 'table' });
      block.databaseId = database.id;
      block.view = database.view;
      block.props = { ...(block.props || {}), view: block.view, databaseId: database.id };
      this.scheduleEmit();
    } catch (err) {
      console.error('database creation failed', err);
    }
  }

  onDatabaseViewChange(block: EditorBlock, view: 'table' | 'list') {
    block.view = view;
    block.props = { ...(block.props || {}), view };
    this.scheduleEmit();
  }

  onDatabaseMutated() {
    this.scheduleEmit();
  }

  onKeyDown(event: KeyboardEvent, block: EditorBlock) {
    if (block.type === 'code') {
      if (event.key === 'Tab') {
        event.preventDefault();
        const target = event.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        target.setRangeText('  ', start, start, 'end');
        block.code = target.value;
        this.scheduleEmit();
      }
      return;
    }
    const isSlash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isSlash) {
      this.openSlash(block);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.splitBlock(block);
      return;
    }
    if (event.key === 'Backspace') {
      const el = this.getBlockElement(block.id);
      const selection = window.getSelection();
      if (!el || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const atStart = range.collapsed && this.isRangeAtStart(el, range);
      if (atStart) {
        if (this.handleBackspaceTransform(block)) {
          event.preventDefault();
          return;
        }
        const idx = this.blocks.findIndex((b) => b.id === block.id);
        if (idx > 0 && (block.html?.trim() ?? '') === '') {
          event.preventDefault();
          this.blocks.splice(idx, 1);
          this.focusBlockByIndex(idx - 1);
          this.scheduleEmit();
        }
      }
    }
    if (event.key === 'ArrowUp' && !event.shiftKey) {
      const idx = this.blocks.findIndex((b) => b.id === block.id);
      if (idx > 0) {
        event.preventDefault();
        this.focusBlockByIndex(idx - 1, 'end');
      }
    }
    if (event.key === 'ArrowDown' && !event.shiftKey) {
      const idx = this.blocks.findIndex((b) => b.id === block.id);
      if (idx < this.blocks.length - 1) {
        event.preventDefault();
        this.focusBlockByIndex(idx + 1, 'start');
      }
    }
  }

  handleBackspaceTransform(block: EditorBlock): boolean {
    if (
      (block.type === 'heading-1' || block.type === 'heading-2' || block.type === 'heading-3' ||
        block.type === 'quote' || block.type.startsWith('callout') ||
        block.type === 'bulleted-list' || block.type === 'numbered-list' || block.type === 'todo') &&
      !(block.html && block.html.length > 0)
    ) {
      block.type = 'paragraph';
      block.checked = false;
      block.html = '';
      this.scheduleEmit();
      return true;
    }
    return false;
  }

  splitBlock(block: EditorBlock) {
    const el = this.getBlockElement(block.id);
    if (!el) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.insertBlockAfter(block, createBlock(block.type === 'todo' ? 'todo' : 'paragraph'));
      return;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) {
      this.insertBlockAfter(block, createBlock('paragraph'));
      return;
    }
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(el);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(el);
    afterRange.setStart(range.endContainer, range.endOffset);

    const beforeHtml = this.fragmentToHtml(beforeRange.cloneContents());
    const afterHtml = this.fragmentToHtml(afterRange.cloneContents());

    block.html = beforeHtml;
    const newBlock = createBlock(block.type === 'todo' ? 'todo' : block.type === 'code' ? 'code' : 'paragraph');
    if (block.type === 'todo') {
      newBlock.type = 'todo';
      newBlock.checked = false;
      newBlock.html = afterHtml;
    } else if (block.type === 'bulleted-list' || block.type === 'numbered-list') {
      newBlock.type = block.type;
      newBlock.html = afterHtml;
    } else {
      newBlock.html = afterHtml;
    }

    this.insertBlockAfter(block, newBlock);
    queueMicrotask(() => this.focusBlock(newBlock.id));
  }

  insertBlockAfter(target: EditorBlock, newBlock: EditorBlock) {
    const idx = this.blocks.findIndex((b) => b.id === target.id);
    const insertAt = idx === -1 ? this.blocks.length : idx + 1;
    this.blocks.splice(insertAt, 0, newBlock);
    this.scheduleEmit();
  }

  fragmentToHtml(fragment: DocumentFragment): string {
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  isRangeAtStart(container: HTMLElement, range: Range) {
    const test = range.cloneRange();
    test.selectNodeContents(container);
    test.setEnd(range.endContainer, range.endOffset);
    const html = this.fragmentToHtml(test.cloneContents());
    return html.replace(/<br\s*\/?>/gi, '').trim().length === 0;
  }

  getBlockElement(id: string): HTMLElement | undefined {
    return this.blockContentEls.find((ref) => ref.nativeElement.dataset['blockId'] === id)?.nativeElement;
  }

  focusBlock(blockId: string) {
    const el = this.getBlockElement(blockId);
    if (el) {
      el.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.addRange(range);
      }
    }
  }

  focusBlockByIndex(index: number, pos: 'start' | 'end' = 'end') {
    const block = this.blocks[index];
    if (!block) return;
    const el = this.getBlockElement(block.id);
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(pos === 'start');
    selection.addRange(range);
  }

  removeBlock(block: EditorBlock) {
    if (this.blocks.length === 1) {
      block.type = 'paragraph';
      block.html = '';
      block.checked = false;
      block.code = '';
      return;
    }
    const idx = this.blocks.findIndex((b) => b.id === block.id);
    if (idx === -1) return;
    this.blocks.splice(idx, 1);
    const nextIndex = Math.min(idx, this.blocks.length - 1);
    queueMicrotask(() => this.focusBlockByIndex(nextIndex));
    this.scheduleEmit();
  }

  transformBlock(block: EditorBlock, nextType: BlockType) {
    if (block.type === nextType) return;
    const prevHtml = block.html;
    block.type = nextType;
    if (nextType === 'todo') {
      block.checked = false;
      block.html = prevHtml ?? '';
    } else if (nextType === 'code') {
      block.code = '';
      block.html = undefined;
    } else if (nextType === 'divider') {
      block.html = undefined;
    } else if (nextType.startsWith('callout')) {
      block.html = prevHtml ?? '';
    } else if (nextType === 'image' || nextType === 'bookmark') {
      block.url = '';
      block.caption = '';
    } else {
      block.html = prevHtml ?? '';
      block.checked = false;
    }
    this.scheduleEmit();
    this.closeSlash();
  }

  @HostListener('document:selectionchange')
  onSelectionChange() {
    if (!this.slashOpen) return;
    const block = this.blocks.find((b) => b.id === this.slashBlockId);
    if (block) this.updateSlashState(block);
  }

  openSlash(block: EditorBlock) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    this.slashX = rect.left;
    this.slashY = rect.bottom + 4;
    this.slashOpen = true;
    this.slashBlockId = block.id;
    this.slashQuery = '';
  }

  closeSlash() {
    this.slashOpen = false;
    this.slashBlockId = null;
    this.slashQuery = '';
  }

  updateSlashState(block: EditorBlock) {
    if (!this.slashOpen || this.slashBlockId !== block.id) return;
    const plain = this.getPlainText(block).trimEnd();
    const match = plain.match(/\/([^\s\/]*)$/);
    if (match) {
      this.slashQuery = match[1];
    } else {
      this.closeSlash();
    }
  }

  get filteredSlashCommands(): SlashCommand[] {
    if (!this.slashQuery) return this.slashCommands;
    const q = this.slashQuery.toLowerCase();
    return this.slashCommands.filter((cmd) =>
      cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
    );
  }

  pickSlash(cmd: SlashCommand) {
    if (!this.slashBlockId) return;
    const block = this.blocks.find((b) => b.id === this.slashBlockId);
    if (!block) return;
    this.stripSlashText(block);
    this.transformBlock(block, cmd.type);
    queueMicrotask(() => {
      if (cmd.type === 'divider') {
        this.splitBlock(block);
      } else {
        this.focusBlock(block.id);
      }
    });
  }

  stripSlashText(block: EditorBlock) {
    if (block.type === 'code') return;
    const el = this.getBlockElement(block.id);
    if (!el) return;
    const text = this.getPlainText(block);
    const cleaned = text.replace(/\/([^\s\/]*)$/, '');
    el.innerText = cleaned;
    block.html = el.innerHTML;
  }

  getPlainText(block: EditorBlock): string {
    if (block.type === 'code') return block.code ?? '';
    if (block.type === 'bookmark') {
      return block.bookmark?.title || block.caption || block.url || '';
    }
    if (block.type === 'database') {
      return 'Database';
    }
    const el = this.getBlockElement(block.id);
    if (el) return el.innerText;
    return block.html ? block.html.replace(/<[^>]+>/g, '') : '';
  }
  scheduleEmit() {
    if (this.emitTimer) window.clearTimeout(this.emitTimer);
    this.emitTimer = window.setTimeout(() => {
      const doc: EditorDocument = {
        version: this._document?.version ?? 1,
        meta: this._document?.meta,
        blocks: cloneBlocks(this.blocks),
      };
      this.documentChange.emit(doc);
    }, 120);
  }

  // Drag & drop
  onDragStart(event: DragEvent, block: EditorBlock) {
    this.dragBlockId = block.id;
    event.dataTransfer?.setData('text/plain', block.id);
    event.dataTransfer?.setDragImage(this.createDragImage(block), 0, 0);
  }

  onDragOver(event: DragEvent, block: EditorBlock) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.classList.add('drag-over');
  }

  onDragLeave(event: DragEvent) {
    const target = event.currentTarget as HTMLElement;
    target.classList.remove('drag-over');
  }

  onDrop(event: DragEvent, block: EditorBlock) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.classList.remove('drag-over');
    const dragId = this.dragBlockId;
    this.dragBlockId = null;
    if (!dragId || dragId === block.id) return;
    const fromIndex = this.blocks.findIndex((b) => b.id === dragId);
    const toIndex = this.blocks.findIndex((b) => b.id === block.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = this.blocks.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex : toIndex;
    this.blocks.splice(insertAt, 0, moved);
    this.scheduleEmit();
  }

  createDragImage(block: EditorBlock): HTMLElement {
    const el = document.createElement('div');
    el.className =
      'px-4 py-2 rounded border border-neutral-200 bg-white shadow text-sm text-neutral-600';
    el.textContent = this.getPlainText(block) || 'Empty';
    document.body.appendChild(el);
    setTimeout(() => document.body.removeChild(el), 0);
    return el;
  }

  ensureAtLeastOneBlock() {
    if (this.blocks.length === 0) {
      this.blocks = [createBlock('paragraph')];
      this.scheduleEmit();
    }
  }

  toggleFormat(command: string, value?: string) {
    document.execCommand(command, false, value ?? undefined);
  }
}









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

interface TypeOption {
  label: string;
  description: string;
  value: BlockType;
  icon: string;
}

interface ImagePreset {
  label: string;
  url: string;
}

interface CaretSnapshot {
  blockId: string;
  offset: number;
  mode: 'contenteditable' | 'textarea';
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
    if (this.pendingLocalUpdate) {
      this.pendingLocalUpdate = false;
      setTimeout(() => this.restorePendingCaret());
      return;
    }
    this.blocks = doc ? cloneBlocks(doc.blocks) : [createBlock('paragraph')];
    this.blocks.forEach((block) => this.hydrateBlock(block));
    this.typeMenuOpenId = null;
    this.imageGalleryOpenId = null;
    queueMicrotask(() => this.ensureAtLeastOneBlock());
    setTimeout(() => this.restorePendingCaret());
  }

  private hydrateBlock(block: EditorBlock) {
    if (block.type === 'database') {
      const view = (block.view as any) || (block.props?.['view'] as any);
      block.view = view === 'list' ? 'list' : 'table';
      block.props = { ...(block.props || {}), view: block.view };
      if (!block.databaseId) {
        void this.ensureDatabase(block);
      }
    }
    if (block.type === 'bookmark') {
      block.url = block.url || '';
      block.caption = block.caption || '';
      if (block.bookmark && typeof block.bookmark !== 'object') {
        block.bookmark = undefined;
      }
    }
    if (block.type === 'image') {
      block.url = block.url || '';
      block.caption = block.caption || '';
    }
    if (block.type === 'todo') {
      block.checked = !!block.checked;
      block.html = block.html ?? '';
    }
    if (
      block.type !== 'code' &&
      block.type !== 'divider' &&
      block.type !== 'image' &&
      block.type !== 'bookmark' &&
      block.type !== 'database'
    ) {
      block.html = block.html ?? '';
    }
    if (block.type === 'code') {
      block.code = block.code ?? '';
      (block as any).language = (block as any).language || 'plaintext';
    }
  }

  private captureContentEditableCaret(): CaretSnapshot | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const blockEl = this.findBlockRoot(range.startContainer);
    if (!blockEl) return null;
    const blockId = blockEl.dataset['blockId'];
    if (!blockId) return null;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(blockEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const offset = preRange.toString().length;
    return { blockId, offset, mode: 'contenteditable' };
  }

  private findBlockRoot(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    return element ? element.closest<HTMLElement>('[data-block-id]') : null;
  }

  private resolveTextPosition(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let currentOffset = 0;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const contentLength = node.textContent?.length ?? 0;
      if (currentOffset + contentLength >= targetOffset) {
        const offsetWithin = Math.max(0, Math.min(contentLength, targetOffset - currentOffset));
        return { node, offset: offsetWithin };
      }
      currentOffset += contentLength;
      node = walker.nextNode() as Text | null;
    }
    return { node: root, offset: root.childNodes.length };
  }

  private restorePendingCaret() {
    if (!this.pendingCaret) return;
    const snapshot = this.pendingCaret;
    this.pendingCaret = null;
    requestAnimationFrame(() => this.restoreCaret(snapshot));
  }

  private restoreCaret(snapshot: CaretSnapshot) {
    if (snapshot.mode === 'textarea') {
      const textarea = this.getCodeTextarea(snapshot.blockId);
      if (!textarea) return;
      const position = Math.max(0, Math.min(snapshot.offset, textarea.value.length));
      textarea.focus();
      textarea.setSelectionRange(position, position);
      return;
    }
    const blockEl = this.getBlockElement(snapshot.blockId);
    if (!blockEl) return;
    blockEl.focus();
    const { node, offset } = this.resolveTextPosition(blockEl, snapshot.offset);
    const range = document.createRange();
    const selection = window.getSelection();
    try {
      range.setStart(node, offset);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      // If selection restoration fails we silently ignore.
    }
  }

  private getCodeTextarea(blockId: string): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>(`textarea[data-block-id=\"${blockId}\"]`);
  }

  get document(): EditorDocument | null { return this._document; }

  @Output() documentChange = new EventEmitter<EditorDocument>();

  blocks: EditorBlock[] = [createBlock('paragraph')];
  activeBlockId: string | null = null;
  dragBlockId: string | null = null;
  slashOpen = false;
  slashBlockId: string | null = null;
  slashCommands: SlashCommand[] = [];

  slashX = 0;
  slashY = 0;
  slashQuery = '';

  readonly typeOptions: TypeOption[] = [
    { label: 'Paragraph', description: 'Paragraph text', value: 'paragraph', icon: 'Aa' },
    { label: 'Heading 1', description: 'Large section title', value: 'heading-1', icon: 'H1' },
    { label: 'Heading 2', description: 'Medium section title', value: 'heading-2', icon: 'H2' },
    { label: 'Heading 3', description: 'Small section title', value: 'heading-3', icon: 'H3' },
    { label: 'Bulleted list', description: 'Create a simple list', value: 'bulleted-list', icon: '*' },
    { label: 'Numbered list', description: 'Create an ordered list', value: 'numbered-list', icon: '1.' },
    { label: 'To-do', description: 'Track tasks with checkboxes', value: 'todo', icon: '[ ]' },
    { label: 'Quote', description: 'Capture a quote', value: 'quote', icon: '""' },
    { label: 'Callout (info)', description: 'Highlight information', value: 'callout-info', icon: 'i' },
    { label: 'Callout (warning)', description: 'Important warning', value: 'callout-warning', icon: '!' },
    { label: 'Callout (success)', description: 'Celebrate success', value: 'callout-success', icon: 'OK' },
    { label: 'Code', description: 'Capture code snippet', value: 'code', icon: '{ }' },
    { label: 'Divider', description: 'Visual divider', value: 'divider', icon: '--' },
    { label: 'Image', description: 'Upload or paste images', value: 'image', icon: 'Img' },
    { label: 'Bookmark', description: 'Save a link preview', value: 'bookmark', icon: 'Bk' },
    { label: 'Database', description: 'Structured table', value: 'database', icon: 'Tbl' },
  ];
  typeMenuOpenId: string | null = null;
  imageGalleryOpenId: string | null = null;

  readonly imageLibrary: ImagePreset[] = [
    { label: 'Aurora', url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Ocean', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Desert', url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Forest', url: 'https://images.unsplash.com/photo-1482192597420-4817fdd7e8b0?auto=format&fit=crop&w=1600&q=80' },
    { label: 'City', url: 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Workspace', url: 'https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=1600&q=80' },
  ];

  uploadingBlocks = new Set<string>();
  bookmarkLoadingBlocks = new Set<string>();
  bookmarkErrors: Record<string, string> = {};
  private pendingLocalUpdate = false;
  private pendingCaret: CaretSnapshot | null = null;

  constructor(private notes: NotesService) {
    this.slashCommands = this.typeOptions.map(({ label, description, value, icon }) => ({
      label,
      description,
      type: value,
      icon,
    }));
  }

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
      const caretOffset = target.selectionStart ?? target.value.length;
      block.code = target.value;
      const snapshot: CaretSnapshot = {
        blockId: block.id,
        offset: caretOffset,
        mode: 'textarea',
      };
      this.pendingCaret = snapshot;
      requestAnimationFrame(() => this.restoreCaret(snapshot));
    } else if (block.type === 'image') {
      const target = event.target as HTMLInputElement;
      block.url = target.value;
    } else if (block.type === 'bookmark') {
      const target = event.target as HTMLInputElement;
      block.url = target.value;
    } else {
      const caretSnapshot = this.captureContentEditableCaret();
      const el = event.target as HTMLElement;
      block.html = el.innerHTML;
      if (caretSnapshot) {
        this.pendingCaret = caretSnapshot;
        requestAnimationFrame(() => this.restoreCaret(caretSnapshot));
      }
    }
    if (!this.pendingCaret && block.type !== 'image' && block.type !== 'bookmark') {
      const caret = this.captureContentEditableCaret();
      if (caret) this.pendingCaret = caret;
    }
    this.scheduleEmit();
    this.updateSlashState(block);
  }

  onPaste(event: ClipboardEvent, block: EditorBlock) {
    if (block.type === 'code') return; // allow native multi-line paste in code blocks
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    event.preventDefault();
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length) return;
    const blockEl = this.getBlockElement(block.id);
    let selection = window.getSelection();
    if (!blockEl) return;
    if (!selection || selection.rangeCount === 0 || !blockEl.contains(selection.getRangeAt(0).startContainer)) {
      this.focusBlock(block.id);
      selection = window.getSelection();
    }
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range) {
      range.deleteContents();
      const firstText = document.createTextNode(lines[0]);
      range.insertNode(firstText);
      range.setStartAfter(firstText);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      document.execCommand('insertText', false, lines[0]);
    }
    block.html = blockEl.innerHTML;
    let referenceBlock = block;
    for (let i = 1; i < lines.length; i++) {
      const newBlock = createBlock('paragraph');
      newBlock.html = this.escapeHtml(lines[i]);
      this.insertBlockAfter(referenceBlock, newBlock);
      referenceBlock = newBlock;
    }
    // ensure block content reflects first line post insertion
    const updatedEl = this.getBlockElement(block.id);
    if (updatedEl) {
      block.html = updatedEl.innerHTML;
    }
    const focusId = lines.length > 1 ? referenceBlock.id : block.id;
    this.closeSlash();
    this.scheduleEmit();
    queueMicrotask(() => this.focusBlock(focusId));
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
      this.imageGalleryOpenId = null;
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

  insertBlockBefore(target: EditorBlock, newBlock: EditorBlock) {
    const idx = this.blocks.findIndex((b) => b.id === target.id);
    const insertAt = idx <= 0 ? 0 : idx;
    this.blocks.splice(insertAt, 0, newBlock);
    this.scheduleEmit();
  }

  addAdjacentBlock(block: EditorBlock, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const newBlockType =
      block.type === 'todo' ? 'todo' : block.type === 'code' ? 'code' : 'paragraph';
    const newBlock = createBlock(newBlockType);
    if (event.altKey) {
      this.insertBlockBefore(block, newBlock);
    } else {
      this.insertBlockAfter(block, newBlock);
    }
    queueMicrotask(() => this.focusBlock(newBlock.id));
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

  onEditorSurfaceClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (event.currentTarget !== event.target) return;
    const newBlock = createBlock('paragraph');
    this.blocks.push(newBlock);
    this.scheduleEmit();
    queueMicrotask(() => this.focusBlock(newBlock.id));
  }

  focusBlock(blockId: string) {
    this.pendingCaret = null;
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
    this.pendingCaret = null;
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
    if (this.typeMenuOpenId === block.id) this.typeMenuOpenId = null;
    if (this.imageGalleryOpenId === block.id) this.imageGalleryOpenId = null;
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
    if (this.typeMenuOpenId === block.id) this.typeMenuOpenId = null;
    if (this.imageGalleryOpenId === block.id) this.imageGalleryOpenId = null;
  }

  toggleTypeMenu(block: EditorBlock) {
    this.typeMenuOpenId = this.typeMenuOpenId === block.id ? null : block.id;
    if (this.typeMenuOpenId) {
      this.imageGalleryOpenId = null;
    }
  }

  selectType(block: EditorBlock, type: BlockType) {
    this.transformBlock(block, type);
    this.typeMenuOpenId = null;
  }

  getTypeIcon(type: BlockType): string {
    return this.typeOptions.find((option) => option.value === type)?.icon ?? 'Aa';
  }

  getTypeLabel(type: BlockType): string {
    return this.typeOptions.find((option) => option.value === type)?.label ?? 'Paragraph';
  }

  toggleImageGallery(block: EditorBlock) {
    this.imageGalleryOpenId = this.imageGalleryOpenId === block.id ? null : block.id;
    if (this.imageGalleryOpenId) {
      this.typeMenuOpenId = null;
    }
  }

  triggerImageUpload(input: HTMLInputElement, block: EditorBlock) {
    if (this.uploadingBlocks.has(block.id)) return;
    this.imageGalleryOpenId = null;
    input.click();
  }

  setImageFromLibrary(block: EditorBlock, preset: ImagePreset) {
    block.url = preset.url;
    if (!block.caption) {
      block.caption = preset.label;
    }
    this.imageGalleryOpenId = null;
    this.scheduleEmit();
  }

  clearImage(block: EditorBlock) {
    block.url = '';
    this.imageGalleryOpenId = null;
    this.scheduleEmit();
  }

  @HostListener('document:selectionchange')
  onSelectionChange() {
    if (!this.slashOpen) return;
    const block = this.blocks.find((b) => b.id === this.slashBlockId);
    if (block) this.updateSlashState(block);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.typeMenuOpenId && !target.closest('[data-block-type-menu]') && !target.closest('[data-block-type-trigger]')) {
      this.typeMenuOpenId = null;
    }
    if (this.imageGalleryOpenId && !target.closest('[data-image-gallery]') && !target.closest('[data-image-gallery-trigger]')) {
      this.imageGalleryOpenId = null;
    }
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
    if (!this.pendingCaret) {
      const caret = this.captureContentEditableCaret();
      if (caret) this.pendingCaret = caret;
    }
    this.emitTimer = window.setTimeout(() => {
      const doc: EditorDocument = {
        version: this._document?.version ?? 1,
        meta: this._document?.meta,
        blocks: cloneBlocks(this.blocks),
      };
      this.pendingLocalUpdate = true;
      this._document = doc;
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}









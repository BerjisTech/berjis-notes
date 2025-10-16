import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Note, NotesService, TodoItem } from '../../notes.service';

@Component({
  standalone: true,
  selector: 'app-note',
  imports: [CommonModule, FormsModule],
  templateUrl: './note.component.html',
  styles: [`
    :host { --brand-blue: #2EA4FB; --brand-purple: #5821A7; --brand-magenta: #8808B2; }
    .prose a { color: var(--brand-blue); text-decoration: underline; }
    .prose hr { border: none; border-top: 1px dashed #d1d5db; margin: 1rem 0; }
    .prose ul, .prose ol { padding-left: 1.25rem; margin: 0.5rem 0; }
    .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { margin: 1rem 0 0.5rem; }
    .prose input[type="checkbox"] { accent-color: var(--brand-blue); }

    /* Inline code pill */
    .prose code { background: rgba(46,164,251,0.14); color: var(--brand-purple); padding: 0.1rem 0.35rem; border-radius: 4px; }
    /* Code block */
    .prose pre { background: rgba(46,164,251,0.08); color: #111827; padding: 0.75rem 1rem; border-radius: 6px; overflow: auto; border-left: 4px solid var(--brand-blue); }
    .prose pre code { background: transparent; color: inherit; padding: 0; }
    /* Blockquote */
    .prose blockquote { border-left: 6px solid var(--brand-purple); background: rgba(136,8,178,0.06); margin: 0.75rem 0; padding: 0.25rem 0 0.25rem 0.75rem; color: #374151; font-style: italic; }
  `]
})
export class NotePageComponent implements OnInit, OnDestroy {
  @ViewChild('mdEditor', { static: false }) mdEditorRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('richEditor', { static: false }) editorRef?: ElementRef<HTMLDivElement>;
  @ViewChild('cmRef', { static: false }) cmRef?: ElementRef<HTMLDivElement>;

  note: Note | null = null;
  pendingSave?: any;
  colorPickerOpen = false;
  emojiPickerOpen = false;
  foreColor = '#000000';
  backColor = '#ffff00';

  renderedHtml = '';
  codeMode = false; // false = rich editable preview, true = raw Markdown editor
  isLegacyHtml = false; // if true, keep HTML as source instead of Markdown
  cmOpen = false; cmX = 0; cmY = 0; // context menu state

  // Selection toolbar state (rich mode)
  selOpen = false; selX = 0; selY = 0;
  linkMode = false; linkHref = '';

  // Slash command palette
  slashOpen = false; slashX = 0; slashY = 0;
  private routeSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public notes: NotesService,
  ) {}
  editorPlaceholder: string = 'Write in Markdown...\n- [ ] Tasks\n- [x] Done\n\nImages: ![alt](url)  Links: [text](url)\n\nHeadings: # H1 ## H2 ### H3\n\nCode: ```\nconst x = 1;\n```';

  async ngOnInit() {
    // Subscribe to route id changes so the same component instance updates content
    this.routeSub = this.route.paramMap.subscribe(async (pm) => {
      const id = pm.get('id') || 'new';
      await this.loadNote(id);
    });
    // Selection change listener for floating toolbar
    document.addEventListener('selectionchange', this.onSelectionChange);
    // Global listeners to close overlays on outside click / escape
    document.addEventListener('mousedown', this.onDocMouseDown);
    document.addEventListener('keydown', this.onDocKeyDown as any);
    // Close menus on scroll/resize
    window.addEventListener('scroll', this.onWindowScroll, true);
    window.addEventListener('resize', this.onWindowResize);
  }

  ngOnDestroy(): void {
    if (this.pendingSave) clearTimeout(this.pendingSave);
    if (this.routeSub) this.routeSub.unsubscribe();
    document.removeEventListener('selectionchange', this.onSelectionChange);
    document.removeEventListener('mousedown', this.onDocMouseDown);
    document.removeEventListener('keydown', this.onDocKeyDown as any);
    window.removeEventListener('scroll', this.onWindowScroll, true);
    window.removeEventListener('resize', this.onWindowResize);
  }

  onTitleChange() { this.queueSave(); }

  onContentChange() { this.isLegacyHtml = this.isProbablyHtml(this.note?.content || ''); this.updateRendered(true); this.queueSave(); }

  onRichInput() {
    if (!this.note || !this.editorRef) return;
    const html = this.editorRef.nativeElement.innerHTML;
    if (this.isLegacyHtml) this.note.content = html;
    else this.note.content = this.htmlToMarkdown(html);
    this.queueSave();

    // Markdown shortcuts auto-convert in rich view
    this.applyMarkdownShortcuts();
  }
  onRichClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
      // Reflect checkbox state into Markdown immediately
      this.onRichInput();
    }
  }

  // Legacy todo APIs removed from UI; kept no-ops to avoid template breakage if referenced
  addTodo() {}
  removeTodo(id: string) {}
  toggleTodo(t: TodoItem) {}
  onTodoTextChange() {}

  private queueSave() {
    if (!this.note) return;
    if (this.pendingSave) clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => this.save(), 400);
  }

  private async ensureCreatedId() {
    if (this.note && this.note.id === 'new') {
      const hasTitle = !!this.note.title && this.note.title.trim().length > 0;
      const hasContent = !!this.note.content && this.stripFormatting(this.note.content).trim().length > 0;
      const hasTodos = !!this.note.todos && this.note.todos.some(t => t.text.trim().length > 0);
      if (hasTitle || hasContent || hasTodos) {
        const created = await this.notes.create({
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

  private async loadNote(id: string) {
    // Clear any pending save on navigation
    if (this.pendingSave) { clearTimeout(this.pendingSave); this.pendingSave = undefined; }
    // Start with a placeholder so template bindings are safe
    this.note = {
      id,
      title: '', content: '', todos: [], status: 'active',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    if (id !== 'new') {
      const existing = this.notes.get(id) || await this.notes.fetch(id);
      if (existing) { this.note = existing; }
      else { this.router.navigate(['/']); return; }
    }
    const initial = this.note?.content || '';
    this.isLegacyHtml = this.isProbablyHtml(initial);
    // Re-render into the rich view
    setTimeout(() => { this.updateRendered(true); });
  }

  private async save() {
    if (!this.note) return;
    await this.ensureCreatedId();
    if (!this.note) return;
    await this.notes.save(this.note);
  }

  // Markdown helper: insert raw text at cursor (code view)
  insertAtCursor(text: string) {
    const el = this.mdEditorRef?.nativeElement;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const value = el.value || '';
    el.value = value.slice(0, start) + text + value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input'));
  }

  insertEmoji(e: string) { this.insertAtCursor(e); this.emojiPickerOpen = false; this.onContentChange(); }

  // Rich editor commands
  exec(cmd: string, value?: string) {
    if (this.codeMode) return;
    document.execCommand(cmd, false, value);
    this.onRichInput();
  }
  applyBlock(tag: string) { if (this.codeMode) return; document.execCommand('formatBlock', false, tag); this.onRichInput(); }
  insertLink() { if (this.codeMode) return; const url = prompt('Enter URL'); if (url) this.exec('createLink', url); }
  unlink() { if (this.codeMode) return; this.exec('unlink'); }
  insertImageUrl() { if (this.codeMode) return; const url = prompt('Image URL'); if (url) document.execCommand('insertImage', false, url); this.onRichInput(); }

  async softDelete() {
    if (!this.note) return;
    if (confirm('Move note to Trash?')) {
      await this.notes.softDelete(this.note.id);
      this.router.navigate(['/']);
    }
  }

  async archive() {
    if (!this.note) return;
    await this.notes.archive(this.note.id);
    this.router.navigate(['/']);
  }

  async restore() {
    if (!this.note) return;
    await this.notes.restore(this.note.id);
    this.router.navigate(['/']);
  }

  keydown(e: KeyboardEvent) {
    // Shortcuts
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); this.exec('bold'); return; }
      if (key === 'i') { e.preventDefault(); this.exec('italic'); return; }
      if (key === 'u') { e.preventDefault(); this.exec('underline'); return; }
      if (key === 'z') { e.preventDefault(); document.execCommand('undo'); return; }
      if (key === 'y') { e.preventDefault(); document.execCommand('redo'); return; }
    }
    if (this.codeMode) return;
    // Enter handling for lists/tasks and code fences
    if (e.key === 'Enter') {
      if (this.handleEnterRich(e)) return;
    }
    // Slash command open if '/' at start
    if (e.key === '/') {
      setTimeout(() => this.maybeOpenSlash());
    }
  }

  private uuid(): string { return 't_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }

  toggleCodeMode() {
    this.codeMode = !this.codeMode;
    setTimeout(() => { this.updateRendered(true); });
  }

  openContextMenu(e: MouseEvent) { e.preventDefault(); this.cmOpen = true; this.cmX = e.clientX; this.cmY = e.clientY; }
  closeContextMenu() { this.cmOpen = false; }

  cmHeading(level: number) { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('\n' + '#'.repeat(level) + ' '); } else { this.applyBlock('h' + level); } }
  cmBlockquote() { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('\n> '); } else { this.applyBlock('blockquote'); } }
  cmUl() { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('\n- '); } else { this.exec('insertUnorderedList'); } }
  cmOl() { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('\n1. '); } else { this.exec('insertOrderedList'); } }
  cmTask() {
    this.closeContextMenu();
    if (this.codeMode) { this.insertAtCursor('\n- [ ] '); }
    else {
      const html = '<ul><li><input type="checkbox" disabled /> Task</li></ul>';
      document.execCommand('insertHTML', false, html);
      this.onRichInput();
    }
  }
  cmInlineCode() { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('`code`'); } else { document.execCommand('insertHTML', false, '<code>code</code>'); this.onRichInput(); } }
  cmCodeBlock() { this.closeContextMenu(); if (this.codeMode) { this.insertAtCursor('\n```\ncode\n```\n'); } else { document.execCommand('insertHTML', false, '<pre><code>code</code></pre>'); this.onRichInput(); } }
  cmLink() { this.closeContextMenu(); if (this.codeMode) { const url = prompt('URL'); if (url) this.insertAtCursor(`[text](${url})`); } else { this.insertLink(); } }
  cmImage() { this.closeContextMenu(); if (this.codeMode) { const url = prompt('Image URL'); if (url) this.insertAtCursor(`![alt](${url})`); } else { this.insertImageUrl(); } }

  private updateRendered(applyToRich = false) {
    if (!this.note) return;
    const src = this.note.content || '';
    this.renderedHtml = this.isLegacyHtml ? src : this.markdownToHtml(src);
    if (applyToRich && this.editorRef && !this.codeMode) {
      this.editorRef.nativeElement.innerHTML = this.renderedHtml || '';
    }
  }

  private stripFormatting(s: string): string {
    if (!s) return '';
    let t = s;
    // Remove code blocks
    t = t.replace(/```[\s\S]*?```/g, ' ');
    // Remove inline code
    t = t.replace(/`[^`]*`/g, ' ');
    // Remove HTML tags
    t = t.replace(/<[^>]*>/g, ' ');
    // Remove markdown links/images, keep text/alt
    t = t.replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ');
    t = t.replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1');
    // Remove emphasis markers and headers, lists, blockquotes, tasks
    t = t.replace(/[\*_]{1,3}([^\*_]+)[\*_]{1,3}/g, '$1');
    t = t.replace(/^>\s?/gm, '');
    // Unordered list markers
    t = t.replace(/^\s{0,3}(\*|\-|\+)\s+/gm, '');
    t = t.replace(/^\s{0,3}\d+\.\s+/gm, '');
    t = t.replace(/\[([ xX])]\s+/g, '');
    t = t.replace(/^#{1,6}\s+/gm, '');
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ');
    return t.trim();
  }

  private markdownToHtml(md: string): string {
    if (!md) return '';
    // Handle code fences first
    const codeBlocks: string[] = [];
    // Single-line code fence ```lang code```
    md = md.replace(/```(\w+)?\s*([^\n`][^`]*)\s*```/g, (_m, lang, code) => {
      const idx = codeBlocks.push(`<pre><code class="language-${lang || ''}">${this.escapeHtml(code)}</code></pre>`) - 1;
      return `{{CODE_BLOCK_${idx}}}`;
    });
    // Multi-line code fence
    md = md.replace(/```(\w+)?\r?\n([\s\S]*?)```/g, (_m, lang, code) => {
      const idx = codeBlocks.push(`<pre><code class="language-${lang || ''}">${this.escapeHtml(code)}</code></pre>`) - 1;
      return `{{CODE_BLOCK_${idx}}}`;
    });

    // Escape HTML except allowing existing HTML blocks to pass through by line
    // We will not escape lines that start with '<' to allow legacy HTML content to render.
    const lines = md.split(/\r?\n/);
    const htmlLines: string[] = [];
    let inList = false; let inOl = false; let inBlockquote = false;

    const closeBlocks = () => {
      if (inList) { htmlLines.push('</ul>'); inList = false; }
      if (inOl) { htmlLines.push('</ol>'); inOl = false; }
      if (inBlockquote) { htmlLines.push('</blockquote>'); inBlockquote = false; }
    };

    for (let raw of lines) {
      let line = raw;
      // Code block placeholder line
      const cb = line.match(/^\s*\{\{CODE_BLOCK_(\d+)\}\}\s*$/);
      if (cb) { closeBlocks(); const idx = Number(cb[1]); htmlLines.push(codeBlocks[idx] || ''); continue; }
      // Horizontal rule
      if (/^\s*(\*\s?\*\s?\*|-\s?-\s?-|_{3,})\s*$/.test(line)) { closeBlocks(); htmlLines.push('<hr/>'); continue; }

      // Headings
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeBlocks(); const level = h[1].length; htmlLines.push(`<h${level}>${this.inlineMarkdown(h[2])}</h${level}>`); continue; }

      // Blockquote
      if (/^>\s?/.test(line)) {
        if (!inBlockquote) { closeBlocks(); htmlLines.push('<blockquote>'); inBlockquote = true; }
        line = line.replace(/^>\s?/, '');
        htmlLines.push(`<p>${this.inlineMarkdown(line)}</p>`);
        continue;
      } else if (inBlockquote && line.trim() === '') { closeBlocks(); continue; }

      // Ordered list
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ol) {
        if (!inOl) { closeBlocks(); htmlLines.push('<ol>'); inOl = true; }
        htmlLines.push(`<li>${this.inlineMarkdown(ol[1])}</li>`);
        continue;
      }
      // Unordered list with optional task
      const ul = line.match(/^\s*(?:-|\*|\+)\s+(\[([ xX])\]\s+)?(.*)$/);
      if (ul) {
        if (!inList) { closeBlocks(); htmlLines.push('<ul>'); inList = true; }
        const checked = (ul[2] || '').toLowerCase() === 'x';
        const content = this.inlineMarkdown(ul[3] || '');
        if (ul[1]) {
          htmlLines.push(`<li><input type="checkbox" ${checked ? 'checked' : ''}/> ${content}</li>`);
        } else {
          htmlLines.push(`<li>${content}</li>`);
        }
        continue;
      }

      // Legacy HTML line passthrough
      if (/^\s*</.test(line.trim())) { closeBlocks(); htmlLines.push(line); continue; }

      // Paragraph or blank
      if (line.trim() === '') { closeBlocks(); htmlLines.push(''); continue; }
      htmlLines.push(`<p>${this.inlineMarkdown(line)}</p>`);
    }
    closeBlocks();

    let html = htmlLines.join('\n');
    return html;
  }

  private htmlToMarkdown(html: string): string {
    const container = document.createElement('div');
    container.innerHTML = html;

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || '').replace(/\s+/g, ' ');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const childMd = Array.from(el.childNodes).map(walk).join('');
      switch (tag) {
        case 'strong':
        case 'b': return childMd ? `**${childMd}**` : '';
        case 'em':
        case 'i': return childMd ? `*${childMd}*` : '';
        case 'u': return childMd; // no markdown equivalent
        case 'code': {
          if (el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') return childMd;
          return '`' + childMd + '`';
        }
        case 'pre': {
          const code = el.textContent || '';
          return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
        }
        case 'br': return '  \n';
        case 'p': return childMd.trim() ? `${childMd.trim()}\n\n` : '';
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const level = Number(tag.slice(1));
          return `\n${'#'.repeat(level)} ${childMd.trim()}\n\n`;
        }
        case 'blockquote': {
          const lines = (childMd || '').split(/\n/).map(l => l.trim()).filter(l => l.length);
          return lines.map(l => `> ${l}`).join('\n') + '\n\n';
        }
        case 'ul': {
          let out = '';
          el.querySelectorAll(':scope > li').forEach(li => { out += walk(li) + '\n'; });
          return out + '\n';
        }
        case 'ol': {
          let i = 1; let out = '';
          el.querySelectorAll(':scope > li').forEach(li => { out += `${i}. ${walk(li).trim()}\n`; i++; });
          return out + '\n';
        }
        case 'li': {
          const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          let text = '';
          Array.from(el.childNodes).forEach(n => { if (!(n as HTMLElement).matches || !(n as HTMLElement).matches('input[type="checkbox"]')) text += walk(n); });
          if (checkbox) return `- [${checkbox.checked ? 'x' : ' '}] ${text.trim()}`;
          return text.trim().startsWith('- ') || /^\d+\. /.test(text.trim()) ? text.trim() : `- ${text.trim()}`;
        }
        case 'a': {
          const href = (el.getAttribute('href') || '').trim();
          const txt = childMd.trim() || href;
          return `[${txt}](${href})`;
        }
        case 'img': {
          const src = el.getAttribute('src') || '';
          const alt = el.getAttribute('alt') || '';
          return `![${alt}](${src})`;
        }
        default:
          return childMd;
      }
    };

    const result = Array.from(container.childNodes).map(walk).join('').replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  private isProbablyHtml(s: string): boolean {
    if (!s) return false;
    const hasTag = /<\w+[^>]*>/.test(s) || /<\/\w+>/.test(s);
    const mdHints = /(^|\n)\s{0,3}(#{1,6}\s|(?:-|\*|\+)\s|\d+\.\s|>\s|```|\[|!\[)/.test(s);
    return hasTag && !mdHints;
  }
    private inlineMarkdown(text: string): string {
    let t = text;
    t = t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[ch]);
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_m, alt, src, title) =>
      `<img src="${src}" alt="${this.escapeHtml(alt)}" ${title ? `title="${this.escapeHtml(title)}"` : ''} />`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_m, txt, href, title) =>
      `<a href="${href}" target="_blank" rel="noopener">${this.escapeHtml(txt)}</a>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/_([^_]+)_/g, '<em>$1</em>');
    t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${this.escapeHtml(code)}</code>`);
    t = t.replace(/\s{2}$/g, '<br/>' );
    return t;
  }

  private escapeHtml(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ===== Rich editor helpers =====
  private getSelectionRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }
  private isInEditor(node: Node | null): boolean {
    if (!this.editorRef) return false;
    const root = this.editorRef.nativeElement;
    while (node) { if (node === root) return true; node = (node as any).parentNode; }
    return false;
  }
  private getCurrentBlock(): HTMLElement | null {
    const range = this.getSelectionRange(); if (!range) return null;
    let el: any = range.startContainer as Node;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el && this.isInEditor(el) && !/^P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE$/.test(el.tagName)) el = el.parentElement;
    return (this.isInEditor(el) ? el as HTMLElement : null);
  }
  private setCaretTo(el: Node) {
    const range = document.createRange(); const sel = window.getSelection();
    range.selectNodeContents(el); range.collapse(false); sel?.removeAllRanges(); sel?.addRange(range);
  }

  private handleEnterRich(e: KeyboardEvent): boolean {
    const block = this.getCurrentBlock(); if (!block) return false;
    // End code fence shorthand: line exactly ```lang or ```
    const text = block.textContent?.trim() || '';
    const fence = text.match(/^```(\w+)?$/);
    if (fence) {
      e.preventDefault();
      const lang = fence[1] || '';
      const pre = document.createElement('pre'); const code = document.createElement('code');
      if (lang) code.className = 'language-' + lang;
      code.innerHTML = '';
      pre.appendChild(code);
      block.replaceWith(pre);
      this.setCaretTo(code);
      this.onRichInput();
      return true;
    }
    // Inside list item behavior
    if (block.tagName === 'LI') {
      const li = block as HTMLLIElement;
      const isEmpty = (li.textContent || '').trim().length === 0 || li.innerHTML.replace(/<input[^>]*>/,'').trim() === '';
      const ul = li.closest('ul');
      const hasCheckbox = !!li.querySelector('input[type="checkbox"]');
      if (isEmpty) {
        e.preventDefault();
        // Exit list: create paragraph after the list
        const parentList = li.parentElement!;
        if (parentList && li.nextSibling == null) {
          parentList.removeChild(li);
          const p = document.createElement('p'); p.innerHTML = '';
          parentList.after(p);
          this.setCaretTo(p);
        } else {
          // remove the empty item and move caret to next
          const next = li.nextSibling; li.remove(); if (next) this.setCaretTo(next as any);
        }
        this.onRichInput();
        return true;
      }
      if (ul && hasCheckbox) {
        e.preventDefault();
        const newLi = document.createElement('li');
        newLi.innerHTML = '<input type="checkbox" /> ';
        li.after(newLi);
        this.setCaretTo(newLi);
        this.onRichInput();
        return true;
      }
    }
    return false;
  }

    private applyMarkdownShortcuts() {
    const block = this.getCurrentBlock(); if (!block || block.tagName === 'LI') return;
    const txt = (block.textContent || '').replace(/\u00A0/g, ' ');
    const mH = txt.match(/^(#{1,6})\s+(.*)$/);
    if (mH) {
      const level = mH[1].length; block.outerHTML = `<h${level}>${this.escapeHtml(mH[2])}</h${level}>`;
      this.onRichInput(); return;
    }
    if (/^(?:-|\*|\+)\s+/.test(txt)) {
      const content = txt.replace(/^(?:-|\*|\+)\s+/, '');
      block.outerHTML = `<ul><li>${this.escapeHtml(content)}</li></ul>`; this.onRichInput(); return;
    }
    if (/^\d+\.\s+/.test(txt)) {
      const content = txt.replace(/^\d+\.\s+/, '');
      block.outerHTML = `<ol><li>${this.escapeHtml(content)}</li></ol>`; this.onRichInput(); return;
    }
    if (/^>\s+/.test(txt)) {
      const content = txt.replace(/^>\s+/, '');
      block.outerHTML = `<blockquote><p>${this.escapeHtml(content)}</p></blockquote>`; this.onRichInput(); return;
    }
    if (/^(?:-|\*|\+)\s+\[(?: |x|X)\]\s+/.test(txt)) {
      const content = txt.replace(/^(?:-|\*|\+)\s+\[(?: |x|X)\]\s+/, '');
      block.outerHTML = `<ul><li><input type=\"checkbox\" /> ${this.escapeHtml(content)}</li></ul>`; this.onRichInput(); return;
    }
    // Inline code: `code`
    if (/`[^`]+`/.test(block.innerHTML)) {
      block.innerHTML = block.innerHTML.replace(/`([^`]+)`/g, (_m, c) => `<code>${this.escapeHtml(c)}</code>`);
    }
  }  // Selection toolbar logic
  onSelectionChange = () => {
    if (this.codeMode || !this.editorRef) { this.selOpen = false; return; }
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { this.selOpen = false; return; }
    const range = sel.getRangeAt(0);
    if (!this.isInEditor(range.commonAncestorContainer)) { this.selOpen = false; return; }
    const rect = range.getBoundingClientRect();
    this.selX = Math.max(8, rect.left + rect.width / 2);
    this.selY = Math.max(8, rect.top) - 8;
    this.selOpen = true; this.linkMode = false; this.linkHref = '';
  }

  openLinkMode() { this.linkMode = true; this.linkHref = ''; }
  applyLink() { if (this.linkHref) { document.execCommand('createLink', false, this.linkHref); this.onRichInput(); } this.selOpen = false; this.linkMode = false; }

  // Slash commands
  private maybeOpenSlash() {
    if (this.codeMode) return;
    const block = this.getCurrentBlock(); if (!block) return;
    const txt = (block.textContent || '').trim();
    if (txt === '/' || txt.endsWith('\n/')) {
      const range = this.getSelectionRange(); if (!range) return; const rect = range.getBoundingClientRect();
      this.slashX = rect.left + 12; this.slashY = rect.top + 16; this.slashOpen = true;
    }
  }
  slashPick(kind: string) {
    this.slashOpen = false;
    // Remove the leading slash
    const block = this.getCurrentBlock(); if (!block) return;
    block.innerHTML = block.innerHTML.replace('/', '');
    switch (kind) {
      case 'h1': block.outerHTML = `<h1></h1>`; break;
      case 'h2': block.outerHTML = `<h2></h2>`; break;
      case 'quote': block.outerHTML = `<blockquote><p></p></blockquote>`; break;
      case 'ul': block.outerHTML = `<ul><li></li></ul>`; break;
      case 'ol': block.outerHTML = `<ol><li></li></ol>`; break;
      case 'task': block.outerHTML = `<ul><li><input type="checkbox" /> </li></ul>`; break;
      case 'code': block.outerHTML = `<pre><code></code></pre>`; break;
    }
    this.onRichInput();
  }

  // Dismiss context/slash/selection UI on outside click or Escape
  onDocMouseDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (this.cmOpen) {
      const menu = this.cmRef?.nativeElement;
      if (menu && !menu.contains(target)) this.cmOpen = false;
    }
    if (this.selOpen) {
      // Close selection toolbar if clicking outside editor or toolbar itself
      const inEditor = this.isInEditor(target);
      this.selOpen = !!inEditor && this.selOpen; // keep if still in editor
      if (!inEditor) { this.linkMode = false; }
    }
    if (this.slashOpen) {
      // Simple outside click closes the slash palette
      this.slashOpen = false;
    }
  }
  onDocKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { this.cmOpen = false; this.slashOpen = false; this.selOpen = false; this.linkMode = false; }
  }

  onWindowScroll = () => { if (this.cmOpen) this.cmOpen = false; if (this.slashOpen) this.slashOpen = false; if (this.selOpen) { this.selOpen = false; this.linkMode = false; } }
  onWindowResize = () => { if (this.cmOpen) this.cmOpen = false; if (this.slashOpen) this.slashOpen = false; if (this.selOpen) { this.selOpen = false; this.linkMode = false; } }
}












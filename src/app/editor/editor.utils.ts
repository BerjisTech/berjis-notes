import { BlockType, EditorBlock, EditorDocument } from './editor.types';

const DEFAULT_VERSION = 1;

let idCounter = 0;
const uuid = () => `blk_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export function createBlock(type: BlockType): EditorBlock {
  switch (type) {
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'paragraph':
    case 'bulleted-list':
    case 'numbered-list':
    case 'quote':
    case 'callout-info':
    case 'callout-warning':
    case 'callout-success':
      return { id: uuid(), type, html: '' };
    case 'todo':
      return { id: uuid(), type, html: '', checked: false };
    case 'code':
      return { id: uuid(), type, code: '', language: 'plaintext' };
    case 'divider':
      return { id: uuid(), type };
    case 'image':
      return { id: uuid(), type, url: '', caption: '' };
    case 'bookmark':
      return { id: uuid(), type, url: '', caption: '', bookmark: undefined };
    case 'database':
      return { id: uuid(), type, databaseId: '', view: 'table', props: { view: 'table' } };
    default:
      return { id: uuid(), type: 'paragraph', html: '' };
  }
}

export function deserializeDocument(raw?: string | null): EditorDocument {
  if (!raw) {
    return { version: DEFAULT_VERSION, blocks: [createBlock('paragraph')] };
  }
  try {
    const parsed = JSON.parse(raw) as EditorDocument;
    if (parsed && Array.isArray(parsed.blocks)) {
      return normaliseDocument(parsed);
    }
  } catch {
    // fall through to markdown conversion
  }
  return markdownToDocument(raw);
}

export function serializeDocument(doc: EditorDocument): string {
  return JSON.stringify({
    version: doc.version ?? DEFAULT_VERSION,
    blocks: doc.blocks ?? [],
    meta: doc.meta ?? undefined,
  });
}

export function cloneBlocks(blocks: EditorBlock[]): EditorBlock[] {
  return blocks.map((block) => ({
    ...block,
    props: block.props ? { ...block.props } : undefined,
    bookmark: block.bookmark ? { ...block.bookmark } : undefined,
  }));
}

function normaliseDocument(doc: EditorDocument): EditorDocument {
  const blocks = Array.isArray(doc.blocks) && doc.blocks.length > 0 ? doc.blocks : [createBlock('paragraph')];
  const withIds = blocks.map((block) => ({
    ...block,
    id: block.id || uuid(),
    view: block.view || (block.type === 'database' ? 'table' : block.view),
    props: block.props ? { ...block.props } : undefined,
    bookmark: block.bookmark ? { ...block.bookmark } : undefined,
  }));
  return {
    version: doc.version || DEFAULT_VERSION,
    blocks: withIds,
    meta: doc.meta,
  };
}

function markdownToDocument(markdown: string): EditorDocument {
  const lines = markdown.split(/\r?\n/);
  const blocks: EditorBlock[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  let codeLanguage = 'plaintext';

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    const block = createBlock('code');
    block.code = codeBuffer.join('\n');
    block.language = codeLanguage || 'plaintext';
    blocks.push(block);
    codeBuffer = [];
    codeLanguage = 'plaintext';
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLanguage = line.slice(3).trim() || 'plaintext';
        continue;
      } else {
        inCode = false;
        flushCode();
        continue;
      }
    }
    if (inCode) {
      codeBuffer.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      blocks.push(createBlock('paragraph'));
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const block = createBlock(level === 1 ? 'heading-1' : level === 2 ? 'heading-2' : 'heading-3');
      block.html = escapeHtml(headingMatch[2]);
      blocks.push(block);
      continue;
    }
    const todoMatch = line.match(/^- \[( |x|X)\]\s+(.*)$/);
    if (todoMatch) {
      const block = createBlock('todo');
      block.checked = todoMatch[1].toLowerCase() === 'x';
      block.html = escapeHtml(todoMatch[2]);
      blocks.push(block);
      continue;
    }
    const bulletMatch = line.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const block = createBlock('bulleted-list');
      block.html = escapeHtml(bulletMatch[1]);
      blocks.push(block);
      continue;
    }
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      const block = createBlock('numbered-list');
      block.html = escapeHtml(numberedMatch[1]);
      blocks.push(block);
      continue;
    }
    const quoteMatch = line.match(/^>\s+(.*)$/);
    if (quoteMatch) {
      const block = createBlock('quote');
      block.html = escapeHtml(quoteMatch[1]);
      blocks.push(block);
      continue;
    }
    // default paragraph
    const block = createBlock('paragraph');
    block.html = escapeHtml(line);
    blocks.push(block);
  }
  flushCode();
  if (blocks.length === 0) {
    blocks.push(createBlock('paragraph'));
  }
  return { version: DEFAULT_VERSION, blocks };
}

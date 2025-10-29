export type BlockType =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bulleted-list'
  | 'numbered-list'
  | 'todo'
  | 'code'
  | 'quote'
  | 'callout-info'
  | 'callout-warning'
  | 'callout-success'
  | 'divider'
  | 'image'
  | 'bookmark'
  | 'database';

export interface EditorBlock {
  id: string;
  type: BlockType;
  html?: string;
  code?: string;
  language?: string;
  checked?: boolean;
  url?: string;
  caption?: string;
  props?: Record<string, unknown>;
  databaseId?: string;
  view?: 'table' | 'list';
  bookmark?: BookmarkPreview;
}

export interface EditorDocumentMeta {
  icon?: string;
  coverImage?: string;
  properties?: Record<string, { type: 'text' | 'date' | 'select' | 'multi-select' | 'number' | 'checkbox'; value: unknown }>;
}

export interface EditorDocument {
  version: number;
  blocks: EditorBlock[];
  meta?: EditorDocumentMeta;
}

export interface BookmarkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface NoteDatabase {
  id: string;
  noteId: string;
  title?: string | null;
  view: 'table' | 'list';
  filters?: unknown;
  sorts?: unknown;
  columns: NoteDatabaseColumn[];
  rows: NoteDatabaseRow[];
}

export interface NoteDatabaseColumn {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  position: number;
  config?: any;
}

export interface NoteDatabaseRow {
  id: string;
  databaseId: string;
  position: number;
  values: Record<string, any>;
}

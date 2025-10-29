import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorBlock, NoteDatabase, NoteDatabaseColumn, NoteDatabaseRow } from '../../editor/editor.types';
import { NotesService } from '../../notes.service';

type ColumnType = NoteDatabaseColumn['type'];

@Component({
  standalone: true,
  selector: 'app-database-block',
  imports: [CommonModule, FormsModule],
  templateUrl: './database-block.component.html',
  styleUrls: ['./database-block.component.css'],
})
export class DatabaseBlockComponent implements OnChanges {
  @Input({ required: true }) block!: EditorBlock;
  @Input() noteId: string | null = null;

  @Output() viewChange = new EventEmitter<'table' | 'list'>();
  @Output() mutate = new EventEmitter<void>();

  database?: NoteDatabase;
  loading = false;
  error: string | null = null;

  filterTerm = '';
  sortColumnId: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  constructor(private notes: NotesService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['block']) {
      this.filterTerm = '';
      this.sortColumnId = null;
      this.sortDirection = 'asc';
      void this.loadDatabase();
    }
  }

  get view(): 'table' | 'list' {
    return this.database?.view ?? (this.block.view === 'list' ? 'list' : 'table');
  }

  get columns(): NoteDatabaseColumn[] {
    return this.database?.columns ?? [];
  }

  get rows(): NoteDatabaseRow[] {
    return this.database?.rows ?? [];
  }

  get visibleRows(): NoteDatabaseRow[] {
    let rows = [...this.rows];
    if (this.filterTerm.trim()) {
      const term = this.filterTerm.trim().toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row.values || {}).some((value) =>
          String(value ?? '')
            .toLowerCase()
            .includes(term),
        ),
      );
    }
    if (this.sortColumnId) {
      const column = this.columns.find((c) => c.id === this.sortColumnId);
      if (column) {
        rows.sort((a, b) => {
          const av = a.values?.[column.id];
          const bv = b.values?.[column.id];
          if (av === bv) return 0;
          const dir = this.sortDirection === 'asc' ? 1 : -1;
          if (av == null) return -1 * dir;
          if (bv == null) return 1 * dir;
          if (column.type === 'number') {
            return (Number(av) - Number(bv)) * dir;
          }
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
    }
    return rows;
  }

  async loadDatabase(force = false) {
    if (!this.block?.databaseId) {
      this.error = 'Database not initialized yet.';
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const db = await this.notes.getDatabase(this.block.databaseId, force);
      if (db) this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to load database.';
    } finally {
      this.loading = false;
    }
  }

  async refresh() {
    await this.loadDatabase(true);
  }

  async addColumn() {
    if (!this.block.databaseId) return;
    const name = prompt('Column name');
    if (!name) return;
    try {
      const db = await this.notes.createDatabaseColumn(this.block.databaseId, { name, type: 'text' });
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to add column.';
    }
  }

  async updateColumnType(column: NoteDatabaseColumn, type: ColumnType) {
    if (!this.block.databaseId) return;
    try {
      const db = await this.notes.updateDatabaseColumn(this.block.databaseId, column.id, { type });
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to update column.';
    }
  }

  async renameColumn(column: NoteDatabaseColumn, name: string) {
    if (!this.block.databaseId || !name.trim()) return;
    try {
      const db = await this.notes.updateDatabaseColumn(this.block.databaseId, column.id, { name: name.trim() });
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to rename column.';
    }
  }

  async deleteColumn(column: NoteDatabaseColumn) {
    if (!this.block.databaseId) return;
    if (!confirm(`Delete column "${column.name}"?`)) return;
    try {
      const db = await this.notes.deleteDatabaseColumn(this.block.databaseId, column.id);
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to delete column.';
    }
  }

  async addRow() {
    if (!this.block.databaseId) return;
    try {
      const db = await this.notes.createDatabaseRow(this.block.databaseId, {});
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to add row.';
    }
  }

  async deleteRow(row: NoteDatabaseRow) {
    if (!this.block.databaseId) return;
    if (!confirm('Delete row?')) return;
    try {
      const db = await this.notes.deleteDatabaseRow(this.block.databaseId, row.id);
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to delete row.';
    }
  }

  async updateCell(row: NoteDatabaseRow, column: NoteDatabaseColumn, value: any) {
    if (!this.block.databaseId) return;
    try {
      const payload = column.type === 'checkbox' ? { [column.id]: !!value } : { [column.id]: value };
      const db = await this.notes.updateDatabaseRow(this.block.databaseId, row.id, { values: payload });
      this.applyDatabase(db);
    } catch (err: any) {
      this.error = err?.message || 'Failed to update cell.';
    }
  }

  async toggleView(view: 'table' | 'list') {
    if (!this.block.databaseId) return;
    if (view === this.view) return;
    try {
      const db = await this.notes.updateDatabase(this.block.databaseId, { view });
      this.applyDatabase(db);
      this.viewChange.emit(view);
    } catch (err: any) {
      this.error = err?.message || 'Failed to change view.';
    }
  }

  trackColumn(_: number, column: NoteDatabaseColumn) {
    return column.id;
  }

  trackRow(_: number, row: NoteDatabaseRow) {
    return row.id;
  }

  private applyDatabase(db: NoteDatabase) {
    this.database = db;
    this.block.view = db.view;
    this.viewChange.emit(db.view);
    this.mutate.emit();
  }

  toggleSort(column: NoteDatabaseColumn) {
    if (this.sortColumnId === column.id) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumnId = column.id;
      this.sortDirection = 'asc';
    }
  }
}

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS note_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  note_id UUID NULL REFERENCES notes(id) ON DELETE SET NULL,
  block_id TEXT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NULL,
  mime_type TEXT NULL,
  file_size BIGINT NULL,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_assets_user ON note_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_note_assets_note ON note_assets(note_id);

CREATE TABLE IF NOT EXISTS note_databases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NULL,
  view TEXT NOT NULL DEFAULT 'table',
  filters JSONB NULL,
  sorts JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_databases_user ON note_databases(user_id);
CREATE INDEX IF NOT EXISTS idx_note_databases_note ON note_databases(note_id);

CREATE TABLE IF NOT EXISTS note_database_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  database_id UUID NOT NULL REFERENCES note_databases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  config JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_database_columns_db ON note_database_columns(database_id);

CREATE TABLE IF NOT EXISTS note_database_rows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  database_id UUID NOT NULL REFERENCES note_databases(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_database_rows_db ON note_database_rows(database_id);

CREATE TABLE IF NOT EXISTS note_database_values (
  row_id UUID NOT NULL REFERENCES note_database_rows(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES note_database_columns(id) ON DELETE CASCADE,
  value JSONB NULL,
  PRIMARY KEY (row_id, column_id)
);

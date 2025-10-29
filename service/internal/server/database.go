package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type databaseRecord struct {
	ID        string          `db:"id" json:"id"`
	NoteID    string          `db:"note_id" json:"noteId"`
	Title     sql.NullString  `db:"title" json:"title,omitempty"`
	View      string          `db:"view" json:"view"`
	Filters   json.RawMessage `db:"filters" json:"filters,omitempty"`
	Sorts     json.RawMessage `db:"sorts" json:"sorts,omitempty"`
	CreatedAt time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time       `db:"updated_at" json:"updatedAt"`
}

type databaseColumn struct {
	ID        string          `db:"id" json:"id"`
	Database  string          `db:"database_id" json:"databaseId"`
	Name      string          `db:"name" json:"name"`
	Type      string          `db:"type" json:"type"`
	Position  int             `db:"position" json:"position"`
	Config    json.RawMessage `db:"config" json:"config,omitempty"`
	CreatedAt time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time       `db:"updated_at" json:"updatedAt"`
}

type databaseRow struct {
	ID        string         `db:"id" json:"id"`
	Database  string         `db:"database_id" json:"databaseId"`
	Position  int            `db:"position" json:"position"`
	Values    map[string]any `json:"values"`
	CreatedAt time.Time      `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time      `db:"updated_at" json:"updatedAt"`
	rawValues map[string]json.RawMessage
}

type databasePayload struct {
	databaseRecord
	Columns []databaseColumn `json:"columns"`
	Rows    []databaseRow    `json:"rows"`
}

func registerDatabaseRoutes(app *fiber.App, opts Options) {
	app.Post("/v1/databases", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		var in struct {
			NoteID  string          `json:"noteId"`
			Title   *string         `json:"title"`
			View    string          `json:"view"`
			Filters json.RawMessage `json:"filters"`
			Sorts   json.RawMessage `json:"sorts"`
		}
		if err := c.BodyParser(&in); err != nil || in.NoteID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "noteId required"})
		}
		if err := ensureNoteOwnership(opts.DB, in.NoteID, uid); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false})
		}
		view := in.View
		if view == "" {
			view = "table"
		}
		var payload databasePayload
		tx, err := opts.DB.BeginTxx(c.Context(), nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		defer tx.Rollback()
		if err := tx.QueryRowx(
			`INSERT INTO note_databases (user_id, note_id, title, view, filters, sorts, created_at, updated_at)
             VALUES ($1, $2, NULLIF($3,''), $4, $5, $6, now(), now())
             RETURNING id, note_id, title, view, COALESCE(filters,'null'::jsonb) AS filters, COALESCE(sorts,'null'::jsonb) AS sorts, created_at, updated_at`,
			uid, in.NoteID, optStr(in.Title), view, defaultJSON(in.Filters), defaultJSON(in.Sorts),
		).StructScan(&payload.databaseRecord); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		var col databaseColumn
		if err := tx.QueryRowx(
			`INSERT INTO note_database_columns (database_id, name, type, position, created_at, updated_at)
             VALUES ($1, $2, $3, 0, now(), now())
             RETURNING id, database_id, name, type, position, COALESCE(config,'null'::jsonb) AS config, created_at, updated_at`,
			payload.ID, "Name", "text",
		).StructScan(&col); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload.Columns = []databaseColumn{col}
		payload.Rows = []databaseRow{}
		if _, err := tx.Exec(`UPDATE notes SET updated_at = now() WHERE id=$1 AND user_id=$2`, in.NoteID, uid); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		if err := tx.Commit(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Get("/v1/databases/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Patch("/v1/databases/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		var in struct {
			Title   *string         `json:"title"`
			View    *string         `json:"view"`
			Filters json.RawMessage `json:"filters"`
			Sorts   json.RawMessage `json:"sorts"`
		}
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if err := updateDatabase(opts.DB, dbID, uid, in.Title, in.View, in.Filters, in.Sorts); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Post("/v1/databases/:id/columns", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		var in struct {
			Name     string          `json:"name"`
			Type     string          `json:"type"`
			Position *int            `json:"position"`
			Config   json.RawMessage `json:"config"`
		}
		if err := c.BodyParser(&in); err != nil || strings.TrimSpace(in.Name) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "name required"})
		}
		if err := createColumn(opts.DB, dbID, uid, in.Name, in.Type, in.Position, in.Config); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Patch("/v1/databases/:id/columns/:columnId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		columnID := c.Params("columnId")
		var in struct {
			Name     *string         `json:"name"`
			Type     *string         `json:"type"`
			Position *int            `json:"position"`
			Config   json.RawMessage `json:"config"`
		}
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if err := updateColumn(opts.DB, dbID, columnID, uid, in.Name, in.Type, in.Position, in.Config); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Delete("/v1/databases/:id/columns/:columnId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		columnID := c.Params("columnId")
		if err := deleteColumn(opts.DB, dbID, columnID, uid); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Post("/v1/databases/:id/rows", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		var in struct {
			Position *int           `json:"position"`
			Values   map[string]any `json:"values"`
		}
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if err := createRow(opts.DB, dbID, uid, in.Position, in.Values); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Patch("/v1/databases/:id/rows/:rowId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		rowID := c.Params("rowId")
		var in struct {
			Position *int           `json:"position"`
			Values   map[string]any `json:"values"`
		}
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if err := updateRow(opts.DB, dbID, rowID, uid, in.Position, in.Values); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})

	app.Delete("/v1/databases/:id/rows/:rowId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		dbID := c.Params("id")
		rowID := c.Params("rowId")
		if err := deleteRow(opts.DB, dbID, rowID, uid); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		payload, err := loadDatabase(opts.DB, dbID, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": payload})
	})
}

func ensureNoteOwnership(db *sqlx.DB, noteID, userID string) error {
	var exists bool
	if err := db.Get(&exists, `SELECT EXISTS(SELECT 1 FROM notes WHERE id=$1 AND user_id=$2)`, noteID, userID); err != nil {
		return err
	}
	if !exists {
		return sql.ErrNoRows
	}
	return nil
}

func loadDatabase(db *sqlx.DB, databaseID, userID string) (databasePayload, error) {
	var payload databasePayload
	if err := db.QueryRowx(
		`SELECT id, note_id, title, view, COALESCE(filters,'null'::jsonb) AS filters, COALESCE(sorts,'null'::jsonb) AS sorts, created_at, updated_at
         FROM note_databases WHERE id=$1 AND user_id=$2`, databaseID, userID,
	).StructScan(&payload.databaseRecord); err != nil {
		return payload, err
	}
	if err := db.Select(&payload.Columns,
		`SELECT id, database_id, name, type, position, COALESCE(config,'null'::jsonb) AS config, created_at, updated_at
         FROM note_database_columns WHERE database_id=$1 ORDER BY position ASC, created_at ASC`, payload.ID); err != nil {
		return payload, err
	}
	var rows []databaseRow
	if err := db.Select(&rows,
		`SELECT id, database_id, position, created_at, updated_at
         FROM note_database_rows WHERE database_id=$1 ORDER BY position ASC, created_at ASC`, payload.ID); err != nil {
		return payload, err
	}
	if len(rows) > 0 {
		type cell struct {
			RowID    string          `db:"row_id"`
			ColumnID string          `db:"column_id"`
			Value    json.RawMessage `db:"value"`
		}
		var cells []cell
		if err := db.Select(&cells,
			`SELECT v.row_id, v.column_id, COALESCE(v.value,'null'::jsonb) AS value
             FROM note_database_values v
             JOIN note_database_rows r ON r.id = v.row_id
             WHERE r.database_id=$1`, payload.ID); err != nil {
			return payload, err
		}
		cellMap := make(map[string]map[string]json.RawMessage)
		for _, c := range cells {
			if _, ok := cellMap[c.RowID]; !ok {
				cellMap[c.RowID] = make(map[string]json.RawMessage)
			}
			cellMap[c.RowID][c.ColumnID] = c.Value
		}
		for i := range rows {
			rows[i].Values = make(map[string]any)
			if rowCells, ok := cellMap[rows[i].ID]; ok {
				for colID, v := range rowCells {
					var val any
					if len(v) > 0 {
						if err := json.Unmarshal(v, &val); err == nil {
							rows[i].Values[colID] = val
						} else {
							rows[i].Values[colID] = string(v)
						}
					}
				}
			}
		}
	}
	payload.Rows = rows
	return payload, nil
}

func updateDatabase(db *sqlx.DB, databaseID, userID string, title *string, view *string, filters, sorts json.RawMessage) error {
	res, err := db.Exec(
		`UPDATE note_databases SET
            title = COALESCE(NULLIF($1,''), title),
            view = COALESCE(NULLIF($2,''), view),
            filters = COALESCE($3, filters),
            sorts = COALESCE($4, sorts),
            updated_at = now()
         WHERE id=$5 AND user_id=$6`,
		optStr(title), optStr(view), defaultJSON(filters), defaultJSON(sorts), databaseID, userID,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func createColumn(db *sqlx.DB, databaseID, userID, name, typ string, position *int, config json.RawMessage) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT note_id FROM note_databases WHERE id=$1 AND user_id=$2`, databaseID, userID); err != nil {
		return err
	}
	pos := 0
	if position != nil {
		pos = *position
	} else {
		_ = db.Get(&pos, `SELECT COALESCE(MAX(position)+1,0) FROM note_database_columns WHERE database_id=$1`, databaseID)
	}
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO note_database_columns (database_id, name, type, position, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
		databaseID, name, typ, pos, defaultJSON(config),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return tx.Commit()
}

func updateColumn(db *sqlx.DB, databaseID, columnID, userID string, name, typ *string, position *int, config json.RawMessage) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT note_id FROM note_databases WHERE id=$1 AND user_id=$2`, databaseID, userID); err != nil {
		return err
	}
	setPosition := ""
	var args []any
	args = append(args, optStr(name), optStr(typ), defaultJSON(config), columnID, databaseID)
	if position != nil {
		setPosition = ", position = $6"
		args = append(args, *position)
	}
	query := fmt.Sprintf(
		`UPDATE note_database_columns SET
            name = COALESCE(NULLIF($1,''), name),
            type = COALESCE(NULLIF($2,''), type),
            config = COALESCE($3, config),
            updated_at = now()%s
         WHERE id=$4 AND database_id=$5`, setPosition)
	res, err := db.Exec(query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, err := db.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := db.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return nil
}

func deleteColumn(db *sqlx.DB, databaseID, columnID, userID string) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT note_id FROM note_databases WHERE id=$1 AND user_id=$2`, databaseID, userID); err != nil {
		return err
	}
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM note_database_values WHERE column_id=$1`, columnID); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM note_database_columns WHERE id=$1 AND database_id=$2`, columnID, databaseID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, err := tx.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return tx.Commit()
}

func createRow(db *sqlx.DB, databaseID, userID string, position *int, values map[string]any) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT note_id FROM note_databases WHERE id=$1 AND user_id=$2`, databaseID, userID); err != nil {
		return err
	}
	pos := 0
	if position != nil {
		pos = *position
	} else {
		_ = db.Get(&pos, `SELECT COALESCE(MAX(position)+1,0) FROM note_database_rows WHERE database_id=$1`, databaseID)
	}
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var rowID string
	if err := tx.QueryRowx(
		`INSERT INTO note_database_rows (database_id, position, created_at, updated_at)
         VALUES ($1, $2, now(), now()) RETURNING id`,
		databaseID, pos,
	).Scan(&rowID); err != nil {
		return err
	}
	if len(values) > 0 {
		if err := upsertValues(tx, rowID, values); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return tx.Commit()
}

func updateRow(db *sqlx.DB, databaseID, rowID, userID string, position *int, values map[string]any) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT d.note_id FROM note_database_rows r JOIN note_databases d ON d.id = r.database_id WHERE r.id=$1 AND d.id=$2 AND d.user_id=$3`, rowID, databaseID, userID); err != nil {
		return err
	}
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if position != nil {
		if _, err := tx.Exec(`UPDATE note_database_rows SET position=$1, updated_at=now() WHERE id=$2`, *position, rowID); err != nil {
			return err
		}
	}
	if len(values) > 0 {
		if err := upsertValues(tx, rowID, values); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return tx.Commit()
}

func deleteRow(db *sqlx.DB, databaseID, rowID, userID string) error {
	var noteID string
	if err := db.Get(&noteID, `SELECT d.note_id FROM note_database_rows r JOIN note_databases d ON d.id = r.database_id WHERE r.id=$1 AND d.id=$2 AND d.user_id=$3`, rowID, databaseID, userID); err != nil {
		return err
	}
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM note_database_values WHERE row_id=$1`, rowID); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM note_database_rows WHERE id=$1`, rowID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	if _, err := tx.Exec(`UPDATE note_databases SET updated_at=now() WHERE id=$1`, databaseID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE notes SET updated_at=now() WHERE id=$1`, noteID); err != nil {
		return err
	}
	return tx.Commit()
}

func upsertValues(tx *sqlx.Tx, rowID string, values map[string]any) error {
	if len(values) == 0 {
		return nil
	}
	columns := make([]string, 0, len(values))
	for k := range values {
		columns = append(columns, k)
	}
	sort.Strings(columns)
	for _, columnID := range columns {
		payload, err := json.Marshal(values[columnID])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO note_database_values (row_id, column_id, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (row_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
			rowID, columnID, json.RawMessage(payload),
		); err != nil {
			return err
		}
	}
	return nil
}

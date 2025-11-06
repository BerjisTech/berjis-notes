package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/jmoiron/sqlx"
)

type Options struct {
	AllowedOrigins string
	CoreAPIBase    string
	DB             *sqlx.DB
	UploadDir      string
	AssetsBaseURL  string
	UploadMaxBytes int64
}

type Note struct {
	ID        string          `db:"id" json:"id"`
	UserID    string          `db:"user_id" json:"userId"`
	Title     *string         `db:"title" json:"title,omitempty"`
	Content   *string         `db:"content" json:"content,omitempty"`
	Todos     json.RawMessage `db:"todos" json:"todos,omitempty"`
	Status    string          `db:"status" json:"status"`
	CreatedAt time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time       `db:"updated_at" json:"updatedAt"`
}

func New(opts Options) *fiber.App {
	app := fiber.New()
	app.Use(cors.New(cors.Config{
		AllowOrigins:     opts.AllowedOrigins,
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Authorization,Content-Type,Accept",
		AllowCredentials: true,
	}))
	if opts.UploadDir != "" {
		app.Static("/uploads", opts.UploadDir, fiber.Static{
			Compress:      false,
			Browse:        false,
			CacheDuration: 24 * time.Hour,
		})
	}

	registerAssetRoutes(app, opts)
	registerBookmarkRoutes(app, opts)
	registerDatabaseRoutes(app, opts)
	registerSearchRoutes(app, opts)
	registerExportRoutes(app, opts)

	app.Get("/v1/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"success": true}) })

	// List notes
	app.Get("/v1/notes", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		statuses := c.Query("status", "active")
		q := `SELECT id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at FROM notes n
              WHERE (n.user_id=$1 OR EXISTS (SELECT 1 FROM note_collaborators c WHERE c.note_id=n.id AND c.user_id=$1))
                AND n.status = ANY(string_to_array($2, ',')) 
              ORDER BY n.updated_at DESC`
		rows := []Note{}
		if err := opts.DB.Select(&rows, q, uid, statuses); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": rows})
	})

	// Get note
	app.Get("/v1/notes/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var n Note
		if err := opts.DB.Get(&n, `SELECT id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at FROM notes n
            WHERE n.id=$1 AND (n.user_id=$2 OR EXISTS (SELECT 1 FROM note_collaborators c WHERE c.note_id=n.id AND c.user_id=$2))`, id, uid); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": n})
	})

	type noteIn struct {
		Title   *string         `json:"title"`
		Content *string         `json:"content"`
		Todos   json.RawMessage `json:"todos"`
		Status  *string         `json:"status"`
	}

	// Create note (only if non-empty)
	app.Post("/v1/notes", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		var in noteIn
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		hasTitle := in.Title != nil && strings.TrimSpace(*in.Title) != ""
		hasContent := in.Content != nil && strings.TrimSpace(stripHTML(*in.Content)) != ""
		hasTodos := len(in.Todos) > 2 // [] or [{}]
		if !hasTitle && !hasContent && !hasTodos {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "empty"})
		}
		var n Note
		if err := opts.DB.Get(&n, `INSERT INTO notes (user_id, title, content, todos, status)
            VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,'null'::jsonb), COALESCE(NULLIF($5,''),'active'))
            RETURNING id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at`, uid, optStr(in.Title), optStr(in.Content), defaultJSON(in.Todos), optStr(in.Status)); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": n})
	})

	// Update note
	app.Put("/v1/notes/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var in noteIn
		if err := c.BodyParser(&in); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		var n Note
		if err := opts.DB.Get(&n, `UPDATE notes SET
            title = NULLIF($1,''),
            content = NULLIF($2,''),
            todos = NULLIF($3,'null'::jsonb),
            status = COALESCE(NULLIF($4,''), status),
            updated_at = now()
            WHERE id=$5 AND (
              user_id=$6 OR EXISTS(SELECT 1 FROM note_collaborators nc WHERE nc.note_id=$5 AND nc.user_id=$6 AND nc.role='editor')
            )
            RETURNING id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at`,
			optStr(in.Title), optStr(in.Content), defaultJSON(in.Todos), optStr(in.Status), id, uid); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": n})
	})

	// Archive
	app.Post("/v1/notes/:id/archive", func(c *fiber.Ctx) error {
		return setStatus(opts, c, "archived")
	})
	// Restore
	app.Post("/v1/notes/:id/restore", func(c *fiber.Ctx) error {
		return setStatus(opts, c, "active")
	})
	// Soft delete
	app.Delete("/v1/notes/:id", func(c *fiber.Ctx) error {
		return setStatus(opts, c, "deleted")
	})

	// Collaborators (owner-managed)
	app.Get("/v1/notes/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM notes WHERE id=$1`, id); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
		}
		if owner != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false})
		}
		type row struct {
			UserID, Role, InvitedBy string
			CreatedAt               time.Time
		}
		rows := []row{}
		_ = opts.DB.Select(&rows, `SELECT user_id, role, invited_by, created_at FROM note_collaborators WHERE note_id=$1 ORDER BY created_at DESC`, id)
		return c.JSON(fiber.Map{"success": true, "data": rows})
	})
	app.Post("/v1/notes/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM notes WHERE id=$1`, id); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
		}
		if owner != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false})
		}
		var body struct{ UserID, Role string }
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		role := strings.ToLower(strings.TrimSpace(body.Role))
		if body.UserID == "" || (role != "viewer" && role != "commenter" && role != "editor") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if _, err := opts.DB.Exec(`INSERT INTO note_collaborators (note_id, user_id, role, invited_by) VALUES ($1,$2,$3,$4)
		  ON CONFLICT (note_id, user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now()`, id, body.UserID, role, uid); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true})
	})
	app.Delete("/v1/notes/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM notes WHERE id=$1`, id); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
		}
		if owner != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"success": false})
		}
		userID := strings.TrimSpace(c.Query("user_id"))
		if userID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
		}
		if _, err := opts.DB.Exec(`DELETE FROM note_collaborators WHERE note_id=$1 AND user_id=$2`, id, userID); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true})
	})

	return app
}

func setStatus(opts Options, c *fiber.Ctx, status string) error {
	if opts.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}
	uid, err := getUserID(opts, c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
	}
	id := c.Params("id")
	var n Note
	if err := opts.DB.Get(&n, `UPDATE notes SET status=$1, updated_at=now() WHERE id=$2 AND (
        user_id=$3 OR EXISTS(SELECT 1 FROM note_collaborators nc WHERE nc.note_id=$2 AND nc.user_id=$3 AND nc.role='editor')
      )
        RETURNING id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at`, status, id, uid); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": n})
}

func stripHTML(s string) string {
	out := make([]rune, 0, len(s))
	inTag := false
	for _, r := range s {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				out = append(out, r)
			}
		}
	}
	return strings.TrimSpace(string(out))
}

func optStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func defaultJSON(j json.RawMessage) json.RawMessage {
	if len(j) == 0 {
		return json.RawMessage("null")
	}
	return j
}

var authClient = &http.Client{Timeout: 3 * time.Second}

func getUserID(opts Options, c *fiber.Ctx) (string, error) {
	req, _ := http.NewRequest("GET", strings.TrimRight(opts.CoreAPIBase, "/")+"/v1/auth/verify", nil)
	if v := c.Get("Authorization"); v != "" {
		req.Header.Set("Authorization", v)
	}
	if v := c.Get("Cookie"); v != "" {
		req.Header.Set("Cookie", v)
	}
	resp, err := authClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var raw map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return "", err
	}
	data, _ := raw["data"].(map[string]any)
	if data == nil {
		return "", fiber.ErrUnauthorized
	}
	valid, _ := data["valid"].(bool)
	if !valid {
		return "", fiber.ErrUnauthorized
	}
	if uidAny, ok := data["uid"]; ok {
		switch v := uidAny.(type) {
		case float64:
			return fmt.Sprintf("%0.0f", v), nil
		case string:
			return v, nil
		default:
			return "", fiber.ErrUnauthorized
		}
	}
	if uidStr, ok := data["userId"].(string); ok && uidStr != "" {
		return uidStr, nil
	}
	return "", fiber.ErrUnauthorized
}

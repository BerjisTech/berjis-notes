package server

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

func registerExportRoutes(app *fiber.App, opts Options) {
	app.Get("/v1/notes/:id/export", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		noteID := c.Params("id")
		var note Note
		if err := opts.DB.Get(&note,
			`SELECT id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at
             FROM notes WHERE id=$1 AND user_id=$2`, noteID, uid); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"success": false})
		}
		ctx, cancel := exportContext(c, 5*time.Second)
		defer cancel()
		markdown, err := generateMarkdown(ctx, opts.DB, opts, note, uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		filename := buildNoteFilename(note)
		c.Set("Content-Type", "text/markdown; charset=utf-8")
		c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		return c.SendString(markdown)
	})
}

func buildNoteFilename(note Note) string {
	name := "note"
	if note.Title != nil && strings.TrimSpace(*note.Title) != "" {
		name = strings.TrimSpace(*note.Title)
	}
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, " ", "-")
	if name == "" {
		name = "note"
	}
	name = url.PathEscape(name)
	return name + ".md"
}

func exportContext(c *fiber.Ctx, timeout time.Duration) (context.Context, context.CancelFunc) {
	base := c.UserContext()
	if base == nil {
		base = context.Background()
	}
	ctx, cancel := context.WithTimeout(base, timeout)
	reqCtx := c.Context()
	if reqCtx != nil {
		if done := reqCtx.Done(); done != nil {
			go func() {
				select {
				case <-done:
					cancel()
				case <-ctx.Done():
				}
			}()
		}
	}
	return ctx, cancel
}

package server

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

func registerSearchRoutes(app *fiber.App, opts Options) {
	app.Get("/v1/search", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		query := strings.TrimSpace(c.Query("q"))
		if query == "" {
			return c.JSON(fiber.Map{"success": true, "data": []any{}})
		}
		pattern := "%" + strings.ToLower(query) + "%"
		var notes []Note
		sql := `SELECT id, user_id, title, content, COALESCE(todos,'null'::jsonb) AS todos, status, created_at, updated_at
		        FROM notes
		        WHERE user_id=$1 AND status != 'deleted'
		          AND (LOWER(COALESCE(title,'')) LIKE $2 OR LOWER(COALESCE(content,'')) LIKE $2)
		        ORDER BY updated_at DESC LIMIT 20`
		if err := opts.DB.Select(&notes, sql, uid, pattern); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		results := make([]fiber.Map, 0, len(notes))
		for _, n := range notes {
			snippet := ""
			if n.Content != nil {
				snippet = documentToPlainText(*n.Content)
				snippet = buildSnippet(snippet, query, 160)
			}
			title := ""
			if n.Title != nil {
				title = *n.Title
			}
			results = append(results, fiber.Map{
				"id":        n.ID,
				"title":     title,
				"snippet":   snippet,
				"updatedAt": n.UpdatedAt,
			})
		}
		return c.JSON(fiber.Map{"success": true, "data": results})
	})
}

func buildSnippet(body, query string, maxLen int) string {
	if len(body) <= maxLen {
		return body
	}
	lowerBody := strings.ToLower(body)
	index := strings.Index(lowerBody, strings.ToLower(query))
	if index == -1 {
		return body[:maxLen] + "…"
	}
	start := index - maxLen/2
	if start < 0 {
		start = 0
	}
	end := start + maxLen
	if end > len(body) {
		end = len(body)
	}
	snippet := body[start:end]
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(body) {
		snippet += "…"
	}
	return snippet
}

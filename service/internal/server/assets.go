package server

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func registerAssetRoutes(app *fiber.App, opts Options) {
	if opts.UploadDir == "" {
		return
	}

	app.Post("/v1/assets/images", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": "storage unavailable"})
		}
		uid, err := getUserID(opts, c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "file is required"})
		}
		if opts.UploadMaxBytes > 0 && fileHeader.Size > opts.UploadMaxBytes {
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"success": false, "message": "file too large"})
		}
		extension := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if extension == "" {
			extension = ".bin"
		}
		fileName := fmt.Sprintf("%s%s", uuid.New().String(), extension)
		dst := filepath.Join(opts.UploadDir, fileName)
		if err := c.SaveFile(fileHeader, dst); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		noteIDVal := c.FormValue("noteId")
		blockIDVal := c.FormValue("blockId")
		var noteID sql.NullString
		if noteIDVal != "" {
			noteID = sql.NullString{String: noteIDVal, Valid: true}
		}
		var blockID sql.NullString
		if blockIDVal != "" {
			blockID = sql.NullString{String: blockIDVal, Valid: true}
		}
		publicURL := buildAssetURL(opts, c, fileName)
		var assetID string
		if err := opts.DB.QueryRow(
			`INSERT INTO note_assets (user_id, note_id, block_id, kind, file_name, mime_type, file_size, storage_path, url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
			uid,
			noteID,
			blockID,
			"image",
			fileHeader.Filename,
			fileHeader.Header.Get("Content-Type"),
			fileHeader.Size,
			dst,
			publicURL,
			time.Now(),
		).Scan(&assetID); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{
			"success": true,
			"data": fiber.Map{
				"id":       assetID,
				"url":      publicURL,
				"fileName": fileHeader.Filename,
				"mimeType": fileHeader.Header.Get("Content-Type"),
				"size":     fileHeader.Size,
			},
		})
	})
}

func buildAssetURL(opts Options, c *fiber.Ctx, fileName string) string {
	base := strings.TrimSpace(opts.AssetsBaseURL)
	if base != "" {
		return strings.TrimRight(base, "/") + "/uploads/" + fileName
	}
	proto := c.Protocol()
	if proto == "" {
		proto = "https"
	}
	host := c.Hostname()
	if host == "" {
		host = string(c.Request().Host())
	}
	return fmt.Sprintf("%s://%s/uploads/%s", proto, host, fileName)
}

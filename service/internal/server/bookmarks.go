package server

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/gofiber/fiber/v2"
)

var bookmarkClient = &http.Client{
	Timeout: 6 * time.Second,
}

func registerBookmarkRoutes(app *fiber.App, opts Options) {
	app.Post("/v1/bookmarks/preview", func(c *fiber.Ctx) error {
		if _, err := getUserID(opts, c); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
		}
		var req struct {
			URL string `json:"url"`
		}
		if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.URL) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "url is required"})
		}
		u := strings.TrimSpace(req.URL)
		parsed, err := url.ParseRequestURI(u)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false, "message": "invalid url"})
		}
		resp, err := bookmarkClient.Get(u)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		defer resp.Body.Close()
		doc, err := goquery.NewDocumentFromReader(resp.Body)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"success": false, "message": "unable to read page"})
		}
		title := firstNonEmpty(
			strings.TrimSpace(doc.Find(`meta[property="og:title"]`).AttrOr("content", "")),
			strings.TrimSpace(doc.Find(`meta[name="twitter:title"]`).AttrOr("content", "")),
			strings.TrimSpace(doc.Find("title").First().Text()),
		)
		description := firstNonEmpty(
			strings.TrimSpace(doc.Find(`meta[property="og:description"]`).AttrOr("content", "")),
			strings.TrimSpace(doc.Find(`meta[name="description"]`).AttrOr("content", "")),
			strings.TrimSpace(doc.Find(`meta[name="twitter:description"]`).AttrOr("content", "")),
		)
		image := firstNonEmpty(
			strings.TrimSpace(doc.Find(`meta[property="og:image"]`).AttrOr("content", "")),
			strings.TrimSpace(doc.Find(`meta[name="twitter:image"]`).AttrOr("content", "")),
		)
		return c.JSON(fiber.Map{
			"success": true,
			"data": fiber.Map{
				"url":         u,
				"title":       title,
				"description": description,
				"image":       image,
			},
		})
	})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

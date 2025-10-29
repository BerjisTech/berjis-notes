package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
)

type editorDocument struct {
	Version int            `json:"version"`
	Blocks  []editorBlock  `json:"blocks"`
	Meta    map[string]any `json:"meta"`
}

type editorBlock struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	HTML        string         `json:"html"`
	Code        string         `json:"code"`
	Language    string         `json:"language"`
	Checked     bool           `json:"checked"`
	URL         string         `json:"url"`
	Caption     string         `json:"caption"`
	Props       map[string]any `json:"props"`
	DatabaseID  string         `json:"databaseId"`
	Data        map[string]any `json:"data"`
	Bookmark    map[string]any `json:"bookmark"`
	CaptionHTML string         `json:"captionHtml"`
}

func parseEditorDocument(raw string) (editorDocument, error) {
	if strings.TrimSpace(raw) == "" {
		return editorDocument{Blocks: []editorBlock{}}, nil
	}
	var doc editorDocument
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return editorDocument{}, err
	}
	if doc.Blocks == nil {
		doc.Blocks = []editorBlock{}
	}
	return doc, nil
}

func documentToPlainText(raw string) string {
	doc, err := parseEditorDocument(raw)
	if err != nil {
		return stripHTML(raw)
	}
	var parts []string
	for _, block := range doc.Blocks {
		switch block.Type {
		case "heading-1", "heading-2", "heading-3", "paragraph", "quote", "callout-info", "callout-warning", "callout-success":
			parts = append(parts, stripHTML(block.HTML))
		case "bulleted-list", "numbered-list":
			parts = append(parts, stripHTML(block.HTML))
		case "todo":
			prefix := "[ ]"
			if block.Checked {
				prefix = "[x]"
			}
			parts = append(parts, fmt.Sprintf("%s %s", prefix, stripHTML(block.HTML)))
		case "code":
			parts = append(parts, block.Code)
		case "divider":
			parts = append(parts, "----")
		case "image":
			text := stripHTML(block.Caption)
			if text == "" {
				text = block.URL
			}
			parts = append(parts, text)
		case "bookmark":
			if block.Bookmark != nil {
				if title, ok := block.Bookmark["title"].(string); ok && title != "" {
					parts = append(parts, title)
					break
				}
			}
			parts = append(parts, block.URL)
		case "database":
			parts = append(parts, "[database]")
		default:
			if block.HTML != "" {
				parts = append(parts, stripHTML(block.HTML))
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func generateMarkdown(ctx context.Context, db *sqlx.DB, opts Options, note Note, userID string) (string, error) {
	var buf bytes.Buffer
	title := ""
	if note.Title != nil && strings.TrimSpace(*note.Title) != "" {
		title = strings.TrimSpace(*note.Title)
		buf.WriteString("# ")
		buf.WriteString(title)
		buf.WriteString("\n\n")
	}
	if note.Content == nil || strings.TrimSpace(*note.Content) == "" {
		return buf.String(), nil
	}
	doc, err := parseEditorDocument(*note.Content)
	if err != nil {
		buf.WriteString(stripHTML(*note.Content))
		buf.WriteString("\n")
		return buf.String(), nil
	}
	for _, block := range doc.Blocks {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		switch block.Type {
		case "heading-1":
			writeHeading(&buf, 1, block.HTML)
		case "heading-2":
			writeHeading(&buf, 2, block.HTML)
		case "heading-3":
			writeHeading(&buf, 3, block.HTML)
		case "paragraph":
			writeParagraph(&buf, block.HTML)
		case "bulleted-list":
			buf.WriteString("- ")
			buf.WriteString(stripHTML(block.HTML))
			buf.WriteString("\n\n")
		case "numbered-list":
			buf.WriteString("1. ")
			buf.WriteString(stripHTML(block.HTML))
			buf.WriteString("\n\n")
		case "todo":
			state := " "
			if block.Checked {
				state = "x"
			}
			buf.WriteString(fmt.Sprintf("- [%s] %s\n\n", state, stripHTML(block.HTML)))
		case "quote":
			buf.WriteString("> ")
			buf.WriteString(stripHTML(block.HTML))
			buf.WriteString("\n\n")
		case "callout-info", "callout-warning", "callout-success":
			buf.WriteString("> ")
			buf.WriteString(stripHTML(block.HTML))
			buf.WriteString("\n\n")
		case "code":
			lang := strings.TrimSpace(block.Language)
			buf.WriteString("```")
			buf.WriteString(lang)
			buf.WriteString("\n")
			buf.WriteString(block.Code)
			if !strings.HasSuffix(block.Code, "\n") {
				buf.WriteString("\n")
			}
			buf.WriteString("```\n\n")
		case "divider":
			buf.WriteString("---\n\n")
		case "image":
			caption := strings.TrimSpace(block.Caption)
			if caption == "" {
				caption = "image"
			}
			buf.WriteString(fmt.Sprintf("![%s](%s)\n\n", caption, block.URL))
		case "bookmark":
			title := stripHTML(block.HTML)
			if block.Bookmark != nil {
				if t, ok := block.Bookmark["title"].(string); ok && t != "" {
					title = t
				}
			}
			if title == "" {
				title = block.URL
			}
			buf.WriteString(fmt.Sprintf("[%s](%s)\n\n", title, block.URL))
		case "database":
			markdown, err := renderDatabaseMarkdown(db, opts, block, userID)
			if err != nil {
				return "", err
			}
			if markdown != "" {
				buf.WriteString(markdown)
				if !strings.HasSuffix(markdown, "\n\n") {
					buf.WriteString("\n\n")
				}
			}
		default:
			if block.HTML != "" {
				writeParagraph(&buf, block.HTML)
			}
		}
	}
	return strings.TrimSpace(buf.String()) + "\n", nil
}

func writeHeading(buf *bytes.Buffer, level int, html string) {
	if level < 1 {
		level = 1
	}
	if level > 6 {
		level = 6
	}
	buf.WriteString(strings.Repeat("#", level))
	buf.WriteString(" ")
	buf.WriteString(stripHTML(html))
	buf.WriteString("\n\n")
}

func writeParagraph(buf *bytes.Buffer, html string) {
	text := strings.TrimSpace(stripHTML(html))
	if text == "" {
		buf.WriteString("\n")
		return
	}
	buf.WriteString(text)
	buf.WriteString("\n\n")
}

func renderDatabaseMarkdown(db *sqlx.DB, opts Options, block editorBlock, userID string) (string, error) {
	databaseID := block.DatabaseID
	if databaseID == "" && block.Props != nil {
		if v, ok := block.Props["databaseId"].(string); ok {
			databaseID = v
		}
	}
	if databaseID == "" {
		return "", nil
	}
	payload, err := loadDatabase(db, databaseID, userID)
	if err != nil {
		return "", err
	}
	if len(payload.Columns) == 0 {
		return "", nil
	}
	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("### Database %s\n\n", databaseID))
	// header
	for i, col := range payload.Columns {
		if i > 0 {
			buf.WriteString(" | ")
		}
		buf.WriteString(stripPipes(col.Name))
	}
	buf.WriteString("\n")
	for i := range payload.Columns {
		if i > 0 {
			buf.WriteString("|")
		}
		buf.WriteString(" --- ")
	}
	buf.WriteString("\n")
	for _, row := range payload.Rows {
		for i, col := range payload.Columns {
			if i > 0 {
				buf.WriteString(" | ")
			}
			var cell string
			if v, ok := row.Values[col.ID]; ok && v != nil {
				switch val := v.(type) {
				case string:
					cell = stripPipes(val)
				default:
					raw, _ := json.Marshal(val)
					cell = stripPipes(string(raw))
				}
			}
			buf.WriteString(cell)
		}
		buf.WriteString("\n")
	}
	buf.WriteString("\n")
	return buf.String(), nil
}

func stripPipes(s string) string {
	s = stripHTML(s)
	return strings.ReplaceAll(s, "|", "\\|")
}

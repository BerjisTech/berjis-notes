# Berjis Notes – Modern Editor

This package delivers the Notion-style experience for the Berjis file-management suite. It pairs an Angular front-end with a Go (Fiber + PostgreSQL) service that now supports rich blocks, database views, global search, and Markdown export.

## Frontend Highlights
- Block editor supports paragraphs, headings, todos, code, callouts, bookmarks, images, dividers, and structured database blocks.
- Drag and drop blocks, invoke slash commands (`/`) to switch types, and use keyboard shortcuts (Ctrl/Cmd + B/I/U, Ctrl + K for search).
- Image blocks upload directly to the Go service; bookmark blocks show metadata fetched server-side.
- Database blocks create server-backed tables with column/row CRUD, filters, and toggles between table and list layouts.
- Global search, Markdown export, dark mode toggle, and offline-first autosave flow are exposed from the redesigned shell.

## Backend Highlights
- REST endpoints under `/v1/assets`, `/v1/bookmarks`, `/v1/databases`, `/v1/search`, and `/v1/notes/:id/export` back the new UI features.
- Local file uploads respect `UPLOAD_DIR`; the service serves `/uploads` statically and exposes `AssetsBaseURL` for the frontend.
- Database migrations add tables for note databases, columns, rows, and asset metadata (ensure migration `0002` is applied).
- Auth verification reuses a shared HTTP client and respects request cancellation inside the export flow.

## Running the Stack
1. **Install dependencies**
   ```bash
   cd file-management/notes
   yarn install
   ```
2. **Serve the Angular app**
   ```bash
   yarn start
   ```
3. **Run the Go service**
   ```bash
   cd service
   go run ./cmd/service
   ```
   Provide environment variables:
   - `DATABASE_URL` – PostgreSQL connection string
   - `CORE_API_BASE` – URL to the shared auth API (for JWT verification)
   - `UPLOAD_DIR` – writable path for image uploads (created on startup)
   - `ASSETS_BASE_URL` – public URL prefix for uploaded assets

## Feature Walkthrough
- **Search**: Use the global search bar (or `Ctrl/Cmd + K`). Results stream from `/v1/search` with a local fallback when offline.
- **Export**: From the editor header, trigger Markdown export; backend assembles blocks, embeds database snapshots, and streams a `.md` file.
- **Database Blocks**: Selecting “Database” from slash commands provisions a new table tied to the current note. Column/row edits sync instantly.
- **Image Uploads & Bookmarks**: Paste or upload images to `/v1/assets/images`. Bookmark previews call `/v1/bookmarks/preview` and hydrate inline cards.
- **Offline Mode**: Notes persist to IndexedDB/localStorage when remote calls fail. Sync status appears in the sidebar header.

## Testing & Validation
- Frontend: `yarn test` (unit) or `yarn build` to ensure Tailwind + Angular build passes without selector warnings.
- Backend: `go test ./...` inside `service/` to validate database, search, and export logic.

## Next Steps
- Add E2E coverage for database interactions, uploads, and bookmark previews.
- Expand backend tests around new endpoints and markdown export edge cases.
- Consider promoting the new `surface` styles into Tailwind plugin utilities for reuse across apps.

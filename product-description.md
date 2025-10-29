Core Editor Features Required:
Block-Based Editor:

Every piece of content is a block (paragraph, heading, list, code, etc.)
Drag and drop to reorder blocks
Type "/" to open block type selector
Press Enter to create new block
Press Backspace on empty block to delete it
Click and drag the handle (⋮⋮) on the left to move blocks

Block Types to Support:

Text (paragraph)
Headings (H1, H2, H3)
Bulleted list
Numbered list
To-do checkbox
Code block (with syntax highlighting)
Quote
Callout (info, warning, success)
Divider
Image upload
Link/bookmark preview

Text Formatting:

Bold (Cmd/Ctrl + B)
Italic (Cmd/Ctrl + I)
Underline (Cmd/Ctrl + U)
Strikethrough
Inline code
Highlight
Text color options
Markdown shortcuts (**, *, ~~, etc.)

Page Features:

Nested pages (pages within pages)
Page hierarchy/tree navigation in sidebar
Breadcrumb navigation
Page icons and cover images
Page properties (created date, modified date)
Search functionality across all pages

Database Features (simplified):

Table view
Create columns with types: text, number, select, multi-select, date, checkbox
Add, edit, delete rows
Filter rows
Sort by columns
Toggle between table and list view

Essential Features:

Auto-save (debounced)
Offline support (save to IndexedDB, sync when online)
Export to Markdown
Dark mode toggle
Responsive design

Technical Requirements:
Frontend (Angular):

Use ContentEditable or build custom editor with Angular components
RxJS for state management
Angular Material or TailwindCSS for UI
IndexedDB for offline storage
Rich text editing library recommendation (ProseMirror, Quill, or TipTap)

Backend (Go):

RESTful API or GraphQL
PostgreSQL for data storage
JWT authentication
File upload handling for images
WebSocket for real-time updates (optional for v1)

Data Models:

Pages (id, title, icon, parent_id, content_blocks, created_at, updated_at)
Blocks (id, type, content, order, page_id)
Users (id, email, password_hash)
Databases (id, page_id, columns, rows)

Deliverables:

Project structure for both Angular and Go apps
Database schema with migration files
Complete Angular components for:

Editor component with block rendering
Sidebar with page tree
Block type selector menu
Formatting toolbar


Go API endpoints for:

CRUD operations for pages and blocks
User authentication
File uploads
Search


Docker Compose file for easy self-hosting
README with setup instructions

Implementation Priority:
Phase 1 (MVP):

Basic block editor (text, headings, lists)
Create/edit/delete pages
Sidebar navigation
Auto-save

Phase 2:

All block types
Text formatting
Search
Dark mode

Phase 3:

Database/table views
Export functionality
Image uploads

Additional Notes:

Start with Phase 1 MVP - get a working editor first
Use existing libraries where possible (don't reinvent the wheel)
Focus on clean, maintainable code
Include TypeScript types and Go struct definitions
Provide example data/seed files for testing

Build this step by step, starting with the basic block editor architecture and page management system.
# JobTracker

A standalone, local job-search tracker. All data lives in a single SQLite database on your machine — no hosting, no accounts. It can track jobs for **multiple people** (e.g. family members): each person has their own job list, standard resume, and documents folder, and the UI's header selector switches between them. It has two front doors:

- **A React web UI** (served locally) for viewing and editing your pipeline — status changes and notes save instantly.
- **An MCP server** so Claude (a Cowork job, Claude Code, or Claude Desktop) can add each day's job suggestions and query/update the tracker in conversation.

Both share the same database (`data/jobtracker.db`), so an update from either side shows up in the other.

## Setup

```
npm install
npm run build
```

## Running the web UI

Double-click **`Start JobTracker.cmd`**, or run:

```
npm start
```

Then open http://localhost:7080. The UI auto-refreshes every 30 seconds, so changes Claude makes through the MCP server appear while the page is open.

## Connecting Claude via MCP

The MCP server is `server/mcp-server.js` (stdio). It does not need the web server running — it talks straight to the database.

**Claude Code**: this repo's `.mcp.json` registers the server automatically for sessions in this directory. From elsewhere:

```
claude mcp add jobtracker -- node C:\Code\JobTracker\server\mcp-server.js
```

**Claude Desktop / Cowork**: add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jobtracker": {
      "command": "node",
      "args": ["C:\\Code\\JobTracker\\server\\mcp-server.js"]
    }
  }
}
```

Then update the Cowork job's instructions: instead of generating a new HTML file, call the `add_jobs` tool with the day's findings. Duplicate URLs are skipped automatically, so it's always safe to send everything found.

### MCP tools

| Tool | Purpose |
|---|---|
| `add_jobs` | Add new opportunities for one person (bulk); URLs that person already tracks are skipped |
| `list_jobs` | List/filter by person, status, company, text search, or date |
| `get_job` | Fetch one job by id or URL |
| `update_job` | Change status, notes (replace or append), salary, etc. |
| `delete_job` | Remove an entry (prefer status "Not Moving Forward") |
| `get_summary` | Counts by status + latest find date (optionally per person) |
| `list_people` | The tracked candidates, with job counts and per-person config |
| `add_person` | Add a person to track jobs for |
| `update_person` | Rename a person |
| `generate_documents` | Tailored resume + cover letter for one job, or all `Interested` jobs |
| `configure_document_generation` | View/set one person's standard resume path and documents folder |

Tools that need a person (`add_jobs`, `configure_document_generation`, …) take a `person` argument — the person's name. It can be omitted while only one person is tracked. Job posting URLs are unique **per person**, so two people can track the same posting independently; URL-based lookups accept `person` to disambiguate.

Statuses: `new`, `Interested`, `Applied`, `Interviewing`, `Offer`, `Not Moving Forward`.

Every job also has a seniority **level** used for grouping and filtering: `Senior`, `Staff`, `Principal`, `Lead`, `Manager`, `Senior Manager`, `Director`, `Senior Director`, `VP`, `Executive`, or `Other`. `add_jobs` accepts an optional `level`; when omitted, the level is classified automatically from the job title (e.g. "Sr. Engineering Manager, Platform" → `Senior Manager`). Misclassifications can be corrected inline in the UI's Level column or via `update_job`.

## Tailored resumes & cover letters

JobTracker can generate a resume and cover letter tailored to a specific posting, using the Anthropic API (Claude Opus). The standard resume and documents folder are configured **per person** — open Settings with a person selected in the header and you're editing that person's config (generation for a job always uses the resume of the person the job belongs to). Setup:

1. Set `ANTHROPIC_API_KEY` in the environment the server runs in, then start the server. The key is never stored by the app.
2. Open **Settings** (⚙ in the UI) and set the selected person's **Standard resume** — use **Choose file…** (native Windows dialog) or drag-and-drop. Either way the server stores a snapshot it can read, and the browser keeps a link to your original file (File System Access API), refreshing the snapshot from it automatically before every generation — so edits to your resume are always picked up. A **⟳ Refresh from original now** button in Settings forces a sync, and typing/pasting a path into the field still points at a server-side file directly (read in place, no snapshot). Supported formats: PDF, Word `.docx`, Markdown, or plain text. The resume is the source of truth — generated documents never claim anything that isn't in it. With a `.docx` resume, generated documents are **`.docx` files that mirror the original's formatting**: Claude writes a new `word/document.xml` reusing the original's styles, and it's packaged into a copy of your resume's own file (same styles, fonts, numbering, headers, page setup). Other resume formats produce Markdown documents.
3. Optionally change the **Documents folder** (default: `data/documents`).

Generate from the ✨ button on any job row, from **✨ Generate for Interested** in the header (batch over every `Interested` job, skipping ones that already have documents), or from Claude via the `generate_documents` MCP tool. Each job gets its own subfolder (`<id> - <company> - <title>`) containing the resume and cover letter (`.docx` or `.md`, matching the standard resume's format); the `job_documents` table stores their relative paths. Local `file://` postings are sent to the model directly; http(s) postings are fetched by the model via web fetch.

The writing instructions live in `skills/tailored-resume/SKILL.md` and `skills/tailored-cover-letter/SKILL.md` — edit those files to change how the documents are written.

## Importing old daily tracker files

Each daily HTML file the Cowork job produced embeds its job data. Import one file or a whole folder:

```
npm run import -- "C:\Users\you\Downloads\tracker_3.html"
npm run import -- "C:\Users\you\Downloads\trackers\"
```

Already-imported jobs (same URL) are skipped, so re-running is safe.

## REST API

The web server also exposes the data at `http://localhost:7080/api`:

- `GET /api/jobs` — query params: `person` (id), `status`, `company`, `level`, `q`, `since`, `limit`
- `POST /api/jobs` — body: job object or array (requires `title`, `company`, `url`; each job may carry `person_id`, otherwise `?person=<id>` applies)
- `GET /api/jobs/:id`, `PATCH /api/jobs/:id`, `DELETE /api/jobs/:id`
- `GET /api/people`, `POST /api/people`, `GET|PATCH|DELETE /api/people/:id` — the tracked candidates (delete requires the person to have no jobs)
- `GET /api/stats` — query param: `person` (id)
- `GET /api/settings?person=<id>`, `PATCH /api/settings?person=<id>` — that person's document-generation settings (and `name`)
- `POST /api/jobs/:id/generate` — generate tailored resume + cover letter (body: `{ "skip_existing": true }` to no-op when both exist)
- `GET /api/document?job=:id&kind=resume|cover_letter` — serve a generated document (`&download=1` for attachment)

## Development

```
npm start        # backend on :7080
npm run dev      # Vite dev server on :5173, proxying /api to :7080
```

## Data

Everything is in `data/jobtracker.db` (gitignored). Back it up by copying the file.

Databases from before multi-person support migrate automatically on first start: existing jobs and the resume/documents settings move to a seeded person named "Default" — rename them via Settings (⚙) or the `update_person` MCP tool.

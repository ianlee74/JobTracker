# JobTracker

A standalone, local job-search tracker. All data lives in a single SQLite database on your machine — no hosting, no accounts. It has two front doors:

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
| `add_jobs` | Add new opportunities (bulk); already-tracked URLs are skipped |
| `list_jobs` | List/filter by status, company, text search, or date |
| `get_job` | Fetch one job by id or URL |
| `update_job` | Change status, notes (replace or append), salary, etc. |
| `delete_job` | Remove an entry (prefer status "Not Moving Forward") |
| `get_summary` | Counts by status + latest find date |

Statuses: `new`, `Interested`, `Applied`, `Interviewing`, `Offer`, `Not Moving Forward`.

## Importing old daily tracker files

Each daily HTML file the Cowork job produced embeds its job data. Import one file or a whole folder:

```
npm run import -- "C:\Users\you\Downloads\tracker_3.html"
npm run import -- "C:\Users\you\Downloads\trackers\"
```

Already-imported jobs (same URL) are skipped, so re-running is safe.

## REST API

The web server also exposes the data at `http://localhost:7080/api`:

- `GET /api/jobs` — query params: `status`, `company`, `q`, `since`, `limit`
- `POST /api/jobs` — body: job object or array (requires `title`, `company`, `url`)
- `GET /api/jobs/:id`, `PATCH /api/jobs/:id`, `DELETE /api/jobs/:id`
- `GET /api/stats`

## Development

```
npm start        # backend on :7080
npm run dev      # Vite dev server on :5173, proxying /api to :7080
```

## Data

Everything is in `data/jobtracker.db` (gitignored). Back it up by copying the file.

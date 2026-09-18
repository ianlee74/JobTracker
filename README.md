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

Each person can also carry their own **Job search instructions** (Settings ⚙, or the `update_person` MCP tool) — standing guidance like target roles, locations, salary floor, preferred sources, and deal-breakers. They're returned by `list_people`, so an AI doing the searching reads each person's instructions from the tracker itself instead of keeping them in its own notes.

### MCP tools

| Tool | Purpose |
|---|---|
| `add_jobs` | Add new opportunities for one person (bulk); URLs that person already tracks are skipped |
| `list_jobs` | List/filter by person, status (one or an array), company, text search, or date |
| `get_job` | Fetch one job by id or URL |
| `update_job` | Change status, rejection reason / missing skills, notes (replace or append), salary, etc. |
| `delete_job` | Remove an entry (prefer status "Not Moving Forward") |
| `get_summary` | Counts by status + latest find date (optionally per person) |
| `list_companies` | Every company with tracked jobs or saved info, incl. profile fields and the given person's favorite / not-interested flags |
| `add_company` | Add a company before any of its jobs are tracked, optionally with profile fields |
| `update_company` | Save company info (website, type, size, ticker, revenue, interview questions), notes, and referrals; mark it a person's favorite (its jobs win sort ties for them) or "not interested" (its jobs hide for them) — both flags are per person and mutually exclusive: setting one clears the other |
| `research_company` | Have the server research a company on the web (Anthropic API, following the `research-company` skill) and propose its profile; `apply: true` saves it |
| `list_people` | The tracked candidates, with job counts, per-person config, and their job-search instructions |
| `add_person` | Add a person to track jobs for |
| `update_person` | Rename a person, set their preferred name (how cover letters are signed), email address, or job-search instructions |
| `list_interviews` | A job's interviews, each with type, time, attendees (contacts), Markdown notes, and Q&A |
| `add_interview` | Record an interview for a job (type, time, other jobs it also covers, attendees by name — contacts are created as needed — and questions to ask) |
| `update_interview` | Change type/time/notes (replace or append), link/unlink jobs, add or remove attendees, add questions, record answers, delete questions |
| `delete_interview` | Remove an interview and its Q&A (contacts stay) |
| `generate_interview_questions` | Have the server propose questions for one interview (Anthropic API, following the `interview-questions` skill); save the keepers with `update_interview` |
| `list_contacts` / `add_contact` / `update_contact` | The recruiters, hiring managers and interviewers the candidate deals with, reused as interview attendees |
| `generate_interested_email` | Compose the digest email of one person's `Interested` jobs, with candidate feedback links |
| `generate_documents` | Tailored resume + cover letter for one job |
| `configure_document_generation` | View/set one person's standard resume path and documents folder |

Tools that need a person (`add_jobs`, `configure_document_generation`, …) take a `person` argument — the person's name. It can be omitted while only one person is tracked. Job posting URLs are unique **per person**, so two people can track the same posting independently; URL-based lookups accept `person` to disambiguate.

Statuses: `new`, `Interested`, `Applied`, `Interviewing`, `Offer`, `Not Moving Forward`, `No Longer Available`.

`Not Moving Forward` takes a **rejection reason** (`Not Interested`, `Not Qualified`, `Over Qualified`, `Low Salary`, `Missing Benefits`, `Not Remote`, `Not Interested in Location`, `Not Interested in Company`, or free text). A `Not Qualified` reason adds a third prompt for the **missing skills** — a comma-delimited list of what the posting wanted that the candidate lacks (`missing_skills`; e.g. `Kubernetes, Go`). The UI suggests every skill previously entered, and the list is cleared automatically if the status or reason changes to anything else.

`Applied` prompts for two optional **application details**: the **proposed salary** (`proposed_salary` — the minimum annual salary you specified in the application, if it asked) and **application notes** (`application_notes` — anything about the application process worth remembering later in an interview). In the UI the prompt opens under the status right after the change and collapses to a one-line summary when you click Done; click the summary (or edit the job) to change them later. Unlike the rejection reason, these are **kept** when the status moves on to `Interviewing`, `Offer`, or anything else — that's when they're most useful — and they can be set or cleared through `update_job` at any time.

## Companies

The **Jobs / Companies** switch in the header opens a page that lists every company — those with tracked jobs and those added directly — with its type, employee count, ticker symbol, revenue, website, and how many of the selected person's jobs it has; filter by text, sort by any column, star favorites in place, and click a name to open the company's page. Favorites and **Not Interested** are per person — starring a company for the selected person leaves everyone else's view alone, and a signed-in user sets their own. They are also mutually exclusive: starring a not-interested company clears that flag, and marking a favorite not interested drops the star. **+ Add company** creates a company before any of its jobs are tracked (only the name is required; spell it the way its postings will, since jobs are matched to companies by name) and opens its page, where the rest can be filled in or researched. Claude can do the same with the `add_company` MCP tool or `POST /api/companies`.

Each company's page (click its name on a job or on the companies page) has its **website**, **company type**, **employee count**, **ticker symbol** (`ticker` — if the company is publicly traded; it links to Fidelity's research page for that symbol), **gross revenue** (`gross_revenue` — the current annual figure as free text, e.g. `$245.1B (FY2024)`), notes, **interview questions** (`interview_questions` — questions to ask the company if you interview with them, one per line), and referrals. **✨ Research with Claude** on that page has Claude search the web for the company (it needs the same `ANTHROPIC_API_KEY` as document generation, see below) and come back with a proposal: values for the profile fields, shown next to what is saved now, a set of interview questions grounded in what it found, plus a short briefing — what the company does, size and ownership, engineering signals, employer reputation, recent news — with its sources. Nothing changes until you click **Apply**, which fills the fields, adds the questions to the list (duplicates skipped), and appends the dated briefing to the notes; **Discard** throws it away. A confidence badge appears when Claude wasn't sure it found the right company (the tracked job postings' URLs are given to it to disambiguate). The same research is available to Claude through the `research_company` MCP tool and to scripts via `POST /api/company/research`.

What the research looks for and how it reports it is the **`research-company` skill** (`skills/research-company/SKILL.md`): its body is the research prompt and its `model:` frontmatter picks the model, so edit that file to change what gets researched. The skill is also written to be followed directly — a Claude session that can search the web itself (Claude Code, Cowork) can research a company by that procedure and save the result with `update_company` (`ticker`, `gross_revenue`, `add_interview_questions`, `append_note`), which is what the job-search skill does for new companies.

Any job can record who **referred** you to it (`referred_by` — a person's name). Each company keeps a **referrals** list (`referrals` on the company — everyone who has referred you to that company's jobs, comma-delimited), and the two stay in sync automatically: a new `referred_by` name is added to its company's list, and the list is offered as a drop-down for `Referred by` on the company's other jobs (in the job row, under the company name, and in the add/edit form). Clearing a job's `referred_by` leaves the company list alone. The list is editable on the company page and through `update_company` (`referrals` replaces it, `add_referrals` appends).

### Adding a job

**+ Add job** in the header opens the **Add a job** page (the job list comes back on save or cancel). The posting can be a web URL, a path on the server machine, or a file: **Choose file…** opens the browser's file dialog (the same one the per-job resume / cover-letter upload uses) and drag-and-drop from File Explorer works too — either way the server stores a copy under `data/postings/` and the job links to it. Once a posting is uploaded, and the server has Anthropic API credentials (see below), the form offers to have Claude **fill it in**: Claude reads the posting and proposes the title, company, level, category, salary (as listed and as a min/max range), and a one-line note about the role — remote stance, must-have requirements, anything unusual — all of which you can edit before adding the job. The **✨ Parse** button next to the URL does the same for any posting, including an `http(s)` page (fetched by Claude). If the posting names a company that isn't tracked yet, it is added as a company and researched in the background with the `research-company` skill, so its profile is ready by the time the job is saved; a company that is already tracked is matched by name (ignoring case) so the job joins it.

What Claude extracts, and how, is the **`research-job` skill** (`skills/research-job/SKILL.md`): its body is the parsing prompt and its `model:` frontmatter picks the model — edit that file to change what gets filled in. Like `research-company`, it is written to be followed directly by a Claude session reading a posting itself before calling `add_jobs`. Scripts reach the same parser through `POST /api/job/research`.

Every job also has a seniority **level** used for grouping and filtering: `Senior`, `Staff`, `Principal`, `Lead`, `Manager`, `Senior Manager`, `Director`, `Senior Director`, `VP`, `Executive`, or `Other`. `add_jobs` accepts an optional `level`; when omitted, the level is classified automatically from the job title (e.g. "Sr. Engineering Manager, Platform" → `Senior Manager`). Misclassifications can be corrected inline in the UI's Level column or via `update_job`.

## Tailored resumes & cover letters

JobTracker can generate a resume and cover letter tailored to a specific posting, using the Anthropic API (Claude Opus). The standard resume and documents folder are configured **per person** — open Settings with a person selected in the header and you're editing that person's config (generation for a job always uses the resume of the person the job belongs to). Setup:

1. Set `ANTHROPIC_API_KEY` in the environment the server runs in, then start the server. The key is never stored by the app.
2. Open **Settings** (⚙ in the UI) and set the selected person's **Standard resume** — use **Choose file…** (native Windows dialog) or drag-and-drop. Either way the server stores a snapshot it can read, and the browser keeps a link to your original file (File System Access API), refreshing the snapshot from it automatically before every generation — so edits to your resume are always picked up. A **⟳ Refresh from original now** button in Settings forces a sync, and typing/pasting a path into the field still points at a server-side file directly (read in place, no snapshot). Supported formats: PDF, Word `.docx`, Markdown, or plain text. The resume is the source of truth for **content** — generated documents never claim anything that isn't in it — but not for formatting: every generated document is a `.docx` built on the app-wide template at `skills/templates/resume.docx`, so all resumes and cover letters, for every person, come out in the same layout and style regardless of what the standard resume looks like.
3. Optionally change the **Documents folder** (default: `data/documents`).

Generate from the ✨ button on any job row, or from Claude via the `generate_documents` MCP tool. Either way, generation starts by asking for **special instructions** for that application — what to emphasize or leave out, tone, a project to foreground, what a recruiter said. The ✨ button opens a dialog for them (leave it blank to skip), and the MCP tool's description tells Claude to ask before calling it, passing the answer as `instructions`. They are folded into the generation prompt as guidance that steers both documents, not pasted into them, and they never override the rule that the standard resume is the only source of facts. Each job gets its own subfolder (`<id> - <company> - <title>`) containing the resume and cover letter as `.docx` files; the `job_documents` table stores their relative paths. Local `file://` postings are sent to the model directly; http(s) postings are fetched by the model via web fetch.

You don't have to generate at all: the **📎** button on a job row uploads your own resume or cover letter (`.docx`, `.pdf`, `.md`, `.txt`, or `.html`) into that job's folder, and it then behaves exactly like a generated document — listed under the job title, downloadable, replaceable, deletable. ✨ only ever generates the document kinds a job is still missing, so you can upload one and generate the other. Scripts can do the same with `POST /api/jobs/<id>/document?kind=resume|cover_letter&name=<filename>` (raw file body).

The writing instructions live in `skills/tailored-resume/SKILL.md` and `skills/tailored-cover-letter/SKILL.md` — edit those files to change how the documents are written. Each skill's frontmatter can also set:

- `model:` — the model for that document type (e.g. `model: claude-sonnet-5`); without one, the server's default (`claude-opus-5`) is used.
- `template:` — the `.docx` formatting template, relative to `skills/` (both skills use `templates/resume.docx`). Its named styles define the look; the model writes structure and text only, and the output is packaged into a copy of the template. Without a template, the skill produces Markdown.
- `max_words:` — a hard cap on the document's visible words. The model can't see pages, so length is given to it as a word budget and checked after generation; an over-budget document is rejected and regenerated with the overage as feedback (up to three attempts). The resume's cap (920) fills two pages in the template.

The template is generated by `node scripts/build-resume-template.mjs` — edit the style definitions or placeholder skeleton there and re-run it rather than editing the `.docx` in Word.

## Interviews & contacts

Once a job is `Interviewing` (or has interviews recorded), a **🎤 Interviews** link appears under its status. It opens the **Interviews page** for that job. On a wide screen it is two columns: on the left, a **Company** tab (profile, notes, and the company's standing interview-questions list) and a tab for each **job** the selected interview covers (posting link, level, salary, why it fits, notes, what you said in the application, who referred you), with a **✎** that opens that job's edit form in a new browser tab — so a salary band or detail learned mid-interview can be recorded without leaving the page, which refreshes when it regains focus; on the right, the job's **interviews** — as many as the process has: recruiter screen, hiring manager, technical, system design, behavioral, panel, executive, team fit, final, or any custom type — as tabs. (Narrow screens stack the two columns.) Each interview has:

- a **type** and **when** it takes place;
- the **jobs it covers** — usually one, but an interview that discusses several openings at once (two roles on the same team, say) can be linked to each of them (the picker offers your other `Interviewing` jobs): it then appears on every linked job's Interviews page with the same notes and Q&A, the left column gets a tab per linked job, question generation considers all of them, and deleting a job only unlinks it (an interview with no job left goes with it);
- **attendees** — picked from your contacts or created on the spot (a new attendee defaults to the job's company), shown with their title and company;
- **notes** in **Markdown**, with Edit / Preview, for prep beforehand and live notes during the call (headings, lists, task lists, tables, code, quotes and links all render);
- **Q&A** — the questions you plan to ask, each with a box for the answer you get. Add questions by hand, copy them from the company's list with one click, reorder or edit them in place, and **✨ Generate questions with Claude** to have Claude propose 8–12 questions for *this* interview: grounded in the posting, the company profile and its web research, the interview's type and attendees, and what earlier interviews for the same job already asked and learned (their Q&A and notes are given to it, so it follows up rather than repeats). The proposal is shown with a rationale per question and checkboxes; only the ticked ones are added.

Everything on the page saves automatically. The generation prompt is the **`interview-questions` skill** (`skills/interview-questions/SKILL.md`) — edit it to change what the questions cover — and, like the other skills, it is written to be followed directly by a Claude session that can search the web itself, saving the result with `update_interview`.

**Contacts** (the third view in the header switch) are everyone you deal with along the way — recruiters, hiring managers, interviewers — with title, company, email, phone, LinkedIn and notes, and how many interviews each has attended. They are shared across people, like companies; a company's page lists its contacts. Anyone signed in can add and edit contacts (a candidate records their own interviewers); deleting is admin-only.

## Interested-jobs digest email & candidate feedback

JobTracker can compose an email digest of every job currently in `Interested` status, addressed to the person the jobs belong to (set their **Email address** in Settings ⚙, or via the `update_person` MCP tool). Each job in the email has a link to the posting, a short summary of why it looks like a good fit (the job's `fit` field), and three feedback links for the candidate:

- **✅ I applied** — marks the job `Applied`.
- **👍 Still interested** — notes the confirmation on the job.
- **👎 Not interested** — opens a small form asking why (the standard rejection reasons plus free text), then marks the job `Not Moving Forward` with that reason.

Feedback links carry a per-job unguessable token and are served by the web server (`/respond/<token>/…`), so clicking them updates the tracker directly — no login needed. The email also explains how to reply by email instead, referencing each job's `#id` (e.g. "Job #12: applied"), for candidates who can't reach the tracker's URL; apply those answers yourself or let Claude do it via `update_job`.

The app **composes** the email but never sends it. Get it out via:

- **UI**: the **✉ Email Interested** header button opens a preview with a *Copy email* button — paste into any compose window (Gmail, Outlook) as rich text.
- **MCP**: the `generate_interested_email` tool returns `to`/`subject`/`html`/`text`, so Claude can send it through a connected email integration.
- **REST**: `POST /api/interested-email?person=<id>`.

By default the server only listens on `127.0.0.1`, so feedback links only work on the tracker machine. For a candidate on another device in your home network, start the server with `JOBTRACKER_HOST=0.0.0.0` and set `JOBTRACKER_BASE_URL` to the tracker machine's LAN address (e.g. `http://192.168.1.20:7080`) so the links in the email point somewhere reachable. Only do this on a network you trust — the app has no authentication.

## Importing old daily tracker files

Each daily HTML file the Cowork job produced embeds its job data. Import one file or a whole folder:

```
npm run import -- "C:\Users\you\Downloads\tracker_3.html"
npm run import -- "C:\Users\you\Downloads\trackers\"
```

Already-imported jobs (same URL) are skipped, so re-running is safe.

## REST API

The web server also exposes the data at `http://localhost:7080/api`:

- `GET /api/jobs` — query params: `person` (id), `status` (repeatable or comma-separated for any-of), `company`, `level`, `q`, `since`, `limit`
- `POST /api/jobs` — body: job object or array (requires `title`, `company`, `url`; each job may carry `person_id`, otherwise `?person=<id>` applies)
- `GET /api/jobs/:id`, `PATCH /api/jobs/:id`, `DELETE /api/jobs/:id`
- `GET /api/people`, `POST /api/people`, `GET|PATCH|DELETE /api/people/:id` — the tracked candidates (delete requires the person to have no jobs)
- `GET /api/companies?person=<id>` — every company with tracked jobs or saved info, with that person's `favorite` and `not_interested` flags (a `user` account always gets its own person's; an admin omitting `person` gets no flags); `POST /api/companies` — add a company (body: `{ name, ...profile fields }`; 409 if the name already exists, case-insensitively)
- `GET|PATCH /api/company?name=<name>&person=<id>` — one company's info; PATCH upserts the shared profile fields (`website`, `note`, `company_type`, `employee_count`, `ticker` — stored upper-case, `gross_revenue`, `interview_questions` — newline-delimited string or array, `referrals` — comma-delimited string or array) and the per-person flags (`not_interested`, `favorite`), which need a `person` (400 without one; a `user` account's own person is implied) and exclude each other (setting one true clears the other; both true in one request is a 400)
- `POST /api/company/research?name=<name>` — Claude researches the company on the web (slow; needs the Anthropic key) and returns proposed `website`, `company_type`, `employee_count`, `ticker`, `gross_revenue`, `headquarters`, `founded`, `confidence`, `summary`, `interview_questions`, `sources`, the `note_section` Apply would append, and the `current` field values; body `{ "apply": true }` saves the proposal and adds the updated `company`
- `POST /api/job/research?person=<id>` — body `{ "url": "<file:// or http(s) posting>" }`; Claude reads the posting (slow; needs the Anthropic key) and returns proposed `title`, `company` (matched to a tracked company's spelling), `company_website`, `level`, `category`, `salary`, `salary_min`, `salary_max`, `salary_uncertain`, `location`, `remote`, `note`, `confidence`, and `company_status` (`existing`, `created` — the company was added and its research started in the background — or `none`); `person` scopes the category suggestions
- `GET /api/ai-status` — `{ api_credentials_found }`: whether the server can call the Anthropic API
- `GET /api/stats` — query param: `person` (id)
- `GET /api/settings?person=<id>`, `PATCH /api/settings?person=<id>` — that person's document-generation settings (and `name`, `email`)
- `POST /api/interested-email?person=<id>` — compose the Interested-jobs digest email (`{ to, subject, html, text }`); `GET /api/interested-email/preview?person=<id>` renders it with copy buttons
- `GET|POST /respond/<token>/<action>` — candidate feedback endpoints linked from the digest email (`applied`, `interested`, `not-interested`)
- `GET /api/jobs/:id/interviews` — the Interviews page's data: `{ job, company, interviews, types }`, each interview with `attendees` and `questions`; `POST` adds an interview (`{ type, scheduled_at, notes }`)
- `GET|PATCH|DELETE /api/interviews/:id` — one interview (PATCH: `type`, `scheduled_at`, `notes`); each carries the `jobs` it covers
- `POST /api/interviews/:id/jobs` — body `{ job_id }` links another of the same person's jobs the interview covers; `DELETE /api/interviews/:id/jobs/:jobId` unlinks (400 for the last one)
- `POST /api/interviews/:id/attendees` — body `{ contact_id }` to attach an existing contact, or `{ contact: { name, title, … } }` to create one (at the job's company unless given) and attach it; `DELETE /api/interviews/:id/attendees/:contactId` detaches
- `POST /api/interviews/:id/questions` — body `{ questions: [...strings or { question, answer }], source? }` appends (duplicates skipped); `PATCH` with `{ order: [ids] }` reorders; `PATCH|DELETE /api/interviews/:id/questions/:qid` edits (`question`, `answer`) or removes one
- `POST /api/interviews/:id/generate` — Claude proposes questions for the interview (slow; needs the Anthropic key): `{ questions: [{ question, why, topic }], sources }`, nothing saved
- `GET /api/contacts?company=&q=`, `POST /api/contacts`, `GET|PATCH|DELETE /api/contacts/:id` — contacts (`name`, `title`, `company`, `email`, `phone`, `linkedin`, `note`); POST is 409 when the name already exists at that company; DELETE is admin-only
- `POST /api/jobs/:id/generate` — generate tailored resume + cover letter
- `GET /api/document?job=:id&kind=resume|cover_letter` — serve a generated document (`&download=1` for attachment)

## Development

```
npm start        # backend on :7080
npm run dev      # Vite dev server on :5173, proxying /api to :7080
```

## Data

Everything is in `data/jobtracker.db` (gitignored). Back it up by copying the file.

Databases from before multi-person support migrate automatically on first start: existing jobs and the resume/documents settings move to a seeded person named "Default" — rename them via Settings (⚙) or the `update_person` MCP tool.

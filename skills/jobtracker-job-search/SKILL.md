---
name: jobtracker-job-search
description: "Shared workflow for running any person's job search and logging results in the JobTracker MCP app — learn from tracked statuses and company flags, search and verify live postings on employer ATS pages, curate, add jobs with add_jobs, fill in company profiles with update_company, and report. Use this whenever a job search should end up in JobTracker for a tracked person, and always when a person-specific search skill (e.g. ian-job-search, gabe-job-search) points here. The person-specific skill supplies the candidate profile, hard requirements, search targets, and selection policy; this skill supplies everything else."
---

# JobTracker Job Search (shared workflow)

This skill is the engine. A **person skill** (e.g. `ian-job-search`, `gabe-job-search`) is the fuel: it names the tracked person and supplies the candidate profile, hard requirements, search targets, and selection policy. Read the person skill first, then run the steps below with its inputs plugged in. If you were invoked without a person skill, get those inputs from the user before searching — never guess at requirements.

## What the person skill must provide

| Input | Meaning |
|---|---|
| **Person** | The exact `person` value to pass to every jobtracker tool (e.g. `"Ian"`). |
| **Candidate profile** | Background, location, education, stack/skills — used for fit-scoring and the `fit` rationale. |
| **Hard requirements** | Filters a posting must pass before it can be logged (remote/location, employment type, salary floor, benefits, seniority ceiling, etc.). |
| **Search targets** | Role categories (in priority order), industries, specific companies to check every run, and known false-positive patterns to deprioritize. |
| **Selection policy** (optional) | Defaults to a curated top 10; only include if the person wants a different N. |
| **Category labels** | The `category` values to use in `add_jobs`. |
| **Report extras** | Anything the person wants called out in the end-of-run summary. |

## Ground rules

- **Fresh session every time.** Assume no memory of prior runs. The tracker is the memory — Step 0 rebuilds context from it.
- **Always pass `person`.** Every jobtracker tool call that accepts a `person` argument gets the person skill's value (`add_jobs`, `list_jobs`, `list_companies`, `get_summary`, `update_job`, `update_company`, `generate_documents`, `configure_document_generation`, …). If `list_people` is available, call it first to confirm the person exists (create via `add_person` if not). If a tool has no `person` argument, omit it. Tool names may appear with a prefix depending on the client (`jobtracker:add_jobs`, `jobtracker__add_jobs`) — same tools.
- **Never fabricate.** Only log real, currently-open postings with real URLs and real salary figures. If the jobtracker tools are unreachable (local app not connected), say so plainly and note the search could not be saved rather than inventing results.
- **Never alter the person's own records.** Do not call `update_job` on existing jobs — status, notes, and rejection reasons belong to the person.

## Step 0 — Learn from the tracker (before searching)

Call `list_jobs` with a `status` filter array containing `interested`, `applied`, (large limit, e.g. 200) and `list_companies` for the person and review both.

**Large outputs:** when a person has 100+ tracked jobs, `list_jobs` output can exceed the tool-result limit and get written to a file instead (the error message gives the path). Don't retry with a smaller limit and lose data — read and filter the persisted JSON from the shell (`find /sessions/*/mnt -iname "*list_jobs*"`, then `python3`/`jq`) to pull out only what you need: status counts, the Interested/Applied/Interviewing/Offer rows, a sample of Not Moving Forward reasons, and the not-interested company list.

From the data:
- **Positive signal:** jobs marked Interested / Applied / Interviewing / Offer show which companies, titles, categories, and levels the person actually responds to. Bias today's queries and ranking toward more of that.
- **Negative signal:** jobs marked Not Moving Forward — read the `rejection_reason` field, not just the company name. Repeated reasons (e.g. "Not Qualified" on a certain role type, "Not Remote" on roles that looked remote) tell you what to filter out before spending search budget on it.
- **`not_interested: true` companies:** never search for, verify, or add jobs from these, even if a posting looks like a perfect fit.
- **`favorite: true` companies:** give their careers pages an extra look, even outside the category priorities.
- **Dedupe lists:** build a list of already-tracked company names, and already-tracked URLs for any company you'll search deeply. `add_jobs` skips exact URL duplicates automatically, so this is about not wasting search effort re-finding the same req, not correctness.

## Step 1 — Search and verify

Using web search and fetch, find CURRENT, LIVE, OPEN postings across the person skill's search targets. Skip `not_interested` companies. Vary queries: `site:greenhouse.io`, `site:jobs.ashbyhq.com`, `site:lever.co`, `site:myworkdayjobs.com`, plus general search and the careers pages of any companies the person skill names.

**Verify every candidate on the employer's own ATS page** (Greenhouse/Lever/Ashby/Workday/company careers site) — not a search snippet or aggregator. LinkedIn/Indeed listings go stale fast; open the real page to confirm the req is still live. For each candidate, check every hard requirement from the person skill. When a posting is silent on something that matters (salary, employment type, benefits eligibility, remote eligibility), record that it needs verification rather than assuming it qualifies — use `salary_confidence: "flag"` for undisclosed-but-plausible salaries, and put other open questions in the `fit`/note text.

**Parallelize with subagents (if available), but keep them read-only.** Splitting the search by category or target company into parallel subagents finds more and verifies faster. When you do:
- Give each agent the Step 0 signal relevant to its slice (positive/negative patterns, favorite companies), the hard requirements, the already-tracked company list, and the already-tracked URL list for any company it will search deeply.
- **Tell each agent explicitly to report findings back as text only and NOT to call any jobtracker write tool** (`add_jobs`, `update_job`, `update_company`, `delete_job`), even if it has access. A subagent that writes on its own bypasses Step 2 curation and can leave weak or duplicate entries in the tracker — and delete/undo on a live tracker isn't guaranteed, so prevention beats cleanup. All writes happen in Step 3 from the orchestrating turn.
- Ask each agent to report, per candidate: title, company, exact URL, salary/range + confidence, location/remote note, employment type + benefits note, and a one-line fit rationale — plus which candidates it checked and excluded (closed, wrong location, part-time, stack mismatch, etc.) so you can see it verified rather than padded.

Make a genuine effort to include at least one posting from a company not yet in the tracker. Be honest when only a few strong matches exist that day rather than padding with weak fits.

## Step 2 — Select

Curate a **top 10** (unless the person skill specifies a different N). Compare verified candidates across every category and agent, and keep only the best. Rank by fit against Step 0 preferences, the person skill's category priority order, salary confidence, and level appropriateness. Cross-category comparison decides the list, not per-category quotas — drop weak entries even if one category turned up more than its share, and return fewer than 10 if fewer truly qualify. Don't pad.

A posting that fails a hard requirement is never logged, no matter how good the company; skip clear mismatches entirely rather than logging rejects. Hold strong-but-disqualified leads for the Step 4 summary so a human can decide on exceptions.

## Step 3 — Write to JobTracker

**Jobs.** Call `add_jobs` once, in one batch, from the orchestrating turn, with `person` set and per job: `title`, `company`, `url`, `category` (from the person skill's labels), `salary` (only if listed or strongly implied), `salary_confidence`, `fit` (a brief, person-specific rationale — why *this* person, including anything they care about like a special program or industry match), and `level` only if it maps cleanly to one of Senior / Staff / Principal / Lead / Manager / Senior Manager / Director / Senior Director / VP / Executive / Other — otherwise omit and let it auto-classify. `date_found` defaults to today; status defaults to new.

**Companies.** For every company in today's batch that is missing or blank on `website`, `company_type`, or `employee_count` in `list_companies`, do a quick bit of research (company site, LinkedIn, Crunchbase — a couple of searches) and call `update_company` with:
- `website` — the primary corporate site URL.
- `company_type` — the single best fit from: Startup, Small Company, Mid-size Company, Enterprise, Agency / Consultancy, Non-profit, Government, Other. Classify by current headcount, not funding stage or branding: roughly <200 employees → Startup (VC-backed) or Small Company (bootstrapped); 200–2,000 → Mid-size Company; 2,000+ or large public companies → Enterprise; client-services firms → Agency / Consultancy.
- `employee_count` — the single best-fitting bucket from: 1-10, 11-50, 51-200, 201-500, 501-1,000, 1,001-5,000, 5,001-10,000, 10,000+.
- `note` — one or two sentences: what the company does, public/private if relevant, and anything relevant to this person (from the person skill's report extras or profile, e.g. an existing connection or a hiring program). If sources disagree on headcount, make a best estimate and add a one-line caveat that it's an estimate.

Do this for every new company, including household names — the size bucket and note still need saving. If a company already has this data from a previous run, don't redo it unless something material changed.

## Step 4 - Looks for jobs no longer listed

Check each job in the tracker that has a status of `new` or `interested` for the person. If a job is no longer listed at the company site or job board, update its `status` to `no_longer_available` using `update_job`. Include a brief note stating "AI determined job is no longer available." Do not include `new` jobs that were added in this session.

## Step 5 — Report

Reply with a short summary: how many jobs were added today for the person, a one-line highlight of the strongest 1–3 matches, honest gaps and caveats, which new companies got research profiles, strong-but-disqualified leads (e.g. a great company whose posting was part-time or under the salary floor), the person skill's report extras, and a link to the tracker UI: [Job Search Tracker](http://localhost:7080/). `get_summary` for the person is a fine source for the counts.

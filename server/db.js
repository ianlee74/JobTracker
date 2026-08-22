import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.JOBTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'jobtracker.db');

export const STATUSES = ['new', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Not Moving Forward', 'No Longer Available'];

// Preset reasons for "Not Moving Forward"; a custom free-text reason is also
// allowed (the UI files it under "Other").
export const REJECTION_REASONS = ['Not Interested', 'Not Qualified', 'Over Qualified', 'Low Salary', 'Missing Benefits', 'Not Remote', 'Not Interested in Location', 'Not Interested in Company', 'Other'];

export const LEVELS = ['Senior', 'Staff', 'Principal', 'Lead', 'Manager', 'Senior Manager', 'Director', 'Senior Director', 'VP', 'Executive', 'Other'];

// Ordered most-specific first: "Senior Engineering Manager" must classify as
// Senior Manager (not Senior), "Senior/Staff Engineer" as Staff (the higher band).
const LEVEL_PATTERNS = [
  ['Executive', /\bchief\b|\bc[eit]o\b|\bciso\b/i],
  ['VP', /\bvp\b|vice president/i],
  ['Senior Director', /\b(senior|sr\.?)\s+director\b/i],
  ['Director', /\bdirector\b/i],
  ['Senior Manager', /\b(senior|sr\.?)\s+(\w+\s+)?manager\b/i],
  ['Manager', /\bmanager\b/i],
  ['Principal', /\bprincipal\b/i],
  ['Staff', /\bstaff\b/i],
  ['Lead', /\blead\b/i],
  ['Senior', /\b(senior|sr)\b\.?/i]
];

// Best-effort parse of a salary string into annual min/max dollar amounts.
// Returns { min, max } with nulls when nothing trustworthy can be extracted
// (hourly rates, "Competitive", etc.) so callers fall back to the raw string.
export function parseSalary(text) {
  if (!text) return { min: null, max: null };
  // "401(k)" would otherwise parse as $401,000; non-annual rates would be nonsense.
  const s = String(text).replace(/401\s*\(?k\)?/gi, '');
  if (/(per|\/)\s*(hour|hr|day|week|wk|month|mo)\b/i.test(s) || /\b(hourly|daily|weekly|monthly)\b/i.test(s)) {
    return { min: null, max: null };
  }
  const tokens = [...s.matchAll(/(\$)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK]\b)?/g)].map(m => ({
    flagged: Boolean(m[1] || m[3]), // had a "$" prefix or "k" suffix
    value: parseFloat(m[2].replace(/,/g, '')) * (m[3] ? 1000 : 1)
  }));
  let values = tokens.filter(t => t.flagged).map(t => t.value);
  // Once one credible annual figure exists, rescue shorthand like the "$120"
  // in "$120 - $150K" (and bare numbers such as the "120" in "120-150K").
  if (values.some(v => v >= 10_000)) {
    values.push(...tokens.filter(t => !t.flagged).map(t => t.value));
    values = values.map(v => (v >= 30 && v < 10_000 ? v * 1000 : v));
  }
  values = values.filter(v => v >= 10_000 && v <= 5_000_000);
  if (!values.length) return { min: null, max: null };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    if (/\bup\s+to\b|\bmax(imum)?\b/i.test(s)) min = null;
    else if (/(\d|[kK])\s*\+/.test(s) || /\bfrom\b|\bmin(imum)?\b|\bat\s+least\b|\bstarting\b/i.test(s)) max = null;
  }
  return { min, max };
}

export function classifyLevel(text) {
  for (const [level, re] of LEVEL_PATTERNS) {
    if (re.test(text || '')) return level;
  }
  return 'Other';
}

// Canonicalize a caller-supplied level ("sr. manager" -> "Senior Manager");
// values that don't map to a known level are kept as given.
function normalizeLevel(level) {
  const exact = LEVELS.find(l => l.toLowerCase() === level.trim().toLowerCase());
  if (exact) return exact;
  const classified = classifyLevel(level);
  return classified !== 'Other' ? classified : level.trim();
}

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_found TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT '',
    salary TEXT DEFAULT '',
    salary_confidence TEXT DEFAULT 'ok',
    fit TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_date_found ON jobs(date_found);
`);

// Migration: add the level column and classify any rows that predate it.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('level')) {
    db.exec("ALTER TABLE jobs ADD COLUMN level TEXT NOT NULL DEFAULT ''");
  }
  const unleveled = db.prepare("SELECT id, title FROM jobs WHERE level = ''").all();
  const setLevel = db.prepare('UPDATE jobs SET level = ? WHERE id = ?');
  for (const row of unleveled) setLevel.run(classifyLevel(row.title), row.id);
}

// Migration: add the rejection_reason column (why a job is "Not Moving Forward").
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('rejection_reason')) {
    db.exec("ALTER TABLE jobs ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: add parsed salary range columns, backfilled from the salary strings.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('salary_min')) {
    db.exec('ALTER TABLE jobs ADD COLUMN salary_min INTEGER; ALTER TABLE jobs ADD COLUMN salary_max INTEGER;');
    const rows = db.prepare("SELECT id, salary FROM jobs WHERE salary != ''").all();
    const setRange = db.prepare('UPDATE jobs SET salary_min = ?, salary_max = ? WHERE id = ?');
    for (const row of rows) {
      const { min, max } = parseSalary(row.salary);
      if (min != null || max != null) setRange.run(min, max, row.id);
    }
  }
}

function touch(fields) {
  return { ...fields, updated_at: new Date().toISOString() };
}

export function listJobs({ status, company, level, q, since, limit } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (company) { where.push('company LIKE ?'); params.push(`%${company}%`); }
  if (level) { where.push('level = ?'); params.push(level); }
  if (since) { where.push('date_found >= ?'); params.push(since); }
  if (q) {
    where.push('(title LIKE ? OR company LIKE ? OR category LIKE ? OR fit LIKE ? OR note LIKE ? OR salary LIKE ? OR rejection_reason LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  let sql = 'SELECT * FROM jobs';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY date_found DESC, company ASC, id ASC';
  if (limit) { sql += ' LIMIT ?'; params.push(limit); }
  return db.prepare(sql).all(...params);
}

export function getJob({ id, url }) {
  if (id != null) return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) ?? null;
  if (url) return db.prepare('SELECT * FROM jobs WHERE url = ?').get(url) ?? null;
  return null;
}

// Adds jobs, skipping any whose URL is already tracked (so a daily run can
// safely re-send an old suggestion without clobbering its status/note).
export function addJobs(jobs) {
  const insert = db.prepare(`
    INSERT INTO jobs (date_found, title, company, url, category, salary, salary_min, salary_max, salary_confidence, fit, status, note, level, rejection_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO NOTHING
  `);
  const results = { added: 0, skipped: 0, jobs: [] };
  for (const job of jobs) {
    const status = STATUSES.includes(job.status) ? job.status : 'new';
    const level = job.level ? normalizeLevel(job.level) : classifyLevel(job.title);
    // An explicitly supplied range wins; otherwise parse it from the salary string.
    const range = job.salary_min != null || job.salary_max != null
      ? { min: job.salary_min ?? null, max: job.salary_max ?? null }
      : parseSalary(job.salary);
    const info = insert.run(
      job.date_found || new Date().toISOString().slice(0, 10),
      job.title,
      job.company,
      job.url,
      job.category || '',
      job.salary || '',
      range.min,
      range.max,
      job.salary_confidence || 'ok',
      job.fit || '',
      status,
      job.note || '',
      level,
      status === 'Not Moving Forward' ? (job.rejection_reason || '') : ''
    );
    if (info.changes > 0) {
      results.added++;
      results.jobs.push(getJob({ id: info.lastInsertRowid }));
    } else {
      results.skipped++;
    }
  }
  return results;
}

const EDITABLE_FIELDS = ['date_found', 'title', 'company', 'url', 'category', 'salary', 'salary_min', 'salary_max', 'salary_confidence', 'fit', 'status', 'note', 'level', 'rejection_reason'];

export function updateJob({ id, url }, fields) {
  const job = getJob({ id, url });
  if (!job) return null;
  if (fields.status && !STATUSES.includes(fields.status)) {
    throw new Error(`Invalid status "${fields.status}". Valid statuses: ${STATUSES.join(', ')}`);
  }
  // Keep the parsed range in sync: an explicit min/max wins; otherwise a new
  // salary string is re-parsed (clearing the range if nothing parses).
  if ('salary' in fields && fields.salary_min === undefined && fields.salary_max === undefined) {
    const { min, max } = parseSalary(fields.salary);
    fields = { ...fields, salary_min: min, salary_max: max };
  }
  if (fields.level) fields = { ...fields, level: normalizeLevel(fields.level) };
  // The reason only applies to "Not Moving Forward"; clear it when the job
  // moves (back) to any other status.
  if (fields.status && fields.status !== 'Not Moving Forward') {
    fields = { ...fields, rejection_reason: '' };
  }
  const updates = Object.entries(touch(fields)).filter(([k]) => EDITABLE_FIELDS.includes(k) || k === 'updated_at');
  if (!updates.length) return job;
  const sql = `UPDATE jobs SET ${updates.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...updates.map(([, v]) => v), job.id);
  return getJob({ id: job.id });
}

export function deleteJob({ id, url }) {
  const job = getJob({ id, url });
  if (!job) return false;
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  return true;
}

export function getStats() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.n;
    total += row.n;
  }
  const latest = db.prepare('SELECT MAX(date_found) AS d FROM jobs').get();
  return { total, byStatus, lastFound: latest?.d ?? null };
}

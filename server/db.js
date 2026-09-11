import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.JOBTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'jobtracker.db');

export const STATUSES = ['new', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Not Moving Forward', 'No Longer Available'];

// Preset reasons for "Not Moving Forward"; a custom free-text reason is also
// allowed (the UI files it under "Other").
export const REJECTION_REASONS = ['Not Interested', 'Not Qualified', 'Over Qualified', 'Low Salary', 'Missing Benefits', 'Not Remote', 'Not Interested in Location', 'Not Interested in Company', 'Other'];

// Skills a "Not Qualified" job asked for that the candidate lacks. Stored as a
// comma-delimited string; these helpers keep it tidy (trimmed, deduped
// case-insensitively, joined with ", ") so the UI's suggestion list stays clean.
export function parseSkills(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(',')) {
    const skill = raw.trim();
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

export function normalizeSkills(text) {
  return parseSkills(text).join(', ');
}

// Referral names (companies.referrals) are stored the same way — a
// comma-delimited, case-insensitively deduped list — so they share the helpers.
export const parseNames = parseSkills;
export const normalizeNames = normalizeSkills;

// Interview questions (companies.interview_questions) are stored one per
// line. Accepts an array or newline-delimited text; trims, drops blanks and
// list markers ("- ", "1. "), and dedupes case-insensitively.
export function parseQuestions(value) {
  const lines = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const q = String(raw ?? '').trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

export function normalizeQuestions(value) {
  return parseQuestions(value).join('\n');
}

// Stock ticker symbols are stored upper-case without exchange prefixes or
// decoration ("nasdaq: msft" → "MSFT"); anything that isn't a plausible symbol
// is dropped rather than saved.
export function normalizeTicker(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/^\$/, '');
  const symbol = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1).trim() : raw;
  return /^[A-Z0-9]{1,6}(?:[.-][A-Z0-9]{1,3})?$/.test(symbol) ? symbol : '';
}

export const LEVELS = ['Senior', 'Staff', 'Principal', 'Lead', 'Manager', 'Senior Manager', 'Director', 'Senior Director', 'VP', 'Executive', 'Other'];

export const COMPANY_TYPES = ['Startup', 'Small Company', 'Mid-size Company', 'Enterprise', 'Agency / Consultancy', 'Non-profit', 'Government', 'Other'];

// LinkedIn-style headcount buckets, since that's how companies usually self-report.
export const EMPLOYEE_COUNTS = ['1-10', '11-50', '51-200', '201-500', '501-1,000', '1,001-5,000', '5,001-10,000', '10,000+'];

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
    person_id INTEGER NOT NULL DEFAULT 1,
    date_found TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT NOT NULL,
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

// Migration: companies table — per-company notes/info. (Its original global
// "not interested" flag, and the later "favorite" one, moved to the per-person
// company_flags table below.)
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    website TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Migration: add company_type and employee_count to companies.
{
  const cols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  if (!cols.includes('company_type')) {
    db.exec("ALTER TABLE companies ADD COLUMN company_type TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('employee_count')) {
    db.exec("ALTER TABLE companies ADD COLUMN employee_count TEXT NOT NULL DEFAULT ''");
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

// Migration: app settings (key/value) and generated job documents. Documents
// live on disk in a per-job folder; rows hold paths relative to the documents
// base directory so the whole tree can be moved by changing one setting.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS job_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(job_id, kind)
  );
`);

// Migration: people. Each person has their own set of jobs and their own
// document-generation config (resume_path: their standard resume, the source
// of truth for generated documents; documents_dir: base folder for per-job
// document folders, empty = <data dir>/documents).
db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    resume_path TEXT NOT NULL DEFAULT '',
    documents_dir TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Migration: the person's email address — where their Interested-jobs digest
// email is sent.
{
  const cols = db.prepare('PRAGMA table_info(people)').all().map(c => c.name);
  if (!cols.includes('email')) {
    db.exec("ALTER TABLE people ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: per-person job-search instructions — free-form guidance for the
// AI that hunts for this person's jobs (target roles, locations, salary floor,
// preferred sources, deal-breakers). Stored here so the instructions travel
// with the database instead of living in some assistant's own memory.
{
  const cols = db.prepare('PRAGMA table_info(people)').all().map(c => c.name);
  if (!cols.includes('search_instructions')) {
    db.exec("ALTER TABLE people ADD COLUMN search_instructions TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: the name the person signs generated cover letters with (e.g.
// "Ian Lee" when the resume says "Richard Ian Lee"). Empty = sign with the
// name on the resume.
{
  const cols = db.prepare('PRAGMA table_info(people)').all().map(c => c.name);
  if (!cols.includes('preferred_name')) {
    db.exec("ALTER TABLE people ADD COLUMN preferred_name TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: per-job feedback token. Minted when a job first goes into a
// digest email; its /respond/<token> links let the candidate report back
// without authentication, so the token must be unguessable.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('feedback_token')) {
    db.exec("ALTER TABLE jobs ADD COLUMN feedback_token TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_feedback_token ON jobs(feedback_token) WHERE feedback_token != ''");
}

// Migration: the candidate's own note on a job. The original `note` column is
// the admin's note; `user_note` belongs to the signed-in user tracking the job.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('user_note')) {
    db.exec("ALTER TABLE jobs ADD COLUMN user_note TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: web accounts and their sessions. A user signs in with Google;
// the email is the identity. role is 'admin' or 'user'; person_id links a
// 'user' account to the person whose jobs they see.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    picture TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    person_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL
  );
`);

// Seed the first person, inheriting the legacy global settings (settings-table
// rows from single-person databases; empty on a fresh database).
if (!db.prepare('SELECT 1 FROM people LIMIT 1').get()) {
  const legacy = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  db.prepare('INSERT INTO people (name, resume_path, documents_dir) VALUES (?, ?, ?)')
    .run('Default', legacy.resume_path || '', legacy.documents_dir || '');
}

// Migration: single-person jobs tables (no person_id, globally-unique url)
// are rebuilt with a person_id owned by the seeded person, and URL uniqueness
// becomes per-person so two people can track the same posting independently.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('person_id')) {
    const firstPerson = db.prepare('SELECT MIN(id) AS id FROM people').get().id;
    const copyCols = cols.join(', ');
    db.exec(`
      CREATE TABLE jobs_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL DEFAULT ${firstPerson},
        date_found TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        url TEXT NOT NULL,
        category TEXT DEFAULT '',
        salary TEXT DEFAULT '',
        salary_min INTEGER,
        salary_max INTEGER,
        salary_confidence TEXT DEFAULT 'ok',
        fit TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        note TEXT DEFAULT '',
        level TEXT NOT NULL DEFAULT '',
        rejection_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO jobs_migrated (${copyCols}) SELECT ${copyCols} FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_migrated RENAME TO jobs;
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_date_found ON jobs(date_found);
    `);
  }
  // Backs the per-person duplicate skip in addJobs (ON CONFLICT(person_id, url)).
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_person_url ON jobs(person_id, url)');
}

// Migration: add the missing_skills column (what a "Not Qualified" job wanted
// that the candidate lacks). Runs after the person_id rebuild so a legacy
// single-person table isn't rebuilt with a column it doesn't yet know about.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('missing_skills')) {
    db.exec("ALTER TABLE jobs ADD COLUMN missing_skills TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: what the candidate put in the application itself. proposed_salary
// is the minimum annual salary they asked for (if the application asked);
// application_notes is anything about the application process worth
// remembering in an interview. Both are prompted for when a job is set to
// "Applied", but unlike rejection_reason they are NOT cleared when the status
// moves on — they matter most at Interviewing/Offer.
{
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!cols.includes('proposed_salary')) {
    db.exec('ALTER TABLE jobs ADD COLUMN proposed_salary INTEGER');
  }
  if (!cols.includes('application_notes')) {
    db.exec("ALTER TABLE jobs ADD COLUMN application_notes TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: referrals. jobs.referred_by is who referred the candidate to the
// job, if anyone; companies.referrals is the comma-delimited list of everyone
// who has ever referred them to that company's jobs. The list is maintained
// automatically — setting referred_by on a job adds the name to its company's
// list — so the UI can offer it as a drop-down on the company's other jobs.
{
  const jobCols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!jobCols.includes('referred_by')) {
    db.exec("ALTER TABLE jobs ADD COLUMN referred_by TEXT NOT NULL DEFAULT ''");
  }
  const companyCols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  if (!companyCols.includes('referrals')) {
    db.exec("ALTER TABLE companies ADD COLUMN referrals TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: more company profile fields. ticker is the stock symbol of a
// publicly traded company (the UI links it to Fidelity's research page);
// gross_revenue is free text ("$245.1B (FY2024)") since sources report it in
// every shape; interview_questions is a newline-delimited list of questions
// to ask the company in an interview. All three are filled by company research.
{
  const cols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  if (!cols.includes('ticker')) {
    db.exec("ALTER TABLE companies ADD COLUMN ticker TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('gross_revenue')) {
    db.exec("ALTER TABLE companies ADD COLUMN gross_revenue TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('interview_questions')) {
    db.exec("ALTER TABLE companies ADD COLUMN interview_questions TEXT NOT NULL DEFAULT ''");
  }
}

// Migration: the favorite and not-interested flags are per person, not per
// company — Gabe may pass on an airline Ian is keen on. They live in
// company_flags, one row per (company, person); a company's profile stays
// shared. Flags that were global are handed to every person who tracks a job
// at that company (the people who could have set them); a flagged company
// nobody tracks keeps its flags for everyone. The old columns are dropped so
// nothing can read the stale global values by accident.
db.exec(`
  CREATE TABLE IF NOT EXISTS company_flags (
    company TEXT NOT NULL,
    person_id INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    not_interested INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (company, person_id)
  );
`);
{
  const cols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  const old = ['favorite', 'not_interested'].filter(c => cols.includes(c));
  if (old.length) {
    const flagged = db.prepare(`SELECT name, ${old.join(', ')} FROM companies WHERE ${old.map(c => `${c} = 1`).join(' OR ')}`).all();
    const everyone = db.prepare('SELECT id FROM people').all().map(p => p.id);
    const trackers = db.prepare('SELECT DISTINCT person_id FROM jobs WHERE company = ?');
    const insert = db.prepare('INSERT OR REPLACE INTO company_flags (company, person_id, favorite, not_interested) VALUES (?, ?, ?, ?)');
    for (const row of flagged) {
      const owners = trackers.all(row.name).map(r => r.person_id);
      for (const personId of owners.length ? owners : everyone) insert.run(row.name, personId, row.favorite ?? 0, row.not_interested ?? 0);
    }
    for (const col of old) db.exec(`ALTER TABLE companies DROP COLUMN ${col}`);
  }
}

// proposed_salary is stored as whole dollars or NULL. Accepts a number or a
// numeric string (with $ and commas); anything else is an error, and an empty
// value clears it.
export function normalizeProposedSalary(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid proposed_salary "${value}" — expected a non-negative dollar amount (or null to clear)`);
  }
  return Math.round(n);
}

function touch(fields) {
  return { ...fields, updated_at: new Date().toISOString() };
}

export function listPeople() {
  return db.prepare(`
    SELECT people.*, (SELECT COUNT(*) FROM jobs WHERE jobs.person_id = people.id) AS job_count
    FROM people ORDER BY name COLLATE NOCASE
  `).all();
}

export function getPerson(id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id) ?? null;
}

export function findPersonByName(name) {
  return db.prepare('SELECT * FROM people WHERE name = ? COLLATE NOCASE').get(String(name ?? '').trim()) ?? null;
}

// The person to use when a caller doesn't name one — only unambiguous when
// exactly one person exists.
export function onlyPerson() {
  const rows = db.prepare('SELECT * FROM people ORDER BY id LIMIT 2').all();
  return rows.length === 1 ? rows[0] : null;
}

export function addPerson(name) {
  name = String(name ?? '').trim();
  if (!name) throw new Error('Person name is required');
  if (findPersonByName(name)) throw new Error(`A person named "${name}" already exists`);
  const info = db.prepare('INSERT INTO people (name) VALUES (?)').run(name);
  return getPerson(info.lastInsertRowid);
}

const PERSON_FIELDS = ['name', 'preferred_name', 'resume_path', 'documents_dir', 'email', 'search_instructions'];

export function updatePerson(id, fields) {
  const person = getPerson(id);
  if (!person) return null;
  if (fields.name !== undefined) {
    const name = String(fields.name).trim();
    if (!name) throw new Error('Person name cannot be empty');
    const existing = findPersonByName(name);
    if (existing && existing.id !== person.id) throw new Error(`A person named "${name}" already exists`);
  }
  const updates = Object.entries(fields)
    .filter(([k]) => PERSON_FIELDS.includes(k))
    .map(([k, v]) => [k, String(v ?? '').trim()]);
  if (!updates.length) return person;
  const sql = `UPDATE people SET ${updates.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...updates.map(([, v]) => v), new Date().toISOString(), person.id);
  return getPerson(person.id);
}

export function deletePerson(id) {
  const person = getPerson(id);
  if (!person) return false;
  const jobCount = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE person_id = ?').get(person.id).n;
  if (jobCount > 0) throw new Error(`${person.name} still has ${jobCount} tracked job(s) — delete them first`);
  if (!db.prepare('SELECT 1 FROM people WHERE id != ? LIMIT 1').get(person.id)) {
    throw new Error('Cannot delete the last person');
  }
  db.prepare('DELETE FROM people WHERE id = ?').run(person.id);
  db.prepare('DELETE FROM company_flags WHERE person_id = ?').run(person.id);
  return true;
}

export function listJobDocuments(jobId) {
  return db.prepare('SELECT * FROM job_documents WHERE job_id = ? ORDER BY kind').all(jobId);
}

export function getJobDocument(jobId, kind) {
  return db.prepare('SELECT * FROM job_documents WHERE job_id = ? AND kind = ?').get(jobId, kind) ?? null;
}

export function upsertJobDocument(jobId, kind, relPath) {
  db.prepare(`
    INSERT INTO job_documents (job_id, kind, path) VALUES (?, ?, ?)
    ON CONFLICT(job_id, kind) DO UPDATE SET path = excluded.path, updated_at = ?
  `).run(jobId, kind, relPath, new Date().toISOString());
  return getJobDocument(jobId, kind);
}

export function deleteJobDocuments(jobId, kind) {
  if (kind) db.prepare('DELETE FROM job_documents WHERE job_id = ? AND kind = ?').run(jobId, kind);
  else db.prepare('DELETE FROM job_documents WHERE job_id = ?').run(jobId);
}

export function listJobs({ personId, status, company, level, q, since, limit, excludeNotInterestedCompanies } = {}) {
  const where = [];
  const params = [];
  // Flags are per person, so each job is judged against its own owner's flags.
  if (excludeNotInterestedCompanies) {
    where.push('NOT EXISTS (SELECT 1 FROM company_flags f WHERE f.company = jobs.company AND f.person_id = jobs.person_id AND f.not_interested = 1)');
  }
  if (personId != null) { where.push('person_id = ?'); params.push(personId); }
  // status accepts one value or an array (any-of match).
  const statuses = (Array.isArray(status) ? status : [status]).filter(Boolean);
  if (statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(', ')})`); params.push(...statuses); }
  if (company) { where.push('company LIKE ?'); params.push(`%${company}%`); }
  if (level) { where.push('level = ?'); params.push(level); }
  if (since) { where.push('date_found >= ?'); params.push(since); }
  if (q) {
    where.push('(title LIKE ? OR company LIKE ? OR category LIKE ? OR fit LIKE ? OR note LIKE ? OR user_note LIKE ? OR salary LIKE ? OR rejection_reason LIKE ? OR missing_skills LIKE ? OR application_notes LIKE ? OR referred_by LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like, like, like);
  }
  // doc_kinds: comma-joined kinds of generated documents ("resume,cover_letter")
  // so callers know what exists without a second query. person_name saves a
  // lookup when listing across people.
  let sql = `SELECT jobs.*,
    (SELECT GROUP_CONCAT(kind) FROM job_documents d WHERE d.job_id = jobs.id) AS doc_kinds,
    (SELECT name FROM people WHERE people.id = jobs.person_id) AS person_name
    FROM jobs`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  // Newest first; the owner's favorite companies win ties within a date.
  sql += ' ORDER BY date_found DESC, EXISTS (SELECT 1 FROM company_flags f WHERE f.company = jobs.company AND f.person_id = jobs.person_id AND f.favorite = 1) DESC, company ASC, id ASC';
  if (limit) { sql += ' LIMIT ?'; params.push(limit); }
  return db.prepare(sql).all(...params);
}

export function getJob({ id, url, personId }) {
  if (id != null) return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) ?? null;
  if (url && personId != null) return db.prepare('SELECT * FROM jobs WHERE url = ? AND person_id = ?').get(url, personId) ?? null;
  if (url) {
    // URL uniqueness is per-person, so a bare URL lookup can be ambiguous.
    const rows = db.prepare('SELECT * FROM jobs WHERE url = ? ORDER BY id LIMIT 2').all(url);
    if (rows.length > 1) throw new Error('Multiple people track this posting URL — identify the job by id or specify the person');
    return rows[0] ?? null;
  }
  return null;
}

// The job's stable feedback token, minting one on first use. Digest emails
// embed it in /respond/<token> links so the candidate can report back.
export function ensureFeedbackToken(jobId) {
  const job = db.prepare('SELECT id, feedback_token FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`No job with id ${jobId}`);
  if (job.feedback_token) return job.feedback_token;
  const token = randomBytes(16).toString('base64url');
  db.prepare('UPDATE jobs SET feedback_token = ? WHERE id = ?').run(token, jobId);
  return token;
}

export function getJobByFeedbackToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM jobs WHERE feedback_token = ?').get(String(token)) ?? null;
}

export function isUrlTracked(url) {
  return Boolean(db.prepare('SELECT 1 FROM jobs WHERE url = ? LIMIT 1').get(url));
}

// Adds jobs, skipping any whose URL that person already tracks (so a daily run
// can safely re-send an old suggestion without clobbering its status/note).
// Each job may carry its own person_id; defaultPersonId covers the rest.
export function addJobs(jobs, defaultPersonId) {
  const insert = db.prepare(`
    INSERT INTO jobs (person_id, date_found, title, company, url, category, salary, salary_min, salary_max, salary_confidence, fit, status, note, level, rejection_reason, missing_skills, proposed_salary, application_notes, referred_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id, url) DO NOTHING
  `);
  const results = { added: 0, skipped: 0, jobs: [] };
  for (const job of jobs) {
    const personId = job.person_id ?? defaultPersonId;
    if (personId == null || !getPerson(personId)) {
      throw new Error(`Unknown person id "${personId}" — every job needs a valid person`);
    }
    const status = STATUSES.includes(job.status) ? job.status : 'new';
    const reason = status === 'Not Moving Forward' ? (job.rejection_reason || '') : '';
    const level = job.level ? normalizeLevel(job.level) : classifyLevel(job.title);
    // An explicitly supplied range wins; otherwise parse it from the salary string.
    const range = job.salary_min != null || job.salary_max != null
      ? { min: job.salary_min ?? null, max: job.salary_max ?? null }
      : parseSalary(job.salary);
    const referredBy = String(job.referred_by ?? '').trim();
    const info = insert.run(
      personId,
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
      reason,
      reason === 'Not Qualified' ? normalizeSkills(job.missing_skills) : '',
      normalizeProposedSalary(job.proposed_salary),
      job.application_notes || '',
      referredBy
    );
    if (info.changes > 0) {
      results.added++;
      if (referredBy) addCompanyReferrals(job.company, [referredBy]);
      results.jobs.push(getJob({ id: info.lastInsertRowid }));
    } else {
      results.skipped++;
    }
  }
  return results;
}

const EDITABLE_FIELDS = ['person_id', 'date_found', 'title', 'company', 'url', 'category', 'salary', 'salary_min', 'salary_max', 'salary_confidence', 'fit', 'status', 'note', 'user_note', 'level', 'rejection_reason', 'missing_skills', 'proposed_salary', 'application_notes', 'referred_by'];

// The subset of job fields a non-admin user may change on their own jobs.
// The application details and the referral belong to the candidate — they're
// the one applying, and the one who knows who referred them.
export const USER_EDITABLE_JOB_FIELDS = ['status', 'rejection_reason', 'missing_skills', 'user_note', 'proposed_salary', 'application_notes', 'referred_by'];

export function updateJob({ id, url, personId }, fields) {
  const job = getJob({ id, url, personId });
  if (!job) return null;
  if (fields.status && !STATUSES.includes(fields.status)) {
    throw new Error(`Invalid status "${fields.status}". Valid statuses: ${STATUSES.join(', ')}`);
  }
  if (fields.person_id != null && !getPerson(fields.person_id)) {
    throw new Error(`Unknown person id "${fields.person_id}"`);
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
  // Missing skills only make sense for a "Not Qualified" rejection; clear them
  // whenever the job's (resulting) status/reason is anything else.
  const reason = 'rejection_reason' in fields ? fields.rejection_reason : job.rejection_reason;
  if ((fields.status || job.status) !== 'Not Moving Forward' || reason !== 'Not Qualified') {
    fields = { ...fields, missing_skills: '' };
  } else if ('missing_skills' in fields) {
    fields = { ...fields, missing_skills: normalizeSkills(fields.missing_skills) };
  }
  // Application details are deliberately kept across status changes (see the
  // migration comment); only their shape is normalized here.
  if ('proposed_salary' in fields) {
    fields = { ...fields, proposed_salary: normalizeProposedSalary(fields.proposed_salary) };
  }
  if ('application_notes' in fields) {
    fields = { ...fields, application_notes: String(fields.application_notes ?? '') };
  }
  if ('referred_by' in fields) {
    fields = { ...fields, referred_by: String(fields.referred_by ?? '').trim() };
  }
  const updates = Object.entries(touch(fields)).filter(([k]) => EDITABLE_FIELDS.includes(k) || k === 'updated_at');
  if (!updates.length) return job;
  const sql = `UPDATE jobs SET ${updates.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...updates.map(([, v]) => v), job.id);
  const updated = getJob({ id: job.id });
  // A referral name is remembered on the job's company so it can be offered
  // for the company's other jobs. Clearing referred_by leaves the list alone —
  // the person still referred the candidate once.
  if (updated.referred_by && ('referred_by' in fields || 'company' in fields)) {
    addCompanyReferrals(updated.company, [updated.referred_by]);
  }
  return updated;
}

// Every distinct skill ever recorded as missing (optionally for one person),
// comma-parsed and deduped case-insensitively, for the UI's suggestion list.
export function listMissingSkills({ personId } = {}) {
  const rows = personId != null
    ? db.prepare("SELECT missing_skills FROM jobs WHERE missing_skills != '' AND person_id = ?").all(personId)
    : db.prepare("SELECT missing_skills FROM jobs WHERE missing_skills != ''").all();
  return parseSkills(rows.map(r => r.missing_skills).join(','))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function deleteJob({ id, url, personId }) {
  const job = getJob({ id, url, personId });
  if (!job) return false;
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  // Document rows go with the job; the files themselves are left on disk.
  db.prepare('DELETE FROM job_documents WHERE job_id = ?').run(job.id);
  return true;
}

// The shape of a company with no saved row yet: every profile field blank and,
// for whichever person is asking, neither flag set.
const COMPANY_DEFAULTS = { website: '', note: '', company_type: '', employee_count: '', ticker: '', gross_revenue: '', interview_questions: '', referrals: '', not_interested: 0, favorite: 0 };

// The per-person flags (favorite, not_interested); everything else on a
// company is its shared profile.
export const COMPANY_FLAGS = ['favorite', 'not_interested'];

// One person's flags by company name. Without a person there are none — a
// company then reads as neither favorite nor not-interested.
function companyFlagsFor(personId) {
  if (personId == null) return new Map();
  const rows = db.prepare('SELECT company, favorite, not_interested FROM company_flags WHERE person_id = ?').all(personId);
  return new Map(rows.map(r => [r.company, { favorite: r.favorite, not_interested: r.not_interested }]));
}

// Every company referenced by a job (with defaults when it has no saved row)
// plus any saved companies whose jobs are gone. The favorite / not_interested
// flags are the given person's.
export function listCompanies({ personId } = {}) {
  const saved = db.prepare('SELECT * FROM companies').all();
  const byName = new Map(saved.map(r => [r.name, r]));
  const flags = companyFlagsFor(personId);
  const counts = db.prepare('SELECT company, COUNT(*) AS n FROM jobs GROUP BY company').all();
  const result = [];
  for (const { company, n } of counts) {
    result.push({ name: company, ...COMPANY_DEFAULTS, ...(byName.get(company) || {}), ...(flags.get(company) || {}), job_count: n });
    byName.delete(company);
  }
  for (const row of byName.values()) result.push({ ...COMPANY_DEFAULTS, ...row, ...(flags.get(row.name) || {}), job_count: 0 });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCompany(name, { personId } = {}) {
  const row = db.prepare('SELECT * FROM companies WHERE name = ?').get(name);
  const count = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE company = ?').get(name);
  const flags = personId == null
    ? null
    : db.prepare('SELECT favorite, not_interested FROM company_flags WHERE company = ? AND person_id = ?').get(name, personId);
  return { name, ...COMPANY_DEFAULTS, ...(row || {}), ...(flags || {}), job_count: count.n };
}

const COMPANY_FIELDS = ['website', 'note', 'company_type', 'employee_count', 'ticker', 'gross_revenue', 'interview_questions', 'referrals'];

// Canonicalize a caller-supplied value against a preset list (case-insensitive);
// values that don't match any preset are kept as given.
function normalizePreset(value, presets) {
  const canon = (s) => String(s).toLowerCase().replace(/[,\s]/g, ''); // "11 - 50" and "1000+" match "11-50" and "1,000+"
  const exact = presets.find(p => canon(p) === canon(value));
  return exact ?? String(value).trim();
}

// Saves a company's shared profile fields and, when favorite / not_interested
// are among the fields, that person's flags — which need a person to belong to.
export function upsertCompany(name, fields, { personId } = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Company name is required');
  const flags = Object.fromEntries(Object.entries(fields).filter(([k]) => COMPANY_FLAGS.includes(k)));
  if (Object.keys(flags).length && personId == null) {
    throw new Error('favorite and not_interested are per person — specify the person they apply to');
  }
  if (fields.company_type) fields = { ...fields, company_type: normalizePreset(fields.company_type, COMPANY_TYPES) };
  if (fields.employee_count) fields = { ...fields, employee_count: normalizePreset(fields.employee_count, EMPLOYEE_COUNTS) };
  // referrals: a comma-delimited string or an array of names; stored tidy.
  if ('referrals' in fields) {
    const raw = Array.isArray(fields.referrals) ? fields.referrals.join(',') : fields.referrals;
    fields = { ...fields, referrals: normalizeNames(raw) };
  }
  if ('ticker' in fields) fields = { ...fields, ticker: normalizeTicker(fields.ticker) };
  if ('gross_revenue' in fields) fields = { ...fields, gross_revenue: String(fields.gross_revenue ?? '').trim() };
  // interview_questions: an array or newline-delimited text; stored one per line.
  if ('interview_questions' in fields) fields = { ...fields, interview_questions: normalizeQuestions(fields.interview_questions) };
  const updates = Object.entries(fields).filter(([k]) => COMPANY_FIELDS.includes(k));
  if (!db.prepare('SELECT 1 FROM companies WHERE name = ?').get(name)) {
    db.prepare('INSERT INTO companies (name) VALUES (?)').run(name);
  }
  if (updates.length) {
    const sql = `UPDATE companies SET ${updates.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE name = ?`;
    db.prepare(sql).run(...updates.map(([, v]) => v), new Date().toISOString(), name);
  }
  if (Object.keys(flags).length) setCompanyFlags(name, personId, flags);
  return getCompany(name, { personId });
}

// Sets one person's favorite / not_interested flags on a company (either or
// both; booleans or 0/1). A row with neither flag set is removed, so the table
// only holds actual preferences.
export function setCompanyFlags(name, personId, flags) {
  name = (name || '').trim();
  if (!name) throw new Error('Company name is required');
  if (personId == null || !getPerson(personId)) throw new Error(`Unknown person id "${personId}"`);
  const updates = Object.entries(flags).filter(([k]) => COMPANY_FLAGS.includes(k)).map(([k, v]) => [k, v ? 1 : 0]);
  if (updates.length) {
    if (!db.prepare('SELECT 1 FROM companies WHERE name = ?').get(name)) {
      db.prepare('INSERT INTO companies (name) VALUES (?)').run(name);
    }
    db.prepare('INSERT OR IGNORE INTO company_flags (company, person_id) VALUES (?, ?)').run(name, personId);
    db.prepare(`UPDATE company_flags SET ${updates.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE company = ? AND person_id = ?`)
      .run(...updates.map(([, v]) => v), new Date().toISOString(), name, personId);
    db.prepare('DELETE FROM company_flags WHERE company = ? AND person_id = ? AND favorite = 0 AND not_interested = 0').run(name, personId);
  }
  return getCompany(name, { personId });
}

// Adds names to a company's referrals list (deduped case-insensitively;
// existing entries keep their casing). Called automatically whenever a job's
// referred_by is set, and by update_company's add_referrals.
export function addCompanyReferrals(name, names) {
  const current = getCompany(name).referrals;
  const merged = normalizeNames([current, ...(names || [])].join(','));
  return merged === current ? getCompany(name) : upsertCompany(name, { referrals: merged });
}

// Appends interview questions to a company's list (deduped case-insensitively,
// existing order kept). Used by research, which adds to the list rather than
// replacing questions a person wrote themselves.
export function addCompanyInterviewQuestions(name, questions) {
  const current = getCompany(name).interview_questions;
  const merged = normalizeQuestions([...parseQuestions(current), ...parseQuestions(questions)]);
  return merged === current ? getCompany(name) : upsertCompany(name, { interview_questions: merged });
}

// Creates a company that has no saved row and no tracked jobs yet, so it can
// be browsed and researched before any posting mentions it. Names are matched
// case-insensitively against saved rows and job companies, and the existing
// spelling is reported, since jobs join to companies by exact name.
export function addCompany(name, fields = {}, { personId } = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Company name is required');
  const existing = listCompanies().find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new Error(`Company "${existing.name}" already exists`);
  return upsertCompany(name, fields, { personId });
}

// ---- Users & sessions (web authentication) ----

export const ROLES = ['admin', 'user'];

export function listUsers() {
  return db.prepare(`
    SELECT users.*, (SELECT name FROM people WHERE people.id = users.person_id) AS person_name
    FROM users ORDER BY email COLLATE NOCASE
  `).all();
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email ?? '').trim()) ?? null;
}

export function addUser({ email, role = 'user', person_id = null, name = '' }) {
  email = String(email ?? '').trim();
  if (!email.includes('@')) throw new Error('A valid email address is required');
  if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}". Valid roles: ${ROLES.join(', ')}`);
  if (getUserByEmail(email)) throw new Error(`A user with email "${email}" already exists`);
  if (person_id != null && !getPerson(person_id)) throw new Error(`Unknown person id "${person_id}"`);
  const info = db.prepare('INSERT INTO users (email, role, person_id, name) VALUES (?, ?, ?, ?)')
    .run(email, role, person_id, String(name ?? ''));
  return getUser(info.lastInsertRowid);
}

export function updateUser(id, fields) {
  const user = getUser(id);
  if (!user) return null;
  if (fields.role !== undefined && !ROLES.includes(fields.role)) {
    throw new Error(`Invalid role "${fields.role}". Valid roles: ${ROLES.join(', ')}`);
  }
  if (fields.person_id !== undefined && fields.person_id != null && !getPerson(fields.person_id)) {
    throw new Error(`Unknown person id "${fields.person_id}"`);
  }
  const allowed = ['role', 'person_id', 'name', 'picture', 'last_login_at'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!updates.length) return user;
  const sql = `UPDATE users SET ${updates.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...updates.map(([, v]) => v), id);
  return getUser(id);
}

export function deleteUser(id) {
  const user = getUser(id);
  if (!user) return false;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return true;
}

const SESSION_DAYS = 30;

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  // Opportunistic cleanup so the table can't grow without bound.
  db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
  return { token, expires_at: expires, max_age: SESSION_DAYS * 24 * 60 * 60 };
}

// The signed-in user for a session token, or null when the token is unknown
// or expired.
export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).get(String(token));
  return row ?? null;
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
}

// Whether this person tracks a job with this exact posting URL — used to
// authorize non-admin access to /api/local-file.
export function personTracksUrl(url, personId) {
  return Boolean(db.prepare('SELECT 1 FROM jobs WHERE url = ? AND person_id = ? LIMIT 1').get(url, personId));
}

export function getStats({ personId } = {}) {
  const where = personId != null ? ' WHERE person_id = ?' : '';
  const params = personId != null ? [personId] : [];
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM jobs${where} GROUP BY status`).all(...params);
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
  let total = 0;
  for (const row of rows) {
    byStatus[row.status] = row.n;
    total += row.n;
  }
  const latest = db.prepare(`SELECT MAX(date_found) AS d FROM jobs${where}`).get(...params);
  return { total, byStatus, lastFound: latest?.d ?? null };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.JOBTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
export const DB_PATH = path.join(DATA_DIR, 'jobtracker.db');

export const STATUSES = ['new', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Not Moving Forward'];

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

function touch(fields) {
  return { ...fields, updated_at: new Date().toISOString() };
}

export function listJobs({ status, company, q, since, limit } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (company) { where.push('company LIKE ?'); params.push(`%${company}%`); }
  if (since) { where.push('date_found >= ?'); params.push(since); }
  if (q) {
    where.push('(title LIKE ? OR company LIKE ? OR category LIKE ? OR fit LIKE ? OR note LIKE ? OR salary LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
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
    INSERT INTO jobs (date_found, title, company, url, category, salary, salary_confidence, fit, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO NOTHING
  `);
  const results = { added: 0, skipped: 0, jobs: [] };
  for (const job of jobs) {
    const status = STATUSES.includes(job.status) ? job.status : 'new';
    const info = insert.run(
      job.date_found || new Date().toISOString().slice(0, 10),
      job.title,
      job.company,
      job.url,
      job.category || '',
      job.salary || '',
      job.salary_confidence || 'ok',
      job.fit || '',
      status,
      job.note || ''
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

const EDITABLE_FIELDS = ['date_found', 'title', 'company', 'url', 'category', 'salary', 'salary_confidence', 'fit', 'status', 'note'];

export function updateJob({ id, url }, fields) {
  const job = getJob({ id, url });
  if (!job) return null;
  if (fields.status && !STATUSES.includes(fields.status)) {
    throw new Error(`Invalid status "${fields.status}". Valid statuses: ${STATUSES.join(', ')}`);
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

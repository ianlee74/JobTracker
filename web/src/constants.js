export const STATUSES = ['new', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Not Moving Forward', 'No Longer Available'];

export const REJECTION_REASONS = ['Not Interested', 'Not Qualified', 'Over Qualified', 'Low Salary', 'Missing Benefits', 'Not Remote', 'Not Interested in Location', 'Not Interested in Company', 'Other'];

// Missing skills for a "Not Qualified" rejection are stored comma-delimited;
// parse trims, drops blanks and dedupes case-insensitively (first casing wins).
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

// A company's referrals (who has referred the candidate to its jobs) are
// stored the same way, so they share the parser.
export const parseNames = parseSkills;

export const LEVELS = ['Senior', 'Staff', 'Principal', 'Lead', 'Manager', 'Senior Manager', 'Director', 'Senior Director', 'VP', 'Executive', 'Other'];

export const COMPANY_TYPES = ['Startup', 'Small Company', 'Mid-size Company', 'Enterprise', 'Agency / Consultancy', 'Non-profit', 'Government', 'Other'];

export const EMPLOYEE_COUNTS = ['1-10', '11-50', '51-200', '201-500', '501-1,000', '1,001-5,000', '5,001-10,000', '10,000+'];

// A company's interview questions are stored one per line.
export function parseQuestions(text) {
  return String(text || '').split(/\r?\n/).map(q => q.trim()).filter(Boolean);
}

// Fidelity's research dashboard for a stock ticker symbol.
export function tickerHref(ticker) {
  return `https://digital.fidelity.com/prgw/digital/research/quote/dashboard/summary?symbol=${encodeURIComponent(ticker)}`;
}

// Whole-dollar amount as "$200,000".
export function formatDollars(n) {
  return '$' + Number(n).toLocaleString('en-US');
}

// Compact display of a job's parsed salary range ("$200K – $250K"), or null
// when nothing was parsed so the caller can fall back to the raw salary string.
export function formatSalaryRange({ salary_min: min, salary_max: max }) {
  if (min == null && max == null) return null;
  // Use the compact "K" style only when every shown endpoint stays clean in it.
  const compact = [min, max].filter(n => n != null).every(n => n >= 1000 && n % 500 === 0);
  const money = (n) => (compact ? `$${(n / 1000).toLocaleString()}K` : `$${n.toLocaleString()}`);
  if (min == null) return `Up to ${money(max)}`;
  if (max == null) return `${money(min)}+`;
  if (min === max) return money(min);
  return `${money(min)} – ${money(max)}`;
}

// Browsers block file:// links from http pages, so local postings are served
// through the server instead.
export function jobHref(url) {
  return (url || '').startsWith('file:') ? `/api/local-file?url=${encodeURIComponent(url)}` : url;
}

// Preset interview kinds (mirrors INTERVIEW_TYPES in server/db.js); a custom
// free-text type is also allowed.
export const INTERVIEW_TYPES = ['Recruiter', 'Hiring Manager', 'Technical', 'System Design', 'Behavioral', 'Panel', 'Executive', 'Team Fit', 'Final', 'Other'];

// An interview's scheduled_at ("2026-09-22T14:00" local, or a bare date) as
// "Tue, Sep 22 · 2:00 PM" / "Tue, Sep 22"; '' when unset or unparseable.
export function formatWhen(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return String(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  if (Number.isNaN(d.getTime())) return String(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  if (!m[4]) return day;
  return `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export const STATUS_COLORS = {
  'new': '#6b7280',
  'Interested': '#2563eb',
  'Applied': '#7c3aed',
  'Interviewing': '#d97706',
  'Offer': '#16a34a',
  'Not Moving Forward': '#9ca3af',
  'No Longer Available': '#b91c1c'
};

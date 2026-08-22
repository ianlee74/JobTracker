export const STATUSES = ['new', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Not Moving Forward', 'No Longer Available'];

export const REJECTION_REASONS = ['Not Interested', 'Not Qualified', 'Over Qualified', 'Low Salary', 'Missing Benefits', 'Not Remote', 'Not Interested in Location', 'Not Interested in Company', 'Other'];

export const LEVELS = ['Senior', 'Staff', 'Principal', 'Lead', 'Manager', 'Senior Manager', 'Director', 'Senior Director', 'VP', 'Executive', 'Other'];

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

export const STATUS_COLORS = {
  'new': '#6b7280',
  'Interested': '#2563eb',
  'Applied': '#7c3aed',
  'Interviewing': '#d97706',
  'Offer': '#16a34a',
  'Not Moving Forward': '#9ca3af',
  'No Longer Available': '#b91c1c'
};

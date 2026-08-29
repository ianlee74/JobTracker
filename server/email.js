import { listJobs, getPerson, ensureFeedbackToken } from './db.js';

// The app never sends email itself — it composes the message (recipient,
// subject, HTML and plain-text bodies) and the caller sends it through their
// own mail client, or Claude sends it via a connected email tool.

// Where the /respond/<token> feedback links (and local-file posting links)
// point. Overridable because localhost only resolves on the tracker machine —
// set JOBTRACKER_BASE_URL (e.g. http://192.168.1.20:7080) so links work for a
// candidate reading the email on another device on the local network.
export function defaultBaseUrl() {
  if (process.env.JOBTRACKER_BASE_URL) return process.env.JOBTRACKER_BASE_URL.replace(/\/+$/, '');
  const port = Number(process.env.JOBTRACKER_PORT || process.env.PORT) || 7080;
  return `http://localhost:${port}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Candidate-facing posting link: file:// URLs only open through the server's
// local-file route, http(s) URLs are used as-is.
function postingLink(job, baseUrl) {
  if (job.url.startsWith('file:')) return `${baseUrl}/api/local-file?url=${encodeURIComponent(job.url)}`;
  return job.url;
}

// The "why this fits you" line: the fit field when the tracker has one,
// otherwise a modest line built from the job's own facts — never invented.
function fitSummary(job) {
  if (job.fit?.trim()) return job.fit.trim();
  const kind = [job.level, job.category].filter(Boolean).join(' ');
  return kind ? `A ${kind} opening at ${job.company}.` : `See the posting for details.`;
}

function metaLine(job) {
  return [job.company, job.level, job.category, job.salary].filter(s => s?.trim()).join(' · ');
}

const ACTIONS = [
  { path: 'applied', label: '✅ I applied', color: '#2e7d32' },
  { path: 'interested', label: '👍 Still interested', color: '#1565c0' },
  { path: 'not-interested', label: '👎 Not interested', color: '#b71c1c' }
];

function jobHtml(job, baseUrl) {
  const token = ensureFeedbackToken(job.id);
  const buttons = ACTIONS.map(a =>
    `<a href="${esc(`${baseUrl}/respond/${token}/${a.path}`)}" style="display:inline-block;margin:0 8px 4px 0;padding:6px 12px;border:1px solid ${a.color};border-radius:6px;color:${a.color};text-decoration:none;font-size:13px;">${a.label}</a>`
  ).join('\n      ');
  return `
  <div style="margin:0 0 20px;padding:14px 16px;border:1px solid #ddd;border-radius:8px;">
    <div style="font-size:12px;color:#777;margin-bottom:2px;">Job #${job.id} · found ${esc(job.date_found)}</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:2px;">
      <a href="${esc(postingLink(job, baseUrl))}" style="color:#1a4d8f;text-decoration:none;">${esc(job.title)}</a>
    </div>
    <div style="font-size:13px;color:#444;margin-bottom:8px;">${esc(metaLine(job))}</div>
    <div style="font-size:14px;color:#222;margin-bottom:10px;"><strong>Why it looks like a fit:</strong> ${esc(fitSummary(job))}</div>
    <div>
      ${buttons}
    </div>
  </div>`;
}

function jobText(job, baseUrl) {
  const token = ensureFeedbackToken(job.id);
  return [
    `Job #${job.id}: ${job.title}`,
    `  ${metaLine(job)}`,
    `  Posting:          ${postingLink(job, baseUrl)}`,
    `  Why it fits:      ${fitSummary(job)}`,
    `  I applied:        ${baseUrl}/respond/${token}/applied`,
    `  Still interested: ${baseUrl}/respond/${token}/interested`,
    `  Not interested:   ${baseUrl}/respond/${token}/not-interested`
  ].join('\n');
}

// Compose the Interested-jobs digest email for one person. Mints each job's
// feedback token as a side effect (stable across re-composes).
export function composeInterestedEmail({ personId, baseUrl } = {}) {
  const person = getPerson(personId);
  if (!person) throw new Error(`No person with id "${personId}"`);
  if (!person.email?.trim()) {
    throw new Error(`${person.name} has no email address — set it in Settings (⚙) or via update_person first.`);
  }
  baseUrl = (baseUrl || defaultBaseUrl()).replace(/\/+$/, '');
  const jobs = listJobs({ personId: person.id, status: 'Interested', excludeNotInterestedCompanies: true });
  if (!jobs.length) throw new Error(`${person.name} has no jobs in "Interested" status.`);

  const n = jobs.length;
  const subject = `${n} job opportunit${n === 1 ? 'y' : 'ies'} for you — please review`;
  const intro = `Here ${n === 1 ? 'is the opportunity' : `are the ${n} opportunities`} currently marked "Interested" for you. For each one, use the links to report back: whether you've applied, are still interested, or aren't interested (and why).`;
  const replyHint = `Can't use the links? Just reply to this email and mention each job's number — for example: "Job #${jobs[0].id}: applied" or "Job #${jobs[0].id}: not interested — salary too low".`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#222;">
  <p style="font-size:15px;">Hi ${esc(person.name)},</p>
  <p style="font-size:14px;">${esc(intro)}</p>
${jobs.map(j => jobHtml(j, baseUrl)).join('\n')}
  <p style="font-size:13px;color:#555;">${esc(replyHint)}</p>
  <p style="font-size:12px;color:#999;">Sent from your local JobTracker.</p>
</div>`;

  const text = [
    `Hi ${person.name},`,
    '',
    intro,
    '',
    jobs.map(j => jobText(j, baseUrl)).join('\n\n'),
    '',
    replyHint
  ].join('\n');

  return {
    to: person.email.trim(),
    person_id: person.id,
    person_name: person.name,
    subject,
    html,
    text,
    job_count: n,
    jobs: jobs.map(j => ({ id: j.id, title: j.title, company: j.company }))
  };
}

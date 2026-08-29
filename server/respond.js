import { getJobByFeedbackToken, updateJob, REJECTION_REASONS } from './db.js';

// Candidate-facing /respond/<token>/<action> pages, linked from the
// Interested-jobs digest email. Email clients can only GET, so the applied /
// interested actions record on GET; "not interested" shows a reason form
// first and records on its POST. The token (per job, unguessable) is the only
// authentication — these pages change nothing but the one job's status/note.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(res, code, title, bodyHtml) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — JobTracker</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f6f8; color: #222; margin: 0; padding: 24px; }
  .card { max-width: 560px; margin: 6vh auto; background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 28px 32px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .job { color: #555; font-size: 14px; margin-bottom: 18px; }
  .big { font-size: 40px; margin-bottom: 10px; }
  label { display: block; margin: 6px 0; font-size: 15px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 70px; margin-top: 4px; font: inherit; padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
  button { margin-top: 16px; padding: 8px 18px; font-size: 15px; border: none; border-radius: 6px; background: #b71c1c; color: #fff; cursor: pointer; }
  .muted { color: #777; font-size: 13px; margin-top: 18px; }
</style></head>
<body><div class="card">${bodyHtml}</div></body></html>`);
}

function jobLine(job) {
  return `<div class="job">Job #${job.id} · ${esc(job.title)} — ${esc(job.company)}</div>`;
}

function notFound(res) {
  return page(res, 404, 'Link not recognized', `
    <div class="big">🤔</div>
    <h1>This link isn't recognized</h1>
    <p>It may be from an old email, or the job may have been removed from the tracker.</p>`);
}

// Appends a dated feedback line to the job's note alongside any other updates.
function record(job, fields, noteLine) {
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[email feedback ${stamp}] ${noteLine}`;
  const note = job.note ? `${job.note}\n${line}` : line;
  return updateJob({ id: job.id }, { ...fields, note });
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

function reasonForm(res, job) {
  const options = REJECTION_REASONS.filter(r => r !== 'Other').map(r =>
    `<label><input type="radio" name="reason" value="${esc(r)}"> ${esc(r)}</label>`
  ).join('\n');
  return page(res, 200, 'Not interested', `
    ${jobLine(job)}
    <h1>Not interested — got it. Why?</h1>
    <form method="post">
      ${options}
      <label><input type="radio" name="reason" value="Other" checked> Other / more detail below</label>
      <label>Anything else worth noting? (optional)
        <textarea name="details" placeholder="e.g. salary too low, wrong tech stack, bad reviews…"></textarea>
      </label>
      <button type="submit">Submit</button>
    </form>
    <p class="muted">This marks the job "Not Moving Forward" in the tracker with your reason.</p>`);
}

// Handles /respond/<token>/<action>; returns false when the URL isn't a
// respond route so the caller can fall through to static serving.
export async function handleRespond(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'respond') return false;
  const job = getJobByFeedbackToken(parts[1]);
  const action = parts[2];
  if (!job || !['applied', 'interested', 'not-interested'].includes(action)) {
    notFound(res);
    return true;
  }

  if (action === 'applied' && req.method === 'GET') {
    if (job.status === 'Applied') {
      page(res, 200, 'Already recorded', `${jobLine(job)}<div class="big">✅</div><h1>Already marked as applied</h1><p>No changes made — good luck!</p>`);
    } else {
      record(job, { status: 'Applied' }, 'candidate reports they applied');
      page(res, 200, 'Application recorded', `${jobLine(job)}<div class="big">🎉</div><h1>Marked as applied</h1><p>The tracker now shows this job as <strong>Applied</strong>. Good luck!</p>`);
    }
    return true;
  }

  if (action === 'interested' && req.method === 'GET') {
    // Confirmation only — don't pull a job that already advanced (Applied,
    // Interviewing, …) back to Interested; do promote a "new" one.
    record(job, job.status === 'new' ? { status: 'Interested' } : {}, 'candidate confirms still interested');
    page(res, 200, 'Interest confirmed', `${jobLine(job)}<div class="big">👍</div><h1>Interest confirmed</h1><p>Noted on the job — thanks!</p>`);
    return true;
  }

  if (action === 'not-interested' && req.method === 'GET') {
    reasonForm(res, job);
    return true;
  }

  if (action === 'not-interested' && req.method === 'POST') {
    let body;
    try {
      body = await readFormBody(req);
    } catch {
      reasonForm(res, job);
      return true;
    }
    const preset = REJECTION_REASONS.includes(body.reason) ? body.reason : 'Other';
    const details = String(body.details || '').trim().slice(0, 2000);
    // A free-text reason replaces the "Other" placeholder; details on a preset
    // reason go into the note instead.
    const reason = preset === 'Other' && details ? details : preset;
    record(
      job,
      { status: 'Not Moving Forward', rejection_reason: reason },
      `candidate not interested — ${reason}${preset !== 'Other' && details ? ` (${details})` : ''}`
    );
    page(res, 200, 'Response recorded', `${jobLine(job)}<div class="big">👌</div><h1>Got it — not interested</h1><p>The job is now marked <strong>Not Moving Forward</strong> (${esc(reason)}).</p>`);
    return true;
  }

  notFound(res);
  return true;
}

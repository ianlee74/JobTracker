import http from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { listJobs, getJob, isUrlTracked, personTracksUrl, addJobs, updateJob, deleteJob, getStats, listCompanies, getCompany, upsertCompany, listPeople, getPerson, addPerson, updatePerson, deletePerson, onlyPerson, getJobDocument, listUsers, addUser, updateUser, deleteUser, getUser, USER_EDITABLE_JOB_FIELDS, STATUSES, LEVELS, DB_PATH } from './db.js';
import { generateJobDocuments, saveUploadedDocument, deleteJobDocumentFiles, documentsDir, hasApiCredentials } from './generate.js';
import { composeInterestedEmail, defaultBaseUrl } from './email.js';
import { handleRespond } from './respond.js';
import { handleAuth, requestUser, authEnabled, checkMcpToken, mcpTokenConfigured } from './auth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.JOBTRACKER_PORT || process.env.PORT) || 7080;
// Local-only by default. Set JOBTRACKER_HOST=0.0.0.0 (and JOBTRACKER_BASE_URL
// to this machine's LAN address) so digest-email feedback links work from a
// candidate's own device on the local network.
const HOST = process.env.JOBTRACKER_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// Where files dragged onto the UI are stored (a copy survives the original
// being moved or deleted).
const POSTINGS_DIR = path.join(path.dirname(DB_PATH), 'postings');

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('File too large (max 50 MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Drive roots for the in-app file picker.
function listRoots() {
  if (process.platform !== 'win32') return ['/'];
  const roots = [];
  for (let c = 67; c <= 90; c++) { // C: through Z:
    const root = `${String.fromCharCode(c)}:\\`;
    if (existsSync(root)) roots.push(root);
  }
  return roots;
}

// Document-generation settings live on the person; ?person=<id> selects whose
// (optional only while a single person exists).
function personFromQuery(url) {
  const p = url.searchParams.get('person');
  if (p) {
    const person = getPerson(Number(p));
    if (!person) throw new Error(`No person with id "${p}"`);
    return person;
  }
  const only = onlyPerson();
  if (only) return only;
  throw new Error('The "person" query parameter is required when multiple people are tracked');
}

async function settingsPayload(person) {
  const rp = person.resume_path ? path.resolve(person.resume_path) : '';
  const dataDir = path.resolve(path.dirname(DB_PATH));
  return {
    person_id: person.id,
    person_name: person.name,
    email: person.email,
    resume_path: person.resume_path,
    documents_dir: person.documents_dir,
    documents_dir_effective: documentsDir(person),
    resume_exists: Boolean(rp) && existsSync(rp),
    // An old-style dropped copy under data/postings — frozen, never refreshed.
    resume_is_snapshot: Boolean(rp) && rp.toLowerCase().startsWith(path.resolve(POSTINGS_DIR).toLowerCase() + path.sep),
    // The managed snapshot (data/standard-resume-<person>.*, or the legacy
    // data/standard-resume.*) — the UI keeps it in sync with the person's
    // original when it holds a file handle to it.
    resume_is_managed: Boolean(rp)
      && path.dirname(rp).toLowerCase() === dataDir.toLowerCase()
      && path.basename(rp).toLowerCase().startsWith('standard-resume'),
    api_credentials_found: await hasApiCredentials()
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function forbidden(res, msg = 'Not allowed for your role') {
  return json(res, 403, { error: msg });
}

// Remote MCP endpoint (/mcp): the same tools as the stdio server, over the
// Streamable HTTP transport, guarded by an admin bearer token. Stateless —
// each request gets a fresh server + transport, so no session bookkeeping.
async function handleMcp(req, res) {
  if (!mcpTokenConfigured()) {
    return json(res, 503, { error: 'Remote MCP is disabled — set JOBTRACKER_MCP_TOKEN on the server to enable it' });
  }
  if (!checkMcpToken(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return json(res, 401, { error: 'Missing or invalid MCP bearer token' });
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed — this MCP endpoint is stateless and accepts POST only' });
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}

async function handleApi(req, res, url, user) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const isAdmin = user.role === 'admin';
  // A user account that isn't linked to a person yet has nothing to look at
  // or change; fail every call with the reason instead of empty results.
  if (!isAdmin && user.person_id == null) {
    return forbidden(res, 'Your account is not linked to a person yet — ask the administrator to link it.');
  }

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const p = url.searchParams;
    return json(res, 200, listJobs({
      // Non-admins only ever see their own person's jobs, whatever they ask for.
      personId: isAdmin ? (p.get('person') ? Number(p.get('person')) : undefined) : user.person_id,
      status: p.get('status') || undefined,
      company: p.get('company') || undefined,
      level: p.get('level') || undefined,
      q: p.get('q') || undefined,
      since: p.get('since') || undefined,
      limit: p.get('limit') ? Number(p.get('limit')) : undefined
    }));
  }

  // Stores a file dragged onto the UI (raw body, filename in the query) and
  // returns the stored copy's file:// URL.
  if (req.method === 'POST' && url.pathname === '/api/upload-posting') {
    if (!isAdmin) return forbidden(res);
    const rawName = url.searchParams.get('name') || 'posting';
    const name = path.basename(rawName).replace(/[<>:"\/\\|?*\u0000-\u001f]/g, '_') || 'posting';
    let body;
    try {
      body = await readRawBody(req, 50 * 1024 * 1024);
    } catch (err) {
      return json(res, 413, { error: err.message });
    }
    if (!body.length) return json(res, 400, { error: 'The dropped file is empty' });
    await mkdir(POSTINGS_DIR, { recursive: true });
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let target = path.join(POSTINGS_DIR, name);
    for (let i = 2; existsSync(target); i++) {
      target = path.join(POSTINGS_DIR, `${stem} (${i})${ext}`);
    }
    await writeFile(target, body);
    return json(res, 201, { path: target, url: pathToFileURL(target).href });
  }

  // Directory listing for the in-app file picker.
  if (req.method === 'GET' && url.pathname === '/api/browse') {
    if (!isAdmin) return forbidden(res);
    const dir = path.resolve(url.searchParams.get('dir') || os.homedir());
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      return json(res, 400, { error: `Cannot read ${dir}: ${err.message}` });
    }
    const parent = path.dirname(dir);
    return json(res, 200, {
      dir,
      parent: parent === dir ? null : parent,
      roots: listRoots(),
      entries: dirents
        .filter(e => e.isDirectory() || e.isFile())
        .map(e => ({ name: e.name, path: path.join(dir, e.name), type: e.isDirectory() ? 'dir' : 'file' }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    });
  }

  // Browsers refuse to open file:// links from an http page, so tracked local
  // postings are served through here instead.
  if (req.method === 'GET' && url.pathname === '/api/local-file') {
    const fileUrl = url.searchParams.get('url') || '';
    if (!fileUrl.startsWith('file:')) return json(res, 400, { error: 'Expected a file:// URL' });
    // Only serve files that are actually some tracked job's posting URL —
    // and for non-admins, one of *their own* jobs' URLs.
    const tracked = isAdmin ? isUrlTracked(fileUrl) : personTracksUrl(fileUrl, user.person_id);
    if (!tracked) return json(res, 404, { error: 'No tracked job has this file URL' });
    let filePath;
    try { filePath = fileURLToPath(fileUrl); }
    catch { return json(res, 400, { error: 'Invalid file URL' }); }
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      return res.end(content);
    } catch {
      return json(res, 404, { error: `File not found: ${filePath}` });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/companies') {
    return json(res, 200, listCompanies());
  }

  // People: the candidates whose jobs are tracked. Each carries their own
  // document-generation settings (resume_path, documents_dir).
  if (url.pathname === '/api/people') {
    // A non-admin sees only the person their account is linked to.
    if (req.method === 'GET') {
      const people = listPeople();
      return json(res, 200, isAdmin ? people : people.filter(p => p.id === user.person_id));
    }
    if (req.method === 'POST') {
      if (!isAdmin) return forbidden(res);
      const body = await readBody(req);
      try {
        return json(res, 201, addPerson(body.name));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'people' && parts.length === 3) {
    if (!isAdmin) return forbidden(res);
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid person id' });
    if (req.method === 'GET') {
      const person = getPerson(id);
      return person ? json(res, 200, person) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      try {
        const person = updatePerson(id, body);
        return person ? json(res, 200, person) : json(res, 404, { error: 'Not found' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      try {
        return deletePerson(id) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  // Single company info; PATCH upserts, so saving notes for a company that has
  // no saved row yet just works.
  if (url.pathname === '/api/company') {
    const name = url.searchParams.get('name') || '';
    if (!name.trim()) return json(res, 400, { error: 'name query parameter is required' });
    if (req.method === 'GET') return json(res, 200, getCompany(name));
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      // Users may only flag/unflag favorites; everything else is admin's.
      if (!isAdmin && Object.keys(body).some(k => k !== 'favorite')) {
        return forbidden(res, 'Your role can only change the favorite flag on a company');
      }
      try {
        return json(res, 200, upsertCompany(name, body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  // Per-person document-generation settings (?person=<id>). The Anthropic API
  // key is never stored here — the server picks it up from the environment
  // (ANTHROPIC_API_KEY or an `ant auth login` profile); the response only
  // reports whether one was found.
  if (url.pathname === '/api/settings') {
    if (!isAdmin) return forbidden(res);
    let person;
    try {
      person = personFromQuery(url);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      try {
        person = updatePerson(person.id, body);
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'GET' || req.method === 'PATCH') {
      return json(res, 200, await settingsPayload(person));
    }
  }

  // Stores/overwrites the person's managed snapshot of their standard resume
  // and points their resume_path at it. The UI uploads through here both when
  // the resume is first chosen/dropped and on every re-sync from the original
  // file it holds a browser file handle to — that keeps the snapshot current.
  if (req.method === 'POST' && url.pathname === '/api/settings/resume-file') {
    if (!isAdmin) return forbidden(res);
    let person;
    try {
      person = personFromQuery(url);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const rawName = path.basename(url.searchParams.get('name') || 'resume');
    const ext = (path.extname(rawName) || '.docx').toLowerCase().replace(/[^.a-z0-9]/g, '');
    let body;
    try {
      body = await readRawBody(req, 50 * 1024 * 1024);
    } catch (err) {
      return json(res, 413, { error: err.message });
    }
    if (!body.length) return json(res, 400, { error: 'The uploaded resume is empty' });
    const dataDir = path.dirname(DB_PATH);
    const target = path.join(dataDir, `standard-resume-${person.id}${ext}`);
    await writeFile(target, body);
    // The previous snapshot may live elsewhere — a format switch (.pdf ->
    // .docx) or the legacy single-person standard-resume.* name — tidy it.
    const old = person.resume_path ? path.resolve(person.resume_path) : '';
    if (old && old !== path.resolve(target)
      && path.dirname(old).toLowerCase() === path.resolve(dataDir).toLowerCase()
      && path.basename(old).toLowerCase().startsWith('standard-resume')) {
      await rm(old, { force: true });
    }
    person = updatePerson(person.id, { resume_path: target });
    return json(res, 200, { path: target, original_name: rawName, ...(await settingsPayload(person)) });
  }

  // Serves a generated document inline (Markdown renders as plain text) or as
  // a download with a friendly filename.
  if (req.method === 'GET' && url.pathname === '/api/document') {
    const jobId = Number(url.searchParams.get('job'));
    const kind = url.searchParams.get('kind') || '';
    const doc = Number.isInteger(jobId) ? getJobDocument(jobId, kind) : null;
    if (!doc) return json(res, 404, { error: 'No such document' });
    const job = getJob({ id: jobId });
    // 404 (not 403) so another person's document ids aren't confirmed to exist.
    if (!isAdmin && job.person_id !== user.person_id) return json(res, 404, { error: 'No such document' });
    const base = documentsDir(getPerson(job.person_id));
    const filePath = path.resolve(base, doc.path);
    if (!filePath.startsWith(path.resolve(base))) return json(res, 403, { error: 'Forbidden' });
    let content;
    try {
      content = await readFile(filePath);
    } catch {
      return json(res, 404, { error: `Document file missing on disk: ${filePath}` });
    }
    const ext = path.extname(filePath).toLowerCase();
    const label = kind === 'resume' ? 'Resume' : 'Cover Letter';
    const name = `${label} - ${job.company} - ${job.title}${ext}`.replace(/[<>:"\/\\|?*]/g, '_');
    // Header values must be Latin-1 (an en dash in a job title would make
    // writeHead throw), so send an ASCII fallback filename plus the exact
    // name RFC 5987-encoded — browsers prefer the filename* form.
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(name).replace(/['()*!]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // The URL stays the same when a document is regenerated or replaced by
      // an upload, so it must never be served from the browser cache.
      'Cache-Control': 'no-store',
      // inline: Markdown displays in the browser; .docx downloads either way,
      // and the filename here makes that download friendly too.
      'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
    });
    return res.end(content);
  }

  // Compose the Interested-jobs digest email for one person: recipient (their
  // saved email), subject, and HTML/plain-text bodies with per-job feedback
  // links. Composing only — sending is up to the caller.
  if (req.method === 'POST' && url.pathname === '/api/interested-email') {
    if (!isAdmin) return forbidden(res);
    let person;
    try {
      person = personFromQuery(url);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const body = await readBody(req);
    try {
      return json(res, 200, composeInterestedEmail({ personId: person.id, baseUrl: body.base_url }));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // Human-friendly preview of that email: the rendered message plus a toolbar
  // to copy it (rich text for pasting into a compose window, or raw HTML).
  if (req.method === 'GET' && url.pathname === '/api/interested-email/preview') {
    if (!isAdmin) return forbidden(res);
    let email;
    try {
      email = composeInterestedEmail({ personId: personFromQuery(url).id });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;"><h2>Can't build the email</h2><p>${err.message.replace(/</g, '&lt;')}</p></body>`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Email preview — ${email.person_name}</title>
<style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: #f5f6f8; }
  .bar { position: sticky; top: 0; background: #1f2733; color: #fff; padding: 12px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .bar .meta { font-size: 13px; line-height: 1.5; }
  .bar button { padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .mail { background: #fff; max-width: 720px; margin: 24px auto; padding: 28px 36px; border-radius: 10px; border: 1px solid #ddd; }
  #copied { color: #8f8; font-size: 13px; }
</style></head>
<body>
  <div class="bar">
    <div class="meta"><strong>To:</strong> ${email.to.replace(/</g, '&lt;')}<br><strong>Subject:</strong> ${email.subject.replace(/</g, '&lt;')}</div>
    <button onclick="copyRich()">Copy email (paste into compose window)</button>
    <button onclick="copyRaw()">Copy raw HTML</button>
    <span id="copied"></span>
  </div>
  <div class="mail" id="mail"></div>
  <script id="payload" type="application/json">${JSON.stringify({ html: email.html, text: email.text }).replace(/</g, '\\u003c')}</script>
  <script>
    const payload = JSON.parse(document.getElementById('payload').textContent);
    document.getElementById('mail').innerHTML = payload.html;
    const flash = (msg) => {
      document.getElementById('copied').textContent = msg;
      setTimeout(() => { document.getElementById('copied').textContent = ''; }, 2000);
    };
    async function copyRich() {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.text], { type: 'text/plain' })
        })]);
        flash('✓ Copied — paste into your email compose window');
      } catch { copyRaw(); }
    }
    async function copyRaw() {
      await navigator.clipboard.writeText(payload.html);
      flash('✓ Raw HTML copied');
    }
  </script>
</body></html>`);
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const p = url.searchParams.get('person');
    const personId = isAdmin ? (p ? Number(p) : undefined) : user.person_id;
    return json(res, 200, { ...getStats({ personId }), statuses: STATUSES, levels: LEVELS });
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await readBody(req);
    const jobs = Array.isArray(body) ? body : [body];
    for (const job of jobs) {
      if (!job.title || !job.company || !job.url) {
        return json(res, 400, { error: 'Each job requires title, company, and url' });
      }
      // Users can only add jobs to their own list.
      if (!isAdmin) job.person_id = user.person_id;
    }
    // Jobs without their own person_id go to ?person=<id> (or the only person).
    try {
      const needsDefault = jobs.some(job => job.person_id == null);
      return json(res, 201, addJobs(jobs, needsDefault ? personFromQuery(url).id : undefined));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // Generate the tailored resume + cover letter for one job. Slow (two model
  // calls); the UI batches "all Interested" by calling this per job so each
  // request stays well under browser/server timeouts.
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 4 && parts[3] === 'generate') {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });
    if (!isAdmin) {
      const job = getJob({ id });
      if (!job || job.person_id !== user.person_id) return json(res, 404, { error: 'Job not found' });
    }
    const body = await readBody(req);
    try {
      return json(res, 200, await generateJobDocuments({ id }, { skipExisting: Boolean(body.skip_existing) }));
    } catch (err) {
      return json(res, err.message === 'Job not found' ? 404 : 500, { error: err.message });
    }
  }

  // Upload a hand-customized resume or cover letter for one job (raw body,
  // filename in ?name=), replacing the generated document of that kind.
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 4 && parts[3] === 'document') {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });
    const job = getJob({ id });
    // 404 (not 403) so other people's job ids aren't confirmed to exist.
    if (!job || (!isAdmin && job.person_id !== user.person_id)) return json(res, 404, { error: 'Job not found' });
    const kind = url.searchParams.get('kind');
    if (kind !== 'resume' && kind !== 'cover_letter') {
      return json(res, 400, { error: 'kind must be "resume" or "cover_letter"' });
    }
    let body;
    try {
      body = await readRawBody(req, 50 * 1024 * 1024);
    } catch (err) {
      return json(res, 413, { error: err.message });
    }
    if (!body.length) return json(res, 400, { error: 'The uploaded file is empty' });
    try {
      return json(res, 200, await saveUploadedDocument(job, kind, path.basename(url.searchParams.get('name') || ''), body));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // Delete a job's documents (files + DB rows) — one kind via ?kind=, or both
  // without it. The required step before regenerating, so existing documents
  // are never silently overwritten.
  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 4 && parts[3] === 'documents') {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });
    const job = getJob({ id });
    // 404 (not 403) so other people's job ids aren't confirmed to exist.
    if (!job || (!isAdmin && job.person_id !== user.person_id)) return json(res, 404, { error: 'Job not found' });
    const kind = url.searchParams.get('kind') || undefined;
    if (kind && kind !== 'resume' && kind !== 'cover_letter') {
      return json(res, 400, { error: 'kind must be "resume" or "cover_letter"' });
    }
    try {
      return json(res, 200, { deleted: await deleteJobDocumentFiles(job, kind) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 3) {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });
    // Non-admins can only see or touch their own jobs; 404 (not 403) so other
    // people's job ids aren't confirmed to exist.
    if (!isAdmin) {
      const job = getJob({ id });
      if (!job || job.person_id !== user.person_id) return json(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET') {
      const job = getJob({ id });
      return job ? json(res, 200, job) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (!isAdmin) {
        const blocked = Object.keys(body).filter(k => !USER_EDITABLE_JOB_FIELDS.includes(k));
        if (blocked.length) {
          return forbidden(res, `Your role can only change: ${USER_EDITABLE_JOB_FIELDS.join(', ')}`);
        }
      }
      try {
        const job = updateJob({ id }, body);
        return job ? json(res, 200, job) : json(res, 404, { error: 'Not found' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      if (!isAdmin) return forbidden(res);
      return deleteJob({ id }) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found' });
    }
  }

  // User management (invitations, roles, person links) — admin only.
  if (url.pathname === '/api/users') {
    if (!isAdmin) return forbidden(res);
    if (req.method === 'GET') return json(res, 200, listUsers());
    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 201, addUser(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  if (parts[0] === 'api' && parts[1] === 'users' && parts.length === 3) {
    if (!isAdmin) return forbidden(res);
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid user id' });
    // Admins can't demote or delete their own signed-in account — prevents
    // locking every admin out of the deployment.
    const self = authEnabled() && id === user.id;
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (self && body.role !== undefined && body.role !== 'admin') {
        return json(res, 400, { error: 'You cannot remove your own admin role' });
      }
      try {
        const updated = updateUser(id, body);
        return updated ? json(res, 200, updated) : json(res, 404, { error: 'Not found' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      if (self) return json(res, 400, { error: 'You cannot delete your own account' });
      return deleteUser(id) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'GET') {
      const found = getUser(id);
      return found ? json(res, 200, found) : json(res, 404, { error: 'Not found' });
    }
  }

  return json(res, 404, { error: 'Unknown API route' });
}

async function serveStatic(res, pathname) {
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    await stat(filePath);
  } catch {
    filePath = path.join(DIST_DIR, 'index.html'); // SPA fallback
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('UI not built yet. Run: npm run build');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // Order matters: /mcp has its own bearer-token auth; /api/auth/* and
    // /respond/* work without a session (sign-in itself, and the tokenized
    // candidate-feedback links); every other /api route needs a signed-in
    // user. Static files stay public — the SPA shell *is* the sign-in page.
    if (url.pathname === '/mcp') return await handleMcp(req, res);
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/me') {
      return await handleAuth(req, res, url, { json, readBody });
    }
    if (await handleRespond(req, res, url)) return;
    if (url.pathname.startsWith('/api/')) {
      const user = requestUser(req);
      if (!user) return json(res, 401, { error: 'Sign in required' });
      return await handleApi(req, res, url, user);
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// Document generation can hold a request open for several minutes; Node's
// default 300s request timeout would kill the socket mid-generation.
server.requestTimeout = 0;

server.listen(PORT, HOST, () => {
  console.log(`JobTracker running at http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1') console.log(`Listening on ${HOST}; email feedback links use ${defaultBaseUrl()}`);
  console.log(`Database: ${DB_PATH}`);
});

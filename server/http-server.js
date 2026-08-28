import http from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, listCompanies, getCompany, upsertCompany, getSettings, updateSettings, getJobDocument, STATUSES, LEVELS, DB_PATH } from './db.js';
import { generateJobDocuments, documentsDir, hasApiCredentials } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.JOBTRACKER_PORT || process.env.PORT) || 7080;

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

async function settingsPayload() {
  const settings = getSettings();
  const rp = settings.resume_path ? path.resolve(settings.resume_path) : '';
  const dataDir = path.resolve(path.dirname(DB_PATH));
  return {
    ...settings,
    documents_dir_effective: documentsDir(),
    resume_exists: Boolean(rp) && existsSync(rp),
    // An old-style dropped copy under data/postings — frozen, never refreshed.
    resume_is_snapshot: Boolean(rp) && rp.toLowerCase().startsWith(path.resolve(POSTINGS_DIR).toLowerCase() + path.sep),
    // The managed snapshot (data/standard-resume.*) — the UI keeps it in sync
    // with the user's original when it holds a file handle to it.
    resume_is_managed: Boolean(rp)
      && path.dirname(rp).toLowerCase() === dataDir.toLowerCase()
      && path.basename(rp).toLowerCase().startsWith('standard-resume.'),
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

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const p = url.searchParams;
    return json(res, 200, listJobs({
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
    // Only serve files that are actually some tracked job's posting URL.
    if (!getJob({ url: fileUrl })) return json(res, 404, { error: 'No tracked job has this file URL' });
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

  // Single company info; PATCH upserts, so saving notes for a company that has
  // no saved row yet just works.
  if (url.pathname === '/api/company') {
    const name = url.searchParams.get('name') || '';
    if (!name.trim()) return json(res, 400, { error: 'name query parameter is required' });
    if (req.method === 'GET') return json(res, 200, getCompany(name));
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      try {
        return json(res, 200, upsertCompany(name, body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
  }

  // Document-generation settings. The Anthropic API key is never stored here —
  // the server picks it up from the environment (ANTHROPIC_API_KEY or an
  // `ant auth login` profile); the response only reports whether one was found.
  if (url.pathname === '/api/settings') {
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      updateSettings(body);
    }
    if (req.method === 'GET' || req.method === 'PATCH') {
      return json(res, 200, await settingsPayload());
    }
  }

  // Stores/overwrites the managed snapshot of the standard resume and points
  // resume_path at it. The UI uploads through here both when the resume is
  // first chosen/dropped and on every re-sync from the original file it holds
  // a browser file handle to — that keeps the snapshot current.
  if (req.method === 'POST' && url.pathname === '/api/settings/resume-file') {
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
    const target = path.join(dataDir, `standard-resume${ext}`);
    await writeFile(target, body);
    // A format switch (e.g. .pdf -> .docx) leaves the old snapshot behind — tidy it.
    for (const entry of await readdir(dataDir)) {
      if (entry.toLowerCase().startsWith('standard-resume.') && entry !== path.basename(target)) {
        await rm(path.join(dataDir, entry), { force: true });
      }
    }
    updateSettings({ resume_path: target });
    return json(res, 200, { path: target, original_name: rawName, ...(await settingsPayload()) });
  }

  // Serves a generated document inline (Markdown renders as plain text) or as
  // a download with a friendly filename.
  if (req.method === 'GET' && url.pathname === '/api/document') {
    const jobId = Number(url.searchParams.get('job'));
    const kind = url.searchParams.get('kind') || '';
    const doc = Number.isInteger(jobId) ? getJobDocument(jobId, kind) : null;
    if (!doc) return json(res, 404, { error: 'No such document' });
    const filePath = path.resolve(documentsDir(), doc.path);
    if (!filePath.startsWith(path.resolve(documentsDir()))) return json(res, 403, { error: 'Forbidden' });
    let content;
    try {
      content = await readFile(filePath);
    } catch {
      return json(res, 404, { error: `Document file missing on disk: ${filePath}` });
    }
    const job = getJob({ id: jobId });
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
      // inline: Markdown displays in the browser; .docx downloads either way,
      // and the filename here makes that download friendly too.
      'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`
    });
    return res.end(content);
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    return json(res, 200, { ...getStats(), statuses: STATUSES, levels: LEVELS });
  }

  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await readBody(req);
    const jobs = Array.isArray(body) ? body : [body];
    for (const job of jobs) {
      if (!job.title || !job.company || !job.url) {
        return json(res, 400, { error: 'Each job requires title, company, and url' });
      }
    }
    return json(res, 201, addJobs(jobs));
  }

  // Generate the tailored resume + cover letter for one job. Slow (two model
  // calls); the UI batches "all Interested" by calling this per job so each
  // request stays well under browser/server timeouts.
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 4 && parts[3] === 'generate') {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });
    const body = await readBody(req);
    try {
      return json(res, 200, await generateJobDocuments({ id }, { skipExisting: Boolean(body.skip_existing) }));
    } catch (err) {
      return json(res, err.message === 'Job not found' ? 404 : 500, { error: err.message });
    }
  }

  if (parts[0] === 'api' && parts[1] === 'jobs' && parts.length === 3) {
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return json(res, 400, { error: 'Invalid job id' });

    if (req.method === 'GET') {
      const job = getJob({ id });
      return job ? json(res, 200, job) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      try {
        const job = updateJob({ id }, body);
        return job ? json(res, 200, job) : json(res, 404, { error: 'Not found' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'DELETE') {
      return deleteJob({ id }) ? json(res, 200, { deleted: true }) : json(res, 404, { error: 'Not found' });
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
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// Document generation can hold a request open for several minutes; Node's
// default 300s request timeout would kill the socket mid-generation.
server.requestTimeout = 0;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`JobTracker running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

import http from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, STATUSES, LEVELS, DB_PATH } from './db.js';

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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`JobTracker running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

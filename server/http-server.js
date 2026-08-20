import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, STATUSES, DB_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.JOBTRACKER_PORT) || 7080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

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
      q: p.get('q') || undefined,
      since: p.get('since') || undefined,
      limit: p.get('limit') ? Number(p.get('limit')) : undefined
    }));
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    return json(res, 200, { ...getStats(), statuses: STATUSES });
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

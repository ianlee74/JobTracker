// Smoke test for multi-user auth/roles/MCP. Runs the server against a
// scratch data dir with auth + MCP enabled, seeds users/sessions directly
// through db.js, then exercises the API as anonymous / admin / user.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'jt-test-'));
const PORT = 7181;
process.env.JOBTRACKER_DATA_DIR = dataDir;
process.env.JOBTRACKER_PORT = String(PORT);
process.env.JOBTRACKER_GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.JOBTRACKER_ADMIN_EMAILS = 'ian@example.com';
process.env.JOBTRACKER_MCP_TOKEN = 'test-mcp-token';

const db = await import('file://' + path.resolve('server/db.js').replace(/\\/g, '/'));

// Seed: two people, one job each, an admin and a linked user with sessions.
const alice = db.addPerson('Alice');
const people = db.listPeople();
const defaultPerson = people.find(p => p.name !== 'Alice');
db.addJobs([{ title: 'Staff Engineer', company: 'Acme', url: 'https://acme.example/1', person_id: defaultPerson.id }]);
db.addJobs([{ title: 'Senior Dev', company: 'Globex', url: 'https://globex.example/2', person_id: alice.id }]);
const adminUser = db.addUser({ email: 'ian@example.com', role: 'admin' });
const aliceUser = db.addUser({ email: 'alice@example.com', role: 'user', person_id: alice.id });
const unlinkedUser = db.addUser({ email: 'bob@example.com', role: 'user' });
const adminCookie = `jt_session=${db.createSession(adminUser.id).token}`;
const aliceCookie = `jt_session=${db.createSession(aliceUser.id).token}`;
const bobCookie = `jt_session=${db.createSession(unlinkedUser.id).token}`;
const jobs = db.listJobs({});
const defaultJob = jobs.find(j => j.person_id === defaultPerson.id);
const aliceJob = jobs.find(j => j.person_id === alice.id);

const server = spawn(process.execPath, [path.resolve('server/http-server.js')], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', d => { serverOut += d; });
server.stderr.on('data', d => { serverOut += d; });
server.on('error', err => { console.log('spawn error:', err.message); });
server.on('exit', code => { if (code !== null && code !== 0) console.log('server exited early with code', code, '\n' + serverOut); });

// Wait until the server answers (up to 15s).
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise(r => setTimeout(r, 250));
  try {
    await fetch(`http://localhost:${PORT}/api/auth/config`);
    up = true;
  } catch { /* not yet */ }
}
if (!up) {
  console.log('Server never came up.\n' + serverOut);
  server.kill();
  process.exit(1);
}

const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
async function check(name, expected, actualPromise) {
  try {
    const actual = await actualPromise;
    if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ok  ${name}`); }
    else { fail++; console.log(`FAIL  ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  } catch (err) {
    fail++;
    console.log(`FAIL  ${name}: threw ${err.message}`);
  }
}
const status = (url, opts) => fetch(base + url, opts).then(r => r.status);
const jsonBody = (url, opts) => fetch(base + url, opts).then(r => r.json());
const H = (cookie, extra = {}) => ({ headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extra } });

// --- anonymous ---
await check('anon /api/jobs -> 401', 401, status('/api/jobs'));
await check('anon /api/me -> 401', 401, status('/api/me'));
await check('auth config public', { auth_enabled: true, google_client_id: 'test-client-id.apps.googleusercontent.com' }, jsonBody('/api/auth/config'));
await check('static SPA shell public -> 200', 200, status('/'));

// --- admin ---
await check('admin sees all jobs', 2, jsonBody('/api/jobs', H(adminCookie)).then(j => j.length));
await check('admin /api/me role', 'admin', jsonBody('/api/me', H(adminCookie)).then(u => u.role));
await check('admin lists users', 3, jsonBody('/api/users', H(adminCookie)).then(u => u.length));
await check('admin browse allowed', 200, status('/api/browse', H(adminCookie)));
await check('admin can edit any field', 200, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ category: 'Infra' }), ...H(adminCookie) }));
await check('admin cannot demote self', 400, status(`/api/users/${adminUser.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'user' }), ...H(adminCookie) }));
await check('admin cannot delete self', 400, status(`/api/users/${adminUser.id}`, { method: 'DELETE', ...H(adminCookie) }));

// --- linked user (Alice) ---
await check('user sees only own jobs', [aliceJob.id], jsonBody('/api/jobs', H(aliceCookie)).then(j => j.map(x => x.id)));
await check('user people list = self only', [alice.id], jsonBody('/api/people', H(aliceCookie)).then(p => p.map(x => x.id)));
await check('user stats scoped', 1, jsonBody('/api/stats', H(aliceCookie)).then(s => s.total));
await check('user cannot see other job -> 404', 404, status(`/api/jobs/${defaultJob.id}`, H(aliceCookie)));
await check('user can set status on own job', 200, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Interested' }), ...H(aliceCookie) }));
await check('user can set user_note', 'my note', jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ user_note: 'my note' }), ...H(aliceCookie) }).then(j => j.user_note));
await check('user cannot edit admin note -> 403', 403, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ note: 'hijack' }), ...H(aliceCookie) }));

// --- missing skills (only kept with Not Moving Forward + Not Qualified) ---
await check('user can record missing skills (normalized)', 'Go, Kubernetes', jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Not Moving Forward', rejection_reason: 'Not Qualified', missing_skills: ' Go ,Kubernetes,, go ' }), ...H(aliceCookie) }).then(j => j.missing_skills));
await check('missing skills ignored without Not Qualified', '', jsonBody(`/api/jobs/${defaultJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Not Moving Forward', rejection_reason: 'Low Salary', missing_skills: 'Rust' }), ...H(adminCookie) }).then(j => j.missing_skills));
await check('admin sees every person\'s skills', ['Go', 'Kubernetes'], jsonBody('/api/missing-skills', H(adminCookie)));
await db.addJobs([{ title: 'Platform Eng', company: 'Initech', url: 'https://initech.example/9', person_id: defaultPerson.id, status: 'Not Moving Forward', rejection_reason: 'Not Qualified', missing_skills: 'Terraform, go' }]);
await check('skills list deduped case-insensitively across jobs', ['Go', 'Kubernetes', 'Terraform'], jsonBody('/api/missing-skills', H(adminCookie)));
await check('user only sees own person\'s skills', ['Go', 'Kubernetes'], jsonBody('/api/missing-skills', H(aliceCookie)));
await check('changing the reason clears the skills', '', jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ rejection_reason: 'Not Interested' }), ...H(aliceCookie) }).then(j => j.missing_skills));
await check('skills search hits the job', 1, jsonBody('/api/jobs?q=terraform', H(adminCookie)).then(j => j.length));
await check('user cannot edit title -> 403', 403, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }), ...H(aliceCookie) }));
await check('user cannot delete job -> 403', 403, status(`/api/jobs/${aliceJob.id}`, { method: 'DELETE', ...H(aliceCookie) }));
await check('user cannot patch other job -> 404', 404, status(`/api/jobs/${defaultJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Interested' }), ...H(aliceCookie) }));
await check('user add job forced to self', alice.id, jsonBody('/api/jobs', { method: 'POST', body: JSON.stringify({ title: 'Sneaky', company: 'Evil', url: 'https://evil.example/3', person_id: defaultPerson.id }), ...H(aliceCookie) }).then(r => r.jobs[0].person_id));
await check('user can favorite company', 200, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(aliceCookie) }));
await check('user cannot edit company note -> 403', 403, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ note: 'x' }), ...H(aliceCookie) }));
await check('user cannot browse -> 403', 403, status('/api/browse', H(aliceCookie)));
await check('user cannot list users -> 403', 403, status('/api/users', H(aliceCookie)));
await check('user cannot open settings -> 403', 403, status(`/api/settings?person=${alice.id}`, H(aliceCookie)));
await check('user cannot email digest -> 403', 403, status('/api/interested-email/preview', H(aliceCookie)));

// --- unlinked user (Bob) ---
await check('unlinked user blocked with reason', 403, status('/api/jobs', H(bobCookie)));

// --- MCP endpoint ---
const mcpInit = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
await check('mcp without token -> 401', 401, status('/mcp', { method: 'POST', body: mcpInit, headers: mcpHeaders }));
await check('mcp bad token -> 401', 401, status('/mcp', { method: 'POST', body: mcpInit, headers: { ...mcpHeaders, Authorization: 'Bearer wrong' } }));
await check('mcp initialize with token -> 200', 200, status('/mcp', { method: 'POST', body: mcpInit, headers: { ...mcpHeaders, Authorization: 'Bearer test-mcp-token' } }));
const toolsList = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
await check('mcp tools/list works', true, fetch(base + '/mcp', { method: 'POST', body: toolsList, headers: { ...mcpHeaders, Authorization: 'Bearer test-mcp-token' } }).then(r => r.text()).then(t => t.includes('list_jobs') && t.includes('add_jobs')));
await check('mcp GET -> 405', 405, status('/mcp', { headers: { Authorization: 'Bearer test-mcp-token' } }));

// --- respond links still work unauthenticated ---
const token = db.ensureFeedbackToken(aliceJob.id);
await check('respond link works anon', 200, status(`/respond/${token}/interested`));

// --- logout ---
await check('logout', 200, status('/api/auth/logout', { method: 'POST', ...H(aliceCookie) }));
await check('session revoked after logout', 401, status('/api/jobs', H(aliceCookie)));

server.kill();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('--- server output ---\n' + serverOut);
process.exit(fail ? 1 : 0);

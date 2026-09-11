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
await check('user can record application details', { proposed_salary: 210000, application_notes: 'Asked for fully remote' }, jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Applied', proposed_salary: '$210,000', application_notes: 'Asked for fully remote' }), ...H(aliceCookie) }).then(j => ({ proposed_salary: j.proposed_salary, application_notes: j.application_notes })));
await check('application details survive a status change', { proposed_salary: 210000, application_notes: 'Asked for fully remote' }, jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Interviewing' }), ...H(aliceCookie) }).then(j => ({ proposed_salary: j.proposed_salary, application_notes: j.application_notes })));
await check('invalid proposed salary -> 400', 400, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ proposed_salary: 'lots' }), ...H(aliceCookie) }));
await check('proposed salary can be cleared', null, jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ proposed_salary: null }), ...H(aliceCookie) }).then(j => j.proposed_salary));
await check('skills search hits the job', 1, jsonBody('/api/jobs?q=terraform', H(adminCookie)).then(j => j.length));

// --- referrals (a job's referred_by feeds its company's referrals list) ---
await check('user can set referred_by on own job (trimmed)', 'Jane Doe', jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ referred_by: '  Jane Doe ' }), ...H(aliceCookie) }).then(j => j.referred_by));
await check('referrer is added to the company', 'Jane Doe', jsonBody('/api/company?name=Globex', H(aliceCookie)).then(c => c.referrals));
await db.addJobs([{ title: 'Eng II', company: 'Globex', url: 'https://globex.example/3', person_id: alice.id, referred_by: 'John Roe' }]);
await db.addJobs([{ title: 'Eng III', company: 'Globex', url: 'https://globex.example/4', person_id: alice.id, referred_by: 'JANE DOE' }]);
await check('added jobs append referrers, deduped case-insensitively', 'Jane Doe, John Roe', jsonBody('/api/company?name=Globex', H(adminCookie)).then(c => c.referrals));
await check('clearing referred_by keeps the company list', 'Jane Doe, John Roe', jsonBody(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ referred_by: '' }), ...H(aliceCookie) }).then(() => jsonBody('/api/company?name=Globex', H(adminCookie))).then(c => c.referrals));
await check('referred_by search hits the job', ['https://globex.example/3'], jsonBody('/api/jobs?q=john+roe', H(adminCookie)).then(j => j.map(x => x.url)));
await check('admin can replace the referrals list (normalized)', 'Ann Lee', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ referrals: ['Ann Lee', 'ann lee', ' '] }), ...H(adminCookie) }).then(c => c.referrals));
await check('companies list carries referrals', 'Ann Lee', jsonBody('/api/companies', H(adminCookie)).then(cs => cs.find(c => c.name === 'Globex').referrals));
await check('user cannot edit referrals -> 403', 403, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ referrals: 'x' }), ...H(aliceCookie) }));

// --- company profile fields (ticker, gross revenue, interview questions) and adding companies ---
await check('ticker is normalized (exchange prefix dropped, upper-cased)', 'MSFT', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ ticker: 'nasdaq: msft' }), ...H(adminCookie) }).then(c => c.ticker));
await check('implausible ticker is dropped', '', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ ticker: 'not a symbol' }), ...H(adminCookie) }).then(c => c.ticker));
await check('gross revenue is free text (trimmed)', '$1.2B (FY2025)', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ gross_revenue: ' $1.2B (FY2025) ' }), ...H(adminCookie) }).then(c => c.gross_revenue));
await check('interview questions accept an array, one per line, tidied', 'Why did you reorganize platform?\nWhat is the on-call load?', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ interview_questions: ['- Why did you reorganize platform?', '', '2. What is the on-call load?', 'why did you reorganize platform?'] }), ...H(adminCookie) }).then(c => c.interview_questions));
await check('interview questions accept newline text', 'A?\nB?', jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ interview_questions: 'A?\r\nB?\n\n' }), ...H(adminCookie) }).then(c => c.interview_questions));
await check('appending questions keeps existing ones and skips duplicates', 'A?\nB?\nC?', Promise.resolve(db.addCompanyInterviewQuestions('Globex', ['b?', 'C?'])).then(c => c.interview_questions));
await check('companies list carries the new fields', { ticker: '', gross_revenue: '$1.2B (FY2025)', interview_questions: 'A?\nB?\nC?' }, jsonBody('/api/companies', H(adminCookie)).then(cs => cs.find(c => c.name === 'Globex')).then(c => ({ ticker: c.ticker, gross_revenue: c.gross_revenue, interview_questions: c.interview_questions })));
await check('user cannot edit ticker -> 403', 403, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ ticker: 'X' }), ...H(aliceCookie) }));
await check('admin can add a company with no jobs', { name: 'Hooli', ticker: 'HOOL', job_count: 0 }, jsonBody('/api/companies', { method: 'POST', body: JSON.stringify({ name: ' Hooli ', ticker: 'hool', website: 'https://hooli.example' }), ...H(adminCookie) }).then(c => ({ name: c.name, ticker: c.ticker, job_count: c.job_count })));
await check('added company appears in the list', true, jsonBody('/api/companies', H(adminCookie)).then(cs => cs.some(c => c.name === 'Hooli')));
await check('adding a duplicate (case-insensitive) -> 409', 409, status('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'hooli' }), ...H(adminCookie) }));
await check('adding a company a job already names -> 409', 409, status('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'globex' }), ...H(adminCookie) }));
await check('adding a company needs a name -> 400', 400, status('/api/companies', { method: 'POST', body: JSON.stringify({ website: 'https://x.example' }), ...H(adminCookie) }));
await check('user cannot add a company -> 403', 403, status('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'Pied Piper' }), ...H(aliceCookie) }));
await check('user cannot edit title -> 403', 403, status(`/api/jobs/${aliceJob.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }), ...H(aliceCookie) }));
await check('user cannot delete job -> 403', 403, status(`/api/jobs/${aliceJob.id}`, { method: 'DELETE', ...H(aliceCookie) }));
await check('user cannot patch other job -> 404', 404, status(`/api/jobs/${defaultJob.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Interested' }), ...H(aliceCookie) }));
await check('user add job forced to self', alice.id, jsonBody('/api/jobs', { method: 'POST', body: JSON.stringify({ title: 'Sneaky', company: 'Evil', url: 'https://evil.example/3', person_id: defaultPerson.id }), ...H(aliceCookie) }).then(r => r.jobs[0].person_id));
await check('user can favorite company', 200, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(aliceCookie) }));
await check('user cannot edit company note -> 403', 403, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ note: 'x' }), ...H(aliceCookie) }));

// --- company flags are per person ---
await check('favorite is the user\'s own', 1, jsonBody(`/api/company?name=Globex&person=${alice.id}`, H(adminCookie)).then(c => c.favorite));
await check('favorite does not show for another person', 0, jsonBody(`/api/company?name=Globex&person=${defaultPerson.id}`, H(adminCookie)).then(c => c.favorite));
await check('user\'s companies list carries own flags', 1, jsonBody('/api/companies', H(aliceCookie)).then(cs => cs.find(c => c.name === 'Globex').favorite));
await check('admin listing another person sees no flag', 0, jsonBody(`/api/companies?person=${defaultPerson.id}`, H(adminCookie)).then(cs => cs.find(c => c.name === 'Globex').favorite));
await check('admin listing without a person sees no flags', 0, jsonBody('/api/companies', H(adminCookie)).then(cs => cs.find(c => c.name === 'Globex').favorite));
await check('admin flagging without a person -> 400', 400, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(adminCookie) }));
await check('admin flagging an unknown person -> 400', 400, status('/api/company?name=Globex&person=999', { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(adminCookie) }));
await check('admin flags for a chosen person', 1, jsonBody(`/api/company?name=Acme&person=${defaultPerson.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(adminCookie) }).then(c => c.favorite));
await check('user can mark a company not interested', 1, jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ not_interested: true }), ...H(aliceCookie) }).then(c => c.not_interested));
await check('not-interested hides that person\'s jobs at the company', false, Promise.resolve(db.listJobs({ personId: alice.id, excludeNotInterestedCompanies: true }).some(j => j.company === 'Globex')));
await check('not-interested keeps the jobs tracked', true, Promise.resolve(db.listJobs({ personId: alice.id }).some(j => j.company === 'Globex')));
await check('another person\'s job at the company is unaffected', true, Promise.resolve(db.listJobs({ excludeNotInterestedCompanies: true }).some(j => j.company === 'Acme' && j.person_id === defaultPerson.id)));
// --- favorite and not-interested exclude each other ---
await check('marking a favorite not interested drops the star', { favorite: 0, not_interested: 1 }, jsonBody(`/api/company?name=Acme&person=${defaultPerson.id}`, { method: 'PATCH', body: JSON.stringify({ not_interested: true }), ...H(adminCookie) }).then(c => ({ favorite: c.favorite, not_interested: c.not_interested })));
await check('starring a not-interested company clears the flag', { favorite: 1, not_interested: 0 }, jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: true }), ...H(aliceCookie) }).then(c => ({ favorite: c.favorite, not_interested: c.not_interested })));
await check('setting both flags at once -> 400', 400, status('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: true, not_interested: true }), ...H(aliceCookie) }));
await check('a rejected request changes nothing', { favorite: 1, not_interested: 0 }, jsonBody('/api/company?name=Globex', H(aliceCookie)).then(c => ({ favorite: c.favorite, not_interested: c.not_interested })));
await check('turning a flag off leaves the other alone', { favorite: 1, not_interested: 0 }, jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ not_interested: false }), ...H(aliceCookie) }).then(c => ({ favorite: c.favorite, not_interested: c.not_interested })));
await check('clearing both flags leaves the company unflagged', { favorite: 0, not_interested: 0 }, jsonBody('/api/company?name=Globex', { method: 'PATCH', body: JSON.stringify({ favorite: false, not_interested: false }), ...H(aliceCookie) }).then(c => ({ favorite: c.favorite, not_interested: c.not_interested })));
await check('profile fields survive flag changes', '$1.2B (FY2025)', jsonBody('/api/company?name=Globex', H(aliceCookie)).then(c => c.gross_revenue));
await check('user cannot research company -> 403', 403, status('/api/company/research?name=Globex', { method: 'POST', body: '{}', ...H(aliceCookie) }));
await check('research needs a company name -> 400', 400, status('/api/company/research', { method: 'POST', body: '{}', ...H(adminCookie) }));
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

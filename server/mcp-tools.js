import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, listCompanies, upsertCompany, addCompanyReferrals, listPeople, getPerson, findPersonByName, onlyPerson, addPerson, updatePerson, STATUSES, LEVELS, REJECTION_REASONS, COMPANY_TYPES, EMPLOYEE_COUNTS } from './db.js';
import { generateJobDocuments, documentsDir, hasApiCredentials } from './generate.js';
import { composeInterestedEmail, defaultBaseUrl } from './email.js';
import { researchCompany } from './research.js';

// Registers every JobTracker tool on a fresh McpServer. Shared between the
// stdio entry point (mcp-server.js, local dev) and the remote /mcp endpoint
// on the HTTP server.
export function createMcpServer() {
const server = new McpServer({
  name: 'jobtracker',
  version: '1.0.0'
});

const statusEnum = z.enum(STATUSES);

const personArg = z.string().optional().describe('Person the jobs belong to — their name (or numeric id). Optional while only one person is tracked; see list_people.');

// Resolve a person argument (name or id). When omitted: the only person if
// exactly one exists, otherwise an error naming the candidates.
function resolvePerson(person) {
  const names = () => listPeople().map(p => p.name).join(', ');
  if (person == null || String(person).trim() === '') {
    const only = onlyPerson();
    if (only) return only;
    throw new Error(`Multiple people are tracked — specify person. Available: ${names()}`);
  }
  const raw = String(person).trim();
  const found = findPersonByName(raw) || (/^\d+$/.test(raw) ? getPerson(Number(raw)) : null);
  if (!found) throw new Error(`No person named "${raw}". Available: ${names()}`);
  return found;
}

const jobInput = {
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  url: z.string().describe('Job posting URL (unique key — duplicates are skipped). file:// URLs to local files are supported for postings that are not online.'),
  date_found: z.string().optional().describe('Date found, YYYY-MM-DD (defaults to today)'),
  category: z.string().optional().describe('Category, e.g. "AI-assisted dev", "Data integration", "DevOps"'),
  salary: z.string().optional().describe('Salary description as listed, e.g. "$200,000 - $225,000". An annual min/max range is parsed from it automatically when salary_min/salary_max are not given.'),
  salary_min: z.number().int().optional().describe('Annual salary minimum in dollars (overrides auto-parsing of `salary`)'),
  salary_max: z.number().int().optional().describe('Annual salary maximum in dollars (overrides auto-parsing of `salary`)'),
  salary_confidence: z.enum(['ok', 'flag']).optional().describe('"flag" if salary is undisclosed/inferred/uncertain'),
  fit: z.string().optional().describe('Why this job fits the candidate'),
  level: z.string().optional().describe(`Seniority level, ideally one of: ${LEVELS.join(', ')}. If omitted it is classified automatically from the job title.`),
  status: statusEnum.optional().describe('Initial status (defaults to "new")'),
  note: z.string().optional().describe('Free-form note'),
  rejection_reason: z.string().optional().describe(`Why the job is "Not Moving Forward" (only stored with that status). Prefer one of: ${REJECTION_REASONS.join(', ')} — or free text for anything else.`),
  missing_skills: z.string().optional().describe('Comma-delimited skills the posting requires that the candidate lacks, e.g. "Kubernetes, Go". Only stored when rejection_reason is "Not Qualified".'),
  proposed_salary: z.number().int().nullable().optional().describe('The minimum annual salary (in dollars) the candidate asked for in their application, if the application asked. Usually recorded when the status becomes "Applied".'),
  application_notes: z.string().optional().describe('Notes about the application process worth remembering later in an interview (what was asked, what was claimed, who was contacted, etc.).'),
  referred_by: z.string().optional().describe('Who referred the candidate to this job (a person\'s name), if anyone. The name is added automatically to the company\'s referrals list (see list_companies).')
};

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

server.registerTool('list_people', {
  title: 'List people',
  description: 'List the people (candidates) whose job searches are tracked, with each person\'s job count, preferred_name (the name their generated cover letters are signed with), document-generation config (standard resume path, documents folder), and search_instructions — that person\'s own guidance for how to look for their jobs. Before searching for jobs for a person, read their search_instructions and follow them.',
  inputSchema: {}
}, async () => ok(listPeople()));

server.registerTool('add_person', {
  title: 'Add a person',
  description: 'Add a new person (candidate) to track jobs for. Their standard resume and documents folder can then be set with configure_document_generation.',
  inputSchema: {
    name: z.string().describe('The person\'s name (must be unique)')
  }
}, async ({ name }) => ok(addPerson(name)));

server.registerTool('update_person', {
  title: 'Update a person',
  description: 'Rename a person, set their preferred_name (the name their generated cover letters are signed with, when it differs from the name on their resume), set their email address (the recipient of their Interested-jobs digest email), and/or set their search_instructions (their standing guidance for how an AI should look for jobs for them — target roles, locations, salary floor, preferred sources, deal-breakers). (Per-person resume/documents settings are changed with configure_document_generation.)',
  inputSchema: {
    person: z.string().describe('The person\'s current name (or numeric id)'),
    new_name: z.string().optional().describe('The new name'),
    preferred_name: z.string().optional().describe('The name to sign generated cover letters with, e.g. "Ian Lee" when the resume says "Richard Ian Lee". Empty string to clear, which signs with the name on the resume.'),
    email: z.string().optional().describe('The person\'s email address (empty string to clear)'),
    search_instructions: z.string().optional().describe('Job-search instructions for this person, followed by the AI whenever it searches for their jobs. Replaces the existing instructions (empty string to clear).')
  }
}, async ({ person, new_name, preferred_name, email, search_instructions }) => {
  const fields = {};
  if (new_name !== undefined) fields.name = new_name;
  if (preferred_name !== undefined) fields.preferred_name = preferred_name;
  if (email !== undefined) fields.email = email;
  if (search_instructions !== undefined) fields.search_instructions = search_instructions;
  if (!Object.keys(fields).length) throw new Error('Provide new_name, preferred_name, email, and/or search_instructions');
  return ok(updatePerson(resolvePerson(person).id, fields));
});

server.registerTool('list_jobs', {
  title: 'List jobs',
  description: 'List tracked job opportunities, optionally filtered by person, status (one or several), company, free-text search, or date found. Without a person filter, jobs for all people are returned (each row includes person_name).',
  inputSchema: {
    person: z.string().optional().describe('Filter to one person\'s jobs — their name (or numeric id)'),
    status: z.union([statusEnum, z.array(statusEnum).min(1)]).optional().describe('Filter by status — a single value or an array of values (jobs matching any of them are returned)'),
    company: z.string().optional().describe('Filter by company name (substring match)'),
    level: z.string().optional().describe(`Filter by seniority level (exact match), e.g. ${LEVELS.slice(0, 4).join(', ')}`),
    q: z.string().optional().describe('Free-text search across title, company, category, fit, notes, salary, rejection reason, missing skills, application notes, and referred_by'),
    since: z.string().optional().describe('Only jobs found on/after this date (YYYY-MM-DD)'),
    limit: z.number().int().positive().optional().describe('Max rows to return'),
    include_not_interested_companies: z.boolean().optional().describe('Jobs from companies marked "not interested" are hidden by default; pass true to include them')
  }
}, async ({ person, include_not_interested_companies, ...args }) =>
  ok(listJobs({
    ...args,
    personId: person ? resolvePerson(person).id : undefined,
    excludeNotInterestedCompanies: !include_not_interested_companies
  })));

server.registerTool('get_job', {
  title: 'Get a job',
  description: 'Fetch one tracked job by id or by posting URL. URL uniqueness is per person, so add person when looking up a URL that several people might track.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL'),
    person: z.string().optional().describe('Disambiguates a URL lookup — the person\'s name (or numeric id)')
  }
}, async ({ id, url, person }) => {
  const job = getJob({ id, url, personId: person ? resolvePerson(person).id : undefined });
  if (!job) throw new Error('Job not found');
  return ok(job);
});

server.registerTool('add_jobs', {
  title: 'Add jobs',
  description: 'Add one or more new job opportunities to the tracker for one person. Jobs whose URL that person already tracks are skipped (their existing status and notes are preserved), so it is always safe to send the full day\'s findings.',
  inputSchema: {
    jobs: z.array(z.object(jobInput)).describe('Jobs to add'),
    person: personArg
  }
}, async ({ jobs, person }) => {
  const result = addJobs(jobs, resolvePerson(person).id);
  return ok({ added: result.added, skipped_existing: result.skipped, added_jobs: result.jobs });
});

server.registerTool('update_job', {
  title: 'Update a job',
  description: 'Update fields on a tracked job (status, note, salary, etc.). Identify the job by id or by posting URL.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)'),
    person: z.string().optional().describe('Disambiguates a URL lookup when several people track the same URL — the person\'s name (or numeric id)'),
    status: statusEnum.optional(),
    rejection_reason: z.string().optional().describe(`Why the job is "Not Moving Forward" — set it when setting that status. Prefer one of: ${REJECTION_REASONS.join(', ')} — or free text for anything else. Cleared automatically if the status changes to anything else.`),
    missing_skills: z.string().optional().describe('Comma-delimited skills the posting requires that the candidate lacks, e.g. "Kubernetes, Go". Only kept while rejection_reason is "Not Qualified"; cleared automatically otherwise.'),
    proposed_salary: z.number().int().nullable().optional().describe('The minimum annual salary (in dollars) the candidate asked for in their application — offer to record it when setting the status to "Applied". null clears it. Kept when the status later moves on (Interviewing, Offer, …).'),
    application_notes: z.string().optional().describe('Notes about the application process worth remembering in an interview — offer to record them when setting the status to "Applied". Replaces the existing notes; kept across later status changes.'),
    referred_by: z.string().optional().describe('Who referred the candidate to this job (a person\'s name); empty string clears it. A new name is added automatically to the company\'s referrals list, which list_companies returns — prefer an existing name from that list when it is the same person.'),
    note: z.string().optional().describe('Replaces the existing note'),
    append_note: z.string().optional().describe('Appended to the existing note on a new line instead of replacing it'),
    title: z.string().optional(),
    company: z.string().optional(),
    category: z.string().optional(),
    salary: z.string().optional().describe('Salary description as listed. Updating it re-parses salary_min/salary_max unless they are set explicitly in the same call.'),
    salary_min: z.number().int().nullable().optional().describe('Annual salary minimum in dollars (null to clear)'),
    salary_max: z.number().int().nullable().optional().describe('Annual salary maximum in dollars (null to clear)'),
    salary_confidence: z.enum(['ok', 'flag']).optional(),
    fit: z.string().optional(),
    level: z.string().optional().describe(`Seniority level, ideally one of: ${LEVELS.join(', ')}`),
    date_found: z.string().optional()
  }
}, async ({ id, url, person, append_note, ...fields }) => {
  if (id == null && !url) throw new Error('Provide id or url to identify the job');
  const personId = person ? resolvePerson(person).id : undefined;
  if (append_note) {
    const existing = getJob({ id, url, personId });
    if (!existing) throw new Error('Job not found');
    fields.note = existing.note ? `${existing.note}\n${append_note}` : append_note;
  }
  const job = updateJob({ id, url, personId }, fields);
  if (!job) throw new Error('Job not found');
  return ok(job);
});

server.registerTool('delete_job', {
  title: 'Delete a job',
  description: 'Permanently remove a job from the tracker. Prefer setting status to "Not Moving Forward" unless the entry is a mistake/duplicate.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)'),
    person: z.string().optional().describe('Disambiguates a URL lookup when several people track the same URL — the person\'s name (or numeric id)')
  }
}, async ({ id, url, person }) => {
  if (id == null && !url) throw new Error('Provide id or url to identify the job');
  if (!deleteJob({ id, url, personId: person ? resolvePerson(person).id : undefined })) throw new Error('Job not found');
  return ok({ deleted: true });
});

server.registerTool('list_companies', {
  title: 'List companies',
  description: 'List every company with tracked jobs (plus any with saved info): website, company type, employee count, note, referrals (comma-delimited names of everyone who has referred the candidate to this company\'s jobs), not-interested flag, favorite flag, and job count.',
  inputSchema: {}
}, async () => ok(listCompanies()));

server.registerTool('update_company', {
  title: 'Update company info',
  description: 'Save notes/info about a company, record who has referred the candidate to its jobs, mark it "not interested", and/or flag it as a favorite. Jobs from not-interested companies are hidden by default in the UI and in list_jobs (but stay tracked); jobs from favorite companies are prioritized within the list\'s sort order. Creates the company record if it does not exist yet.',
  inputSchema: {
    name: z.string().describe('Company name, exactly as it appears on its jobs'),
    website: z.string().optional().describe('Company website URL'),
    company_type: z.string().optional().describe(`Company type, ideally one of: ${COMPANY_TYPES.join(', ')} — or free text for anything else`),
    employee_count: z.string().optional().describe(`Employee count range, ideally one of: ${EMPLOYEE_COUNTS.join(', ')}`),
    note: z.string().optional().describe('Replaces the existing company note'),
    referrals: z.array(z.string()).optional().describe('Names of everyone who has referred the candidate to this company\'s jobs. REPLACES the existing list (an empty array clears it) — use add_referrals to append. Setting referred_by on a job adds to this list automatically.'),
    add_referrals: z.array(z.string()).optional().describe('Names to append to the company\'s referrals list without touching the existing entries (duplicates are ignored case-insensitively)'),
    not_interested: z.boolean().optional().describe('true hides the company\'s jobs by default; false restores them'),
    favorite: z.boolean().optional().describe('true prioritizes the company\'s jobs within the job list\'s sort order (they win ties); false removes the priority')
  }
}, async ({ name, add_referrals, ...fields }) => {
  let company = upsertCompany(name, fields);
  if (add_referrals?.length) company = addCompanyReferrals(name, add_referrals);
  return ok(company);
});

server.registerTool('research_company', {
  title: 'Research a company',
  description: 'Have the JobTracker server research a company on the web through the Anthropic API (web search) and propose values for its profile: website, company_type, employee_count, plus a short briefing (what it does, size, ownership, engineering signals, employer reputation, recent news) with sources. Returns the proposal alongside the company\'s current values without saving anything; pass apply: true to save it (website/type/count are set from the proposal, the briefing is appended to the company note). Slow: allow one to two minutes. Useful when you cannot search the web yourself; if you can, researching directly and calling update_company is equivalent.',
  inputSchema: {
    name: z.string().describe('Company name, exactly as it appears on its jobs'),
    apply: z.boolean().optional().describe('true saves the proposal to the company record; default false just returns it for review')
  }
}, async ({ name, apply }) => ok(await researchCompany(name, { apply: apply === true })));

server.registerTool('generate_documents', {
  title: 'Generate tailored resume & cover letter',
  description: 'Generate a resume and cover letter tailored to a specific job (by id or URL), using the Anthropic API and the owning person\'s standard resume. Files are written to a per-job folder under that person\'s documents directory. Slow: allow a few minutes per job. BEFORE calling this tool, ask the user whether they have any special instructions for this application (what to emphasize or leave out, tone, a particular experience to foreground, anything the recruiter said) and pass their answer as `instructions`; call without instructions only once they have said they have none.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)'),
    person: z.string().optional().describe('With url: disambiguates which person\'s job. Name (or numeric id).'),
    instructions: z.string().optional().describe('The user\'s special instructions for this application, gathered from them before calling. They are folded into the generation prompt as guidance that steers the documents, not copied into them verbatim. Omit when the user says they have none.')
  }
}, async ({ id, url, person, instructions }) => {
  const personId = person ? resolvePerson(person).id : undefined;
  if (id == null && !url) throw new Error('Provide id or url');
  return ok(await generateJobDocuments({ id, url, personId, instructions }));
});

server.registerTool('generate_interested_email', {
  title: 'Generate the Interested-jobs digest email',
  description: 'Compose an email digest of one person\'s jobs in "Interested" status, addressed to that person (their saved email — set it with update_person). Each job carries a posting link, a short why-it-fits summary, and feedback links the candidate can click to report "applied", "still interested", or "not interested" (with a reason); they can also reply by email referencing each job\'s #id, in which case apply their answers with update_job. Returns { to, subject, html, text } — this tool only composes the email; send it via an email tool, showing the user a draft first.',
  inputSchema: {
    person: personArg,
    base_url: z.string().optional().describe(`Base URL the feedback links point at (default ${defaultBaseUrl()}, or the JOBTRACKER_BASE_URL environment variable). Links only work on machines that can reach the JobTracker server.`)
  }
}, async ({ person, base_url }) =>
  ok(composeInterestedEmail({ personId: resolvePerson(person).id, baseUrl: base_url })));

server.registerTool('configure_document_generation', {
  title: 'Configure document generation',
  description: 'View or change one person\'s document-generation settings: their standard resume file (PDF, Word .docx, Markdown, or plain text — the source of truth for generated documents; with a .docx, generated documents are .docx files mirroring its formatting, otherwise Markdown) and the base folder where per-job document folders are created. Call with only the person to just view their current settings. The Anthropic API key is read from the server environment, never stored here.',
  inputSchema: {
    person: personArg,
    resume_path: z.string().optional().describe('Absolute path to the person\'s standard resume file'),
    documents_dir: z.string().optional().describe('Absolute path to the person\'s base documents folder (empty string resets to the default under the data directory)')
  }
}, async ({ person, ...fields }) => {
  const updated = updatePerson(resolvePerson(person).id, fields);
  return ok({
    person_id: updated.id,
    person_name: updated.name,
    resume_path: updated.resume_path,
    documents_dir: updated.documents_dir,
    documents_dir_effective: documentsDir(updated),
    api_credentials_found: await hasApiCredentials()
  });
});

server.registerTool('get_summary', {
  title: 'Get summary',
  description: 'Get pipeline totals: job counts by status, overall total, and the most recent date jobs were found. Optionally scoped to one person.',
  inputSchema: {
    person: z.string().optional().describe('Limit the summary to this person\'s jobs — their name (or numeric id)')
  }
}, async ({ person }) => ok(getStats({ personId: person ? resolvePerson(person).id : undefined })));

return server;
}

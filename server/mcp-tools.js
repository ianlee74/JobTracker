import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, listCompanies, getCompany, addCompany, upsertCompany, addCompanyReferrals, addCompanyInterviewQuestions, listPeople, getPerson, findPersonByName, onlyPerson, addPerson, updatePerson, listContacts, getContact, findContact, addContact, updateContact, listInterviews, getInterview, addInterview, updateInterview, deleteInterview, linkInterviewJob, unlinkInterviewJob, addInterviewAttendee, removeInterviewAttendee, addInterviewQuestions, updateInterviewQuestion, deleteInterviewQuestion, STATUSES, LEVELS, REJECTION_REASONS, COMPANY_TYPES, EMPLOYEE_COUNTS, INTERVIEW_TYPES } from './db.js';
import { generateJobDocuments, documentsDir, hasApiCredentials } from './generate.js';
import { composeInterestedEmail, defaultBaseUrl } from './email.js';
import { researchCompany } from './research.js';
import { generateInterviewQuestions } from './interview.js';

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

// The person whose favorite / not_interested company flags are meant: the
// named one, else the only person when exactly one is tracked, else nobody —
// flags then read as unset, and setting one is an error asking for the person.
function flagsPerson(person) {
  return person != null && String(person).trim() !== '' ? resolvePerson(person).id : onlyPerson()?.id;
}

const flagsPersonArg = z.string().optional().describe('The person whose favorite / not_interested flags are meant — their name (or numeric id). Optional while only one person is tracked; with several, required when setting either flag.');

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
    include_not_interested_companies: z.boolean().optional().describe('Jobs from companies their owner marked "not interested" are hidden by default; pass true to include them')
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

// The profile fields shared by add_company and update_company.
const COMPANY_PROFILE_SCHEMA = {
  website: z.string().optional().describe('Company website URL'),
  company_type: z.string().optional().describe(`Company type, ideally one of: ${COMPANY_TYPES.join(', ')} — or free text for anything else`),
  employee_count: z.string().optional().describe(`Employee count range, ideally one of: ${EMPLOYEE_COUNTS.join(', ')}`),
  ticker: z.string().optional().describe('Stock ticker symbol if the company is publicly traded (e.g. MSFT — no exchange prefix; stored upper-case). The UI links it to Fidelity\'s research page for that symbol. Empty string clears it.'),
  gross_revenue: z.string().optional().describe('Current annual gross revenue as short text with the period, e.g. "$245.1B (FY2024)" or "~$40M (2023, estimate)". Empty string clears it.'),
  note: z.string().optional().describe('Replaces the existing company note'),
  interview_questions: z.array(z.string()).optional().describe('Questions to ask this company in an interview. REPLACES the existing list (an empty array clears it) — use add_interview_questions to append.'),
  referrals: z.array(z.string()).optional().describe('Names of everyone who has referred the candidate to this company\'s jobs. REPLACES the existing list (an empty array clears it) — use add_referrals to append. Setting referred_by on a job adds to this list automatically.'),
  not_interested: z.boolean().optional().describe('true hides the company\'s jobs from this person by default and clears their favorite flag (the two are mutually exclusive); false restores them. Per person — see the person argument.'),
  favorite: z.boolean().optional().describe('true prioritizes the company\'s jobs within this person\'s job list sort order (they win ties) and clears their not_interested flag (the two are mutually exclusive); false removes the priority. Per person — see the person argument.')
};

server.registerTool('list_companies', {
  title: 'List companies',
  description: 'List every company with tracked jobs (plus any with saved info): website, company type, employee count, ticker symbol, gross revenue, note, interview questions (newline-delimited), referrals (comma-delimited names of everyone who has referred the candidate to this company\'s jobs), the given person\'s not-interested and favorite flags (they are per person), and job count (across everyone).',
  inputSchema: {
    person: z.string().optional().describe('Whose favorite / not_interested flags to report — the person\'s name (or numeric id). Optional while only one person is tracked; with several and no person, both flags read false for every company.')
  }
}, async ({ person }) => ok(listCompanies({ personId: flagsPerson(person) })));

server.registerTool('add_company', {
  title: 'Add a company',
  description: 'Add a company to browse and research before any of its jobs are tracked, optionally with profile fields. Fails if a company with that name already exists (case-insensitively) — use update_company to change an existing one. Jobs join to companies by exact name, so spell it the way its postings will.',
  inputSchema: {
    name: z.string().describe('Company name'),
    person: flagsPersonArg,
    ...COMPANY_PROFILE_SCHEMA
  }
}, async ({ name, person, ...fields }) => ok(addCompany(name, fields, { personId: flagsPerson(person) })));

server.registerTool('update_company', {
  title: 'Update company info',
  description: 'Save notes/info about a company (website, type, employee count, ticker symbol, gross revenue, interview questions), record who has referred the candidate to its jobs, mark it "not interested" for a person, and/or flag it as that person\'s favorite. The profile is shared; the two flags are per person (pass person) and mutually exclusive — setting one clears the other, and passing both as true is an error. Jobs from a person\'s not-interested companies are hidden by default in the UI and in list_jobs (but stay tracked); jobs from their favorite companies are prioritized within the list\'s sort order. Creates the company record if it does not exist yet. Follow the research-company skill (skills/research-company/SKILL.md) when researching a company yourself to fill these in.',
  inputSchema: {
    name: z.string().describe('Company name, exactly as it appears on its jobs'),
    person: flagsPersonArg,
    ...COMPANY_PROFILE_SCHEMA,
    append_note: z.string().optional().describe('Appended to the existing company note after a blank line instead of replacing it (e.g. a dated research briefing)'),
    add_interview_questions: z.array(z.string()).optional().describe('Questions to append to the company\'s interview-question list without touching the existing entries (duplicates are ignored case-insensitively)'),
    add_referrals: z.array(z.string()).optional().describe('Names to append to the company\'s referrals list without touching the existing entries (duplicates are ignored case-insensitively)')
  }
}, async ({ name, person, append_note, add_interview_questions, add_referrals, ...fields }) => {
  const personId = flagsPerson(person);
  if (append_note) {
    const existing = fields.note ?? getCompany(name).note;
    fields.note = existing ? `${existing}\n\n${append_note}` : append_note;
  }
  upsertCompany(name, fields, { personId });
  if (add_interview_questions?.length) addCompanyInterviewQuestions(name, add_interview_questions);
  if (add_referrals?.length) addCompanyReferrals(name, add_referrals);
  return ok(getCompany(name, { personId }));
});

server.registerTool('research_company', {
  title: 'Research a company',
  description: 'Have the JobTracker server research a company on the web through the Anthropic API (web search), following the research-company skill, and propose values for its profile: website, company_type, employee_count, ticker, gross_revenue, interview_questions to ask it, plus a short briefing (what it does, size, ownership, engineering signals, employer reputation, recent news) with sources. Returns the proposal alongside the company\'s current values without saving anything; pass apply: true to save it (the profile fields are set from the proposal, the questions are added to the company\'s list, the briefing is appended to the company note). Slow: allow one to two minutes. Useful when you cannot search the web yourself; if you can, following skills/research-company/SKILL.md directly and calling update_company is equivalent.',
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

// ---- Contacts ----

const CONTACT_SCHEMA = {
  title: z.string().optional().describe('Their job title / role, e.g. "Senior Technical Recruiter"'),
  company: z.string().optional().describe('The company they work for, spelled as it appears on its jobs'),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedin: z.string().optional().describe('LinkedIn profile URL'),
  note: z.string().optional().describe('Anything worth remembering about them')
};

server.registerTool('list_contacts', {
  title: 'List contacts',
  description: 'List the contacts the candidate has met or will meet — recruiters, hiring managers, interviewers — with title, company, email, phone, LinkedIn, note, and how many interviews each has attended. Optionally filtered by company or free text.',
  inputSchema: {
    company: z.string().optional().describe('Only contacts at this company (exact name, case-insensitive)'),
    q: z.string().optional().describe('Free-text search across name, title, company, email and note')
  }
}, async (args) => ok(listContacts(args)));

server.registerTool('add_contact', {
  title: 'Add a contact',
  description: 'Add a person the candidate deals with during a job search (a recruiter, hiring manager, interviewer). Fails if a contact with the same name at the same company already exists — use update_contact for them. Contacts are attached to interviews as attendees (add_interview / update_interview accept attendee names and create missing contacts for you).',
  inputSchema: {
    name: z.string().describe('Full name'),
    ...CONTACT_SCHEMA
  }
}, async (fields) => ok(addContact(fields)));

server.registerTool('update_contact', {
  title: 'Update a contact',
  description: 'Change a contact\'s details. Identify them by id, or by name (plus company when the name is ambiguous).',
  inputSchema: {
    id: z.number().int().optional().describe('Contact id'),
    name: z.string().optional().describe('Current name (alternative to id)'),
    company: z.string().optional().describe('With name: the company that disambiguates them; also the new company value'),
    new_name: z.string().optional().describe('Rename the contact'),
    ...CONTACT_SCHEMA
  }
}, async ({ id, name, new_name, ...fields }) => {
  const contact = id != null ? getContact(id) : findContact(name, fields.company);
  if (!contact) throw new Error('Contact not found');
  if (new_name !== undefined) fields.name = new_name;
  return ok(updateContact(contact.id, fields));
});

// ---- Interviews ----

// Resolves a job argument (id, or url + optional person) to the job row.
function resolveJob({ job_id, url, person }) {
  if (job_id == null && !url) throw new Error('Provide job_id or url to identify the job');
  const job = getJob({ id: job_id, url, personId: person ? resolvePerson(person).id : undefined });
  if (!job) throw new Error('Job not found');
  return job;
}

// Attendees named in add_interview / update_interview: an existing contact
// by name (preferring one at the job's company), else a new contact at the
// job's company.
function attachAttendees(interview, job, names) {
  for (const raw of names || []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const contact = findContact(name, job.company) || addContact({ name, company: job.company });
    addInterviewAttendee(interview.id, contact.id);
  }
}

const interviewFields = {
  type: z.string().optional().describe(`Kind of interview, ideally one of: ${INTERVIEW_TYPES.join(', ')} — or free text`),
  scheduled_at: z.string().optional().describe('When it takes place, as "YYYY-MM-DDTHH:MM" (local time) or "YYYY-MM-DD"; empty string clears it'),
  notes: z.string().optional().describe('The candidate\'s prep and live notes for this interview, in Markdown. REPLACES the existing notes — use append_notes to add to them.')
};

server.registerTool('list_interviews', {
  title: 'List a job\'s interviews',
  description: 'List the interviews scheduled or held for one job, in time order, each with its type, when, the jobs it covers (an interview can cover several openings at once), attendees (contacts), Markdown notes, and Q&A: the questions the candidate planned to ask (question, answer recorded during the interview, source: user / claude / company).',
  inputSchema: {
    job_id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to job_id)'),
    person: z.string().optional().describe('Disambiguates a URL lookup — the person\'s name (or numeric id)')
  }
}, async (args) => ok(listInterviews(resolveJob(args).id)));

server.registerTool('add_interview', {
  title: 'Add an interview',
  description: 'Record an interview for a job (a job can have several: recruiter screen, technical, hiring manager, ...). One interview can also cover several of the person\'s jobs at once (two openings discussed in one call) — pass the others in also_job_ids. Consider also setting the job\'s status to "Interviewing" with update_job if it is not already. Attendees are matched to existing contacts by name (at the job\'s company first) or created as new contacts at the job\'s company.',
  inputSchema: {
    job_id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to job_id)'),
    person: z.string().optional().describe('Disambiguates a URL lookup — the person\'s name (or numeric id)'),
    also_job_ids: z.array(z.number().int()).optional().describe('Ids of other jobs (same person) this interview also covers'),
    ...interviewFields,
    attendees: z.array(z.string()).optional().describe('Names of the people attending (interviewers, recruiter)'),
    questions: z.array(z.string()).optional().describe('Questions the candidate plans to ask in this interview')
  }
}, async ({ job_id, url, person, also_job_ids, attendees, questions, ...fields }) => {
  const job = resolveJob({ job_id, url, person });
  const interview = addInterview(job.id, { ...fields, job_ids: also_job_ids });
  attachAttendees(interview, job, attendees);
  if (questions?.length) addInterviewQuestions(interview.id, questions);
  return ok(getInterview(interview.id));
});

server.registerTool('update_interview', {
  title: 'Update an interview',
  description: 'Change an interview\'s type, time or notes; link or unlink jobs it covers; add or remove attendees; add questions to its Q&A or record the answers received; remove questions. Follow the interview-questions skill (skills/interview-questions/SKILL.md) when preparing questions yourself.',
  inputSchema: {
    id: z.number().int().describe('Interview id (from list_interviews)'),
    ...interviewFields,
    add_job_ids: z.array(z.number().int()).optional().describe('Ids of other jobs (same person) this interview also covers'),
    remove_job_ids: z.array(z.number().int()).optional().describe('Ids of jobs to unlink from this interview (it must keep at least one)'),
    append_notes: z.string().optional().describe('Appended to the existing notes after a blank line instead of replacing them'),
    add_attendees: z.array(z.string()).optional().describe('Names to add as attendees (existing contacts matched by name, else created at the job\'s company)'),
    remove_attendees: z.array(z.string()).optional().describe('Names of attendees to remove from this interview (the contacts themselves are kept)'),
    add_questions: z.array(z.string()).optional().describe('Questions to append to this interview\'s Q&A (duplicates ignored case-insensitively)'),
    answers: z.array(z.object({
      question_id: z.number().int().optional().describe('The question\'s id (from list_interviews)'),
      question: z.string().optional().describe('Or the question\'s exact text'),
      answer: z.string().describe('The answer received (empty string clears it)')
    })).optional().describe('Record what the interviewers answered for existing questions'),
    remove_question_ids: z.array(z.number().int()).optional().describe('Ids of questions to delete from this interview')
  }
}, async ({ id, add_job_ids, remove_job_ids, append_notes, add_attendees, remove_attendees, add_questions, answers, remove_question_ids, ...fields }) => {
  let interview = getInterview(id);
  if (!interview) throw new Error('Interview not found');
  const job = getJob({ id: interview.job_id });
  if (append_notes) {
    const existing = fields.notes ?? interview.notes;
    fields.notes = existing ? `${existing}\n\n${append_notes}` : append_notes;
  }
  updateInterview(id, fields);
  for (const jid of add_job_ids || []) linkInterviewJob(id, jid);
  for (const jid of remove_job_ids || []) unlinkInterviewJob(id, jid);
  attachAttendees(interview, job, add_attendees);
  for (const raw of remove_attendees || []) {
    const match = interview.attendees.find(c => c.name.toLowerCase() === String(raw).trim().toLowerCase());
    if (match) removeInterviewAttendee(id, match.id);
  }
  if (add_questions?.length) addInterviewQuestions(id, add_questions);
  for (const a of answers || []) {
    const q = a.question_id != null
      ? interview.questions.find(q => q.id === a.question_id)
      : interview.questions.find(q => q.question.toLowerCase() === String(a.question ?? '').trim().toLowerCase());
    if (!q) throw new Error(`No such question on this interview: ${a.question_id ?? a.question}`);
    updateInterviewQuestion(q.id, { answer: a.answer });
  }
  for (const qid of remove_question_ids || []) {
    if (interview.questions.some(q => q.id === qid)) deleteInterviewQuestion(qid);
  }
  return ok(getInterview(id));
});

server.registerTool('delete_interview', {
  title: 'Delete an interview',
  description: 'Remove an interview record (its attendees list and Q&A go with it; the contacts stay).',
  inputSchema: { id: z.number().int().describe('Interview id') }
}, async ({ id }) => {
  if (!deleteInterview(id)) throw new Error('Interview not found');
  return ok({ deleted: true });
});

server.registerTool('generate_interview_questions', {
  title: 'Propose questions for an interview',
  description: 'Have the JobTracker server propose the questions the candidate should ask in one interview, through the Anthropic API (web search), following the interview-questions skill: grounded in the posting, the company profile, the interview\'s type and attendees, and what earlier interviews for the job already covered. Returns { questions: [{ question, why, topic }], sources } without saving anything; save the ones the candidate wants with update_interview add_questions. Slow: allow a minute or two. If you can search the web yourself, following skills/interview-questions/SKILL.md directly is equivalent.',
  inputSchema: { id: z.number().int().describe('Interview id (from list_interviews)') }
}, async ({ id }) => ok(await generateInterviewQuestions(id)));

server.registerTool('get_summary', {
  title: 'Get summary',
  description: 'Get pipeline totals: job counts by status, overall total, and the most recent date jobs were found. Optionally scoped to one person.',
  inputSchema: {
    person: z.string().optional().describe('Limit the summary to this person\'s jobs — their name (or numeric id)')
  }
}, async ({ person }) => ok(getStats({ personId: person ? resolvePerson(person).id : undefined })));

return server;
}

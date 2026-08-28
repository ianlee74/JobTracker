import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, listCompanies, upsertCompany, updateSettings, STATUSES, LEVELS, REJECTION_REASONS, COMPANY_TYPES, EMPLOYEE_COUNTS } from './db.js';
import { generateJobDocuments, generateForInterested, documentsDir, hasApiCredentials } from './generate.js';

const server = new McpServer({
  name: 'jobtracker',
  version: '1.0.0'
});

const statusEnum = z.enum(STATUSES);

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
  rejection_reason: z.string().optional().describe(`Why the job is "Not Moving Forward" (only stored with that status). Prefer one of: ${REJECTION_REASONS.join(', ')} — or free text for anything else.`)
};

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

server.registerTool('list_jobs', {
  title: 'List jobs',
  description: 'List tracked job opportunities, optionally filtered by status, company, free-text search, or date found.',
  inputSchema: {
    status: statusEnum.optional().describe('Filter to one status'),
    company: z.string().optional().describe('Filter by company name (substring match)'),
    level: z.string().optional().describe(`Filter by seniority level (exact match), e.g. ${LEVELS.slice(0, 4).join(', ')}`),
    q: z.string().optional().describe('Free-text search across title, company, category, fit, note, and salary'),
    since: z.string().optional().describe('Only jobs found on/after this date (YYYY-MM-DD)'),
    limit: z.number().int().positive().optional().describe('Max rows to return'),
    include_not_interested_companies: z.boolean().optional().describe('Jobs from companies marked "not interested" are hidden by default; pass true to include them')
  }
}, async ({ include_not_interested_companies, ...args }) =>
  ok(listJobs({ ...args, excludeNotInterestedCompanies: !include_not_interested_companies })));

server.registerTool('get_job', {
  title: 'Get a job',
  description: 'Fetch one tracked job by id or by posting URL.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL')
  }
}, async ({ id, url }) => {
  const job = getJob({ id, url });
  if (!job) throw new Error('Job not found');
  return ok(job);
});

server.registerTool('add_jobs', {
  title: 'Add jobs',
  description: 'Add one or more new job opportunities to the tracker. Jobs whose URL is already tracked are skipped (their existing status and notes are preserved), so it is always safe to send the full day\'s findings.',
  inputSchema: {
    jobs: z.array(z.object(jobInput)).describe('Jobs to add')
  }
}, async ({ jobs }) => {
  const result = addJobs(jobs);
  return ok({ added: result.added, skipped_existing: result.skipped, added_jobs: result.jobs });
});

server.registerTool('update_job', {
  title: 'Update a job',
  description: 'Update fields on a tracked job (status, note, salary, etc.). Identify the job by id or by posting URL.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)'),
    status: statusEnum.optional(),
    rejection_reason: z.string().optional().describe(`Why the job is "Not Moving Forward" — set it when setting that status. Prefer one of: ${REJECTION_REASONS.join(', ')} — or free text for anything else. Cleared automatically if the status changes to anything else.`),
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
}, async ({ id, url, append_note, ...fields }) => {
  if (id == null && !url) throw new Error('Provide id or url to identify the job');
  if (append_note) {
    const existing = getJob({ id, url });
    if (!existing) throw new Error('Job not found');
    fields.note = existing.note ? `${existing.note}\n${append_note}` : append_note;
  }
  const job = updateJob({ id, url }, fields);
  if (!job) throw new Error('Job not found');
  return ok(job);
});

server.registerTool('delete_job', {
  title: 'Delete a job',
  description: 'Permanently remove a job from the tracker. Prefer setting status to "Not Moving Forward" unless the entry is a mistake/duplicate.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)')
  }
}, async ({ id, url }) => {
  if (id == null && !url) throw new Error('Provide id or url to identify the job');
  if (!deleteJob({ id, url })) throw new Error('Job not found');
  return ok({ deleted: true });
});

server.registerTool('list_companies', {
  title: 'List companies',
  description: 'List every company with tracked jobs (plus any with saved info): website, company type, employee count, note, not-interested flag, and job count.',
  inputSchema: {}
}, async () => ok(listCompanies()));

server.registerTool('update_company', {
  title: 'Update company info',
  description: 'Save notes/info about a company and/or mark it "not interested". Jobs from not-interested companies are hidden by default in the UI and in list_jobs (but stay tracked). Creates the company record if it does not exist yet.',
  inputSchema: {
    name: z.string().describe('Company name, exactly as it appears on its jobs'),
    website: z.string().optional().describe('Company website URL'),
    company_type: z.string().optional().describe(`Company type, ideally one of: ${COMPANY_TYPES.join(', ')} — or free text for anything else`),
    employee_count: z.string().optional().describe(`Employee count range, ideally one of: ${EMPLOYEE_COUNTS.join(', ')}`),
    note: z.string().optional().describe('Replaces the existing company note'),
    not_interested: z.boolean().optional().describe('true hides the company\'s jobs by default; false restores them')
  }
}, async ({ name, ...fields }) => ok(upsertCompany(name, fields)));

server.registerTool('generate_documents', {
  title: 'Generate tailored resume & cover letter',
  description: 'Generate a resume and cover letter tailored to a specific job (by id or URL), or to every job in "Interested" status, using the Anthropic API and the configured standard resume. Files are written to a per-job folder under the documents directory. Slow: allow a few minutes per job.',
  inputSchema: {
    id: z.number().int().optional().describe('Job id'),
    url: z.string().optional().describe('Job posting URL (alternative to id)'),
    all_interested: z.boolean().optional().describe('Generate for every job in "Interested" status instead of a single job'),
    skip_existing: z.boolean().optional().describe('Skip jobs that already have both documents (default true for all_interested, false for a single job)')
  }
}, async ({ id, url, all_interested, skip_existing }) => {
  if (all_interested) return ok(await generateForInterested({ skipExisting: skip_existing ?? true }));
  if (id == null && !url) throw new Error('Provide id or url, or set all_interested: true');
  return ok(await generateJobDocuments({ id, url }, { skipExisting: Boolean(skip_existing) }));
});

server.registerTool('configure_document_generation', {
  title: 'Configure document generation',
  description: 'View or change document-generation settings: the standard resume file (PDF, Word .docx, Markdown, or plain text — the source of truth for generated documents; with a .docx, generated documents are .docx files mirroring its formatting, otherwise Markdown) and the base folder where per-job document folders are created. Call with no arguments to just view the current settings. The Anthropic API key is read from the server environment, never stored here.',
  inputSchema: {
    resume_path: z.string().optional().describe('Absolute path to the standard resume file'),
    documents_dir: z.string().optional().describe('Absolute path to the base documents folder (empty string resets to the default under the data directory)')
  }
}, async (fields) => {
  const settings = updateSettings(fields);
  return ok({
    ...settings,
    documents_dir_effective: documentsDir(),
    api_credentials_found: await hasApiCredentials()
  });
});

server.registerTool('get_summary', {
  title: 'Get summary',
  description: 'Get pipeline totals: job counts by status, overall total, and the most recent date jobs were found.',
  inputSchema: {}
}, async () => ok(getStats()));

const transport = new StdioServerTransport();
await server.connect(transport);

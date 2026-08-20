import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listJobs, getJob, addJobs, updateJob, deleteJob, getStats, STATUSES, LEVELS } from './db.js';

const server = new McpServer({
  name: 'jobtracker',
  version: '1.0.0'
});

const statusEnum = z.enum(STATUSES);

const jobInput = {
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  url: z.string().describe('Job posting URL (unique key — duplicates are skipped)'),
  date_found: z.string().optional().describe('Date found, YYYY-MM-DD (defaults to today)'),
  category: z.string().optional().describe('Category, e.g. "AI-assisted dev", "Data integration", "DevOps"'),
  salary: z.string().optional().describe('Salary description, e.g. "$200,000 - $225,000"'),
  salary_confidence: z.enum(['ok', 'flag']).optional().describe('"flag" if salary is undisclosed/inferred/uncertain'),
  fit: z.string().optional().describe('Why this job fits the candidate'),
  level: z.string().optional().describe(`Seniority level, ideally one of: ${LEVELS.join(', ')}. If omitted it is classified automatically from the job title.`),
  status: statusEnum.optional().describe('Initial status (defaults to "new")'),
  note: z.string().optional().describe('Free-form note')
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
    limit: z.number().int().positive().optional().describe('Max rows to return')
  }
}, async (args) => ok(listJobs(args)));

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
    note: z.string().optional().describe('Replaces the existing note'),
    append_note: z.string().optional().describe('Appended to the existing note on a new line instead of replacing it'),
    title: z.string().optional(),
    company: z.string().optional(),
    category: z.string().optional(),
    salary: z.string().optional(),
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

server.registerTool('get_summary', {
  title: 'Get summary',
  description: 'Get pipeline totals: job counts by status, overall total, and the most recent date jobs were found.',
  inputSchema: {}
}, async () => ok(getStats()));

const transport = new StdioServerTransport();
await server.connect(transport);

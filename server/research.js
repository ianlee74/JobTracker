import { getCompany, listJobs, listCompanies, addCompany, upsertCompany, addCompanyInterviewQuestions, parseQuestions, normalizeTicker, COMPANY_TYPES, EMPLOYEE_COUNTS, LEVELS } from './db.js';
import { generateDocument, loadSkill, postingContext } from './generate.js';

// Company research via the Anthropic API: Claude searches the web for the
// company and returns values for the tracker's company fields (website, type,
// employee count, ticker, gross revenue), interview questions to ask it, and
// a short briefing for the notes. What to look for and how to report it is
// the `research-company` skill (skills/research-company/SKILL.md), whose body
// is the system prompt and whose frontmatter picks the model. The result is a
// proposal — the UI previews it and applies on confirmation; the MCP tool and
// the API apply it directly only when asked (`apply`), so nothing a person
// typed is overwritten without their say-so.

const SKILL = 'research-company';
const DEFAULT_MODEL = 'claude-opus-5';

// The skill's instructions with the tracker's preset lists filled in, so the
// enums stay defined in one place (db.js) and the skill text can't drift.
async function loadResearchSkill() {
  const skill = await loadSkill(SKILL);
  return {
    model: skill.model || DEFAULT_MODEL,
    system: skill.instructions
      .replaceAll('{{COMPANY_TYPES}}', COMPANY_TYPES.join(', '))
      .replaceAll('{{EMPLOYEE_COUNTS}}', EMPLOYEE_COUNTS.join(', '))
  };
}

// The fields research proposes a value for and Apply copies onto the company
// (blank proposals leave the field alone).
export const RESEARCHED_FIELDS = ['website', 'company_type', 'employee_count', 'ticker', 'gross_revenue'];

// Turns the model's reply into a validated research object; tolerant of a
// stray fence or a sentence around the JSON.
function parseResearch(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The research reply was not in the expected format.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The research reply was not valid JSON.');
  }
  // Web search makes the model mark cited spans with (cite index="…"> tags;
  // outside a citation-bearing text block they survive as literal text, so
  // they are stripped from every string.
  const str = (v) => (typeof v === 'string' ? v.replace(/<\/?cite\b[^>]*>/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim() : '');
  const website = str(parsed.website);
  return {
    website: /^https?:\/\//i.test(website) ? website : '',
    company_type: str(parsed.company_type),
    employee_count: str(parsed.employee_count),
    ticker: normalizeTicker(str(parsed.ticker)),
    gross_revenue: str(parsed.gross_revenue),
    headquarters: str(parsed.headquarters),
    founded: str(parsed.founded),
    confidence: ['high', 'medium', 'low'].includes(str(parsed.confidence)) ? str(parsed.confidence) : 'medium',
    summary: str(parsed.summary),
    interview_questions: parseQuestions(Array.isArray(parsed.interview_questions) ? parsed.interview_questions.map(str) : str(parsed.interview_questions)),
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(str).filter(s => /^https?:\/\//i.test(s)).slice(0, 6) : []
  };
}

// The block appended to the company's notes when research is applied. Dated,
// so repeated research reads as a log rather than replacing what was there.
export function researchNoteSection(research) {
  const stamp = new Date().toISOString().slice(0, 10);
  const facts = [
    research.headquarters && `HQ: ${research.headquarters}`,
    research.founded && `Founded: ${research.founded}`
  ].filter(Boolean).join(' · ');
  return [
    `--- Claude research (${stamp}) ---`,
    facts,
    research.summary,
    research.sources.length ? `Sources: ${research.sources.join(' ')}` : ''
  ].filter(Boolean).join('\n');
}

// Fills the company's fields from a research result: the researched fields
// take the researched values (blank research values leave the field alone),
// the interview questions are added to the company's list, and the briefing
// is appended to the notes.
export function applyResearch(name, research) {
  const company = getCompany(name);
  const fields = {};
  for (const key of RESEARCHED_FIELDS) {
    if (research[key]) fields[key] = research[key];
  }
  const section = researchNoteSection(research);
  fields.note = company.note ? `${company.note}\n\n${section}` : section;
  upsertCompany(name, fields);
  return addCompanyInterviewQuestions(name, research.interview_questions);
}

// Researches one company. Resolves to the proposal plus the company's current
// field values (so a caller can show what would change); with `apply`, the
// proposal is saved and the updated company is included as `company`.
export async function researchCompany(name, { apply = false } = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('Company name is required');
  const company = getCompany(name);
  const jobs = listJobs({ company: name }).filter(j => j.company === name).slice(0, 8);

  const lines = [
    `Company: ${name}`,
    `Known website: ${company.website || 'unknown'}`
  ];
  if (company.ticker) lines.push(`Known ticker symbol: ${company.ticker}`);
  if (jobs.length) {
    lines.push('', 'Job postings the seeker has tracked at this company (their URLs identify which company is meant):');
    for (const job of jobs) lines.push(`- ${job.title} — ${job.url}`);
  }
  if (company.note) {
    lines.push('', 'Existing notes about the company (do not repeat these; add what is new):', company.note);
  }
  const existingQuestions = parseQuestions(company.interview_questions);
  if (existingQuestions.length) {
    lines.push('', 'Interview questions already on file (propose different ones):', ...existingQuestions.map(q => `- ${q}`));
  }

  const skill = await loadResearchSkill();
  const text = await generateDocument({
    contextBlocks: [],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    instruction: lines.join('\n'),
    model: skill.model,
    system: skill.system,
    what: 'to research this company'
  });
  const research = parseResearch(text);
  const result = {
    name,
    ...research,
    note_section: researchNoteSection(research),
    current: Object.fromEntries(RESEARCHED_FIELDS.map(key => [key, company[key]]))
  };
  if (apply) result.company = applyResearch(name, research);
  return result;
}

// ---- Job posting parsing ----
//
// Reads one posting (a stored/local file or a web page) and proposes the
// add-job form's fields, following the `research-job` skill
// (skills/research-job/SKILL.md). The proposal is what the form is filled
// with; nothing about the job is saved until the person submits it. The one
// side effect: a company the posting names that isn't tracked yet is added
// and researched (research-company skill) in the background, so its profile
// is ready by the time the job is.

const JOB_SKILL = 'research-job';

async function loadJobSkill() {
  const skill = await loadSkill(JOB_SKILL);
  return {
    model: skill.model || DEFAULT_MODEL,
    system: skill.instructions.replaceAll('{{LEVELS}}', LEVELS.join(', '))
  };
}

// Turns the model's reply into a validated job proposal; tolerant of a stray
// fence or a sentence around the JSON, and of fields of the wrong type.
function parseJobResearch(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The parsing reply was not in the expected format.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The parsing reply was not valid JSON.');
  }
  const str = (v) => (typeof v === 'string' ? v.replace(/<\/?cite\b[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
  const num = (v) => {
    const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const website = str(parsed.company_website);
  const level = str(parsed.level);
  const remote = str(parsed.remote);
  return {
    title: str(parsed.title),
    company: str(parsed.company),
    company_website: /^https?:\/\//i.test(website) ? website : '',
    level: LEVELS.find(l => l.toLowerCase() === level.toLowerCase()) || '',
    category: str(parsed.category),
    salary: str(parsed.salary),
    salary_min: num(parsed.salary_min),
    salary_max: num(parsed.salary_max),
    salary_uncertain: typeof parsed.salary_uncertain === 'boolean' ? parsed.salary_uncertain : !str(parsed.salary),
    location: str(parsed.location),
    remote: ['Remote', 'Hybrid', 'On-site'].find(r => r.toLowerCase() === remote.toLowerCase()) || '',
    note: str(parsed.note),
    confidence: ['high', 'medium', 'low'].includes(str(parsed.confidence)) ? str(parsed.confidence) : 'medium'
  };
}

// Companies whose background research is in flight, so a posting parsed
// twice doesn't research the same new company twice.
const researching = new Set();

function researchInBackground(name) {
  if (researching.has(name)) return;
  researching.add(name);
  researchCompany(name, { apply: true })
    .then(() => console.log(`[research] researched new company ${name}`))
    .catch(err => console.error(`[research] research of new company ${name} failed: ${err.message}`))
    .finally(() => researching.delete(name));
}

// Parses one posting by URL (file:// for a stored/local file, http(s) for a
// page Claude fetches). `personId` scopes the category suggestions to that
// person's jobs. Resolves to the proposal plus `company_status`: 'existing'
// (the name was matched to a tracked company, whose spelling is returned),
// 'created' (a new company was added and its research started), or 'none'
// (the posting named no company).
export async function researchJob(url, { personId } = {}) {
  url = (url || '').trim();
  if (!url) throw new Error('A posting URL is required');
  if (!/^(https?|file):/i.test(url)) throw new Error('The posting URL must be an http(s) or file:// URL');

  const posting = await postingContext({ url });
  if (!posting.block && !posting.tools) throw new Error(posting.note.replace(/; tailor from the job details above\.$/, '.'));

  const companies = listCompanies().map(c => c.name);
  const categories = [...new Set(listJobs({ personId }).map(j => j.category).filter(Boolean))].sort();
  const lines = [`Posting URL: ${url}`];
  if (posting.note) lines.push(posting.note);
  if (companies.length) lines.push('', 'Companies already tracked (use the exact spelling when the posting\'s employer is one of these):', companies.join('; '));
  if (categories.length) lines.push('', 'Categories the seeker already uses (pick one when it fits):', categories.join('; '));

  const skill = await loadJobSkill();
  const text = await generateDocument({
    contextBlocks: posting.block ? [posting.block] : [],
    tools: posting.tools,
    instruction: lines.join('\n'),
    model: skill.model,
    system: skill.system,
    what: 'to parse this job posting'
  });
  const job = parseJobResearch(text);

  let companyStatus = 'none';
  if (job.company) {
    const existing = companies.find(c => c.toLowerCase() === job.company.toLowerCase());
    if (existing) {
      job.company = existing;
      companyStatus = 'existing';
    } else {
      try {
        addCompany(job.company, job.company_website ? { website: job.company_website } : {});
        companyStatus = 'created';
        researchInBackground(job.company);
      } catch (err) {
        // Added concurrently (another parse, the MCP server): treat as existing.
        const now = listCompanies().find(c => c.name.toLowerCase() === job.company.toLowerCase());
        if (!now) throw err;
        job.company = now.name;
        companyStatus = 'existing';
      }
    }
  }
  return { ...job, url, company_status: companyStatus };
}

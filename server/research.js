import { getCompany, listJobs, upsertCompany, addCompanyInterviewQuestions, parseQuestions, normalizeTicker, COMPANY_TYPES, EMPLOYEE_COUNTS } from './db.js';
import { generateDocument, loadSkill } from './generate.js';

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

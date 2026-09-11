import { getCompany, listJobs, upsertCompany, COMPANY_TYPES, EMPLOYEE_COUNTS } from './db.js';
import { generateDocument } from './generate.js';

// Company research via the Anthropic API: Claude searches the web for the
// company and returns values for the tracker's company fields (website, type,
// employee count) plus a short briefing for the notes. The result is a
// proposal — the UI previews it and applies on confirmation; the MCP tool and
// the API apply it directly only when asked (`apply`), so nothing a person
// typed is overwritten without their say-so.

const MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = `You research employers for a job seeker's personal job tracker. Given a company name (and the job postings the seeker has tracked at it, whose URLs identify which company is meant), use web search to find current, factual information about that company. Prefer primary and reputable sources: the company's own site, LinkedIn, Crunchbase, Wikipedia, its filings, and recent reputable news. Never invent facts — when something cannot be established, leave the field empty and say so in the summary.

Reply with ONLY a JSON object — no Markdown fences, no prose before or after it, no citation tags inside the strings — with exactly these keys:
- "website": the company's primary corporate website URL (https://...), or "" if not found.
- "company_type": exactly one of: ${COMPANY_TYPES.join(', ')} — or "" if unknown. Classify by current headcount, not by branding or funding stage: roughly under 200 employees is Startup (VC-backed) or Small Company (bootstrapped/independent); 200–2,000 is Mid-size Company; over 2,000 or a large public company is Enterprise; client-services firms are Agency / Consultancy.
- "employee_count": exactly one of: ${EMPLOYEE_COUNTS.join(', ')} — or "" if unknown.
- "headquarters": "City, State/Country", or "".
- "founded": the founding year as a string, or "".
- "confidence": "high", "medium", or "low" — how sure you are that you identified the right company (lower it when the name is ambiguous and the postings did not settle it).
- "summary": 120–250 words of plain text (paragraphs separated by blank lines, no Markdown) covering: what the company does, its products and customers; size, ownership (public, private, VC-backed, subsidiary of whom) and funding or revenue if known; the engineering organization and technology signals; its reputation as an employer (employee reviews, remote-work stance, growth, layoffs or other notable news from the last year); and anything a candidate should know before applying or interviewing.
- "sources": an array of up to 6 URLs you actually consulted.`;

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
  // Web search makes the model mark cited spans with <cite index="…"> tags;
  // outside a citation-bearing text block they survive as literal text, so
  // they are stripped from every string.
  const str = (v) => (typeof v === 'string' ? v.replace(/<\/?cite\b[^>]*>/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim() : '');
  const website = str(parsed.website);
  return {
    website: /^https?:\/\//i.test(website) ? website : '',
    company_type: str(parsed.company_type),
    employee_count: str(parsed.employee_count),
    headquarters: str(parsed.headquarters),
    founded: str(parsed.founded),
    confidence: ['high', 'medium', 'low'].includes(str(parsed.confidence)) ? str(parsed.confidence) : 'medium',
    summary: str(parsed.summary),
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

// Fills the company's fields from a research result: website/type/count take
// the researched values (blank research values leave the field alone), the
// briefing is appended to the notes.
export function applyResearch(name, research) {
  const company = getCompany(name);
  const fields = {};
  for (const key of ['website', 'company_type', 'employee_count']) {
    if (research[key]) fields[key] = research[key];
  }
  const section = researchNoteSection(research);
  fields.note = company.note ? `${company.note}\n\n${section}` : section;
  return upsertCompany(name, fields);
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
  if (jobs.length) {
    lines.push('', 'Job postings the seeker has tracked at this company (their URLs identify which company is meant):');
    for (const job of jobs) lines.push(`- ${job.title} — ${job.url}`);
  }
  if (company.note) {
    lines.push('', 'Existing notes about the company (do not repeat these; add what is new):', company.note);
  }

  const text = await generateDocument({
    contextBlocks: [],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    instruction: lines.join('\n'),
    model: MODEL,
    system: SYSTEM_PROMPT,
    what: 'to research this company'
  });
  const research = parseResearch(text);
  const result = {
    name,
    ...research,
    note_section: researchNoteSection(research),
    current: { website: company.website, company_type: company.company_type, employee_count: company.employee_count }
  };
  if (apply) result.company = applyResearch(name, research);
  return result;
}

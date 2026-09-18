import { getJob, getCompany, getInterview, listInterviews, parseQuestions } from './db.js';
import { generateDocument, loadSkill, postingContext } from './generate.js';

// Interview-question generation via the Anthropic API: Claude reads the job
// (its posting, the tracker's notes on it and the application), the company's
// profile, and the interview itself (its type, who is attending, the
// candidate's prep notes), searches the web for what the profile lacks, and
// proposes the questions the candidate should ask in that interview. What to
// cover and how to phrase it is the `interview-questions` skill
// (skills/interview-questions/SKILL.md), whose body is the system prompt and
// whose frontmatter picks the model. The result is a proposal: the Interviews
// page previews it and adds the ticked questions on confirmation.

const SKILL = 'interview-questions';
const DEFAULT_MODEL = 'claude-opus-5';
const TOPICS = ['role', 'team', 'company', 'process'];

function field(label, value) {
  return value ? `${label}: ${value}\n` : '';
}

// Turns the model's reply into a validated proposal; tolerant of a stray
// fence or a sentence around the JSON, and of items of the wrong shape.
function parseProposal(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reply was not in the expected format.');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The reply was not valid JSON.');
  }
  const str = (v) => (typeof v === 'string' ? v.replace(/<\/?cite\b[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
  const seen = new Set();
  const questions = [];
  for (const item of Array.isArray(parsed.questions) ? parsed.questions : []) {
    const question = parseQuestions([str(typeof item === 'string' ? item : item?.question)])[0];
    if (!question || seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    const topic = str(item?.topic).toLowerCase();
    questions.push({
      question,
      why: str(item?.why),
      topic: TOPICS.includes(topic) ? topic : ''
    });
  }
  if (!questions.length) throw new Error('Claude proposed no questions.');
  return {
    questions,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(str).filter(s => /^https?:\/\//i.test(s)).slice(0, 6) : []
  };
}

function contactLine(c) {
  return [c.name, c.title, c.company].filter(Boolean).join(', ') + (c.note ? ` — ${c.note.replace(/\s+/g, ' ')}` : '');
}

// Proposes questions for one interview. Resolves to
// { interview_id, questions: [{ question, why, topic }], sources }; nothing
// is saved.
export async function generateInterviewQuestions(interviewId) {
  const interview = getInterview(interviewId);
  if (!interview) throw new Error('Interview not found');
  // Every job the interview covers (the primary one first), with each job's
  // full row; an interview can cover several openings at once.
  const jobs = interview.jobs.map(j => getJob({ id: j.id })).filter(Boolean);
  if (!jobs.length) throw new Error('Job not found');
  const companies = [...new Set(jobs.map(j => j.company))].map(name => getCompany(name));

  const lines = [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '# This interview',
    field('Type', interview.type || 'not specified')
    + field('Scheduled', interview.scheduled_at)
    + (jobs.length > 1 ? `This one interview covers ${jobs.length} openings at once (listed below); propose questions that help the candidate compare and choose between them as well as questions about each.\n` : '')
    + (interview.attendees.length ? `Attendees:\n${interview.attendees.map(c => `- ${contactLine(c)}`).join('\n')}\n` : '')
  ];
  for (const job of jobs) {
    lines.push(
      jobs.length > 1 ? `# Job: ${job.title}` : '# Job',
      field('Title', job.title)
      + field('Company', job.company)
      + field('Seniority level', job.level)
      + field('Category', job.category)
      + field('Salary as listed', job.salary)
      + field('Why the candidate thinks it fits', job.fit)
      + field('Notes on the job', job.note)
      + field("Candidate's own notes", job.user_note)
      + field('Salary the candidate proposed in the application', job.proposed_salary != null ? `$${Number(job.proposed_salary).toLocaleString('en-US')}` : '')
      + field('Application notes', job.application_notes)
      + field('Referred by', job.referred_by)
      + field('Posting URL', job.url)
    );
  }
  for (const company of companies) {
    lines.push(
      companies.length > 1 ? `# Company: ${company.name}` : '# Company',
      field('Website', company.website)
      + field('Type', company.company_type)
      + field('Employee count', company.employee_count)
      + field('Ticker symbol', company.ticker)
      + field('Gross revenue', company.gross_revenue)
      + field('Notes', company.note)
    );
  }

  // Everything the candidate has already asked or plans to ask, across every
  // interview for these jobs, plus the companies' standing lists.
  const seenIds = new Set([interview.id]);
  const others = jobs.flatMap(j => listInterviews(j.id)).filter(i => !seenIds.has(i.id) && seenIds.add(i.id));
  const asked = others.flatMap(i => i.questions.map(q => ({ ...q, interview: i })));
  if (asked.length) {
    lines.push('# Questions already asked in earlier interviews for this job (with the answers received — do not repeat them; build on them)');
    for (const q of asked) {
      lines.push(`- [${q.interview.type || 'interview'}${q.interview.scheduled_at ? ` ${q.interview.scheduled_at}` : ''}] ${q.question}${q.answer ? `\n  Answer: ${q.answer.replace(/\s+/g, ' ')}` : ''}`);
    }
    lines.push('');
  }
  const onFile = [...new Set([...interview.questions.map(q => q.question), ...companies.flatMap(c => parseQuestions(c.interview_questions))])];
  if (onFile.length) {
    lines.push('# Questions already on the candidate\'s list for this interview or the company (propose different ones)', ...onFile.map(q => `- ${q}`), '');
  }
  if (interview.notes) {
    lines.push('# The candidate\'s prep notes for this interview', interview.notes, '');
  }
  const earlierNotes = others.filter(i => i.notes).map(i => `## ${i.type || 'Interview'}${i.scheduled_at ? ` (${i.scheduled_at})` : ''}\n${i.notes}`);
  if (earlierNotes.length) {
    lines.push('# Notes from the other interviews for this job', ...earlierNotes, '');
  }

  // Each job's posting: local files are embedded, web pages fetched by Claude.
  const contextBlocks = [];
  let fetchTools = null;
  for (const job of jobs) {
    const posting = await postingContext(job);
    if (posting.block) contextBlocks.push(posting.block);
    if (posting.tools) fetchTools = posting.tools;
    if (posting.note) lines.push(posting.note.replace(/; tailor from the job details above\.$/, '.').replace(/before writing\.$/, 'before proposing questions.'));
  }

  const skill = await loadSkill(SKILL);
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
    ...(fetchTools || [])
  ];
  const text = await generateDocument({
    contextBlocks,
    tools,
    instruction: lines.join('\n'),
    model: skill.model || DEFAULT_MODEL,
    system: skill.instructions,
    what: 'to propose interview questions'
  });
  return { interview_id: interview.id, ...parseProposal(text) };
}

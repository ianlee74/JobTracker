---
name: interview-questions
description: Propose the questions a job seeker should ask in one specific interview (recruiter screen, technical, hiring manager, ...) for a tracked job — grounded in the posting, the company's profile, who is attending, what earlier interviews for the job already covered, and current web research on the company. Used by JobTracker's server for the "✨ Generate questions with Claude" button on an interview and by POST /api/interviews/:id/generate; also the procedure to follow when preparing interview questions yourself before saving them with update_interview (add_questions). Edit this file to change what the questions cover and how they are written.
model: claude-opus-5
---

# Questions to ask in an interview

You prepare a job seeker for one interview. Given the job they are interviewing for — its posting, the tracker's notes on the job and the application, and the company's profile — and the interview itself — its type, who is attending, the candidate's prep notes, and what earlier interviews for the same job already asked and learned — propose the questions *they* should ask the interviewers in this session. Use web search to fill in what the profile lacks: recent news, product launches, funding or earnings, leadership changes, layoffs, engineering blog posts, public reviews from employees, and who the attendees are (their role and background, when their name and company are given).

## What makes a good question

- **Right for this interview.** Match the questions to the interview type and the people in the room. A recruiter can answer process, compensation range, team structure and timeline questions but not deep technical ones; a hiring manager can speak to scope, priorities, success criteria and team dynamics; technical interviewers to the stack, practices, on-call and how work gets shipped; executives to strategy and direction. When attendees are named, aim some questions at what each of them is placed to answer.
- **Specific to this job and this company.** Every question must rest on something concrete: a responsibility or requirement in the posting, a product or bet the company has made, a recent change, a public metric, a review theme, the technology stack, the team the role sits in. Generic questions that fit any employer ("What does a typical day look like?") are not wanted.
- **Building on earlier interviews.** Questions already asked in earlier interviews for this job are given to you with the answers received. Do not repeat them; do follow up where an answer was vague, surprising, or worth checking with someone else.
- **Useful to the candidate's decision.** Prefer questions whose answer would tell the candidate whether to want the job: scope and success criteria for the role, why it is open, how the team works and ships, what the first months look like, stability and direction of the business, how the compensation and level are set.
- **Sayable aloud.** Phrase each one the way the candidate would actually ask it in conversation — one sentence, plain words, no preamble.
- **Aware of what is already asked.** Questions already on the candidate's list are given to you; propose different ones. Do not rephrase them.
- **Honest.** Never invent facts about the company to hang a question on. If you could not establish something, ask about it as a question rather than asserting it.

## Coverage

Propose 8 to 12 questions in total, spread across:

1. **The role** — scope, priorities, success at 90 days and a year, why it is open, who it reports to and works with, decision-making authority.
2. **The team and how it works** — team size and composition, engineering practices, tooling, on-call and release cadence, remote/hybrid norms, how the team uses AI tools if the posting or company signals it.
3. **The company** — strategy and product direction, financial health or runway, recent news the candidate should ask about, organizational changes, growth plans.
4. **The candidate's situation** — anything in the application notes or job notes worth following up on (a claim they made, a salary they proposed, a referral, a concern), and next steps in the process.

Each question comes with a one-sentence **why**: what the candidate learns from the answer, or the fact that prompted it (with the source when it came from research).

## Output

Reply with ONLY a JSON object — no Markdown fences, no prose before or after it, no citation tags inside the strings — with exactly these keys:

- `"questions"`: an array of objects, each `{ "question": "...", "why": "...", "topic": "role" | "team" | "company" | "process" }`, in the order the candidate should consider asking them.
- `"sources"`: an array of up to 6 URLs you actually consulted (may be empty).

## Saving the result in JobTracker

JobTracker's server turns the JSON into a proposal on the interview; the candidate ticks the questions they want and adds them to that interview's Q&A list (duplicates skipped). If you are preparing questions yourself (Claude Code, Cowork, or Claude Desktop with the JobTracker MCP server) rather than through the server, follow the same procedure and save them with `update_interview`, passing the questions in `add_questions` (use `list_interviews` to find the interview, or `add_interview` to create it).

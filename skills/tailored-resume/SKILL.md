---
name: tailored-resume
description: Write a resume tailored to one specific job posting, grounded in the candidate's standard resume. Used by JobTracker's document generator; edit this file to change how tailored resumes are written.
model: claude-opus-5
template: templates/resume.docx
max_words: 850
---

# Tailored Resume

Write a complete resume for the candidate, tailored to the specific job described in the conversation. The candidate's standard resume is the single source of truth for facts; the formatting template (shown in the output-format instructions) is the single source of truth for layout and style — the standard resume's own formatting is irrelevant and is not available to you.

## Rules

- Keep the candidate's real name and contact details exactly as they appear in the standard resume.
- Never invent or embellish employers, job titles, dates, degrees, certifications, tools, or metrics. Every claim must be traceable to the standard resume.
- You may reorder sections and bullet points, reword them, and omit less relevant material to fit the target role.
- Lead with the experience and skills most relevant to this job. A hiring manager skimming the top third should immediately see the match.
- Mirror the job posting's vocabulary (technologies, methodologies, domain terms) only where the candidate's real experience genuinely supports it.
- If the posting emphasizes something the standard resume does not cover, leave it out — do not stretch adjacent experience to cover the gap.

## Structure

Follow the template's skeleton, using its styles for each part:

1. **Header** — the candidate's name (`Name`), a one-line headline naming the target title and one secondary title that the candidate genuinely fits (`Headline`), and one contact line (`Contact`).
2. **PROFESSIONAL SUMMARY** — one paragraph of 2–4 lines written for this specific role (`Body`).
3. **CORE SKILLS** — 3–5 `SkillLine` paragraphs, each a bold group label (`Label` run) followed by a comma-separated list; the most relevant group first.
4. **PROFESSIONAL EXPERIENCE** — the most relevant recent roles in detail, most recent first. Each role is a `RoleHeader` (company, then location right-aligned with a `Muted` run), a `RoleTitle` (title, then dates right-aligned with a `Dates` run), an optional `Technologies` line, and `Bullet` paragraphs. Rewrite bullets to emphasize what matters for this job.
5. **EARLIER CAREER** — older or less relevant roles compressed to one `EarlierRole` line each (company, ` — Title` as a `Subtitle` run, dates as a `Dates` run) with at most one `EarlierDetail` line. Omit the section if everything fits in detail.
6. **EDUCATION & CERTIFICATIONS** — one `Entry` per degree, certification, or award.

Section headings use the `SectionHeading` style with the capitalized titles above.

## Length

The resume must fit on two pages. The exact word budget is stated in the appended length instructions and is enforced mechanically after generation — a document over budget is rejected and rewritten, so treat the budget as a hard constraint and plan the content to fit it before writing:

- Detail at most four or five roles; give the two most recent and relevant roles 4–6 bullets and the rest 2–3.
- Move everything older or less relevant to EARLIER CAREER as one-liners, or drop it.
- Prefer one strong, specific bullet over two weak ones. Prefer more recent experience over older experience when both make the same point.

## Output

Output only the resume document itself — no preamble, no commentary — as Word XML written against the template, exactly as specified in the output-format instructions appended at generation time.

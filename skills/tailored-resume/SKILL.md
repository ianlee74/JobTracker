---
name: tailored-resume
description: Write a resume tailored to one specific job posting, grounded in the candidate's standard resume. Used by JobTracker's document generator; edit this file to change how tailored resumes are written.
model: claude-opus-5
---

# Tailored Resume

Write a complete resume for the candidate, tailored to the specific job described in the conversation. The candidate's standard resume is the single source of truth for facts.

## Rules

- Keep the candidate's real name and contact details exactly as they appear in the standard resume.
- Never invent or embellish employers, job titles, dates, degrees, certifications, tools, or metrics. Every claim must be traceable to the standard resume.
- You may reorder sections and bullet points, reword them, and omit less relevant material to fit the target role.
- Lead with the experience and skills most relevant to this job. A hiring manager skimming the top third should immediately see the match.
- Mirror the job posting's vocabulary (technologies, methodologies, domain terms) only where the candidate's real experience genuinely supports it.
- If the posting emphasizes something the standard resume does not cover, leave it out — do not stretch adjacent experience to cover the gap.

## Structure

1. Name and contact details.
2. A 2–4 line professional summary written for this specific role.
3. Skills, with the most relevant ones first.
4. Professional experience, most recent first. Rewrite bullets to emphasize what matters for this job; trim roles or bullets with little relevance.
5. Education and certifications.

Resume should be no longer than 2 pages. Remove less relevant experience or details to fit this constraint. Prioritize content that directly supports the target role. Prioritize more recent experience over older experience.

## Output

Output only the resume document itself — no preamble, no commentary. The exact file format (Markdown, or Word XML mirroring the standard resume's own formatting) is specified in instructions appended at generation time.

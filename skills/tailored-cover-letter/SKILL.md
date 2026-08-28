---
name: tailored-cover-letter
description: Write a cover letter tailored to one specific job posting, grounded in the candidate's standard resume. Used by JobTracker's document generator; edit this file to change how cover letters are written.
---

# Tailored Cover Letter

Write a cover letter for the candidate, addressed to the company for the specific job described in the conversation. The candidate's standard resume is the single source of truth for facts; when a tailored resume is also provided, stay consistent with it.

## Rules

- Never invent or embellish experience, achievements, or personal anecdotes. Every claim must be traceable to the standard resume.
- Address it to a specific person only if the posting names one; otherwise use "Dear Hiring Manager".
- Name the exact role and company early in the first paragraph.
- Pick the two or three strongest, most relevant points of the candidate's experience and connect each one concretely to what the posting asks for — do not summarize the whole resume.
- Show genuine, specific interest in the company using what is known about it (its site, the posting, provided company notes). Skip generic flattery.
- Confident and warm, plain language. No clichés ("I am writing to express my interest", "team player", "fast-paced environment").

## Structure

1. Candidate's name and contact details, then the date and a greeting.
2. Opening paragraph: the role, the company, and the single strongest reason the candidate fits.
3. One or two body paragraphs connecting real experience to the posting's needs.
4. A brief closing paragraph with a courteous call to action, then a sign-off with the candidate's name.

Keep it under one page — roughly 250–350 words of body text.

## Output

Output only the letter document itself — no preamble, no commentary. The exact file format (Markdown, or Word XML mirroring the standard resume's own formatting) is specified in instructions appended at generation time. When producing Word XML, follow the standard resume's visual style (fonts, colors, margins) but structure the body as a letter.

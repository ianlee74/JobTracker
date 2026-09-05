---
name: tailored-cover-letter
description: Write a cover letter tailored to one specific job posting, grounded in the candidate's standard resume. Used by JobTracker's document generator; edit this file to change how cover letters are written.
model: claude-sonnet-5
template: templates/resume.docx
max_words: 450
---

# Tailored Cover Letter

Write a cover letter for the candidate, addressed to the company for the specific job described in the conversation. The candidate's standard resume is the single source of truth for facts; when a tailored resume is also provided, stay consistent with it. The formatting template (shown in the output-format instructions) is the single source of truth for layout and style.

## Rules

- Never invent or embellish experience, achievements, or personal anecdotes. Every claim must be traceable to the standard resume.
- Address it to a specific person only if the posting names one; otherwise use "Dear Hiring Manager".
- Name the exact role and company early in the first paragraph.
- Pick the two or three strongest, most relevant points of the candidate's experience and connect each one concretely to what the posting asks for — do not summarize the whole resume.
- Show genuine, specific interest in the company using what is known about it (its site, the posting, provided company notes). Skip generic flattery.
- Confident and warm, plain language. No clichés ("I am writing to express my interest", "I'm writing to apply", "team player", "fast-paced environment") — open with substance, not with the fact that you are writing.
- Date the letter with the date given in the job context ("Today's date"), written out in full (e.g. September 5, 2026).

## Structure

Use the template's header styles for the letterhead and its `LetterBody` style for everything else:

1. Letterhead: the candidate's name (`Name`) and one contact line (`Contact`) — no headline.
2. The date, then the greeting, each as its own `LetterBody` paragraph.
3. Opening paragraph: the role, the company, and the single strongest reason the candidate fits.
4. One or two body paragraphs connecting real experience to the posting's needs.
5. A brief closing paragraph with a courteous call to action, then a sign-off ("Sincerely,") and the candidate's name as separate `LetterBody` paragraphs.

Do not use the resume's section headings, bullets, or role styles in the letter.

## Length

Under one page: roughly 250–350 words of body text. The overall word budget is stated in the appended length instructions and enforced after generation.

## Output

Output only the letter document itself — no preamble, no commentary — as Word XML written against the template, exactly as specified in the output-format instructions appended at generation time.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INTERVIEW_TYPES, STATUS_COLORS, formatDollars, formatSalaryRange, formatWhen, jobHref, parseQuestions, tickerHref } from './constants.js';
import { fetchJobInterviews, addInterview, updateInterview, deleteInterview, addInterviewJob, removeInterviewJob, addInterviewAttendee, removeInterviewAttendee, addInterviewQuestions, reorderInterviewQuestions, updateInterviewQuestion, deleteInterviewQuestion, generateInterviewQuestions } from './api.js';
import { renderMarkdown } from './markdown.js';
import { ContactForm } from './ContactsPage.jsx';

// Autosave helper: returns [value, setValue, flush] for a text field whose
// saves are debounced while typing and flushed on blur/unmount. `stored` is
// the server's value; external changes are picked up unless the field is
// being edited (the caller passes `editing`).
function useAutosave(stored, save, { delay = 800 } = {}) {
  const [value, setValue] = useState(stored ?? '');
  const latest = useRef(stored ?? '');
  const timer = useRef(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) {
      setValue(stored ?? '');
      latest.current = stored ?? '';
    }
  }, [stored]);

  const flush = () => {
    clearTimeout(timer.current);
    if (dirty.current) {
      dirty.current = false;
      if (latest.current !== (stored ?? '')) save(latest.current);
    }
  };
  const change = (text) => {
    setValue(text);
    latest.current = text;
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return [value, change, flush];
}

function Field({ label, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="review-field">
      <span className="review-label">{label}</span>
      <span className="review-value">{children}</span>
    </div>
  );
}

// What the candidate should have in front of them about the job: the
// posting link, the basics, why it fits, notes, and what they said in the
// application.
function JobReview({ job, company, onOpenCompany }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="company-card review-card">
      <div className="review-header">
        <h2>
          <a href={jobHref(job.url)} target="_blank" rel="noopener noreferrer" title="Open the posting">{job.title}</a>
          <span className="review-at"> at </span>
          <button className="company-link review-company" onClick={() => onOpenCompany(job.company)} title="Open company page">{job.company}</button>
          <span className="status-pill" style={{ color: STATUS_COLORS[job.status], borderColor: STATUS_COLORS[job.status] }}>{job.status}</span>
        </h2>
        <button className="clear-btn collapse-btn" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="review-grid">
          <Field label="Level">{job.level}</Field>
          <Field label="Category">{job.category}</Field>
          <Field label="Salary">{formatSalaryRange(job) ?? job.salary}{job.salary_confidence === 'flag' ? ' (inferred)' : ''}</Field>
          <Field label="Found">{job.date_found}</Field>
          <Field label="Referred by">{job.referred_by}</Field>
          <Field label="You asked for">{job.proposed_salary != null ? formatDollars(job.proposed_salary) : ''}</Field>
          <div className="review-wide">
            <Field label="Why it fits">{job.fit}</Field>
            <Field label="Notes">{job.note && <span className="pre-wrap">{job.note}</span>}</Field>
            <Field label="Your notes">{job.user_note && <span className="pre-wrap">{job.user_note}</span>}</Field>
            <Field label="Application notes">{job.application_notes && <span className="pre-wrap">{job.application_notes}</span>}</Field>
          </div>
        </div>
      )}
    </div>
  );
}

// The company's profile, notes, and its standing list of interview
// questions — each with a button to copy it into the selected interview.
function CompanyReview({ company, onOpenCompany, onAddQuestion, existing }) {
  const [open, setOpen] = useState(true);
  const questions = parseQuestions(company.interview_questions);
  const have = new Set(existing.map(q => q.toLowerCase()));
  return (
    <div className="company-card review-card">
      <div className="review-header">
        <h2>
          <button className="company-link review-company" onClick={() => onOpenCompany(company.name)} title="Open company page">{company.name}</button>
          {company.favorite ? <span className="fav-badge" title="Favorite company">★</span> : null}
        </h2>
        <button className="clear-btn collapse-btn" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="review-grid">
          <Field label="Type">{company.company_type}</Field>
          <Field label="Employees">{company.employee_count}</Field>
          <Field label="Ticker">{company.ticker && <a className="ticker-link" href={tickerHref(company.ticker)} target="_blank" rel="noopener noreferrer">{company.ticker} ↗</a>}</Field>
          <Field label="Revenue">{company.gross_revenue}</Field>
          <Field label="Website">{company.website && <a href={company.website} target="_blank" rel="noopener noreferrer">{company.website.replace(/^https?:\/\//, '')}</a>}</Field>
          <Field label="Referrals">{company.referrals}</Field>
          <div className="review-wide">
            <Field label="Notes">{company.note && <span className="pre-wrap">{company.note}</span>}</Field>
            {questions.length > 0 && (
              <Field label="Company questions">
                <ul className="company-question-list">
                  {questions.map(q => (
                    <li key={q}>
                      <span>{q}</span>
                      {have.has(q.toLowerCase())
                        ? <span className="hint">added</span>
                        : <button className="link-btn" onClick={() => onAddQuestion(q)} title="Add this question to the selected interview">+ add</button>}
                    </li>
                  ))}
                </ul>
              </Field>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The attendees of one interview: chips of contacts, plus a picker that
// searches existing contacts by name or creates a new one (at the job's
// company by default).
function Attendees({ interview, contacts, job, companies, onChange, onContactsChanged, onError }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(null); // name for the new-contact form
  const attending = new Set(interview.attendees.map(c => c.id));
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return contacts.filter(c => !attending.has(c.id) && c.company.toLowerCase() === job.company.toLowerCase()).slice(0, 8);
    return contacts.filter(c => !attending.has(c.id) && [c.name, c.title, c.company].some(v => (v || '').toLowerCase().includes(q))).slice(0, 8);
  }, [contacts, q, interview.attendees, job.company]);
  const exact = matches.find(c => c.name.toLowerCase() === q);

  const attach = async (contactId) => {
    try {
      onChange(await addInterviewAttendee(interview.id, { contact_id: contactId }));
      setText('');
      setAdding(false);
    } catch (err) {
      onError(err.message);
    }
  };
  const remove = async (contactId) => {
    try {
      onChange(await removeInterviewAttendee(interview.id, contactId));
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <div className="attendees">
      <span className="review-label">Attendees</span>
      <div className="attendee-chips">
        {interview.attendees.map(c => (
          <span key={c.id} className="attendee-chip" title={[c.title, c.company, c.email].filter(Boolean).join(' · ') || undefined}>
            {c.name}
            {c.title ? <span className="attendee-title"> · {c.title}</span> : null}
            {c.company ? <span className="attendee-company"> @ {c.company}</span> : null}
            <button className="chip-x attendee-x" onClick={() => remove(c.id)} title="Remove from this interview" aria-label={`Remove ${c.name}`}>×</button>
          </span>
        ))}
        {!adding && (
          <button className="link-btn" onClick={() => setAdding(true)}>+ Add attendee</button>
        )}
      </div>
      {adding && (
        <div className="attendee-picker">
          <input
            autoFocus
            className="reason-input attendee-input"
            placeholder="Type a name — pick an existing contact or create one"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAdding(false); setText(''); }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (exact) attach(exact.id);
                else if (text.trim()) setCreating(text.trim());
              }
            }}
          />
          <div className="attendee-options">
            {matches.map(c => (
              <button key={c.id} className="attendee-option" onClick={() => attach(c.id)}>
                <strong>{c.name}</strong>{c.title ? ` · ${c.title}` : ''}{c.company ? <span className="hint"> · {c.company}</span> : null}
              </button>
            ))}
            {text.trim() && !exact && (
              <button className="attendee-option attendee-create" onClick={() => setCreating(text.trim())}>
                + Create contact “{text.trim()}”
              </button>
            )}
            {!matches.length && !text.trim() && <span className="hint attendee-empty">No contacts at {job.company} yet — type a name to create one.</span>}
            <button className="link-btn attendee-cancel" onClick={() => { setAdding(false); setText(''); }}>Cancel</button>
          </div>
        </div>
      )}
      {creating != null && (
        <ContactForm
          contact={null}
          initial={{ name: creating, company: job.company }}
          companies={companies}
          onSubmit={async (fields) => {
            const updated = await addInterviewAttendee(interview.id, { contact: fields });
            onChange(updated);
            onContactsChanged();
            setCreating(null);
            setText('');
            setAdding(false);
          }}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

// Markdown notes with an Edit / Preview toggle; autosaves.
function Notes({ interview, onSave }) {
  const [mode, setMode] = useState(interview.notes ? 'preview' : 'edit');
  const [value, change, flush] = useAutosave(interview.notes, (notes) => onSave({ notes }));
  useEffect(() => { setMode(interview.notes ? 'preview' : 'edit'); }, [interview.id]);
  const html = useMemo(() => renderMarkdown(value), [value]);
  return (
    <div className="interview-notes">
      <div className="section-head">
        <span className="review-label">Notes</span>
        <div className="view-switch small">
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => { flush(); setMode('preview'); }}>Preview</button>
        </div>
        <span className="hint">Markdown · saves automatically</span>
      </div>
      {mode === 'edit' ? (
        <textarea
          className="notes-editor"
          value={value}
          onChange={e => change(e.target.value)}
          onBlur={flush}
          placeholder={'Prep notes before, live notes during, impressions after.\n\n## Prep\n- Talking points\n\n## During\n- What they said'}
        />
      ) : (
        value.trim()
          ? <div className="markdown" onClick={() => setMode('edit')} dangerouslySetInnerHTML={{ __html: html }} />
          : <div className="markdown markdown-empty" onClick={() => setMode('edit')}>No notes yet — click to write some.</div>
      )}
    </div>
  );
}

// One Q&A row: the question (click to edit), the answer (autosaving), and
// controls to move or delete it.
function QuestionRow({ interview, question, index, count, onChange, onError }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.question);
  const [answer, changeAnswer, flushAnswer] = useAutosave(question.answer, async (value) => {
    try {
      const updated = await updateInterviewQuestion(interview.id, question.id, { answer: value });
      onChange({ ...interview, questions: interview.questions.map(q => (q.id === question.id ? updated : q)) });
    } catch (err) {
      onError(err.message);
    }
  });
  useEffect(() => { if (!editing) setText(question.question); }, [question.question, editing]);

  const saveQuestion = async () => {
    setEditing(false);
    const next = text.trim();
    if (!next || next === question.question) return;
    try {
      const updated = await updateInterviewQuestion(interview.id, question.id, { question: next });
      onChange({ ...interview, questions: interview.questions.map(q => (q.id === question.id ? updated : q)) });
    } catch (err) {
      onError(err.message);
    }
  };
  const move = async (dir) => {
    const ids = interview.questions.map(q => q.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      const { questions } = await reorderInterviewQuestions(interview.id, ids);
      onChange({ ...interview, questions });
    } catch (err) {
      onError(err.message);
    }
  };
  const remove = async () => {
    try {
      await deleteInterviewQuestion(interview.id, question.id);
      onChange({ ...interview, questions: interview.questions.filter(q => q.id !== question.id) });
    } catch (err) {
      onError(err.message);
    }
  };

  return (
    <li className={`qa-row${question.answer ? ' answered' : ''}`}>
      <div className="qa-question">
        <span className="qa-num">{index + 1}.</span>
        {editing ? (
          <input
            autoFocus
            className="reason-input qa-edit"
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={saveQuestion}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { setText(question.question); setEditing(false); }
            }}
          />
        ) : (
          <button className="qa-text" onClick={() => setEditing(true)} title="Click to edit the question">
            {question.question}
            {question.source === 'claude' && <span className="qa-source" title="Proposed by Claude">✨</span>}
            {question.source === 'company' && <span className="qa-source" title="From the company's question list">🏢</span>}
          </button>
        )}
        <span className="qa-controls">
          <button className="edit-btn" onClick={() => move(-1)} disabled={index === 0} title="Move up">▲</button>
          <button className="edit-btn" onClick={() => move(1)} disabled={index === count - 1} title="Move down">▼</button>
          <button className="delete-btn" onClick={remove} title="Delete this question">✕</button>
        </span>
      </div>
      <textarea
        className="qa-answer"
        placeholder="Their answer…"
        value={answer}
        onChange={e => changeAnswer(e.target.value)}
        onBlur={flushAnswer}
        rows={answer ? undefined : 1}
      />
    </li>
  );
}

const TOPIC_LABELS = { role: 'Role', team: 'Team', company: 'Company', process: 'Process' };

// Claude's proposed questions, each with a checkbox (all ticked to start)
// and its rationale; Add puts the ticked ones on the list.
function Proposal({ proposal, onAdd, onDiscard }) {
  const [picked, setPicked] = useState(() => new Set(proposal.questions.map((_, i) => i)));
  const toggle = (i) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  return (
    <div className="research-preview proposal">
      <div className="research-preview-title">✨ Claude's proposed questions</div>
      <ul className="proposal-list">
        {proposal.questions.map((q, i) => (
          <li key={i}>
            <label className="proposal-item">
              <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
              <span>
                {q.topic && <span className="proposal-topic">{TOPIC_LABELS[q.topic]}</span>}
                <span className="proposal-question">{q.question}</span>
                {q.why && <span className="proposal-why">{q.why}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {proposal.sources.length > 0 && (
        <div className="research-sources">
          Sources:{' '}
          {proposal.sources.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">[{i + 1}]</a>
          ))}
        </div>
      )}
      <div className="research-actions">
        <button className="primary-btn" disabled={!picked.size} onClick={() => onAdd(proposal.questions.filter((_, i) => picked.has(i)).map(q => q.question))}>
          Add {picked.size} question{picked.size === 1 ? '' : 's'}
        </button>
        <button className="clear-btn" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

// The Q&A section: questions to ask, added by hand, from the company's
// list, or proposed by Claude; each with the answer recorded live.
function QuestionsSection({ interview, canGenerate, onChange, onError }) {
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [genError, setGenError] = useState(null);

  useEffect(() => { setProposal(null); setGenError(null); }, [interview.id]);

  const add = async (questions, source = 'user') => {
    try {
      const { questions: all } = await addInterviewQuestions(interview.id, questions, source);
      onChange({ ...interview, questions: all });
    } catch (err) {
      onError(err.message);
    }
  };
  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    setProposal(null);
    try {
      setProposal(await generateInterviewQuestions(interview.id));
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="interview-qa">
      <div className="section-head">
        <span className="review-label">Questions to ask</span>
        {canGenerate && (
          <button className="clear-btn research-btn" onClick={handleGenerate} disabled={generating} title="Have Claude propose questions for this interview, grounded in the posting, the company, and who is attending">
            {generating ? '⏳ Thinking…' : '✨ Generate questions with Claude'}
          </button>
        )}
      </div>
      {generating && <div className="research-progress">Claude is reading the posting and researching {interview.type ? `this ${interview.type.toLowerCase()} interview` : 'this interview'} — usually a minute or so.</div>}
      {genError && <div className="error-banner research-error">{genError}</div>}
      {proposal && (
        <Proposal
          proposal={proposal}
          onAdd={async (questions) => { await add(questions, 'claude'); setProposal(null); }}
          onDiscard={() => setProposal(null)}
        />
      )}
      {interview.questions.length === 0 && !proposal && (
        <div className="hint qa-empty">No questions yet. Add them below, copy them from the company's list above{canGenerate ? ', or let Claude propose some' : ''}.</div>
      )}
      <ol className="qa-list">
        {interview.questions.map((q, i) => (
          <QuestionRow key={q.id} interview={interview} question={q} index={i} count={interview.questions.length} onChange={onChange} onError={onError} />
        ))}
      </ol>
      <form
        className="qa-add"
        onSubmit={e => {
          e.preventDefault();
          const lines = parseQuestions(draft);
          if (!lines.length) return;
          add(lines);
          setDraft('');
        }}
      >
        <input
          className="reason-input"
          placeholder="Add a question and press Enter"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.form.requestSubmit();
            }
          }}
        />
        <button type="submit" className="clear-btn" disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

// The jobs one interview covers: chips (the page's own job can't be
// unlinked from here, nor the last one), plus a picker of the person's other
// jobs that are being interviewed for — same company first — to link
// another opening discussed in the same conversation.
function InterviewJobs({ interview, job, jobs, onChange, onError }) {
  const [adding, setAdding] = useState(false);
  const linked = new Set(interview.jobs.map(j => j.id));
  const candidates = jobs
    .filter(j => !linked.has(j.id) && j.status === 'Interviewing')
    .sort((a, b) => (b.company === job.company) - (a.company === job.company) || a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  const link = async (jobId) => {
    try {
      onChange(await addInterviewJob(interview.id, jobId));
      setAdding(false);
    } catch (err) {
      onError(err.message);
    }
  };
  const unlink = async (jobId) => {
    try {
      onChange(await removeInterviewJob(interview.id, jobId));
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <div className="attendees interview-jobs">
      <span className="review-label">Jobs covered</span>
      <div className="attendee-chips">
        {interview.jobs.map(j => (
          <span key={j.id} className="attendee-chip job-chip" title={`${j.title} at ${j.company} · ${j.status}`}>
            {j.title}<span className="attendee-company"> @ {j.company}</span>
            {j.id !== job.id && interview.jobs.length > 1 && (
              <button className="chip-x attendee-x" onClick={() => unlink(j.id)} title="This interview no longer covers this job" aria-label={`Remove ${j.title}`}>×</button>
            )}
          </span>
        ))}
        {!adding && candidates.length > 0 && (
          <button className="link-btn" onClick={() => setAdding(true)} title="This interview also covers another opening you're interviewing for">+ Add job</button>
        )}
        {adding && (
          <select
            autoFocus
            className="job-picker"
            defaultValue=""
            onChange={e => { if (e.target.value) link(Number(e.target.value)); }}
            onBlur={() => setAdding(false)}
          >
            <option value="">Which job does this interview also cover?</option>
            {candidates.map(j => <option key={j.id} value={j.id}>{j.title} @ {j.company}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

// One interview's panel: type and time, jobs covered, attendees, notes, Q&A.
function InterviewPanel({ interview, job, jobs, types, contacts, companies, canGenerate, onChange, onDelete, onContactsChanged, onError }) {
  const save = async (fields) => {
    try {
      onChange(await updateInterview(interview.id, fields));
    } catch (err) {
      onError(err.message);
    }
  };
  const typeOptions = interview.type && !types.includes(interview.type) ? [...types, interview.type] : types;
  return (
    <div className="company-card interview-panel">
      <div className="interview-panel-head">
        <label>
          Type
          <select value={interview.type} onChange={e => save({ type: e.target.value })}>
            <option value="">—</option>
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          When
          <input type="datetime-local" value={interview.scheduled_at} onChange={e => save({ scheduled_at: e.target.value })} />
        </label>
        <button
          className="clear-btn interview-delete"
          onClick={() => {
            if (window.confirm(`Delete this ${interview.type ? interview.type + ' ' : ''}interview and its notes and questions?`)) onDelete(interview);
          }}
        >
          Delete interview
        </button>
      </div>
      <InterviewJobs interview={interview} job={job} jobs={jobs} onChange={onChange} onError={onError} />
      <Attendees interview={interview} contacts={contacts} job={job} companies={companies} onChange={onChange} onContactsChanged={onContactsChanged} onError={onError} />
      <Notes key={interview.id} interview={interview} onSave={save} />
      <QuestionsSection interview={interview} canGenerate={canGenerate} onChange={onChange} onError={onError} />
    </div>
  );
}

// The Interviews page for one job: a review of the job and the company at
// the top, then the job's interviews (any number — recruiter screen,
// technical, hiring manager, ...) as tabs, with the selected one's
// attendees, Markdown notes and Q&A below. Opened from the 🎤 button on a
// job row; everything saves automatically.
export default function InterviewsPage({ jobId, jobs = [], contacts, companies, canGenerate, onBack, onOpenCompany, onContactsChanged }) {
  const [data, setData] = useState(null); // { job, company, interviews, types }
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchJobInterviews(jobId).then(d => {
      if (cancelled) return;
      setData(d);
      setSelectedId(prev => (d.interviews.some(i => i.id === prev) ? prev : (d.interviews[0]?.id ?? null)));
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [jobId]);

  const types = data?.types?.length ? data.types : INTERVIEW_TYPES;
  const selected = data?.interviews.find(i => i.id === selectedId) ?? null;

  // Which job the review cards at the top describe. Normally the page's own
  // job; when the selected interview covers several, a job switcher above
  // the cards picks among them (the company card follows the job).
  const [reviewJobId, setReviewJobId] = useState(null);
  useEffect(() => { setReviewJobId(null); }, [selectedId]);
  const reviewJob = (reviewJobId != null && selected?.jobs.find(j => j.id === reviewJobId)) || data?.job || null;
  const reviewCompany = !reviewJob || !data ? null
    : reviewJob.company === data.company.name ? data.company
    : companies.find(c => c.name === reviewJob.company)
      || { name: reviewJob.company, website: '', note: '', company_type: '', employee_count: '', ticker: '', gross_revenue: '', interview_questions: '', referrals: '', favorite: 0 };

  const replace = (updated) => {
    setData(d => ({ ...d, interviews: d.interviews.map(i => (i.id === updated.id ? updated : i)) }));
  };
  const handleAdd = async () => {
    try {
      // Default the type to the next step that hasn't happened yet.
      const used = new Set(data.interviews.map(i => i.type));
      const type = types.find(t => t !== 'Other' && !used.has(t)) || '';
      const created = await addInterview(jobId, { type });
      setData(d => ({ ...d, interviews: [...d.interviews, created] }));
      setSelectedId(created.id);
    } catch (err) {
      setError(err.message);
    }
  };
  const handleDelete = async (interview) => {
    try {
      await deleteInterview(interview.id);
      setData(d => {
        const interviews = d.interviews.filter(i => i.id !== interview.id);
        setSelectedId(interviews[0]?.id ?? null);
        return { ...d, interviews };
      });
    } catch (err) {
      setError(err.message);
    }
  };
  const addCompanyQuestion = (q) => {
    if (!selected) return;
    addInterviewQuestions(selected.id, [q], 'company')
      .then(({ questions }) => replace({ ...selected, questions }))
      .catch(err => setError(err.message));
  };

  const companyNames = useMemo(() => companies.map(c => c.name), [companies]);

  return (
    <div className="company-page interviews-page">
      <button className="clear-btn back-btn" onClick={onBack}>← Back to jobs</button>
      {error && <div className="error-banner">{error}</div>}
      {!data ? (
        <div className="hint">Loading…</div>
      ) : (
        <>
          {selected && selected.jobs.length > 1 && (
            <div className="view-switch review-job-switch" role="tablist" aria-label="Job shown">
              {selected.jobs.map(j => (
                <button
                  key={j.id}
                  role="tab"
                  aria-selected={j.id === reviewJob.id}
                  className={j.id === reviewJob.id ? 'active' : ''}
                  onClick={() => setReviewJobId(j.id)}
                  title={`Show the details of ${j.title} at ${j.company}`}
                >
                  {j.title}{j.company !== data.job.company || selected.jobs.some(o => o.title === j.title && o.id !== j.id) ? ` @ ${j.company}` : ''}
                </button>
              ))}
            </div>
          )}
          <JobReview job={reviewJob} company={reviewCompany} onOpenCompany={onOpenCompany} />
          <CompanyReview
            company={reviewCompany}
            onOpenCompany={onOpenCompany}
            existing={selected ? selected.questions.map(q => q.question) : []}
            onAddQuestion={addCompanyQuestion}
          />

          <div className="interview-tabs" role="tablist" aria-label="Interviews">
            {data.interviews.map((i, n) => (
              <button
                key={i.id}
                role="tab"
                aria-selected={i.id === selectedId}
                className={`interview-tab${i.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(i.id)}
              >
                <span className="interview-tab-title">{n + 1}. {i.type || 'Interview'}</span>
                <span className="interview-tab-meta">
                  {formatWhen(i.scheduled_at) || 'unscheduled'}
                  {i.jobs.length > 1 ? ` · ${i.jobs.length} jobs` : ''}
                  {i.attendees.length ? ` · ${i.attendees.map(c => c.name.split(' ')[0]).join(', ')}` : ''}
                </span>
              </button>
            ))}
            <button className="interview-tab interview-tab-add" onClick={handleAdd} title="Add another interview for this job">+ Add interview</button>
          </div>

          {selected ? (
            <InterviewPanel
              interview={selected}
              job={data.job}
              jobs={jobs}
              types={types}
              contacts={contacts}
              companies={companyNames}
              canGenerate={canGenerate}
              onChange={replace}
              onDelete={handleDelete}
              onContactsChanged={onContactsChanged}
              onError={setError}
            />
          ) : (
            <div className="empty-state">No interviews recorded for this job yet — add the first one above.</div>
          )}
        </>
      )}
    </div>
  );
}

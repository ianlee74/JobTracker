import React, { useMemo, useRef, useState } from 'react';
import { STATUSES, LEVELS, REJECTION_REASONS, parseSkills, parseNames } from './constants.js';
import { uploadPosting, researchJob } from './api.js';
import SkillsPicker from './SkillsPicker.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Accepts normal URLs and file:// URLs as-is; converts a pasted Windows path
// (C:\..., or \\server\... UNC) into a file:// URL.
function normalizeUrl(raw) {
  const s = raw.trim();
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    const p = s.replace(/\\/g, '/');
    return encodeURI(p.startsWith('//') ? `file:${p}` : `file:///${p}`).replace(/#/g, '%23');
  }
  return s;
}

// Posting formats the server can read (and Claude can parse) — the same set
// a standard resume may be in.
const POSTING_ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.html,.htm';

const EMPTY = {
  title: '',
  company: '',
  url: '',
  date_found: '',
  category: '',
  level: '',
  salary: '',
  salary_min: '',
  salary_max: '',
  salary_uncertain: false,
  fit: '',
  status: 'new',
  rejection_reason: '',
  rejection_other: '',
  missing_skills: '',
  proposed_salary: '',
  application_notes: '',
  referred_by: '',
  note: ''
};

// Statuses at or past "Applied", where the application details are shown
// even when still empty.
const APPLIED_STATUSES = ['Applied', 'Interviewing', 'Offer'];

function formFromJob(job) {
  const stored = job.rejection_reason || '';
  const isPreset = stored !== 'Other' && REJECTION_REASONS.includes(stored);
  return {
    title: job.title,
    company: job.company,
    url: job.url,
    date_found: job.date_found,
    category: job.category || '',
    level: job.level || '',
    salary: job.salary || '',
    salary_min: job.salary_min ?? '',
    salary_max: job.salary_max ?? '',
    salary_uncertain: job.salary_confidence === 'flag',
    fit: job.fit || '',
    status: job.status,
    rejection_reason: !stored ? '' : isPreset ? stored : 'Other',
    rejection_other: stored && !isPreset ? stored : '',
    missing_skills: job.missing_skills || '',
    proposed_salary: job.proposed_salary ?? '',
    application_notes: job.application_notes || '',
    referred_by: job.referred_by || '',
    note: job.note || ''
  };
}

// What to tell the person once Claude has read the posting: whether the
// fields were filled, what happened with the company, and how sure it was.
function parseNotice(result) {
  const parts = [];
  if (!result.title && !result.company) {
    parts.push(`Claude couldn't find a job posting in that document${result.note ? `: ${result.note}` : '.'}`);
  } else {
    parts.push('Filled in from the posting — check the fields before saving.');
    if (result.company_status === 'created') {
      parts.push(`${result.company} wasn't tracked yet, so it was added as a company and Claude is researching it in the background.`);
    } else if (result.company_status === 'existing') {
      parts.push(`Matched the tracked company ${result.company}.`);
    }
    if (result.confidence === 'low') parts.push('Claude had low confidence in this read.');
  }
  return parts.join(' ');
}

// Shared add/edit form. In edit mode (`job` given) submit sends only the
// changed fields, so untouched values can't clobber concurrent MCP updates.
// `companies` supplies the Referred-by suggestions: everyone who has referred
// the candidate to the typed company's jobs before. `canParse` (the server
// has Anthropic credentials) shows the ✨ Parse button; the offer to parse an
// uploaded posting is driven by the upload response instead.
export function JobForm({ jobs, job, companies = [], knownSkills = [], personId, canParse = false, title, submitLabel, onSubmit, onClose }) {
  const [form, setForm] = useState(() => (job ? formFromJob(job) : { ...EMPTY, date_found: today() }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  // The just-uploaded posting's URL while the "fill in with Claude" offer is
  // open; the offer disappears if the URL is edited.
  const [parseOffer, setParseOffer] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [notice, setNotice] = useState(null);
  const fileInput = useRef(null);

  const categories = useMemo(
    () => [...new Set(jobs.map(j => j.category).filter(Boolean))].sort(),
    [jobs]
  );

  const referralOptions = useMemo(() => {
    const company = companies.find(c => c.name === form.company.trim());
    return parseNames(company?.referrals);
  }, [companies, form.company]);

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Money fields display as $###,### but store bare digits in the form state.
  const formatMoney = (v) => (v === '' ? '' : '$' + Number(v).toLocaleString('en-US'));
  const setMoney = (field) => (e) => {
    const digits = e.target.value.replace(/[^0-9]/g, '');
    setForm(prev => ({ ...prev, [field]: digits }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const fields = {
        title: form.title,
        company: form.company,
        url: normalizeUrl(form.url),
        date_found: form.date_found || today(),
        category: form.category,
        salary: form.salary,
        salary_confidence: form.salary_uncertain ? 'flag' : 'ok',
        fit: form.fit,
        status: form.status,
        note: form.note,
        rejection_reason:
          form.status !== 'Not Moving Forward' ? ''
          : form.rejection_reason === 'Other' ? (form.rejection_other.trim() || 'Other')
          : form.rejection_reason,
        missing_skills:
          form.status === 'Not Moving Forward' && form.rejection_reason === 'Not Qualified'
            ? parseSkills(form.missing_skills).join(', ')
            : '',
        application_notes: form.application_notes,
        referred_by: form.referred_by.trim(),
        // An empty level lets the server auto-classify (add) / keep it (edit).
        ...(form.level ? { level: form.level } : {})
      };
      const proposed = form.proposed_salary === '' ? null : Number(form.proposed_salary);
      if (job) {
        // Send min/max only when actually changed; if only the salary string
        // changed the server re-parses the range from it.
        const min = form.salary_min === '' ? null : Number(form.salary_min);
        const max = form.salary_max === '' ? null : Number(form.salary_max);
        if (min !== (job.salary_min ?? null)) fields.salary_min = min;
        if (max !== (job.salary_max ?? null)) fields.salary_max = max;
        if (proposed !== (job.proposed_salary ?? null)) fields.proposed_salary = proposed;
        for (const k of Object.keys(fields)) {
          if (k in job && fields[k] === (job[k] ?? '')) delete fields[k];
        }
      } else {
        // Omit an empty min/max so the server auto-parses the salary string.
        if (form.salary_min !== '') fields.salary_min = Number(form.salary_min);
        if (form.salary_max !== '') fields.salary_max = Number(form.salary_max);
        if (proposed != null) fields.proposed_salary = proposed;
      }
      await onSubmit(fields);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // A file chosen in the browser's file dialog or dragged in from File
  // Explorer arrives as content without a path (browsers hide real paths), so
  // the server stores a copy under data/postings/ and the job links to that
  // copy's file:// URL. When the server can call Claude, it says so and the
  // form offers to fill itself in from the posting.
  const handleFile = async (file) => {
    setUploading(true);
    setError(null);
    setParseOffer(null);
    setNotice(null);
    try {
      const { url, can_parse } = await uploadPosting(file);
      setForm(prev => ({ ...prev, url }));
      if (can_parse) setParseOffer(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Claude reads the posting and proposes the job fields; each non-empty
  // proposal replaces what the form holds (the person reviews before saving).
  // Nothing about the job is saved, but a company the posting names that
  // isn't tracked yet is added and researched server-side.
  const handleParse = async (url) => {
    setParseOffer(null);
    setParsing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await researchJob(url, personId);
      if (result.title || result.company) {
        setForm(prev => ({
          ...prev,
          title: result.title || prev.title,
          company: result.company || prev.company,
          level: result.level || prev.level,
          category: result.category || prev.category,
          salary: result.salary || prev.salary,
          salary_min: result.salary_min != null ? String(result.salary_min) : prev.salary_min,
          salary_max: result.salary_max != null ? String(result.salary_max) : prev.salary_max,
          salary_uncertain: result.salary_uncertain,
          note: result.note || prev.note
        }));
      }
      setNotice(parseNotice(result));
    } catch (err) {
      setError(err.message);
    } finally {
      setParsing(false);
    }
  };

  // Application details appear once the job is at/past "Applied", and stay
  // visible on any status while something is recorded so it can be edited.
  const showApplied = APPLIED_STATUSES.includes(form.status) || form.proposed_salary !== '' || Boolean(form.application_notes);

  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    }
  };

  const busy = uploading || parsing;

  return (
    <form className="add-job-form" onSubmit={handleSubmit}>
      <div className="form-title">{title}</div>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-grid">
        <label>
          Title *
          <input required value={form.title} onChange={set('title')} placeholder="Staff Software Engineer" />
        </label>
        <label>
          Company *
          <input required value={form.company} onChange={set('company')} placeholder="Acme Corp" />
        </label>
        <label className="span-2">
          Posting URL *
          <div className={`url-row ${dragOver ? 'drag-over' : ''}`} {...dropProps}>
            <input
              required
              value={form.url}
              onChange={set('url')}
              placeholder="https://..., a local file (file://... or C:\...), or drop a file here"
            />
            <button
              type="button"
              className="clear-btn browse-btn"
              onClick={() => {
                fileInput.current.value = ''; // re-selecting the same file still fires change
                fileInput.current.click();
              }}
              disabled={busy}
              title="Pick the posting file with your browser's file dialog — the server keeps a copy"
            >
              {uploading ? 'Uploading…' : 'Choose file…'}
            </button>
            {canParse && (
              <button
                type="button"
                className="clear-btn browse-btn parse-btn"
                onClick={() => handleParse(normalizeUrl(form.url))}
                disabled={busy || !form.url.trim()}
                title="Have Claude read the posting (a stored file or a web page) and fill in the form"
              >
                {parsing ? '⏳ Parsing…' : '✨ Parse'}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              hidden
              accept={POSTING_ACCEPT}
              onChange={e => {
                const file = e.target.files[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        </label>
        {parseOffer && parseOffer === form.url && (
          <div className="parse-offer span-2" role="status">
            <span>Posting uploaded. Have Claude read it and fill in the rest of the form?</span>
            <div className="parse-offer-actions">
              <button type="button" className="primary-btn" onClick={() => handleParse(parseOffer)}>✨ Yes, fill it in</button>
              <button type="button" className="clear-btn" onClick={() => setParseOffer(null)}>No thanks</button>
            </div>
          </div>
        )}
        {parsing && (
          <div className="parse-progress span-2">
            Claude is reading the posting — this usually takes under a minute. A company it names that isn't tracked yet is added and researched in the background.
          </div>
        )}
        {notice && <div className="parse-notice span-2" role="status">{notice}</div>}
        <label>
          Date found
          <input type="date" value={form.date_found} onChange={set('date_found')} />
        </label>
        <label>
          Category
          <input list="category-options" value={form.category} onChange={set('category')} placeholder="AI-assisted dev" />
          <datalist id="category-options">
            {categories.map(c => <option key={c} value={c} />)}
          </datalist>
        </label>
        <label>
          Level
          <select value={form.level} onChange={set('level')}>
            {job
              ? (!form.level && <option value="">—</option>)
              : <option value="">Auto-detect from title</option>}
            {form.level && !LEVELS.includes(form.level) && <option value={form.level}>{form.level}</option>}
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={set('status')}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="salary-listed-cell">
          <label>
            Salary (as listed)
            <input value={form.salary} onChange={set('salary')} placeholder="$200,000 - $250,000" />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.salary_uncertain} onChange={set('salary_uncertain')} />
            Salary uncertain / not disclosed
          </label>
        </div>
        <label>
          Salary min / max
          <div className="salary-range-row">
            <input inputMode="numeric" value={formatMoney(form.salary_min)} onChange={setMoney('salary_min')} placeholder="Auto" />
            <input inputMode="numeric" value={formatMoney(form.salary_max)} onChange={setMoney('salary_max')} placeholder="Auto" />
          </div>
        </label>
        <label>
          Referred by
          <input
            list="referral-options"
            value={form.referred_by}
            onChange={set('referred_by')}
            placeholder={referralOptions.length ? 'Pick a past referral or type a name' : 'Who referred you, if anyone'}
            title="Who referred you to this job. A new name is remembered for this company's other jobs."
          />
          <datalist id="referral-options">
            {referralOptions.map(n => <option key={n} value={n} />)}
          </datalist>
        </label>
        {form.status === 'Not Moving Forward' && (
          <label>
            Why not moving forward
            <select value={form.rejection_reason} onChange={set('rejection_reason')}>
              <option value="">—</option>
              {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {form.status === 'Not Moving Forward' && form.rejection_reason === 'Other' && (
          <label className="span-2">
            Other reason
            <input value={form.rejection_other} onChange={set('rejection_other')} placeholder="Enter a reason..." />
          </label>
        )}
        {form.status === 'Not Moving Forward' && form.rejection_reason === 'Not Qualified' && (
          <label className="span-2">
            Missing skills
            <SkillsPicker
              value={form.missing_skills}
              knownSkills={knownSkills}
              placeholder="Comma separated, e.g. Kubernetes, Go"
              onChange={value => setForm(prev => ({ ...prev, missing_skills: value }))}
            />
          </label>
        )}
        {showApplied && (
          <label>
            Proposed salary
            <input
              inputMode="numeric"
              value={formatMoney(form.proposed_salary)}
              onChange={setMoney('proposed_salary')}
              placeholder="Minimum you asked for, if the application asked"
            />
          </label>
        )}
        {showApplied && (
          <label className="span-2">
            Application notes
            <textarea
              value={form.application_notes}
              onChange={set('application_notes')}
              placeholder="Anything about the application worth remembering in an interview"
            />
          </label>
        )}
        <label className="span-2">
          Why it fits
          <input value={form.fit} onChange={set('fit')} placeholder="Optional — why this role is a match" />
        </label>
        <label className="span-2">
          Note
          <input value={form.note} onChange={set('note')} placeholder="Optional" />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-btn" disabled={saving || busy}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="clear-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// The "Add a job" page: replaces the job list (like a company page) until the
// job is added or the form is cancelled.
export default function AddJobPage({ jobs, companies, knownSkills, personId, canParse, onAdd, onClose }) {
  return (
    <div className="company-page add-job-page">
      <button className="clear-btn back-btn" onClick={onClose}>← Back to jobs</button>
      <JobForm
        jobs={jobs}
        companies={companies}
        knownSkills={knownSkills}
        personId={personId}
        canParse={canParse}
        title="Add a job"
        submitLabel="Add job"
        onSubmit={onAdd}
        onClose={onClose}
      />
    </div>
  );
}

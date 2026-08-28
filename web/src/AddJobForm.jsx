import React, { useMemo, useState } from 'react';
import { STATUSES, LEVELS, REJECTION_REASONS } from './constants.js';
import { uploadPosting } from './api.js';
import FilePicker from './FilePicker.jsx';

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
  note: ''
};

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
    note: job.note || ''
  };
}

// Shared add/edit form. In edit mode (`job` given) submit sends only the
// changed fields, so untouched values can't clobber concurrent MCP updates.
export function JobForm({ jobs, job, title, submitLabel, onSubmit, onClose }) {
  const [form, setForm] = useState(() => (job ? formFromJob(job) : { ...EMPTY, date_found: today() }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);

  const categories = useMemo(
    () => [...new Set(jobs.map(j => j.category).filter(Boolean))].sort(),
    [jobs]
  );

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
        // An empty level lets the server auto-classify (add) / keep it (edit).
        ...(form.level ? { level: form.level } : {})
      };
      if (job) {
        // Send min/max only when actually changed; if only the salary string
        // changed the server re-parses the range from it.
        const min = form.salary_min === '' ? null : Number(form.salary_min);
        const max = form.salary_max === '' ? null : Number(form.salary_max);
        if (min !== (job.salary_min ?? null)) fields.salary_min = min;
        if (max !== (job.salary_max ?? null)) fields.salary_max = max;
        for (const k of Object.keys(fields)) {
          if (k in job && fields[k] === (job[k] ?? '')) delete fields[k];
        }
      } else {
        // Omit an empty min/max so the server auto-parses the salary string.
        if (form.salary_min !== '') fields.salary_min = Number(form.salary_min);
        if (form.salary_max !== '') fields.salary_max = Number(form.salary_max);
      }
      await onSubmit(fields);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // A file dragged in from File Explorer arrives as content without a path
  // (browsers hide real paths), so the server stores a copy under
  // data/postings/ and the job links to that copy's file:// URL.
  const handleDroppedFile = async (file) => {
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadPosting(file);
      setForm(prev => ({ ...prev, url }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setPickerOpen(false);
    }
  };

  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: () => setDragOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleDroppedFile(file);
    }
  };

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
            <button type="button" className="clear-btn browse-btn" onClick={() => setPickerOpen(true)} disabled={uploading} title="Pick a local file">
              {uploading ? 'Uploading…' : 'Browse…'}
            </button>
          </div>
        </label>
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
        <button type="submit" className="primary-btn" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="clear-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {pickerOpen && (
        <FilePicker
          onClose={() => setPickerOpen(false)}
          onPick={(p) => {
            setForm(prev => ({ ...prev, url: normalizeUrl(p) }));
            setPickerOpen(false);
          }}
          onDropFile={handleDroppedFile}
        />
      )}
    </form>
  );
}

export default function AddJobForm({ jobs, onAdd }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="add-job-btn" onClick={() => setOpen(true)}>
        + Add job
      </button>
    );
  }
  return (
    <JobForm
      jobs={jobs}
      title="Add a job"
      submitLabel="Add job"
      onSubmit={onAdd}
      onClose={() => setOpen(false)}
    />
  );
}

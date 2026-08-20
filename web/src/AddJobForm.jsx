import React, { useMemo, useState } from 'react';
import { STATUSES, LEVELS } from './constants.js';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  title: '',
  company: '',
  url: '',
  date_found: today(),
  category: '',
  level: '',
  salary: '',
  salary_uncertain: false,
  fit: '',
  status: 'new',
  note: ''
};

export default function AddJobForm({ jobs, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const categories = useMemo(
    () => [...new Set(jobs.map(j => j.category).filter(Boolean))].sort(),
    [jobs]
  );

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { salary_uncertain, level, ...rest } = form;
      await onAdd({
        ...rest,
        // Omit an empty level so the server auto-classifies it from the title.
        ...(level ? { level } : {}),
        date_found: form.date_found || today(),
        salary_confidence: salary_uncertain ? 'flag' : 'ok'
      });
      setForm({ ...EMPTY, date_found: today() });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button className="add-job-btn" onClick={() => setOpen(true)}>
        + Add job
      </button>
    );
  }

  return (
    <form className="add-job-form" onSubmit={handleSubmit}>
      <div className="form-title">Add a job</div>
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
          <input required type="url" value={form.url} onChange={set('url')} placeholder="https://..." />
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
            <option value="">Auto-detect from title</option>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>
          Salary
          <input value={form.salary} onChange={set('salary')} placeholder="$200,000 - $250,000" />
        </label>
        <label>
          Status
          <select value={form.status} onChange={set('status')}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="span-2">
          Why it fits
          <input value={form.fit} onChange={set('fit')} placeholder="Optional — why this role is a match" />
        </label>
        <label className="span-2">
          Note
          <input value={form.note} onChange={set('note')} placeholder="Optional" />
        </label>
        <label className="checkbox-label span-2">
          <input type="checkbox" checked={form.salary_uncertain} onChange={set('salary_uncertain')} />
          Salary uncertain / not disclosed
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-btn" disabled={saving}>
          {saving ? 'Adding…' : 'Add job'}
        </button>
        <button type="button" className="clear-btn" onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

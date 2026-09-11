import React, { useMemo, useState } from 'react';
import { COMPANY_TYPES, EMPLOYEE_COUNTS, tickerHref } from './constants.js';

const EMPTY_FORM = { name: '', website: '', ticker: '', company_type: '', employee_count: '', gross_revenue: '' };

// Modal for adding a company that has no tracked jobs yet, so it can be
// browsed and researched first. Only the name is required; everything else
// can be filled in (or researched) on the company page afterwards.
function AddCompanyForm({ companies, onSubmit, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const name = form.name.trim();
  const duplicate = name && companies.find(c => c.name.toLowerCase() === name.toLowerCase());

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || duplicate) return;
    setSaving(true);
    setError(null);
    try {
      const fields = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await onSubmit({ ...fields, name });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="add-job-form company-form" onSubmit={handleSubmit}>
        <div className="form-title">Add company</div>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <label className="span-2">
            Name *
            <input autoFocus required value={form.name} onChange={set('name')} placeholder="Acme Corp" />
            {duplicate
              ? <span className="settings-hint settings-warn">“{duplicate.name}” is already tracked.</span>
              : <span className="settings-hint">Spell it the way its job postings will — jobs are matched to companies by name.</span>}
          </label>
          <label className="span-2">
            Website
            <input value={form.website} onChange={set('website')} placeholder="https://..." />
          </label>
          <label>
            Company Type
            <select value={form.company_type} onChange={set('company_type')}>
              <option value="">Unknown</option>
              {COMPANY_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label>
            Employee Count
            <select value={form.employee_count} onChange={set('employee_count')}>
              <option value="">Unknown</option>
              {EMPLOYEE_COUNTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label>
            Ticker Symbol
            <input value={form.ticker} onChange={set('ticker')} placeholder="MSFT (if publicly traded)" />
          </label>
          <label>
            Gross Revenue
            <input value={form.gross_revenue} onChange={set('gross_revenue')} placeholder="$245.1B (FY2024)" />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={saving || !name || Boolean(duplicate)}>
            {saving ? 'Adding…' : 'Add company'}
          </button>
          <button type="button" className="clear-btn" onClick={onClose}>Cancel</button>
          <span className="hint">Opens the company's page, where ✨ Research with Claude can fill in the rest.</span>
        </div>
      </form>
    </div>
  );
}

function SortableHeader({ label, sortKey, sort, onSort, width, title }) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th style={{ width }} className="sortable" onClick={() => onSort(sortKey)} title={title || `Sort by ${label}`}>
      {label}{arrow}
    </th>
  );
}

const COMPARATORS = {
  name: (a, b) => a.name.localeCompare(b.name),
  company_type: (a, b) => (a.company_type || '').localeCompare(b.company_type || ''),
  employee_count: (a, b) => EMPLOYEE_COUNTS.indexOf(a.employee_count) - EMPLOYEE_COUNTS.indexOf(b.employee_count),
  ticker: (a, b) => (a.ticker || '').localeCompare(b.ticker || ''),
  gross_revenue: (a, b) => (a.gross_revenue || '').localeCompare(b.gross_revenue || ''),
  jobs: (a, b) => a.jobs - b.jobs
};

// Browse every company — those with tracked jobs and those added directly —
// without going through a job. Click a name to open its page; the star and
// the filter work in place. `jobs` is the selected person's job list, for
// the per-company count.
export default function CompaniesPage({ companies, jobs, isAdmin = true, onOpenCompany, onAdd, onSave }) {
  const [filter, setFilter] = useState('');
  const [hideNotInterested, setHideNotInterested] = useState(false);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [adding, setAdding] = useState(false);

  const jobCounts = useMemo(() => {
    const counts = new Map();
    for (const job of jobs) counts.set(job.company, (counts.get(job.company) || 0) + 1);
    return counts;
  }, [jobs]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = companies
      .map(c => ({ ...c, jobs: jobCounts.get(c.name) || 0 }))
      .filter(c => !(hideNotInterested && c.not_interested))
      .filter(c => !q || [c.name, c.company_type, c.employee_count, c.ticker, c.gross_revenue, c.website, c.note]
        .some(v => (v || '').toLowerCase().includes(q)));
    const cmp = COMPARATORS[sort.key] || COMPARATORS.name;
    return list.sort((a, b) => {
      const result = sort.dir === 'asc' ? cmp(a, b) : cmp(b, a);
      // Favorites win ties, then name.
      return result || (b.favorite - a.favorite) || a.name.localeCompare(b.name);
    });
  }, [companies, jobCounts, filter, hideNotInterested, sort]);

  const handleSort = (key) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'jobs' ? 'desc' : 'asc' }
    );
  };

  const filtersActive = Boolean(filter.trim()) || hideNotInterested;

  return (
    <div className="companies-page">
      <div className="controls">
        <input
          type="text"
          placeholder="Filter by name, type, ticker..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <label className="checkbox-label toggle-label" title="Leave out companies marked Not Interested">
          <input type="checkbox" checked={hideNotInterested} onChange={e => setHideNotInterested(e.target.checked)} />
          Hide not interested
        </label>
        {filtersActive && (
          <button className="clear-btn" onClick={() => { setFilter(''); setHideNotInterested(false); }}>Clear filters</button>
        )}
        <span className="hint">
          {filtersActive ? `${rows.length} of ${companies.length} shown` : `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`}
          {' · '}Click a name to open its page.
        </span>
        {isAdmin && (
          <button className="add-job-btn add-company-btn" onClick={() => setAdding(true)}>+ Add company</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="companies-table">
          <thead>
            <tr>
              <th style={{ width: '4%' }} title="Favorite — its jobs are listed first">★</th>
              <SortableHeader label="Company" sortKey="name" sort={sort} onSort={handleSort} width="24%" />
              <SortableHeader label="Type" sortKey="company_type" sort={sort} onSort={handleSort} width="15%" />
              <SortableHeader label="Employees" sortKey="employee_count" sort={sort} onSort={handleSort} width="11%" />
              <SortableHeader label="Ticker" sortKey="ticker" sort={sort} onSort={handleSort} width="9%" />
              <SortableHeader label="Revenue" sortKey="gross_revenue" sort={sort} onSort={handleSort} width="14%" />
              <th style={{ width: '16%' }}>Website</th>
              <SortableHeader label="Jobs" sortKey="jobs" sort={sort} onSort={handleSort} width="7%" title="Tracked jobs for the selected person" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="companies-empty">{companies.length ? 'No companies match the filter.' : 'No companies yet — add a job or a company to get started.'}</td></tr>
            )}
            {rows.map(c => (
              <tr key={c.name} className={c.not_interested ? 'company-row-ni' : ''}>
                <td>
                  <button
                    className={`fav-toggle fav-toggle-sm${c.favorite ? ' is-favorite' : ''}`}
                    onClick={() => onSave(c.name, { favorite: !c.favorite })}
                    title={c.favorite ? 'Remove from favorites' : 'Mark as favorite — its jobs are listed first'}
                    aria-label={c.favorite ? 'Remove from favorites' : 'Mark as favorite'}
                  >
                    {c.favorite ? '★' : '☆'}
                  </button>
                </td>
                <td className="cell-company">
                  <button className="company-link" onClick={() => onOpenCompany(c.name)} title="Open company page">{c.name}</button>
                  {Boolean(c.not_interested) && <span className="ni-badge" title="Company marked Not Interested">🚫</span>}
                </td>
                <td>{c.company_type || <span className="muted">—</span>}</td>
                <td>{c.employee_count || <span className="muted">—</span>}</td>
                <td>
                  {c.ticker
                    ? <a className="ticker-link" href={tickerHref(c.ticker)} target="_blank" rel="noopener noreferrer" title="Open on Fidelity research">{c.ticker}</a>
                    : <span className="muted">—</span>}
                </td>
                <td>{c.gross_revenue || <span className="muted">—</span>}</td>
                <td className="cell-website">
                  {c.website
                    ? <a href={c.website} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>
                    : <span className="muted">—</span>}
                </td>
                <td>{c.jobs || <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddCompanyForm
          companies={companies}
          onSubmit={async (fields) => { await onAdd(fields); setAdding(false); }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

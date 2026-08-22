import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJobs, fetchStats, addJob, updateJob, deleteJob } from './api.js';
import { STATUSES, STATUS_COLORS, LEVELS } from './constants.js';
import JobTable from './JobTable.jsx';
import AddJobForm, { JobForm } from './AddJobForm.jsx';

const todayStr = () => new Date().toISOString().slice(0, 10);

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Numeric value for sorting: the parsed range when the server extracted one,
// else a best-effort scrape of strings like "$275,000 - $375,000".
function salaryValue(job) {
  if (job.salary_max != null || job.salary_min != null) return job.salary_max ?? job.salary_min;
  const nums = (job.salary || '').match(/\$[\d,]+/g);
  if (!nums) return -1;
  return Math.max(...nums.map(n => Number(n.replace(/[$,]/g, ''))));
}

const COMPARATORS = {
  date_found: (a, b) => a.date_found.localeCompare(b.date_found),
  title: (a, b) => a.title.localeCompare(b.title),
  company: (a, b) => a.company.localeCompare(b.company),
  category: (a, b) => (a.category || '').localeCompare(b.category || ''),
  salary: (a, b) => salaryValue(a) - salaryValue(b),
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
  level: (a, b) => {
    const ia = LEVELS.indexOf(a.level);
    const ib = LEVELS.indexOf(b.level);
    // Known levels in ladder order; unknown custom values after, alphabetically.
    if (ia === -1 && ib === -1) return (a.level || '').localeCompare(b.level || '');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
};

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('any'); // any | today | 7d | 30d | day
  const [customDate, setCustomDate] = useState(todayStr());
  const [sort, setSort] = useState({ key: 'date_found', dir: 'desc' });
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingJob, setEditingJob] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [jobsData, statsData] = await Promise.all([fetchJobs(), fetchStats()]);
      setJobs(jobsData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Pick up changes made through the MCP server while the page is open.
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleAdd = async (job) => {
    const result = await addJob(job);
    if (result.added === 0) {
      throw new Error('That posting URL is already tracked.');
    }
    await refresh();
    flashSaved();
  };

  const handleUpdate = async (id, fields) => {
    try {
      const updated = await updateJob(id, fields);
      setJobs(prev => prev.map(j => (j.id === id ? updated : j)));
      setStats(await fetchStats());
      flashSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  // Save from the edit form; receives only the changed fields (may be none).
  // Errors propagate so the form can display them next to the inputs.
  const handleEditSave = async (fields) => {
    if (!Object.keys(fields).length) return;
    const updated = await updateJob(editingJob.id, fields);
    setJobs(prev => prev.map(j => (j.id === editingJob.id ? updated : j)));
    setStats(await fetchStats());
    flashSaved();
  };

  const handleDelete = async (id) => {
    try {
      await deleteJob(id);
      setJobs(prev => prev.filter(j => j.id !== id));
      setStats(await fetchStats());
      flashSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSort = (key) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date_found' ? 'desc' : 'asc' }
    );
  };

  const visibleJobs = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    const dateMin =
      dateFilter === 'today' ? todayStr()
      : dateFilter === '7d' ? daysAgoStr(7)
      : dateFilter === '30d' ? daysAgoStr(30)
      : null;

    const filtered = jobs.filter(job => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (levelFilter && job.level !== levelFilter) return false;
      if (dateFilter === 'day' && job.date_found !== customDate) return false;
      if (dateMin && job.date_found < dateMin) return false;
      if (!text) return true;
      return [job.title, job.company, job.category, job.fit, job.note, job.salary, job.rejection_reason]
        .some(v => (v || '').toLowerCase().includes(text));
    });

    const cmp = COMPARATORS[sort.key] || COMPARATORS.date_found;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const result = cmp(a, b) * sign;
      // Stable, sensible tie-break: newest first, then company.
      return result || b.date_found.localeCompare(a.date_found) || a.company.localeCompare(b.company);
    });
  }, [jobs, statusFilter, levelFilter, textFilter, dateFilter, customDate, sort]);

  // Ladder-ordered levels present in the data, plus any custom values.
  const levelOptions = useMemo(() => {
    const present = new Set(jobs.map(j => j.level).filter(Boolean));
    return [...LEVELS.filter(l => present.has(l)), ...[...present].filter(l => !LEVELS.includes(l)).sort()];
  }, [jobs]);

  const filtersActive = statusFilter || levelFilter || textFilter || dateFilter !== 'any';

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Job Search Tracker</h1>
          <div className="subtitle">
            {stats ? `${stats.total} total suggestions` : 'Loading…'}
            {stats?.lastFound ? ` · latest found: ${stats.lastFound}` : ''}
          </div>
        </div>
        <div className="header-right">
          <div className={`saved-flash ${savedFlash ? 'visible' : ''}`}>✓ Saved</div>
          <AddJobForm jobs={jobs} onAdd={handleAdd} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {stats && (
        <div className="tiles">
          {STATUSES.map(s => (
            <button
              key={s}
              className={`tile ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              title={`Filter to ${s}`}
            >
              <div className="tile-num" style={{ color: STATUS_COLORS[s] }}>{stats.byStatus[s] ?? 0}</div>
              <div className="tile-label">{s}</div>
            </button>
          ))}
        </div>
      )}

      <div className="controls">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} title="Filter by seniority level">
          <option value="">All levels</option>
          {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} title="Filter by date found">
          <option value="any">Found: any time</option>
          <option value="today">Found today</option>
          <option value="7d">Found in last 7 days</option>
          <option value="30d">Found in last 30 days</option>
          <option value="day">Found on day…</option>
        </select>
        {dateFilter === 'day' && (
          <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} />
        )}
        <input
          type="text"
          placeholder="Filter by company, title, category..."
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        {filtersActive && (
          <button
            className="clear-btn"
            onClick={() => { setStatusFilter(''); setLevelFilter(''); setTextFilter(''); setDateFilter('any'); }}
          >
            Clear filters
          </button>
        )}
        <span className="hint">
          {filtersActive ? `${visibleJobs.length} of ${jobs.length} shown · ` : ''}Changes save automatically.
        </span>
      </div>

      <JobTable
        jobs={visibleJobs}
        sort={sort}
        onSort={handleSort}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onEdit={setEditingJob}
      />

      {editingJob && (
        <div
          className="modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setEditingJob(null); }}
        >
          <JobForm
            jobs={jobs}
            job={editingJob}
            title={`Edit: ${editingJob.title}`}
            submitLabel="Save changes"
            onSubmit={handleEditSave}
            onClose={() => setEditingJob(null)}
          />
        </div>
      )}
    </div>
  );
}

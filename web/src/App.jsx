import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJobs, fetchStats, updateJob, deleteJob } from './api.js';
import { STATUSES, STATUS_COLORS } from './constants.js';
import JobTable from './JobTable.jsx';

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [textFilter, setTextFilter] = useState('');
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

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

  const visibleJobs = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    return jobs.filter(job => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (!text) return true;
      return [job.title, job.company, job.category, job.fit, job.note, job.salary]
        .some(v => (v || '').toLowerCase().includes(text));
    });
  }, [jobs, statusFilter, textFilter]);

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
        <div className={`saved-flash ${savedFlash ? 'visible' : ''}`}>✓ Saved</div>
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
        <input
          type="text"
          placeholder="Filter by company, title, category..."
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        {(statusFilter || textFilter) && (
          <button className="clear-btn" onClick={() => { setStatusFilter(''); setTextFilter(''); }}>
            Clear filters
          </button>
        )}
        <span className="hint">Changes save automatically.</span>
      </div>

      <JobTable jobs={visibleJobs} onUpdate={handleUpdate} onDelete={handleDelete} />
    </div>
  );
}

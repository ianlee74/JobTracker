import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJobs, fetchStats, fetchCompanies, fetchPeople, addPerson, addJob, updateJob, deleteJob, updateCompany, generateDocuments } from './api.js';
import { STATUSES, STATUS_COLORS, LEVELS } from './constants.js';
import JobTable from './JobTable.jsx';
import AddJobForm, { JobForm } from './AddJobForm.jsx';
import CompanyPage from './CompanyPage.jsx';
import SettingsDialog from './SettingsDialog.jsx';
import { syncResumeFromLink } from './resumeLink.js';

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

const FILTERS_STORAGE_KEY = 'jobtracker.viewFilters';
const PERSON_STORAGE_KEY = 'jobtracker.person';

const DEFAULT_FILTERS = {
  statusFilters: [],
  levelFilter: '',
  textFilter: '',
  dateFilter: 'any',
  customDate: null, // null = today at load time
  showNotInterested: false,
  sort: { key: 'date_found', dir: 'desc' }
};

// Saved view state from a previous session, sanitized against stale or
// hand-edited values so a bad localStorage entry can't break the UI.
function loadSavedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) || '{}');
    return {
      statusFilters: Array.isArray(saved.statusFilters)
        ? saved.statusFilters.filter(s => STATUSES.includes(s))
        : [],
      levelFilter: typeof saved.levelFilter === 'string' ? saved.levelFilter : '',
      textFilter: typeof saved.textFilter === 'string' ? saved.textFilter : '',
      dateFilter: ['any', 'today', '7d', '30d', 'day'].includes(saved.dateFilter) ? saved.dateFilter : 'any',
      customDate: /^\d{4}-\d{2}-\d{2}$/.test(saved.customDate || '') ? saved.customDate : null,
      showNotInterested: saved.showNotInterested === true,
      sort: COMPARATORS[saved.sort?.key]
        ? { key: saved.sort.key, dir: saved.sort.dir === 'asc' ? 'asc' : 'desc' }
        : DEFAULT_FILTERS.sort
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

const DATE_FILTER_LABELS = {
  today: 'Found today',
  '7d': 'Found in last 7 days',
  '30d': 'Found in last 30 days'
};

// Removable tag for one active filter, shown in the bar next to the Filters button.
function FilterChip({ onRemove, title, children }) {
  return (
    <button type="button" className="filter-chip" onClick={onRemove} title={title || 'Remove this filter'}>
      {children}
      <span className="chip-x">×</span>
    </button>
  );
}

// Flyout panel holding every filter control; the bar itself only shows chips.
function FilterFlyout({
  statusFilters, onToggleStatus,
  levelFilter, setLevelFilter, levelOptions,
  dateFilter, setDateFilter, customDate, setCustomDate,
  showNotInterested, setShowNotInterested,
  activeCount
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="filter-flyout" ref={wrapRef}>
      <button
        type="button"
        className={`multi-select-btn ${activeCount ? 'has-selection' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        Filters{activeCount ? ` (${activeCount})` : ''} <span className="multi-select-caret">▾</span>
      </button>
      {open && (
        <div className="filter-panel">
          <div className="filter-section">
            <div className="filter-section-title">Status</div>
            <div className="filter-status-grid">
              {STATUSES.map(s => (
                <label key={s} className="multi-select-option">
                  <input
                    type="checkbox"
                    checked={statusFilters.includes(s)}
                    onChange={() => onToggleStatus(s)}
                  />
                  <span className="multi-select-dot" style={{ background: STATUS_COLORS[s] }} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div className="filter-section">
            <div className="filter-section-title">Level</div>
            <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
              <option value="">All levels</option>
              {levelOptions.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="filter-section">
            <div className="filter-section-title">Date found</div>
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
              <option value="any">Any time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="day">On day…</option>
            </select>
            {dateFilter === 'day' && (
              <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} />
            )}
          </div>
          <label className="checkbox-label toggle-label" title="Include jobs from companies marked Not Interested">
            <input
              type="checkbox"
              checked={showNotInterested}
              onChange={e => setShowNotInterested(e.target.checked)}
            />
            Show companies not interested in.
          </label>
        </div>
      )}
    </div>
  );
}

// Small modal for adding a candidate to track jobs for; their resume and
// documents folder are configured afterwards in Settings.
function AddPersonForm({ onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim());
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
      <form className="add-job-form person-form" onSubmit={handleSubmit}>
        <div className="form-title">Add person</div>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Who to track jobs for"
            />
            <span className="settings-hint">
              Each person has their own job list, standard resume, and documents folder (set in Settings ⚙ once they're selected).
            </span>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-btn" disabled={saving || !name.trim()}>
            {saving ? 'Adding…' : 'Add person'}
          </button>
          <button type="button" className="clear-btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [people, setPeople] = useState([]);
  // The selected candidate; everything below (jobs, tiles, settings) is scoped
  // to them. null until the people list first loads.
  const [personId, setPersonId] = useState(() => {
    const saved = Number(localStorage.getItem(PERSON_STORAGE_KEY));
    return Number.isInteger(saved) && saved > 0 ? saved : null;
  });
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [activeCompany, setActiveCompany] = useState(null);
  const [savedFilters] = useState(loadSavedFilters);
  const [showNotInterested, setShowNotInterested] = useState(savedFilters.showNotInterested);
  const [statusFilters, setStatusFilters] = useState(savedFilters.statusFilters); // empty = all statuses
  const [levelFilter, setLevelFilter] = useState(savedFilters.levelFilter);
  const [textFilter, setTextFilter] = useState(savedFilters.textFilter);
  const [dateFilter, setDateFilter] = useState(savedFilters.dateFilter); // any | today | 7d | 30d | day
  const [customDate, setCustomDate] = useState(savedFilters.customDate ?? todayStr());
  const [sort, setSort] = useState(savedFilters.sort);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatingIds, setGeneratingIds] = useState(new Set()); // jobs with a generation in flight
  const [batchProgress, setBatchProgress] = useState(null); // { done, total } while a batch runs

  const refresh = useCallback(async () => {
    try {
      const peopleData = await fetchPeople();
      setPeople(peopleData);
      // Keep the selection valid: fall back to the first person when the saved
      // selection is gone (or this is the first load).
      let pid = personId;
      if (!peopleData.some(p => p.id === pid)) {
        pid = peopleData[0]?.id ?? null;
        setPersonId(pid);
      }
      const [jobsData, statsData, companiesData] = await Promise.all([fetchJobs(pid), fetchStats(pid), fetchCompanies()]);
      setJobs(jobsData);
      setStats(statsData);
      setCompanies(companiesData);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [personId]);

  useEffect(() => {
    refresh();
    // Pick up changes made through the MCP server while the page is open.
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    try {
      if (personId != null) localStorage.setItem(PERSON_STORAGE_KEY, String(personId));
    } catch { /* storage blocked — the selection just won't persist */ }
  }, [personId]);

  // Persist the view (filters + sort) so it survives refreshes and restarts.
  useEffect(() => {
    try {
      localStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({ statusFilters, levelFilter, textFilter, dateFilter, customDate, showNotInterested, sort })
      );
    } catch { /* storage full or blocked — the view just won't persist */ }
  }, [statusFilters, levelFilter, textFilter, dateFilter, customDate, showNotInterested, sort]);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const handleAdd = async (job) => {
    const result = await addJob({ ...job, person_id: personId });
    if (result.added === 0) {
      throw new Error('That posting URL is already tracked.');
    }
    await refresh();
    flashSaved();
  };

  const handleAddPerson = async (name) => {
    const person = await addPerson(name);
    setAddPersonOpen(false);
    setPersonId(person.id); // triggers a refresh scoped to the new person
    flashSaved();
  };

  const handleSelectPerson = (value) => {
    if (value === '__add__') setAddPersonOpen(true);
    else setPersonId(Number(value));
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

  // Tailored resume + cover letter for one job via the server's Anthropic API
  // call. skipExisting is used by the batch so a re-run only fills gaps.
  const handleGenerate = async (job, { skipExisting = false } = {}) => {
    setGeneratingIds(prev => new Set(prev).add(job.id));
    try {
      const result = await generateDocuments(job.id, { skip_existing: skipExisting });
      if (result.documents?.length) {
        const kinds = result.documents.map(d => d.kind).join(',');
        setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, doc_kinds: kinds } : j)));
        flashSaved();
      }
      return result;
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  // Re-sync the resume snapshot from the user's original file (when this
  // browser holds a link to it) so generation never uses stale content.
  // Failures don't block generation — the stored snapshot is still usable.
  const refreshResume = async () => {
    try {
      const result = await syncResumeFromLink({ personId, interactive: true });
      if (result === 'unreadable') {
        setError('Couldn\'t re-read your original resume (moved or deleted?) — generating from the last stored copy.');
      } else if (result === 'permission') {
        setError('The browser wasn\'t allowed to re-read your original resume — generating from the last stored copy. Use Settings → Refresh to re-grant access.');
      }
    } catch { /* sync is best-effort */ }
  };

  const handleGenerateOne = async (job) => {
    setError(null);
    await refreshResume();
    try {
      await handleGenerate(job);
    } catch (err) {
      setError(`${job.title} (${job.company}): ${err.message}`);
    }
  };

  // Batch over every Interested job, one request at a time so each HTTP call
  // stays short-ish and progress is visible. Failures don't stop the run.
  const handleGenerateInterested = async () => {
    const targets = jobs.filter(j => j.status === 'Interested' && !flaggedCompanies.has(j.company));
    if (!targets.length) return;
    const withDocs = targets.filter(t => (t.doc_kinds || '').includes('resume')).length;
    const ok = window.confirm(
      `Generate a tailored resume & cover letter for ${targets.length} Interested job${targets.length === 1 ? '' : 's'}?` +
      (withDocs ? `\n\n${withDocs} already have documents and will be skipped.` : '') +
      '\n\nThis calls the Anthropic API and takes a few minutes per job.'
    );
    if (!ok) return;
    setError(null);
    await refreshResume();
    setBatchProgress({ done: 0, total: targets.length });
    const failures = [];
    for (const [i, job] of targets.entries()) {
      try {
        await handleGenerate(job, { skipExisting: true });
      } catch (err) {
        failures.push(`${job.title} (${job.company}): ${err.message}`);
      }
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchProgress(null);
    if (failures.length) setError(`Generation failed for ${failures.length} job(s) — ${failures.join(' · ')}`);
  };

  const handleCompanySave = async (name, fields) => {
    try {
      const updated = await updateCompany(name, fields);
      setCompanies(prev =>
        prev.some(c => c.name === name)
          ? prev.map(c => (c.name === name ? { ...c, ...updated } : c))
          : [...prev, updated]
      );
      flashSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleStatus = (s) => {
    setStatusFilters(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSort = (key) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date_found' ? 'desc' : 'asc' }
    );
  };

  // Companies flagged "Not Interested" — their jobs are hidden by default.
  const flaggedCompanies = useMemo(
    () => new Set(companies.filter(c => c.not_interested).map(c => c.name)),
    [companies]
  );

  // Favorite companies — their jobs win ties within the chosen sort order.
  const favoriteCompanies = useMemo(
    () => new Set(companies.filter(c => c.favorite).map(c => c.name)),
    [companies]
  );

  const visibleJobs = useMemo(() => {
    const text = textFilter.trim().toLowerCase();
    const dateMin =
      dateFilter === 'today' ? todayStr()
      : dateFilter === '7d' ? daysAgoStr(7)
      : dateFilter === '30d' ? daysAgoStr(30)
      : null;

    const filtered = jobs.filter(job => {
      if (!showNotInterested && flaggedCompanies.has(job.company)) return false;
      if (statusFilters.length && !statusFilters.includes(job.status)) return false;
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
      // The chosen column sort is primary; favorite companies win ties within it.
      const favDiff = favoriteCompanies.has(b.company) - favoriteCompanies.has(a.company);
      const result = cmp(a, b) * sign || favDiff;
      // Stable, sensible tie-break: newest first, then company.
      return result || b.date_found.localeCompare(a.date_found) || a.company.localeCompare(b.company);
    });
  }, [jobs, statusFilters, levelFilter, textFilter, dateFilter, customDate, sort, showNotInterested, flaggedCompanies, favoriteCompanies]);

  // Tile counts match the jobs that are actually reachable in the list, so
  // they exclude not-interested companies unless those are being shown.
  const tileCounts = useMemo(() => {
    const counted = showNotInterested ? jobs : jobs.filter(j => !flaggedCompanies.has(j.company));
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const job of counted) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    return byStatus;
  }, [jobs, flaggedCompanies, showNotInterested]);

  // Ladder-ordered levels present in the data, plus any custom values.
  const levelOptions = useMemo(() => {
    const present = new Set(jobs.map(j => j.level).filter(Boolean));
    return [...LEVELS.filter(l => present.has(l)), ...[...present].filter(l => !LEVELS.includes(l)).sort()];
  }, [jobs]);

  // Count of filters living in the flyout; the search box sits inline in the
  // bar and shows its own state, so it's excluded from the badge and chips.
  const flyoutFilterCount =
    statusFilters.length
    + (levelFilter ? 1 : 0)
    + (dateFilter !== 'any' ? 1 : 0)
    + (showNotInterested ? 1 : 0);
  const filtersActive = flyoutFilterCount > 0 || Boolean(textFilter.trim());

  const clearFilters = () => {
    setStatusFilters([]);
    setLevelFilter('');
    setTextFilter('');
    setDateFilter('any');
    setShowNotInterested(false);
  };

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
          {people.length > 0 && (
            <select
              className="person-select"
              value={personId ?? ''}
              onChange={e => handleSelectPerson(e.target.value)}
              title="Show jobs for this person"
            >
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__add__">＋ Add person…</option>
            </select>
          )}
          {!activeCompany && (
            <button
              className="clear-btn generate-all-btn"
              onClick={handleGenerateInterested}
              disabled={Boolean(batchProgress) || !jobs.some(j => j.status === 'Interested' && !flaggedCompanies.has(j.company))}
              title='Generate a tailored resume & cover letter for every job in "Interested" status'
            >
              {batchProgress ? `Generating ${batchProgress.done}/${batchProgress.total}…` : '✨ Generate for Interested'}
            </button>
          )}
          {!activeCompany && <AddJobForm jobs={jobs} onAdd={handleAdd} />}
          <button className="clear-btn settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {activeCompany && (
        <CompanyPage
          company={
            companies.find(c => c.name === activeCompany)
            || { name: activeCompany, website: '', note: '', company_type: '', employee_count: '', not_interested: 0 }
          }
          jobs={jobs.filter(j => j.company === activeCompany)}
          onBack={() => setActiveCompany(null)}
          onSave={(fields) => handleCompanySave(activeCompany, fields)}
        />
      )}

      {!activeCompany && stats && (
        <div className="tiles">
          {STATUSES.map(s => (
            <button
              key={s}
              className={`tile ${statusFilters.includes(s) ? 'active' : ''}`}
              onClick={() => toggleStatus(s)}
              title={`Toggle ${s} in the status filter`}
            >
              <div className="tile-num" style={{ color: STATUS_COLORS[s] }}>{tileCounts[s] ?? 0}</div>
              <div className="tile-label">{s}</div>
            </button>
          ))}
        </div>
      )}

      {!activeCompany && (
      <div className="controls">
        <FilterFlyout
          statusFilters={statusFilters}
          onToggleStatus={toggleStatus}
          levelFilter={levelFilter}
          setLevelFilter={setLevelFilter}
          levelOptions={levelOptions}
          dateFilter={dateFilter}
          setDateFilter={setDateFilter}
          customDate={customDate}
          setCustomDate={setCustomDate}
          showNotInterested={showNotInterested}
          setShowNotInterested={setShowNotInterested}
          activeCount={flyoutFilterCount}
        />
        <input
          type="text"
          placeholder="Filter by company, title, category..."
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        {statusFilters.map(s => (
          <FilterChip key={s} onRemove={() => toggleStatus(s)}>
            <span className="multi-select-dot" style={{ background: STATUS_COLORS[s] }} />
            {s}
          </FilterChip>
        ))}
        {levelFilter && (
          <FilterChip onRemove={() => setLevelFilter('')}>Level: {levelFilter}</FilterChip>
        )}
        {dateFilter !== 'any' && (
          <FilterChip onRemove={() => setDateFilter('any')}>
            {dateFilter === 'day' ? `Found on ${customDate}` : DATE_FILTER_LABELS[dateFilter]}
          </FilterChip>
        )}
        {showNotInterested && (
          <FilterChip onRemove={() => setShowNotInterested(false)}>Incl. not-interested companies</FilterChip>
        )}
        {filtersActive && (
          <button className="clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <span className="hint">
          {filtersActive ? `${visibleJobs.length} of ${jobs.length} shown · ` : ''}Changes save automatically.
        </span>
      </div>
      )}

      {!activeCompany && (
      <JobTable
        jobs={visibleJobs}
        sort={sort}
        onSort={handleSort}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onEdit={setEditingJob}
        onOpenCompany={setActiveCompany}
        onGenerate={handleGenerateOne}
        generatingIds={generatingIds}
        flaggedCompanies={flaggedCompanies}
        favoriteCompanies={favoriteCompanies}
      />
      )}

      {settingsOpen && personId != null && (
        <SettingsDialog
          personId={personId}
          personName={people.find(p => p.id === personId)?.name}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { flashSaved(); refresh(); }}
        />
      )}

      {addPersonOpen && (
        <AddPersonForm
          onSubmit={handleAddPerson}
          onClose={() => setAddPersonOpen(false)}
        />
      )}

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

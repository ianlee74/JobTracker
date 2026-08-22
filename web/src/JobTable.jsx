import React, { useEffect, useRef, useState } from 'react';
import { STATUSES, STATUS_COLORS, LEVELS, REJECTION_REASONS, formatSalaryRange } from './constants.js';

function NoteInput({ job, onUpdate }) {
  const [value, setValue] = useState(job.note || '');
  const timer = useRef(null);
  const latest = useRef(value);
  const box = useRef(null);

  // Sync external note changes (edit modal, MCP refresh) — but never while the
  // user is typing here, so in-flight keystrokes aren't clobbered.
  useEffect(() => {
    if (document.activeElement !== box.current) {
      setValue(job.note || '');
      latest.current = job.note || '';
    }
  }, [job.id, job.note]);

  const save = (text) => {
    if (text === job.note) return;
    onUpdate(job.id, { note: text });
  };

  const handleChange = (e) => {
    const text = e.target.value;
    setValue(text);
    latest.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(latest.current), 800);
  };

  const handleBlur = () => {
    clearTimeout(timer.current);
    save(latest.current);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <textarea
      ref={box}
      className="note-input"
      placeholder="Add a note..."
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

// Reason for "Not Moving Forward". Custom text is stored directly in
// rejection_reason; the select shows it as "Other" with the text box filled in.
function RejectionReason({ job, onUpdate }) {
  const stored = job.rejection_reason || '';
  const isPreset = stored !== 'Other' && REJECTION_REASONS.includes(stored);
  const selectValue = !stored ? '' : isPreset ? stored : 'Other';
  const [text, setText] = useState(selectValue === 'Other' && stored !== 'Other' ? stored : '');
  const timer = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (document.activeElement !== box.current) {
      setText(stored && stored !== 'Other' && !REJECTION_REASONS.includes(stored) ? stored : '');
    }
  }, [job.id, stored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saveText = (value) => {
    const reason = value.trim() || 'Other';
    if (reason !== stored) onUpdate(job.id, { rejection_reason: reason });
  };

  const handleTextChange = (e) => {
    const value = e.target.value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveText(value), 800);
  };

  return (
    <div className="reason-wrap">
      <select
        className="reason-select"
        value={selectValue}
        onChange={e => {
          setText('');
          onUpdate(job.id, { rejection_reason: e.target.value });
        }}
        title="Why you're not moving forward"
      >
        <option value="">Why not?</option>
        {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      {selectValue === 'Other' && (
        <input
          ref={box}
          className="reason-input"
          placeholder="Enter a reason..."
          value={text}
          onChange={handleTextChange}
          onBlur={() => { clearTimeout(timer.current); saveText(text); }}
        />
      )}
    </div>
  );
}

function JobRow({ job, onUpdate, onDelete, onEdit }) {
  const color = STATUS_COLORS[job.status] || '#6b7280';
  const salaryFlagged = job.salary_confidence === 'flag';
  const salaryRange = formatSalaryRange(job);
  // file:// links are blocked from http pages, so serve them via the server.
  const isLocalFile = (job.url || '').startsWith('file:');
  const href = isLocalFile ? `/api/local-file?url=${encodeURIComponent(job.url)}` : job.url;

  return (
    <tr>
      <td className="cell-date">{job.date_found}</td>
      <td className="cell-title">
        <a href={href} target="_blank" rel="noopener noreferrer">{job.title}</a>
        {isLocalFile && <span className="file-badge" title={`Local file: ${job.url}`}>📄</span>}
        {job.fit && <div className="fit">{job.fit}</div>}
      </td>
      <td>{job.company}</td>
      <td>{job.category}</td>
      <td>
        <select
          className="level-select"
          value={job.level || ''}
          onChange={e => onUpdate(job.id, { level: e.target.value })}
          title="Seniority level (auto-classified from the title; change if wrong)"
        >
          {job.level && !LEVELS.includes(job.level) && <option value={job.level}>{job.level}</option>}
          {!job.level && <option value="">—</option>}
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </td>
      <td>
        <span title={salaryRange && job.salary && job.salary !== salaryRange ? `As listed: ${job.salary}` : undefined}>
          {salaryRange ?? job.salary}
        </span>
        {salaryFlagged && <span className="flag-badge" title="Salary not disclosed / inferred">?</span>}
      </td>
      <td>
        <select
          className="status-select"
          style={{ borderColor: color, color }}
          value={job.status}
          onChange={e => onUpdate(job.id, { status: e.target.value })}
        >
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {job.status === 'Not Moving Forward' && <RejectionReason job={job} onUpdate={onUpdate} />}
      </td>
      <td><NoteInput job={job} onUpdate={onUpdate} /></td>
      <td className="cell-actions">
        <button
          className="edit-btn"
          title="Edit this job"
          onClick={() => onEdit(job)}
        >
          ✎
        </button>
        <button
          className="delete-btn"
          title="Delete this job"
          onClick={() => {
            if (window.confirm(`Delete "${job.title}" at ${job.company}?`)) onDelete(job.id);
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function SortableHeader({ label, sortKey, sort, onSort, width }) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th style={{ width }} className="sortable" onClick={() => onSort(sortKey)} title={`Sort by ${label}`}>
      {label}{arrow}
    </th>
  );
}

export default function JobTable({ jobs, sort, onSort, onUpdate, onDelete, onEdit }) {
  if (!jobs.length) {
    return <div className="empty-state">No jobs match the current filters.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableHeader label="Found" sortKey="date_found" sort={sort} onSort={onSort} width="8%" />
            <SortableHeader label="Title" sortKey="title" sort={sort} onSort={onSort} width="23%" />
            <SortableHeader label="Company" sortKey="company" sort={sort} onSort={onSort} width="11%" />
            <SortableHeader label="Category" sortKey="category" sort={sort} onSort={onSort} width="11%" />
            <SortableHeader label="Level" sortKey="level" sort={sort} onSort={onSort} width="9%" />
            <SortableHeader label="Salary" sortKey="salary" sort={sort} onSort={onSort} width="11%" />
            <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} width="10%" />
            <th style={{ width: '12%' }}>Note</th>
            <th style={{ width: '5%' }}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <JobRow key={job.id} job={job} onUpdate={onUpdate} onDelete={onDelete} onEdit={onEdit} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

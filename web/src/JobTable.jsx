import React, { useEffect, useRef, useState } from 'react';
import { STATUSES, STATUS_COLORS } from './constants.js';

function NoteInput({ job, onUpdate }) {
  const [value, setValue] = useState(job.note || '');
  const timer = useRef(null);
  const latest = useRef(value);

  useEffect(() => {
    setValue(job.note || '');
  }, [job.id]);

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
      className="note-input"
      placeholder="Add a note..."
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}

function JobRow({ job, onUpdate, onDelete }) {
  const color = STATUS_COLORS[job.status] || '#6b7280';
  const salaryFlagged = job.salary_confidence === 'flag';

  return (
    <tr>
      <td className="cell-date">{job.date_found}</td>
      <td className="cell-title">
        <a href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</a>
        {job.fit && <div className="fit">{job.fit}</div>}
      </td>
      <td>{job.company}</td>
      <td>{job.category}</td>
      <td>
        {job.salary}
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
      </td>
      <td><NoteInput job={job} onUpdate={onUpdate} /></td>
      <td className="cell-actions">
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

export default function JobTable({ jobs, sort, onSort, onUpdate, onDelete }) {
  if (!jobs.length) {
    return <div className="empty-state">No jobs match the current filters.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableHeader label="Found" sortKey="date_found" sort={sort} onSort={onSort} width="8%" />
            <SortableHeader label="Title" sortKey="title" sort={sort} onSort={onSort} width="26%" />
            <SortableHeader label="Company" sortKey="company" sort={sort} onSort={onSort} width="13%" />
            <SortableHeader label="Category" sortKey="category" sort={sort} onSort={onSort} width="13%" />
            <SortableHeader label="Salary" sortKey="salary" sort={sort} onSort={onSort} width="12%" />
            <SortableHeader label="Status" sortKey="status" sort={sort} onSort={onSort} width="10%" />
            <th style={{ width: '15%' }}>Note</th>
            <th style={{ width: '3%' }}></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <JobRow key={job.id} job={job} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

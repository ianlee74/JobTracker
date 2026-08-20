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

export default function JobTable({ jobs, onUpdate, onDelete }) {
  if (!jobs.length) {
    return <div className="empty-state">No jobs match the current filters.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: '8%' }}>Found</th>
            <th style={{ width: '26%' }}>Title</th>
            <th style={{ width: '13%' }}>Company</th>
            <th style={{ width: '13%' }}>Category</th>
            <th style={{ width: '12%' }}>Salary</th>
            <th style={{ width: '10%' }}>Status</th>
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

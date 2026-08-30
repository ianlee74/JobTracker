import React, { useEffect, useRef, useState } from 'react';
import { COMPANY_TYPES, EMPLOYEE_COUNTS, STATUS_COLORS, formatSalaryRange, jobHref } from './constants.js';

// Preset dropdown that still displays a custom stored value (e.g. free text
// saved through the MCP server) by listing it as an extra option.
function PresetSelect({ value, options, placeholder, onChange }) {
  const opts = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Info page for one company: website, free-form notes, the favorite star, the
// "Not Interested" flag, and the company's tracked jobs. Changes save automatically.
export default function CompanyPage({ company, jobs, onBack, onSave, isAdmin = true }) {
  const [website, setWebsite] = useState(company.website || '');
  const [note, setNote] = useState(company.note || '');
  const noteTimer = useRef(null);

  useEffect(() => {
    setWebsite(company.website || '');
    setNote(company.note || '');
  }, [company.name]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const saveNote = (text) => {
    if (text !== (company.note || '')) onSave({ note: text });
  };

  const handleNoteChange = (e) => {
    const text = e.target.value;
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => saveNote(text), 800);
  };

  const companyJobs = [...jobs].sort((a, b) => b.date_found.localeCompare(a.date_found));

  return (
    <div className="company-page">
      <button className="clear-btn back-btn" onClick={onBack}>← Back to jobs</button>

      <div className="company-card">
        <div className="company-header">
          <h2>
            <button
              className={`fav-toggle${company.favorite ? ' is-favorite' : ''}`}
              onClick={() => onSave({ favorite: !company.favorite })}
              title={company.favorite ? 'Remove from favorites' : 'Mark as favorite — its jobs are listed first'}
              aria-label={company.favorite ? 'Remove from favorites' : 'Mark as favorite'}
            >
              {company.favorite ? '★' : '☆'}
            </button>
            {company.name}
          </h2>
          {isAdmin && (
            <label className="checkbox-label ni-toggle">
              <input
                type="checkbox"
                checked={Boolean(company.not_interested)}
                onChange={e => onSave({ not_interested: e.target.checked })}
              />
              Not Interested
            </label>
          )}
        </div>
        {Boolean(company.not_interested) && (
          <div className="ni-notice">Jobs from this company are hidden from the job list by default.</div>
        )}
        {isAdmin ? (
          <div className="company-fields">
            <div className="company-fields-row">
              <label>
                Company Type
                <PresetSelect
                  value={company.company_type || ''}
                  options={COMPANY_TYPES}
                  placeholder="Unknown"
                  onChange={company_type => onSave({ company_type })}
                />
              </label>
              <label>
                Employee Count
                <PresetSelect
                  value={company.employee_count || ''}
                  options={EMPLOYEE_COUNTS}
                  placeholder="Unknown"
                  onChange={employee_count => onSave({ employee_count })}
                />
              </label>
            </div>
            <label>
              Website
              <input
                value={website}
                onChange={e => setWebsite(e.target.value)}
                onBlur={() => { if (website !== (company.website || '')) onSave({ website }); }}
                placeholder="https://..."
              />
            </label>
            <label>
              Notes
              <textarea
                value={note}
                onChange={handleNoteChange}
                onBlur={() => { clearTimeout(noteTimer.current); saveNote(note); }}
                placeholder="Anything worth remembering about this company — culture, contacts, interview history..."
              />
            </label>
          </div>
        ) : (
          // Read-only company info for non-admins (they can still favorite it).
          <div className="company-fields company-fields-readonly">
            {(company.company_type || company.employee_count) && (
              <div className="company-fields-row">
                {company.company_type && <div><strong>Type:</strong> {company.company_type}</div>}
                {company.employee_count && <div><strong>Employees:</strong> {company.employee_count}</div>}
              </div>
            )}
            {company.website && (
              <div><strong>Website:</strong> <a href={company.website} target="_blank" rel="noopener noreferrer">{company.website}</a></div>
            )}
            {company.note && <div className="note-readonly">{company.note}</div>}
          </div>
        )}
      </div>

      <div className="company-jobs">
        <div className="company-jobs-title">
          {companyJobs.length} tracked job{companyJobs.length === 1 ? '' : 's'}
        </div>
        {companyJobs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>Found</th>
                  <th style={{ width: '44%' }}>Title</th>
                  <th style={{ width: '14%' }}>Level</th>
                  <th style={{ width: '16%' }}>Salary</th>
                  <th style={{ width: '14%' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {companyJobs.map(job => (
                  <tr key={job.id}>
                    <td className="cell-date">{job.date_found}</td>
                    <td className="cell-title">
                      <a href={jobHref(job.url)} target="_blank" rel="noopener noreferrer">{job.title}</a>
                    </td>
                    <td>{job.level}</td>
                    <td>{formatSalaryRange(job) ?? job.salary}</td>
                    <td style={{ color: STATUS_COLORS[job.status] || 'inherit', fontWeight: 600 }}>{job.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
